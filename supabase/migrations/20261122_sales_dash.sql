-- بيوتفريش: لوحة المبيعات (من بيانات ركاز + المصروفات + التسويق + الفريق)
-- الأرقام تطابق ركاز: إجمالي المبيعات = الطلبات المؤكدة بتاريخ إنشائها، صافي المحصّل = المدفوعات − المسترجع بتاريخ العملية.

create index if not exists rk_resv_start_ix on public.rekaz_reservations (start_at);
create index if not exists rk_resv_cust_ix on public.rekaz_reservations (customer_id, start_at);
create index if not exists rk_orders_created_ix on public.rekaz_orders (created_at);
create index if not exists rk_tx_processed_ix on public.rekaz_transactions (processed_at);

create or replace function private.rd(d date) returns timestamptz
language sql immutable set search_path = '' as $$ select (d::timestamp at time zone 'Asia/Riyadh') $$;

-- كل خدمة في ركاز ← قسمها عندنا
create or replace function private.rk_prod_cat() returns table (product_id text, cat_id bigint, cat text, grp text)
language sql stable set search_path = '' as $$
  select distinct on (p.id) p.id, c.id, c.name, coalesce(c.role, c.grp)
  from public.rekaz_products p
  join public.salon_services s on s.rekaz_slug = p.raw->>'slug'
  join public.salon_svc_cats c on c.id = s.cat_id
  order by p.id, s.id
$$;

-- مؤشرات فترة [d0, d1)
create or replace function private.sd_kpi(d0 date, d1 date) returns jsonb
language sql stable set search_path = '' as $$
  with o as (
    select coalesce(sum(total), 0) sales, coalesce(sum(subtotal), 0) net_sales, coalesce(sum(discount), 0) disc,
           coalesce(sum(tax), 0) tax, count(*) orders
    from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(d0) and created_at < private.rd(d1)),
  t as (
    select coalesce(sum(amount) filter (where type <> 'refund'), 0) paid, coalesce(sum(amount) filter (where type = 'refund'), 0) refunds,
           count(*) filter (where type <> 'refund') ops
    from public.rekaz_transactions where status = 'confirmed' and processed_at >= private.rd(d0) and processed_at < private.rd(d1)),
  r as (
    select coalesce(sum(total) filter (where status = 'confirmed'), 0) svc,
           count(*) filter (where status = 'confirmed') bookings,
           count(distinct customer_id) filter (where status = 'confirmed') clients,
           count(distinct customer_id || '|' || ((start_at at time zone 'Asia/Riyadh')::date)::text) filter (where status = 'confirmed') visits,
           count(*) filter (where status = 'cancelled') cancelled,
           coalesce(sum(total) filter (where status = 'cancelled'), 0) cancelled_value,
           count(*) filter (where status = 'pending' and end_at < now()) noshow,
           coalesce(sum(total) filter (where status = 'pending' and end_at < now()), 0) noshow_value,
           count(*) all_n,
           coalesce(sum(extract(epoch from end_at - start_at) / 3600) filter (where status = 'confirmed'), 0) hours
    from public.rekaz_reservations where start_at >= private.rd(d0) and start_at < private.rd(d1)),
  n as (
    select count(*) new_clients from (
      select customer_id, min(start_at) f from public.rekaz_reservations where status = 'confirmed' group by 1) z
    where f >= private.rd(d0) and f < private.rd(d1)),
  h as (
    select coalesce(sum(total), 0) home from public.home_bookings
    where payment_status = 'paid' and status <> 'cancelled' and starts_at >= private.rd(d0) and starts_at < private.rd(d1))
  select jsonb_build_object(
    'sales', o.sales, 'net_sales', o.net_sales, 'discount', o.disc, 'tax', o.tax, 'orders', o.orders,
    'collected', t.paid - t.refunds, 'paid', t.paid, 'refunds', t.refunds, 'ops', t.ops,
    'svc', r.svc, 'bookings', r.bookings, 'clients', r.clients, 'visits', r.visits,
    'cancelled', r.cancelled, 'cancelled_value', r.cancelled_value, 'noshow', r.noshow, 'noshow_value', r.noshow_value,
    'all', r.all_n, 'hours', round(r.hours, 1), 'new_clients', n.new_clients, 'home', h.home,
    'avg_ticket', case when r.visits > 0 then round(r.svc / r.visits, 2) else 0 end)
  from o, t, r, n, h
$$;

-- سلسلة زمنية (يوم أو شهر)
create or replace function private.sd_series(d0 date, d1 date, monthly boolean) returns jsonb
language sql stable set search_path = '' as $$
  with b as (
    select g::date k from generate_series(case when monthly then date_trunc('month', d0) else d0 end, d1 - 1,
      case when monthly then interval '1 month' else interval '1 day' end) g),
  tx as (
    select case when monthly then date_trunc('month', processed_at at time zone 'Asia/Riyadh')::date else (processed_at at time zone 'Asia/Riyadh')::date end k,
           sum(case when type = 'refund' then -amount else amount end) v
    from public.rekaz_transactions where status = 'confirmed' and processed_at >= private.rd(d0) and processed_at < private.rd(d1) group by 1),
  od as (
    select case when monthly then date_trunc('month', created_at at time zone 'Asia/Riyadh')::date else (created_at at time zone 'Asia/Riyadh')::date end k,
           sum(total) v
    from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(d0) and created_at < private.rd(d1) group by 1),
  rv as (
    select case when monthly then date_trunc('month', start_at at time zone 'Asia/Riyadh')::date else (start_at at time zone 'Asia/Riyadh')::date end k,
           sum(total) v, count(*) n, count(distinct customer_id) c
    from public.rekaz_reservations where status = 'confirmed' and start_at >= private.rd(d0) and start_at < private.rd(d1) group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('k', b.k, 'c', coalesce(tx.v, 0), 's', coalesce(od.v, 0), 'v', coalesce(rv.v, 0),
    'n', coalesce(rv.n, 0), 'cl', coalesce(rv.c, 0)) order by b.k), '[]'::jsonb)
  from b left join tx using (k) left join od using (k) left join rv using (k)
$$;

create or replace function public.sales_dash(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  span int := p_to - p_from + 1;
  d1 date := p_to + 1;
  pf date := p_from - (p_to - p_from + 1);
  monthly boolean := (p_to - p_from) > 62;
  yf date := (p_from - interval '1 year')::date;
  yt date := (d1 - interval '1 year')::date;
  first_day date;
  has_ly boolean;
  cf date; ct date;
  res jsonb;
begin
  if coalesce(private.my_role(), '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  if p_to < p_from or span > 400 then raise exception 'فترة غير صالحة'; end if;
  select (min(created_at) at time zone 'Asia/Riyadh')::date into first_day from public.rekaz_orders;
  has_ly := first_day is not null and first_day <= yf;
  -- السلسلة المقارنة: السنة الماضية إذا موجودة، وإلا الفترة اللي قبل
  if has_ly then cf := yf; ct := yt;
  elsif monthly then cf := (date_trunc('month', p_from) - ((date_trunc('month', p_to) - date_trunc('month', p_from)) + interval '1 month'))::date; ct := date_trunc('month', p_from)::date;
  else cf := pf; ct := p_from; end if;

  with
  rr as (
    select r.*, (r.start_at at time zone 'Asia/Riyadh') lt, greatest(cardinality(coalesce(r.provider_ids, '{}')), 1) pc
    from public.rekaz_reservations r where r.start_at >= private.rd(p_from) and r.start_at < private.rd(d1)),
  rp as (
    select r.product_id, r.total from public.rekaz_reservations r
    where r.status = 'confirmed' and r.start_at >= private.rd(pf) and r.start_at < private.rd(p_from)),
  pc as (select * from private.rk_prod_cat()),
  svc as (
    select rr.product_id, max(rr.product_name) name, max(pc.cat) cat, max(pc.grp) grp, count(*) n, sum(rr.total) v,
           count(distinct rr.customer_id) cl,
           (select coalesce(sum(rp.total), 0) from rp where rp.product_id = rr.product_id) pv,
           (select count(*) from rp where rp.product_id = rr.product_id) pn
    from rr left join pc on pc.product_id = rr.product_id where rr.status = 'confirmed' group by rr.product_id),
  pr as (
    select pid, rr.* from rr, unnest(coalesce(rr.provider_ids, '{}')) pid),
  prov as (
    select pr.pid, max(p.name) name,
      count(*) filter (where pr.status = 'confirmed') n,
      coalesce(sum(pr.total / pr.pc) filter (where pr.status = 'confirmed'), 0) v,
      count(distinct pr.customer_id) filter (where pr.status = 'confirmed') cl,
      coalesce(sum(extract(epoch from pr.end_at - pr.start_at) / 3600) filter (where pr.status = 'confirmed'), 0) hrs,
      count(*) filter (where pr.status = 'cancelled') cx,
      count(*) filter (where pr.status = 'pending' and pr.end_at < now()) ns,
      count(*) all_n
    from pr left join public.rekaz_providers p on p.id = pr.pid group by pr.pid),
  prov_prev as (
    select pid, coalesce(sum(r.total / greatest(cardinality(r.provider_ids), 1)), 0) v
    from public.rekaz_reservations r, unnest(coalesce(r.provider_ids, '{}')) pid
    where r.status = 'confirmed' and r.start_at >= private.rd(pf) and r.start_at < private.rd(p_from) group by pid),
  prov_ret as (  -- عميلات رجعوا لنفس الأخصائية
    select pr.pid, count(distinct pr.customer_id) filter (where exists (
      select 1 from public.rekaz_reservations x where x.customer_id = pr.customer_id and x.status = 'confirmed'
        and x.start_at < pr.start_at - interval '1 day' and x.provider_ids @> array[pr.pid])) ret
    from pr where pr.status = 'confirmed' group by pr.pid),
  prov_top as (
    select pid, jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc) filter (where rk <= 3) top from (
      select pid, product_name name, count(*) n, row_number() over (partition by pid order by count(*) desc) rk
      from pr where status = 'confirmed' group by pid, product_name) z group by pid),
  rev as (
    select * from public.rekaz_reviews where created_at >= private.rd(p_from) and created_at < private.rd(d1)),
  cust as (
    select rr.customer_id, max(rr.customer_name) name, max(rr.phone) phone, count(distinct rr.lt::date) visits, sum(rr.total) v,
           max(rr.lt::date) last, mode() within group (order by rr.product_name) fav
    from rr where rr.status = 'confirmed' group by rr.customer_id order by sum(rr.total) desc limit 15)
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'unit', case when monthly then 'month' else 'day' end,
    'cmp_kind', case when has_ly then 'ly' else 'prev' end, 'first_day', first_day,
    'synced_at', (select max(finished_at) from public.rekaz_sync_log where ok),
    'k', private.sd_kpi(p_from, d1),
    'kp', private.sd_kpi(pf, p_from),
    'ky', case when has_ly then private.sd_kpi(yf, yt) end,
    'series', private.sd_series(p_from, d1, monthly),
    'cmp', private.sd_series(cf, ct, monthly),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', product_id, 'name', name, 'cat', cat, 'grp', grp, 'n', n, 'v', v, 'cl', cl, 'pv', pv, 'pn', pn) order by v desc) from svc), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('grp', grp, 'v', v, 'n', n, 'pv', pv) order by v desc) from (
        select coalesce(grp, 'other') grp, sum(v) v, sum(n) n, sum(pv) pv from svc group by 1) z), '[]'::jsonb),
    'cats', coalesce((select jsonb_agg(jsonb_build_object('cat', cat, 'grp', grp, 'v', v, 'n', n) order by v desc) from (
        select coalesce(cat, 'أخرى') cat, max(grp) grp, sum(v) v, sum(n) n from svc group by 1) z), '[]'::jsonb),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('id', prov.pid, 'name', prov.name, 'n', prov.n, 'v', round(prov.v, 2), 'cl', prov.cl,
        'hrs', round(prov.hrs, 1), 'cx', prov.cx, 'ns', prov.ns, 'all', prov.all_n, 'pv', coalesce(pp.v, 0), 'ret', coalesce(rt.ret, 0), 'top', coalesce(tp.top, '[]'::jsonb),
        'rating', (select round(avg(rating), 2) from rev where rev.provider_names like '%' || prov.name || '%'),
        'reviews', (select count(*) from rev where rev.provider_names like '%' || prov.name || '%')) order by prov.v desc)
      from prov left join prov_prev pp on pp.pid = prov.pid left join prov_ret rt on rt.pid = prov.pid left join prov_top tp on tp.pid = prov.pid
      where prov.name is not null and prov.name not like '%الافتراضي%'), '[]'::jsonb),
    'heat', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'h', h, 'n', n, 'v', v)) from (
        select extract(dow from lt)::int d, extract(hour from lt)::int h, count(*) n, sum(total) v from rr where status = 'confirmed' group by 1, 2) z), '[]'::jsonb),
    'heat_cx', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'h', h, 'n', n)) from (
        select extract(dow from lt)::int d, extract(hour from lt)::int h, count(*) n from rr where status = 'cancelled' or (status = 'pending' and end_at < now()) group by 1, 2) z), '[]'::jsonb),
    'methods', coalesce((select jsonb_agg(jsonb_build_object('m', m, 'v', v, 'n', n) order by v desc) from (
        select coalesce(method, 'other') m, sum(case when type = 'refund' then -amount else amount end) v, count(*) n
        from public.rekaz_transactions where status = 'confirmed' and processed_at >= private.rd(p_from) and processed_at < private.rd(d1) group by 1) z), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('s', s, 'v', v, 'n', n) order by v desc) from (
        select coalesce(source, 'internal') s, sum(total) v, count(*) n from public.rekaz_orders
        where status = 'confirmed' and created_at >= private.rd(p_from) and created_at < private.rd(d1) group by 1) z), '[]'::jsonb),
    'lead', (select jsonb_build_object(
        'same', count(*) filter (where dd < 1), 'd1_2', count(*) filter (where dd >= 1 and dd < 3),
        'd3_7', count(*) filter (where dd >= 3 and dd < 8), 'd8', count(*) filter (where dd >= 8),
        'avg', round(avg(dd), 1)) from (
        select (rr.lt::date - (o.created_at at time zone 'Asia/Riyadh')::date) dd from rr join public.rekaz_orders o on o.id = rr.order_id
        where rr.status = 'confirmed') z),
    'top_clients', coalesce((select jsonb_agg(jsonb_build_object('id', customer_id, 'name', name, 'phone', phone, 'visits', visits, 'v', v, 'last', last, 'fav', fav)) from cust), '[]'::jsonb),
    'reviews', (select jsonb_build_object('n', count(*), 'avg', round(avg(rating), 2),
        'dist', jsonb_build_object('5', count(*) filter (where rating = 5), '4', count(*) filter (where rating = 4), '3', count(*) filter (where rating = 3),
                                   '2', count(*) filter (where rating = 2), '1', count(*) filter (where rating = 1)),
        'low', coalesce((select jsonb_agg(jsonb_build_object('name', customer_name, 'svc', product_name, 'prov', provider_names, 'rating', rating, 'text', description, 'at', created_at) order by created_at desc)
                         from (select * from rev where rating <= 3 order by created_at desc limit 6) l), '[]'::jsonb)) from rev),
    'expenses', (select jsonb_build_object('total', coalesce(sum(amount), 0),
        'cats', coalesce((select jsonb_object_agg(category, s) from (select category, sum(amount) s from public.fin_expenses where day >= p_from and day < d1 group by 1) x), '{}'::jsonb))
        from public.fin_expenses where day >= p_from and day < d1),
    'purchases', (select coalesce(sum(total_amount), 0) from public.purchase_invoices where status = 'approved' and invoice_date >= p_from and invoice_date < d1),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'pct', share_pct) order by sort) from public.fin_partners), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'from', c.starts_on, 'to', c.ends_on, 'spent', coalesce(c.spent, c.budget, 0), 'status', c.status,
        'new_clients', (select count(*) from (select customer_id, min(start_at) f from public.rekaz_reservations where status = 'confirmed' group by 1) z
                        where f >= private.rd(c.starts_on) and f < private.rd(coalesce(c.ends_on, current_date) + 1)),
        'new_rev', (select coalesce(sum(r2.total), 0) from public.rekaz_reservations r2 where r2.status = 'confirmed' and r2.customer_id in (
                        select customer_id from (select customer_id, min(start_at) f from public.rekaz_reservations where status = 'confirmed' group by 1) z
                        where f >= private.rd(c.starts_on) and f < private.rd(coalesce(c.ends_on, current_date) + 1)))) order by c.starts_on desc)
      from public.mkt_campaigns c where c.starts_on <= p_to and coalesce(c.ends_on, current_date) >= p_from), '[]'::jsonb),
    'team', (select count(*) from public.team_members where active)
  ) into res;
  return res;
end $$;
revoke all on function public.sales_dash(date, date) from public, anon;
grant execute on function public.sales_dash(date, date) to authenticated;

-- النبض: اليوم لحظة بلحظة + الشهر + اللي جاي
create or replace function public.sales_pulse() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
  ms date := date_trunc('month', today)::date;
  me date := (date_trunc('month', today) + interval '1 month')::date;
  res jsonb;
begin
  if coalesce(private.my_role(), '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select jsonb_build_object(
    'now', now(), 'today', today,
    'synced_at', (select max(finished_at) from public.rekaz_sync_log where ok),
    'k', private.sd_kpi(today, today + 1),
    'kw', private.sd_kpi(today - 7, today - 6),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 't', t, 'w', w) order by h), '[]'::jsonb) from (
        select g h,
          (select coalesce(sum(case when type = 'refund' then -amount else amount end), 0) from public.rekaz_transactions
            where status = 'confirmed' and processed_at >= private.rd(today) and processed_at < private.rd(today) + make_interval(hours => g + 1)) t,
          (select coalesce(sum(case when type = 'refund' then -amount else amount end), 0) from public.rekaz_transactions
            where status = 'confirmed' and processed_at >= private.rd(today - 7) and processed_at < private.rd(today - 7) + make_interval(hours => g + 1)) w
        from generate_series(0, 23) g) z),
    'left_today', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(total), 0)) from public.rekaz_reservations
        where status in ('confirmed', 'pending') and start_at >= now() and start_at < private.rd(today + 1)),
    'next7', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(total), 0)) from public.rekaz_reservations
        where status in ('confirmed', 'pending') and start_at >= private.rd(today + 1) and start_at < private.rd(today + 8)),
    'next7_ly', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(total), 0)) from public.rekaz_reservations
        where status = 'confirmed' and start_at >= private.rd(today - 6) and start_at < private.rd(today + 1)),
    'rest_month', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(total), 0)) from public.rekaz_reservations
        where status in ('confirmed', 'pending') and start_at >= now() and start_at < private.rd(me)),
    'mtd', private.sd_kpi(ms, today + 1),
    'last_month', private.sd_kpi((ms - interval '1 month')::date, ms),
    'lm_same', private.sd_kpi((ms - interval '1 month')::date, least((today - interval '1 month')::date + 1, ms)),
    'month_days', me - ms, 'day_of_month', today - ms + 1,
    'target', (select revenue from public.fin_targets where month = ms),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', t.processed_at, 'v', t.amount, 'type', t.type, 'm', t.method, 'name', o.customer_name) order by t.processed_at desc)
        from (select * from public.rekaz_transactions where status = 'confirmed' order by processed_at desc limit 8) t
        left join public.rekaz_orders o on o.id = t.order_id), '[]'::jsonb),
    -- عميلات غابوا عن عادتهم (يجون ٣ مرات وأكثر، وتأخروا كثير عن معدلهم، وما عندهم حجز جاي)
    'at_risk', (with v as (
        select customer_id, (start_at at time zone 'Asia/Riyadh')::date d, sum(total) s, max(product_name) p
        from public.rekaz_reservations where status = 'confirmed' and start_at < now() group by 1, 2),
      c as (
        select customer_id, count(*) visits, sum(s) spend, max(d) last, min(d) first,
               (max(d) - min(d))::numeric / nullif(count(*) - 1, 0) gap, mode() within group (order by p) fav
        from v group by 1 having count(*) >= 3),
      risk as (
        select c.*, today - c.last since from c
        where today - c.last > greatest(35, c.gap * 1.8) and today - c.last <= 240
          and not exists (select 1 from public.rekaz_reservations f where f.customer_id = c.customer_id and f.start_at > now() and f.status <> 'cancelled'))
      select jsonb_build_object('n', (select count(*) from risk),
        'monthly_value', (select coalesce(round(sum(spend / greatest((last - first)::numeric / 30, 1))), 0) from risk),
        'list', coalesce((select jsonb_agg(jsonb_build_object('id', r.customer_id, 'name', cu.name, 'phone', cu.phone, 'visits', r.visits, 'spend', r.spend,
              'last', r.last, 'since', r.since, 'gap', round(r.gap), 'fav', r.fav) order by r.spend desc)
            from (select * from risk order by spend desc limit 40) r left join public.rekaz_customers cu on cu.id = r.customer_id), '[]'::jsonb))),
    -- كل شهر: كم عميلة جديدة، وكم رجعت خلال ٦٠ يوم
    'cohorts', (with f as (
        select customer_id, min((start_at at time zone 'Asia/Riyadh')::date) first,
               (array_agg((start_at at time zone 'Asia/Riyadh')::date order by start_at))[2] second_v
        from (select distinct on (customer_id, (start_at at time zone 'Asia/Riyadh')::date) customer_id, start_at
              from public.rekaz_reservations where status = 'confirmed' and start_at < now()) x group by 1)
      select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'r60', r60, 'r', r, 'ready', ready) order by m), '[]'::jsonb) from (
        select date_trunc('month', first)::date m, count(*) n,
               count(*) filter (where second_v is not null and second_v - first <= 60) r60,
               count(*) filter (where second_v is not null) r,
               (date_trunc('month', first) + interval '1 month' + interval '60 days')::date <= today ready
        from f where first >= (ms - interval '11 months') group by 1) z),
    'clients_total', (select count(*) from public.rekaz_customers),
    'active_clients', (select count(distinct customer_id) from public.rekaz_reservations where status = 'confirmed' and start_at >= now() - interval '90 days' and start_at < now())
  ) into res;
  return res;
end $$;
revoke all on function public.sales_pulse() from public, anon;
grant execute on function public.sales_pulse() to authenticated;

-- تصدير الطلبات لفترة (لملف CSV من اللوحة)
create or replace function public.sales_export(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(private.my_role(), '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  if p_to - p_from > 400 then raise exception 'فترة غير صالحة'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'day', (r.start_at at time zone 'Asia/Riyadh')::date, 'time', to_char(r.start_at at time zone 'Asia/Riyadh', 'HH24:MI'),
      'number', r.number, 'client', r.customer_name, 'phone', r.phone, 'service', r.product_name, 'option', r.price_name,
      'provider', r.provider_names, 'status', r.status, 'total', r.total, 'remaining', r.remaining,
      'order', o.seq, 'invoice', o.invoice_no, 'pay', o.payment_status, 'source', o.source) order by r.start_at)
    from public.rekaz_reservations r left join public.rekaz_orders o on o.id = r.order_id
    where r.start_at >= private.rd(p_from) and r.start_at < private.rd(p_to + 1)), '[]'::jsonb);
end $$;
revoke all on function public.sales_export(date, date) from public, anon;
grant execute on function public.sales_export(date, date) to authenticated;
