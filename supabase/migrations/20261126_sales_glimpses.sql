-- لمحات ذكية إضافية: مثل هالفترة من قبل (نفس التاريخ / نفس اليوم من الأسبوع / نفس اليوم هجري)، الأرقام القياسية، السلسلة، الراتب، محطات العميلات
-- المقارنة التاريخية على الحجوزات (موجودة من سبتمبر 2025) والمبيعات من أول طلب مؤكد (ديسمبر 2025)
create or replace function public.sales_glimpses(p_from date, p_to date, p_hoff int default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
  t0 timestamptz := private.rd(p_from);
  t1 timestamptz := least(private.rd(p_to + 1), now());
  ts_today timestamptz := private.rd(today);
  ts_60 timestamptz := private.rd(today - 60);
  ts_7 timestamptz := private.rd(today - 7);
  r_first timestamptz; o_first timestamptz;
  cur numeric; cur_v numeric; cur_n int;
  hist jsonb := '[]'::jsonb;
  sh record; a timestamptz; b timestamptz;
  streak int := 0; avg60 numeric; xd timestamptz; xv numeric;
  med numeric; mcnt int; wk jsonb;
  res jsonb;
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select private.rd((min(start_at) at time zone 'Asia/Riyadh')::date + 1) into r_first from public.rekaz_reservations where status = 'confirmed';
  select private.rd((min(created_at) at time zone 'Asia/Riyadh')::date + 1) into o_first from public.rekaz_orders where status = 'confirmed';
  select coalesce(sum(total), 0) into cur from public.rekaz_orders where status = 'confirmed' and created_at >= t0 and created_at < t1;
  select coalesce(sum(total), 0), count(*) into cur_v, cur_n from public.rekaz_reservations where status = 'confirmed' and start_at >= t0 and start_at < t1;

  -- الأشهر اللي بياناتها ناقصة (بداية التسجيل) ما نقارن فيها
  select percentile_cont(0.5) within group (order by n) into med from (
    select count(*) n from public.rekaz_reservations where status = 'confirmed' and start_at < private.rd(date_trunc('month', today)::date)
    group by date_trunc('month', start_at at time zone 'Asia/Riyadh')) z;

  for sh in select * from (values ('ly', interval '1 year'), ('lw', interval '364 days'), ('hj', make_interval(days => coalesce(p_hoff, 0)))) x(k, iv)
  loop
    continue when sh.k = 'hj' and coalesce(p_hoff, 0) = 0;
    a := t0 - sh.iv; b := t1 - sh.iv;
    continue when a < r_first;
    select count(*) into mcnt from public.rekaz_reservations where status = 'confirmed'
      and start_at >= private.rd(date_trunc('month', a at time zone 'Asia/Riyadh')::date)
      and start_at < private.rd((date_trunc('month', a at time zone 'Asia/Riyadh') + interval '1 month')::date);
    continue when mcnt < coalesce(med, 0) * 0.5;
    hist := hist || jsonb_build_object('k', sh.k, 'from', (a at time zone 'Asia/Riyadh')::date, 'to', ((b - interval '1 second') at time zone 'Asia/Riyadh')::date,
      'v', (select coalesce(sum(total), 0) from public.rekaz_reservations where status = 'confirmed' and start_at >= a and start_at < b),
      'n', (select count(*) from public.rekaz_reservations where status = 'confirmed' and start_at >= a and start_at < b),
      's', case when a >= o_first then (select coalesce(sum(total), 0) from public.rekaz_orders where status = 'confirmed' and created_at >= a and created_at < b) end);
  end loop;

  -- نفس اليوم من الأسابيع الثمانية الماضية (لين نفس الساعة لو اليوم جاري)
  if p_from = p_to then
    select coalesce(jsonb_agg(jsonb_build_object('d', (t0 - make_interval(days => 7 * i)) at time zone 'Asia/Riyadh', 's',
      (select coalesce(sum(total), 0) from public.rekaz_orders where status = 'confirmed'
        and created_at >= t0 - make_interval(days => 7 * i) and created_at < t1 - make_interval(days => 7 * i))) order by i), '[]'::jsonb)
    into wk from generate_series(1, 8) i where t0 - make_interval(days => 7 * i) >= o_first;
  end if;

  select avg(s) into avg60 from (
    select (created_at at time zone 'Asia/Riyadh')::date dd, sum(total) s from public.rekaz_orders
    where status = 'confirmed' and created_at >= greatest(ts_60, o_first) and created_at < ts_today group by 1) z;
  xd := ts_today - interval '1 day';
  loop
    exit when avg60 is null or xd < o_first or streak >= 60;
    select coalesce(sum(total), 0) into xv from public.rekaz_orders where status = 'confirmed' and created_at >= xd and created_at < xd + interval '1 day';
    exit when xv <= avg60;
    streak := streak + 1; xd := xd - interval '1 day';
  end loop;

  with daily as materialized (
    select (created_at at time zone 'Asia/Riyadh')::date dd, sum(total) s from public.rekaz_orders
    where status = 'confirmed' and created_at >= o_first group by 1),
  monthly as (
    select date_trunc('month', dd)::date m, sum(s) s, count(*) dn from daily group by 1),
  pay as (
    select avg(s) filter (where extract(day from dd) >= 27 or extract(day from dd) <= 3) a_in,
           avg(s) filter (where extract(day from dd) between 4 and 26) a_out
    from daily where dd < today),
  recent as (
    select distinct customer_id from public.rekaz_reservations
    where status = 'confirmed' and start_at >= ts_7 and start_at < now() and customer_id is not null),
  visits as (
    select z.customer_id, z.dd, row_number() over (partition by z.customer_id order by z.dd) vn from (
      select distinct r.customer_id, (r.start_at at time zone 'Asia/Riyadh')::date dd from public.rekaz_reservations r
      join recent using (customer_id) where r.status = 'confirmed' and r.start_at < now()) z),
  ms as (
    select vs.vn, vs.dd, c.name, c.phone from visits vs join public.rekaz_customers c on c.id = vs.customer_id
    where vs.vn in (10, 20, 30, 40, 50, 75, 100) and vs.dd >= today - 7 order by vs.vn desc, vs.dd desc limit 12)
  select jsonb_build_object(
    'first_day', (o_first at time zone 'Asia/Riyadh')::date - 1, 'cur', cur, 'cur_v', cur_v, 'cur_n', cur_n, 'hist', hist, 'wk', wk,
    'best_day', (select jsonb_build_object('d', dd, 'v', s) from daily order by s desc limit 1),
    'day_rank', case when p_from = p_to and p_from < today then (select count(*) + 1 from daily where s > cur) end,
    'days_n', (select count(*) from daily),
    'best_month', (select jsonb_build_object('m', m, 'v', s) from monthly where m < date_trunc('month', today)::date and dn >= 25 order by s desc limit 1),
    'month_rank', (select count(*) + 1 from monthly where m < date_trunc('month', today)::date and dn >= 25 and s > coalesce((select s from monthly where m = date_trunc('month', p_from)::date), 0)),
    'months_n', (select count(*) from monthly where m < date_trunc('month', today)::date and dn >= 25),
    'mtd', coalesce((select s from monthly where m = date_trunc('month', today)::date), 0),
    'streak', streak, 'avg60', round(coalesce(avg60, 0)),
    'payday', (select jsonb_build_object('in', round(coalesce(a_in, 0)), 'out', round(coalesce(a_out, 0))) from pay),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('n', vn, 'd', dd, 'name', name, 'phone', phone)) from ms), '[]'::jsonb),
    'today', today) into res;
  return res;
end $$;

revoke all on function public.sales_glimpses(date, date, int) from public, anon;
grant execute on function public.sales_glimpses(date, date, int) to authenticated;
