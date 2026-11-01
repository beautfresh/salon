-- بيوتفريش ↔ ركاز: نسخة قراءة فقط من بيانات ركاز داخل قاعدة بيانات بيوتفريش
-- المزامنة تقرأ من ركاز فقط (صلاحيات *.read)، وما تكتب ولا تعدّل أي شي في ركاز.

create table if not exists public.rekaz_providers (
  id text primary key, name text, raw jsonb, synced_at timestamptz not null default now()
);
create table if not exists public.rekaz_products (
  id text primary key, name text, type text, amount numeric, duration int, raw jsonb, synced_at timestamptz not null default now()
);
create table if not exists public.rekaz_customers (
  id text primary key, number int, name text, phone text, email text, birth_date date, blocked boolean,
  created_at timestamptz, raw jsonb, synced_at timestamptz not null default now()
);
create index if not exists rekaz_customers_phone_idx on public.rekaz_customers (phone);
create table if not exists public.rekaz_reservations (
  id text primary key, number int, customer_id text, customer_name text, phone text, status text,
  product_id text, product_name text, price_name text, provider_ids text[], provider_names text,
  start_at timestamptz, end_at timestamptz, total numeric, remaining numeric, order_id text,
  custom_status text, customer_note text, cancellation_reason text, raw jsonb, synced_at timestamptz not null default now()
);
create index if not exists rekaz_resv_start_idx on public.rekaz_reservations (start_at);
create index if not exists rekaz_resv_customer_idx on public.rekaz_reservations (customer_id);
create table if not exists public.rekaz_orders (
  id text primary key, seq int, status text, payment_status text, source text, customer_id text, customer_name text, phone text,
  subtotal numeric, discount numeric, tax numeric, total numeric, paid numeric, remaining numeric,
  created_at timestamptz, paid_at timestamptz, invoice_no int, raw jsonb, synced_at timestamptz not null default now()
);
create index if not exists rekaz_orders_created_idx on public.rekaz_orders (created_at);
create table if not exists public.rekaz_transactions (
  id text primary key, seq int, type text, status text, method text, amount numeric, order_id text, customer_id text,
  processed_at timestamptz, raw jsonb, synced_at timestamptz not null default now()
);
create index if not exists rekaz_tx_processed_idx on public.rekaz_transactions (processed_at);
create table if not exists public.rekaz_reviews (
  id text primary key, customer_name text, product_name text, provider_names text, rating int, description text, reply text,
  created_at timestamptz, raw jsonb, synced_at timestamptz not null default now()
);
create table if not exists public.rekaz_sync_log (
  id bigint generated always as identity primary key,
  mode text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  ok boolean, counts jsonb, error text
);

do $$
declare t text;
begin
  foreach t in array array['rekaz_providers','rekaz_products','rekaz_customers','rekaz_reservations','rekaz_reviews','rekaz_sync_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- الفلوس: للإدارة فقط
  foreach t in array array['rekaz_orders','rekaz_transactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format($p$create policy %1$s_read on public.%1$s for select to authenticated using (private.my_role() in ('admin','partner'))$p$, t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- أدوات التحويل ----------
create or replace function private.rk_num(j jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(j)
    when 'number' then (j #>> '{}')::numeric
    when 'string' then nullif(regexp_replace(j #>> '{}', '[^0-9.\-]', '', 'g'), '')::numeric
    when 'object' then coalesce(nullif(j->>'amount','')::numeric, nullif(j->>'value','')::numeric)
    else null end
$$;
create or replace function private.rk_ts(t text) returns timestamptz
language sql immutable set search_path = '' as $$ select nullif(t, '')::timestamptz $$;
create or replace function private.rk_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case when d ~ '^9665[0-9]{8}$' then '0' || substr(d, 4)
              when d ~ '^5[0-9]{8}$' then '0' || d
              else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') d) x
$$;
create or replace function private.rk_text(j jsonb) returns text
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(j) when 'object' then coalesce(j->>'ar', j->>'en', j->>'name') when 'string' then j #>> '{}' else null end
$$;

-- يستقبل دفعة من ركاز ويحفظها (للمزامنة فقط)
create or replace function public.rekaz_upsert(p_kind text, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; x jsonb;
begin
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    n := n + 1;
    if p_kind = 'providers' then
      insert into public.rekaz_providers (id, name, raw, synced_at) values (x->>'id', private.rk_text(x->'name'), x, now())
      on conflict (id) do update set name = excluded.name, raw = excluded.raw, synced_at = now();
    elsif p_kind = 'products' then
      insert into public.rekaz_products (id, name, type, amount, duration, raw, synced_at)
      values (x->>'id', private.rk_text(x->'name'), x->>'type', private.rk_num(x->'amount'), nullif(x->>'duration','')::int, x, now())
      on conflict (id) do update set name = excluded.name, type = excluded.type, amount = excluded.amount, duration = excluded.duration, raw = excluded.raw, synced_at = now();
    elsif p_kind = 'customers' then
      insert into public.rekaz_customers (id, number, name, phone, email, birth_date, blocked, created_at, raw, synced_at)
      values (x->>'id', nullif(x->>'customerNumber','')::int, x->>'name', private.rk_phone(x->>'mobileNumber'), x->>'email',
              nullif(left(x->>'birthDate', 10), '')::date, coalesce((x->>'isBlocked')::boolean, false), private.rk_ts(x->>'createdAt'), x, now())
      on conflict (id) do update set number = excluded.number, name = excluded.name, phone = excluded.phone, email = excluded.email,
        birth_date = excluded.birth_date, blocked = excluded.blocked, created_at = excluded.created_at, raw = excluded.raw, synced_at = now();
    elsif p_kind = 'reservations' then
      insert into public.rekaz_reservations (id, number, customer_id, customer_name, phone, status, product_id, product_name, price_name,
        provider_ids, provider_names, start_at, end_at, total, remaining, order_id, custom_status, customer_note, cancellation_reason, raw, synced_at)
      values (x->>'id', nullif(x->>'number','')::int, x->>'customerId', x->>'customerName', private.rk_phone(x->>'customerMobileNumber'),
        x->>'status', x->>'productId', private.rk_text(x->'productName'), private.rk_text(x->'priceName'),
        (select array_agg(coalesce(p->>'id', p #>> '{}')) from jsonb_array_elements(case when jsonb_typeof(x->'providers') = 'array' then x->'providers' else '[]'::jsonb end) p),
        (select string_agg(coalesce(private.rk_text(p->'name'), p->>'providerName', ''), '، ') from jsonb_array_elements(case when jsonb_typeof(x->'providers') = 'array' then x->'providers' else '[]'::jsonb end) p),
        private.rk_ts(x->>'startAt'), private.rk_ts(x->>'endAt'), private.rk_num(x->'totalAmount'), private.rk_num(x->'remainingAmount'),
        x->>'orderId', x->>'customStatusName', x->>'customerNote', x->>'cancellationReason', x, now())
      on conflict (id) do update set number = excluded.number, customer_id = excluded.customer_id, customer_name = excluded.customer_name,
        phone = excluded.phone, status = excluded.status, product_id = excluded.product_id, product_name = excluded.product_name,
        price_name = excluded.price_name, provider_ids = excluded.provider_ids, provider_names = excluded.provider_names,
        start_at = excluded.start_at, end_at = excluded.end_at, total = excluded.total, remaining = excluded.remaining,
        order_id = excluded.order_id, custom_status = excluded.custom_status, customer_note = excluded.customer_note,
        cancellation_reason = excluded.cancellation_reason, raw = excluded.raw, synced_at = now();
    elsif p_kind = 'orders' then
      insert into public.rekaz_orders (id, seq, status, payment_status, source, customer_id, customer_name, phone, subtotal, discount, tax, total, paid, remaining, created_at, paid_at, invoice_no, raw, synced_at)
      values (x->>'id', nullif(x->>'sequentialNumber','')::int, x->>'status', x->>'paymentStatus', x->>'source', x->>'customerId', x->>'customerName',
        private.rk_phone(x->>'customerMobileNumber'), private.rk_num(x->'subtotal'), private.rk_num(x->'discountAmount'), private.rk_num(x->'taxAmount'),
        private.rk_num(x->'totalAmount'), private.rk_num(x->'paidAmount'), private.rk_num(x->'remainingAmount'),
        private.rk_ts(x->>'createdAt'), private.rk_ts(x->>'paidAt'), nullif(x->>'issuedInvoiceSequentialNumber','')::int, x, now())
      on conflict (id) do update set seq = excluded.seq, status = excluded.status, payment_status = excluded.payment_status, source = excluded.source,
        customer_id = excluded.customer_id, customer_name = excluded.customer_name, phone = excluded.phone, subtotal = excluded.subtotal,
        discount = excluded.discount, tax = excluded.tax, total = excluded.total, paid = excluded.paid, remaining = excluded.remaining,
        created_at = excluded.created_at, paid_at = excluded.paid_at, invoice_no = excluded.invoice_no, raw = excluded.raw, synced_at = now();
    elsif p_kind = 'transactions' then
      insert into public.rekaz_transactions (id, seq, type, status, method, amount, order_id, customer_id, processed_at, raw, synced_at)
      values (x->>'id', nullif(x->>'sequentialNumber','')::int, x->>'type', x->>'status', x->>'method', private.rk_num(x->'amount'),
        x->>'orderId', x->>'customerId', private.rk_ts(coalesce(x->>'processedAt', x->>'createdAt')), x, now())
      on conflict (id) do update set seq = excluded.seq, type = excluded.type, status = excluded.status, method = excluded.method, amount = excluded.amount,
        order_id = excluded.order_id, customer_id = excluded.customer_id, processed_at = excluded.processed_at, raw = excluded.raw, synced_at = now();
    elsif p_kind = 'reviews' then
      insert into public.rekaz_reviews (id, customer_name, product_name, provider_names, rating, description, reply, created_at, raw, synced_at)
      values (x->>'id', x->>'customerName', private.rk_text(x->'productName'),
        (select string_agg(coalesce(private.rk_text(p->'name'), ''), '، ') from jsonb_array_elements(case when jsonb_typeof(x->'providers') = 'array' then x->'providers' else '[]'::jsonb end) p),
        nullif(x->>'rating','')::int, x->>'description', x->>'reply', private.rk_ts(x->>'createdAt'), x, now())
      on conflict (id) do update set customer_name = excluded.customer_name, product_name = excluded.product_name, provider_names = excluded.provider_names,
        rating = excluded.rating, description = excluded.description, reply = excluded.reply, created_at = excluded.created_at, raw = excluded.raw, synced_at = now();
    else
      raise exception 'unknown kind %', p_kind;
    end if;
  end loop;
  return n;
end $$;

-- إعدادات المزامنة من الخزنة (للدالة فقط)
create or replace function public.rekaz_sync_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'client_id', (select decrypted_secret from vault.decrypted_secrets where name = 'rekaz_client_id'),
    'client_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rekaz_client_secret'),
    'sync_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rekaz_sync_secret'))
$$;
create or replace function public.rekaz_log(p_mode text, p_ok boolean, p_counts jsonb, p_error text) returns void
language sql security definer set search_path = '' as $$
  insert into public.rekaz_sync_log (mode, finished_at, ok, counts, error) values (p_mode, now(), p_ok, p_counts, left(p_error, 1000));
  delete from public.rekaz_sync_log where started_at < now() - interval '14 days';
$$;
revoke all on function public.rekaz_upsert(text, jsonb), public.rekaz_sync_config(), public.rekaz_log(text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.rekaz_upsert(text, jsonb), public.rekaz_sync_config(), public.rekaz_log(text, boolean, jsonb, text) to service_role;

-- سر داخلي بين قاعدة البيانات ودالة المزامنة (يتولد هنا، ما يحتاج أحد يشوفه)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'rekaz_sync_secret') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'rekaz_sync_secret');
  end if;
end $$;

-- تشغيل المزامنة
create or replace function private.rekaz_kick(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'rekaz_client_secret') then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'rekaz_sync_secret';
  perform net.http_post(
    url := 'https://enrlujtrysrlzwbjexey.supabase.co/functions/v1/rekaz-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 120000);
exception when others then raise warning 'rekaz_kick failed: %', sqlerrm;
end $$;

-- زر «حدّث الحين» في لوحة الإدارة
create or replace function public.rekaz_sync_now() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() not in ('admin','partner') then raise exception 'للإدارة فقط'; end if;
  perform private.rekaz_kick('quick');
end $$;
revoke all on function public.rekaz_sync_now() from public, anon;
grant execute on function public.rekaz_sync_now() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('bf-rekaz-quick', 'bf-rekaz-full');
select cron.schedule('bf-rekaz-quick', '*/10 * * * *', $$select private.rekaz_kick('quick')$$);
select cron.schedule('bf-rekaz-full', '20 0 * * *', $$select private.rekaz_kick('full')$$);
