-- الصلاحيات ٢: ربط الأخصائية بحسابها في ركاز، وتشديد القراءة على البيانات الحساسة، وإخفاء الأرقام المالية عن غير الإدارة
alter table public.profiles add column if not exists provider_id text;

create or replace function private.is_manager() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role()::text, '') in ('admin', 'partner') and private.is_active_user()
$$;
create or replace function private.is_front() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role()::text, '') in ('admin', 'partner', 'reception', 'staff') and private.is_active_user()
$$;

-- الحملات وميزانياتها: للإدارة بس
drop policy if exists mkt_campaigns_read on public.mkt_campaigns;
create policy mkt_campaigns_read on public.mkt_campaigns for select to authenticated using (private.is_manager());
-- بطاقات الهدايا: الإدارة والاستقبال
drop policy if exists gift_vouchers_read on public.gift_vouchers;
create policy gift_vouchers_read on public.gift_vouchers for select to authenticated using (private.is_front());
drop policy if exists gift_vouchers_redeem on public.gift_vouchers;
create policy gift_vouchers_redeem on public.gift_vouchers for update to authenticated using (private.is_front()) with check (private.is_front());
-- فواتير الشراء والموردين: مو للأخصائيات
drop policy if exists invoices_select on public.purchase_invoices;
create policy invoices_select on public.purchase_invoices for select to authenticated using (private.is_front());
drop policy if exists lines_select on public.purchase_invoice_lines;
create policy lines_select on public.purchase_invoice_lines for select to authenticated using (private.is_front());
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated using (private.is_front());
-- مصادر العميلات: أي موظفة معتمدة (بدل أي حساب)
drop policy if exists client_sources_read on public.client_sources;
create policy client_sources_read on public.client_sources for select to authenticated using (private.is_active_user());
drop policy if exists client_sources_write on public.client_sources;
create policy client_sources_write on public.client_sources for all to authenticated using (private.is_active_user()) with check (private.is_active_user());

-- إزالة مفاتيح من JSON بكل مستوياته
create or replace function private.jsonb_strip(j jsonb, ks text[]) returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb; k text; v jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if not (k = any (ks)) then r := r || jsonb_build_object(k, private.jsonb_strip(v, ks)); end if;
    end loop;
    return r;
  elsif jsonb_typeof(j) = 'array' then
    select coalesce(jsonb_agg(private.jsonb_strip(x, ks)), '[]'::jsonb) into r from jsonb_array_elements(j) x;
    return r;
  end if;
  return j;
end $$;

-- ملف العميلة وقائمة العميلات: الأرقام المالية للإدارة بس
alter function public.cx_profile(text) rename to cx_profile_raw;
alter function public.cx_profile_raw(text) set schema private;
create or replace function public.cx_profile(p_id text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb := private.cx_profile_raw(p_id);
begin
  if r is null or private.is_manager() then return r; end if;
  return private.jsonb_strip(r, array['spend', 'v', 'top_pct', 'orders']);
end $$;
alter function public.cx_list(text, text, int, int) rename to cx_list_raw;
alter function public.cx_list_raw(text, text, int, int) set schema private;
create or replace function public.cx_list(p_q text default null, p_seg text default 'all', p_limit int default 60, p_offset int default 0) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb := private.cx_list_raw(p_q, p_seg, p_limit, p_offset);
begin
  if private.is_manager() then return r; end if;
  return private.jsonb_strip(r, array['spend']);
end $$;
revoke all on function private.cx_profile_raw(text) from public, anon, authenticated;
revoke all on function private.cx_list_raw(text, text, int, int) from public, anon, authenticated;
revoke all on function public.cx_profile(text) from public, anon;
revoke all on function public.cx_list(text, text, int, int) from public, anon;
grant execute on function public.cx_profile(text) to authenticated;
grant execute on function public.cx_list(text, text, int, int) to authenticated;

-- صفحة الأخصائية
create or replace function public.staff_me(p_provider_id text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; pn text; td date := (now() at time zone 'Asia/Riyadh')::date; ms date := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date; res jsonb;
begin
  if not private.is_active_user() then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select pr.id, pr.full_name, pr.role, pr.provider_id into p from public.profiles pr where pr.id = auth.uid();
  select name into pn from public.rekaz_providers where id = case when p_provider_id is not null and private.is_manager() then p_provider_id else p.provider_id end;
  if pn is null then return jsonb_build_object('linked', false, 'name', p.full_name); end if;
  perform private.cx_refresh();
  with mine as (
    select r.* from public.rekaz_reservations r
    where r.provider_names is not null and pn = any (array(select trim(x) from unnest(string_to_array(r.provider_names, ',')) x))),
  mon as (
    select coalesce(sum(total), 0) v, count(*) n, count(distinct customer_id) c
    from mine where status = 'confirmed' and start_at >= private.rd(ms) and start_at < now()),
  lmon as (
    select coalesce(sum(total), 0) v, count(*) n from mine where status = 'confirmed'
      and start_at >= private.rd((ms - interval '1 month')::date) and start_at < now() - interval '1 month'),
  rank as (
    select trim(x) prov, sum(r.total) v from public.rekaz_reservations r, unnest(string_to_array(coalesce(r.provider_names, ''), ',')) x
    where r.status = 'confirmed' and r.start_at >= private.rd(ms) and r.start_at < now() and trim(x) <> '' and trim(x) <> 'مزود الخدمة الافتراضي' group by 1),
  rv as (
    select * from public.rekaz_reviews r where r.provider_names is not null and pn = any (array(select trim(x) from unnest(string_to_array(r.provider_names, ',')) x))),
  lastp as (
    select distinct on (customer_id) customer_id, product_name, provider_names, start_at from public.rekaz_reservations
    where status = 'confirmed' and start_at < now() and customer_id is not null order by customer_id, start_at desc),
  due as (
    select l.customer_id, c.name, c.phone, l.product_name, s.visits, s.cadence, (extract(epoch from now() - s.last_at) / 86400)::int days
    from lastp l join public.cx_stats s on s.customer_id = l.customer_id join public.rekaz_customers c on c.id = l.customer_id
    where pn = any (array(select trim(x) from unnest(string_to_array(l.provider_names, ',')) x))
      and s.visits >= 2 and s.next_at is null and s.last_at > now() - interval '240 days'
      and s.last_at < now() - make_interval(days => greatest(21, round(coalesce(s.cadence, 30) * 1.15)::int))
    order by s.spend desc limit 15)
  select jsonb_build_object(
    'linked', true, 'name', p.full_name, 'provider', pn,
    'today', coalesce((select jsonb_agg(jsonb_build_object('at', m.start_at, 'end', m.end_at, 'svc', m.product_name, 'cid', m.customer_id, 'client', m.customer_name, 'st', m.status) order by m.start_at)
        from mine m where (m.start_at at time zone 'Asia/Riyadh')::date = td and m.status in ('confirmed', 'pending')), '[]'::jsonb),
    'week', (select count(*) from mine where status in ('confirmed', 'pending') and start_at >= now() and start_at < private.rd(td + 8)),
    'month', (select to_jsonb(mon) from mon), 'last_month', (select to_jsonb(lmon) from lmon),
    'rank', (select count(*) + 1 from rank where v > (select v from mon)), 'ranked', (select count(*) from rank),
    'rating', (select jsonb_build_object('avg', round(avg(rating)::numeric, 2), 'n', count(*), 'm', count(*) filter (where created_at >= private.rd(ms)))) from rv),
    'reviews', coalesce((select jsonb_agg(x) from (select jsonb_build_object('rating', rating, 'text', description, 'svc', product_name, 'at', created_at) x from rv where length(coalesce(description, '')) > 3 order by created_at desc limit 6) z), '[]'::jsonb),
    'due', coalesce((select jsonb_agg(jsonb_build_object('id', customer_id, 'name', name, 'phone', phone, 'svc', product_name, 'visits', visits, 'days', days)) from due), '[]'::jsonb),
    'logs', (select count(*) from public.cx_log where by_id = auth.uid() and created_at >= private.rd(ms)))
  into res;
  return res;
end $$;
revoke all on function public.staff_me(text) from public, anon;
grant execute on function public.staff_me(text) to authenticated;
