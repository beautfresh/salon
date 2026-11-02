-- المحصّل: كم منه دفعات لطلبات انفتحت قبل الفترة + كم من مبيعات الفترة ما انحصّل
create or replace function private.sd_kpi_t(t0 timestamptz, t1 timestamptz) returns jsonb
language sql stable set search_path = '' as $$
  with o as (
    select coalesce(sum(total), 0) sales, coalesce(sum(subtotal), 0) net_sales, coalesce(sum(discount), 0) disc,
           coalesce(sum(tax), 0) tax, count(*) orders, coalesce(sum(remaining), 0) unpaid
    from public.rekaz_orders where status = 'confirmed' and created_at >= t0 and created_at < t1),
  t as (
    select coalesce(sum(x.amount) filter (where x.type <> 'refund'), 0) paid, coalesce(sum(x.amount) filter (where x.type = 'refund'), 0) refunds,
           count(*) filter (where x.type <> 'refund') ops,
           coalesce(sum(case when x.type = 'refund' then -x.amount else x.amount end) filter (where od.created_at < t0), 0) prev_paid,
           count(distinct x.order_id) filter (where od.created_at < t0 and x.type <> 'refund') prev_orders
    from public.rekaz_transactions x left join public.rekaz_orders od on od.id = x.order_id
    where x.status = 'confirmed' and x.processed_at >= t0 and x.processed_at < t1),
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
    from public.rekaz_reservations where start_at >= t0 and start_at < t1),
  n as (
    select count(*) new_clients from (
      select customer_id, min(start_at) f from public.rekaz_reservations where status = 'confirmed' group by 1) z
    where f >= t0 and f < t1),
  h as (
    select coalesce(sum(total), 0) home from public.home_bookings
    where payment_status = 'paid' and status <> 'cancelled' and starts_at >= t0 and starts_at < t1)
  select jsonb_build_object(
    'sales', o.sales, 'net_sales', o.net_sales, 'discount', o.disc, 'tax', o.tax, 'orders', o.orders,
    'collected', t.paid - t.refunds, 'paid', t.paid, 'refunds', t.refunds, 'ops', t.ops,
    'prev_paid', t.prev_paid, 'prev_orders', t.prev_orders, 'unpaid', o.unpaid,
    'svc', r.svc, 'bookings', r.bookings, 'clients', r.clients, 'visits', r.visits,
    'cancelled', r.cancelled, 'cancelled_value', r.cancelled_value, 'noshow', r.noshow, 'noshow_value', r.noshow_value,
    'all', r.all_n, 'hours', round(r.hours, 1), 'new_clients', n.new_clients, 'home', h.home,
    'avg_ticket', case when r.visits > 0 then round(r.svc / r.visits, 2) else 0 end)
  from o, t, r, n, h
$$;
