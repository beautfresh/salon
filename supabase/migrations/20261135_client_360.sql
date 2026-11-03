-- ملف العميلة الذكي: قائمة العميلات من ركاز + ملف كامل لكل عميلة + ملاحظات الصالون عليها

create table if not exists public.cx_notes (
  customer_id text primary key,
  prefs text, allergies text, notes text,
  ai_summary text, ai_at timestamptz,
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.cx_notes enable row level security;
create policy cx_notes_staff on public.cx_notes for all to authenticated
  using (private.my_role() is not null) with check (private.my_role() is not null);
grant select, insert, update on public.cx_notes to authenticated;

-- ملخص كل عميلة (يُحسب وقت الطلب)
create or replace function private.cx_agg() returns table (
  customer_id text, visits int, spend numeric, first_at timestamptz, last_at timestamptz,
  next_at timestamptz, today_at timestamptz, cancels int, cadence int)
language sql stable set search_path = '' as $$
  with r as (
    select customer_id, status, start_at, total, (start_at at time zone 'Asia/Riyadh')::date dd
    from public.rekaz_reservations where customer_id is not null)
  select customer_id,
    count(distinct dd) filter (where status = 'confirmed' and start_at < now())::int,
    coalesce(sum(total) filter (where status = 'confirmed' and start_at < now()), 0),
    min(start_at) filter (where status = 'confirmed' and start_at < now()),
    max(start_at) filter (where status = 'confirmed' and start_at < now()),
    min(start_at) filter (where status in ('confirmed', 'pending') and start_at >= now()),
    min(start_at) filter (where status in ('confirmed', 'pending') and dd = (now() at time zone 'Asia/Riyadh')::date),
    count(*) filter (where status = 'cancelled')::int,
    case when count(distinct dd) filter (where status = 'confirmed' and start_at < now()) >= 3 then
      round(extract(epoch from max(start_at) filter (where status = 'confirmed' and start_at < now()) - min(start_at) filter (where status = 'confirmed' and start_at < now())) / 86400
        / (count(distinct dd) filter (where status = 'confirmed' and start_at < now()) - 1))::int end
  from r group by customer_id
$$;

create or replace function public.cx_list(p_q text default null, p_seg text default 'all', p_limit int default 60, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb; qq text := nullif(trim(coalesce(p_q, '')), ''); qd text;
begin
  if private.my_role() is null then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  qd := nullif(regexp_replace(translate(coalesce(qq, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
  with ag as materialized (select * from private.cx_agg()),
  vm as (select percentile_cont(0.95) within group (order by spend) vip_min from ag where spend > 0),
  b as (
    select c.id, c.name, c.phone, a.visits, a.spend, a.last_at, a.next_at, a.today_at, a.cadence, a.first_at,
      (extract(epoch from now() - a.last_at) / 86400)::int days,
      case
        when a.visits = 0 and a.next_at is not null then 'new'
        when a.spend >= vm.vip_min and a.visits >= 2 then 'vip'
        when a.first_at > now() - interval '45 days' then 'new'
        when a.visits >= 2 and a.next_at is null and a.last_at < now() - make_interval(days => greatest(45, round(coalesce(a.cadence, 30) * 1.8)::int)) and a.last_at > now() - interval '365 days' then 'away'
        when a.visits >= 3 then 'regular'
        else 'once' end seg
    from public.rekaz_customers c join ag a on a.customer_id = c.id cross join vm
    where coalesce(a.visits, 0) > 0 or a.next_at is not null),
  f as (
    select * from b where
      (qq is null or b.name ilike '%' || qq || '%' or (qd is not null and length(qd) >= 3 and regexp_replace(coalesce(b.phone, ''), '\D', '', 'g') like '%' || qd || '%'))
      and (p_seg = 'all' or b.seg = p_seg or (p_seg = 'today' and b.today_at is not null)))
  select jsonb_build_object(
    'counts', (select jsonb_build_object('all', count(*), 'vip', count(*) filter (where seg = 'vip'), 'regular', count(*) filter (where seg = 'regular'),
        'away', count(*) filter (where seg = 'away'), 'new', count(*) filter (where seg = 'new'), 'today', count(*) filter (where today_at is not null)) from b),
    'total', (select count(*) from f),
    'list', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'visits', visits, 'spend', round(spend), 'seg', seg,
        'last', (last_at at time zone 'Asia/Riyadh')::date, 'days', days, 'next', next_at, 'today', today_at, 'cadence', cadence) x
      from f order by
        case when p_seg = 'today' then extract(epoch from today_at) end asc nulls last,
        case when p_seg = 'away' then spend end desc nulls last,
        case when qq is not null then visits end desc nulls last,
        last_at desc nulls last
      limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)) z), '[]'::jsonb))
  into res;
  return res;
end $$;

create or replace function public.cx_profile(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record; a record; res jsonb; vip_min numeric; rank_pct numeric; p9 text;
begin
  if private.my_role() is null then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select * into c from public.rekaz_customers where id = p_id;
  if not found then return null; end if;
  p9 := private.phone9(c.phone);
  select * into a from private.cx_agg() x where x.customer_id = p_id;
  select round(100.0 * count(*) filter (where s.spend > coalesce(a.spend, 0)) / greatest(count(*), 1), 1) into rank_pct
    from (select customer_id, sum(total) spend from public.rekaz_reservations where status = 'confirmed' and start_at < now() group by 1) s;
  with r as (
    select * from public.rekaz_reservations where customer_id = p_id),
  days as (
    select (start_at at time zone 'Asia/Riyadh')::date dd, min(start_at) at0,
      jsonb_agg(jsonb_build_object('svc', product_name, 'by', provider_names, 'v', total, 'st', status, 'at', start_at) order by start_at) items,
      sum(total) filter (where status = 'confirmed') v,
      bool_or(status = 'confirmed') ok, bool_and(status = 'cancelled') cx
    from r group by 1)
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'number', c.number, 'birth', c.birth_date, 'since', c.created_at, 'blocked', c.blocked,
    'visits', coalesce(a.visits, 0), 'spend', round(coalesce(a.spend, 0)), 'first', a.first_at, 'last', a.last_at, 'cadence', a.cadence,
    'cancels', coalesce(a.cancels, 0),
    'noshow', (select count(*) from r where status = 'pending' and end_at < now()),
    'top_pct', rank_pct,
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('at', start_at, 'svc', product_name, 'by', provider_names, 'v', total, 'st', status) order by start_at)
        from r where start_at >= now() and status in ('confirmed', 'pending')), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(x order by (x->>'n')::int desc, x->>'last' desc) from (
        select jsonb_build_object('name', product_name, 'n', count(*), 'v', round(sum(total)), 'last', max(start_at)) x
        from r where status = 'confirmed' and start_at < now() group by product_name order by count(*) desc limit 8) z), '[]'::jsonb),
    'providers', coalesce((select jsonb_agg(x order by (x->>'n')::int desc) from (
        select jsonb_build_object('name', trim(pn), 'n', count(*), 'last', max(start_at)) x
        from r, unnest(string_to_array(coalesce(provider_names, ''), ',')) pn
        where status = 'confirmed' and start_at < now() and trim(pn) <> '' group by trim(pn) order by count(*) desc limit 5) z), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('m', m, 'n', n, 'v', v) order by m) from (
        select to_char(date_trunc('month', dd), 'YYYY-MM') m, count(*) filter (where ok) n, round(coalesce(sum(v), 0)) v
        from days where dd >= (now() at time zone 'Asia/Riyadh')::date - 365 and dd <= (now() at time zone 'Asia/Riyadh')::date group by 1) z), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('d', dd, 'items', items, 'v', round(coalesce(v, 0)), 'cx', cx) order by dd desc)
        from (select * from days where at0 < now() order by dd desc limit 40) z), '[]'::jsonb),
    'orders', (select jsonb_build_object('n', count(*) filter (where status = 'confirmed'), 'web', count(*) filter (where source = 'website'),
        'web_unpaid', count(*) filter (where source = 'website' and status = 'pending'), 'remaining', round(coalesce(sum(remaining) filter (where status = 'confirmed'), 0)),
        'discount', round(coalesce(sum(discount) filter (where status = 'confirmed'), 0)))
      from public.rekaz_orders where customer_id = p_id),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', rating, 'text', description, 'svc', product_name, 'by', provider_names, 'at', created_at) order by created_at desc)
        from public.rekaz_reviews where customer_name = c.name and c.name is not null and length(c.name) > 3), '[]'::jsonb),
    'source', (select source from public.client_sources where phone9 = p9),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'amount', amount, 'balance', balance, 'status', status, 'to', to_phone = c.phone or private.phone9(to_phone) = p9))
        from public.gift_vouchers where p9 is not null and (private.phone9(to_phone) = p9 or private.phone9(from_phone) = p9)), '[]'::jsonb),
    'winback', (select jsonb_build_object('at', coalesce(sent_at, created_at), 'status', status) from public.winback_msgs where customer_id = p_id order by created_at desc limit 1),
    'note', (select to_jsonb(n) - 'customer_id' from public.cx_notes n where n.customer_id = p_id))
  into res;
  return res;
end $$;

revoke all on function public.cx_list(text, text, int, int) from public, anon;
revoke all on function public.cx_profile(text) from public, anon;
grant execute on function public.cx_list(text, text, int, int) to authenticated;
grant execute on function public.cx_profile(text) to authenticated;
