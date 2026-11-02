-- بطاقات الإهداء الرقمية: رابط خاص لكل بطاقة، تصميم، رصيد، وطلبات من الموقع
alter table public.gift_vouchers add column if not exists token uuid not null default gen_random_uuid();
alter table public.gift_vouchers add column if not exists status text not null default 'active';
alter table public.gift_vouchers add column if not exists design jsonb not null default '{}'::jsonb;
alter table public.gift_vouchers add column if not exists occasion text;
alter table public.gift_vouchers add column if not exists to_phone text;
alter table public.gift_vouchers add column if not exists from_phone text;
alter table public.gift_vouchers add column if not exists balance numeric(10,2);
alter table public.gift_vouchers add column if not exists deliver_on date;
alter table public.gift_vouchers add column if not exists opened_at timestamptz;
alter table public.gift_vouchers add column if not exists source text not null default 'admin';
alter table public.gift_vouchers add column if not exists bookings int[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gift_vouchers_status_chk') then
    alter table public.gift_vouchers add constraint gift_vouchers_status_chk check (status in ('pending', 'active', 'used', 'cancelled'));
  end if;
end $$;
create unique index if not exists gift_vouchers_token_ix on public.gift_vouchers (token);
update public.gift_vouchers set balance = amount where balance is null and amount is not null;
update public.gift_vouchers set status = 'used' where redeemed_on is not null and status = 'active';

create or replace function private.gift_code() returns text
language plpgsql volatile set search_path = '' as $$
declare c text; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    c := 'BF-' || (select string_agg(substr(a, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1), '') from generate_series(1, 5));
    exit when not exists (select 1 from public.gift_vouchers where code = c);
  end loop;
  return c;
end $$;

-- طلب بطاقة من الموقع (قبل الدفع): يتفعّل من الإدارة بعد ما يتأكد الدفع
create or replace function public.gift_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.gift_vouchers; amt numeric := nullif(p->>'amount', '')::numeric;
  tp text := regexp_replace(coalesce(p->>'to_phone', ''), '\D', '', 'g');
  fp text := regexp_replace(coalesce(p->>'from_phone', ''), '\D', '', 'g');
begin
  if amt is null or amt < 100 or amt > 5000 then raise exception 'القيمة لازم تكون بين ١٠٠ و٥٠٠٠ ريال'; end if;
  if length(trim(coalesce(p->>'to_name', ''))) < 2 then raise exception 'اكتبي اسمها'; end if;
  if tp !~ '^05[0-9]{8}$' then raise exception 'رقم جوالها غير صحيح'; end if;
  if fp <> '' and fp !~ '^05[0-9]{8}$' then raise exception 'رقم جوالك غير صحيح'; end if;
  if (select count(*) from public.gift_vouchers where status = 'pending' and source = 'web' and created_at > now() - interval '1 hour') > 30 then
    raise exception 'فيه ضغط على الطلبات، جربي بعد شوي'; end if;
  insert into public.gift_vouchers (code, value_text, amount, balance, to_name, from_name, message, to_phone, from_phone, occasion, design,
      deliver_on, expires_on, paid, status, source, created_by)
  values (private.gift_code(), 'قسيمة ' || amt::int || ' ريال', amt, amt, left(trim(p->>'to_name'), 60), nullif(left(trim(coalesce(p->>'from_name', '')), 60), ''),
      nullif(left(trim(coalesce(p->>'message', '')), 200), ''), tp, nullif(fp, ''), left(coalesce(p->>'occasion', ''), 30),
      coalesce(p->'design', '{}'::jsonb) - 'x', nullif(p->>'deliver_on', '')::date, null, false, 'pending', 'web', null)
  returning * into v;
  begin
    perform private.push_admins('طلب قسيمة هدية 🎁', 'قسيمة ' || amt::int || ' ريال إلى ' || v.to_name, '#/kit?t=gifts', 'gift-' || v.id, null);
  exception when others then null; end;
  return jsonb_build_object('ref', v.id, 'code', v.code);
end $$;
revoke all on function public.gift_request(jsonb) from public;
grant execute on function public.gift_request(jsonb) to anon, authenticated;

-- فتح البطاقة برابطها (للمهدى لها)
create or replace function public.gift_open(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.gift_vouchers;
begin
  select * into v from public.gift_vouchers where token = p_token;
  if not found or v.status in ('pending', 'cancelled') then return null; end if;
  if v.opened_at is null then update public.gift_vouchers set opened_at = now() where id = v.id; end if;
  return jsonb_build_object('to', v.to_name, 'phone', v.to_phone, 'from', v.from_name, 'message', v.message, 'amount', v.amount, 'balance', coalesce(v.balance, v.amount),
    'value_text', v.value_text, 'occasion', v.occasion, 'design', v.design, 'code', v.code, 'issued', v.issued_on, 'expires', v.expires_on,
    'status', case when v.status = 'used' or coalesce(v.balance, 1) <= 0 then 'used' when v.expires_on < current_date then 'expired' else 'active' end);
end $$;
revoke all on function public.gift_open(uuid) from public;
grant execute on function public.gift_open(uuid) to anon, authenticated;

-- تفعيل طلب بعد الدفع
create or replace function public.gift_activate(p_id bigint) returns public.gift_vouchers
language plpgsql security definer set search_path = '' as $$
declare v public.gift_vouchers;
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  update public.gift_vouchers set status = 'active', paid = true, issued_on = current_date,
    expires_on = coalesce(expires_on, (current_date + interval '6 months')::date), balance = coalesce(balance, amount)
  where id = p_id and status = 'pending' returning * into v;
  if not found then raise exception 'الطلب غير موجود أو مفعّل من قبل'; end if;
  return v;
end $$;
revoke all on function public.gift_activate(bigint) from public, anon;
grant execute on function public.gift_activate(bigint) to authenticated;

-- استخدام من الرصيد في الصالون
create or replace function public.gift_redeem(p_id bigint, p_amount numeric) returns public.gift_vouchers
language plpgsql security definer set search_path = '' as $$
declare v public.gift_vouchers;
begin
  if not private.is_active_user() then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select * into v from public.gift_vouchers where id = p_id for update;
  if not found or v.status <> 'active' then raise exception 'القسيمة غير سارية'; end if;
  if v.expires_on is not null and v.expires_on < current_date then raise exception 'القسيمة منتهية'; end if;
  if v.balance is not null and (p_amount is null or p_amount <= 0 or p_amount > v.balance) then raise exception 'المبلغ أكبر من الرصيد'; end if;
  update public.gift_vouchers set
    balance = case when v.balance is null then null else v.balance - p_amount end,
    status = case when v.balance is null or v.balance - p_amount <= 0 then 'used' else 'active' end,
    redeemed_on = case when v.balance is null or v.balance - p_amount <= 0 then current_date else redeemed_on end
  where id = p_id returning * into v;
  return v;
end $$;
revoke all on function public.gift_redeem(bigint, numeric) from public, anon;
grant execute on function public.gift_redeem(bigint, numeric) to authenticated;

-- حجز من البطاقة: نربط رقم حجز ركاز بالبطاقة (تستدعيه دالة الحجز فقط)
create or replace function public.gift_mark_booking(p_token uuid, p_number int) returns void
language sql security definer set search_path = '' as $$
  update public.gift_vouchers set bookings = array_append(bookings, p_number) where token = p_token and status = 'active' and not (p_number = any(bookings))
$$;
revoke all on function public.gift_mark_booking(uuid, int) from public, anon, authenticated;
grant execute on function public.gift_mark_booking(uuid, int) to service_role;
