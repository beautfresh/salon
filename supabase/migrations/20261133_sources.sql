-- «كيف عرفتنا؟»: مصدر كل عميلة جديدة (من صفحة الحجز أو من الاستقبال)
create table if not exists public.client_sources (
  phone9 text primary key check (phone9 ~ '^5[0-9]{8}$'),
  source text not null check (source in ('instagram','tiktok','snapchat','google','friend','passby','influencer','whatsapp','other')),
  via text not null default 'web' check (via in ('web','desk')),
  at timestamptz not null default now(),
  by_user uuid
);
alter table public.client_sources enable row level security;
drop policy if exists client_sources_read on public.client_sources;
create policy client_sources_read on public.client_sources for select to authenticated using (true);
drop policy if exists client_sources_write on public.client_sources;
create policy client_sources_write on public.client_sources for all to authenticated using (true) with check (true);

create or replace function private.phone9(p text) returns text language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '')
$$;

-- من صفحة الحجز (بدون تسجيل): أول إجابة بس تنحفظ
create or replace function public.src_submit(p_phone text, p_source text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text := private.phone9(p_phone);
begin
  if k is null or k !~ '^5[0-9]{8}$' then return false; end if;
  if p_source not in ('instagram','tiktok','snapchat','google','friend','passby','influencer','whatsapp','other') then return false; end if;
  insert into public.client_sources (phone9, source, via) values (k, p_source, 'web') on conflict (phone9) do nothing;
  return true;
end $$;
revoke all on function public.src_submit(text, text) from public;
grant execute on function public.src_submit(text, text) to anon, authenticated;

-- للإدارة والاستقبال: العميلات الجدد (أول زيارة مؤكدة) مع مصدرهن
create or replace function public.src_new(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t0 timestamptz := private.rd((now() at time zone 'Asia/Riyadh')::date) - make_interval(days => greatest(1, least(p_days, 90)) - 1);
begin
  if auth.uid() is null then raise exception 'سجّلي دخولك'; end if;
  return jsonb_build_object(
    'list', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
      select jsonb_build_object('phone9', private.phone9(c.phone), 'name', c.name, 'at', min(r.start_at), 'service', (array_agg(r.product_name order by r.start_at))[1],
        'source', s.source, 'via', s.via) x
      from public.rekaz_reservations r join public.rekaz_customers c on c.id = r.customer_id
      left join public.client_sources s on s.phone9 = private.phone9(c.phone)
      where r.status <> 'cancelled' and r.start_at >= t0 and r.start_at < now() + interval '1 day'
        and not exists (select 1 from public.rekaz_reservations r2 where r2.customer_id = r.customer_id and r2.status = 'confirmed' and r2.start_at < t0)
      group by c.id, c.name, c.phone, s.source, s.via) z), '[]'::jsonb),
    'mix', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from public.client_sources where at >= now() - interval '90 days' group by 1) z), '{}'::jsonb)
  );
end $$;
revoke all on function public.src_new(int) from public;
grant execute on function public.src_new(int) to authenticated;

create or replace function public.biz_lens() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  td date := (now() at time zone 'Asia/Riyadh')::date;
  t0 timestamptz := private.rd(td);
  ws date := td - ((extract(dow from td)::int + 1) % 7);           -- بداية الأسبوع (السبت)
  ms date := date_trunc('month', td)::date;
  qs date := date_trunc('quarter', td)::date;
  ys date := date_trunc('year', td)::date;
  r jsonb; lv jsonb; crit jsonb; lvl int := 0; i int;
  rv_n int; rv_avg numeric; src_pct numeric; posted30 int; web_share numeric; new30 int; camp_measured int; sched14 int; prep_ok boolean; compass_ok boolean;
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;

  -- سلّم التسويق
  select count(*), round(avg(rating), 2) into rv_n, rv_avg from public.rekaz_reviews;
  select count(*) into posted30 from public.mkt_posts where status = 'posted' and coalesce(publish_on, updated_at::date) >= td - 30;
  select round(100.0 * count(*) filter (where source = 'website') / nullif(count(*), 0), 1) into web_share from public.rekaz_orders where status = 'confirmed' and created_at >= t0 - interval '30 days';
  select count(distinct r.customer_id) into new30 from public.rekaz_reservations r where r.status = 'confirmed' and r.start_at >= t0 - interval '30 days' and r.start_at < t0 + interval '1 day'
    and not exists (select 1 from public.rekaz_reservations r2 where r2.customer_id = r.customer_id and r2.status = 'confirmed' and r2.start_at < t0 - interval '30 days');
  select count(*) into camp_measured from public.mkt_campaigns where starts_on >= td - 90 and goal_clients is not null and new_clients is not null;
  select count(*) into sched14 from public.mkt_posts where publish_on between td and td + 14;
  select not exists (select 1 from public.mkt_seasons s where s.starts_on > td and s.starts_on - td <= coalesce(s.prep_days, 21)
                       and not exists (select 1 from public.mkt_campaigns c where c.season_id = s.id)) into prep_ok;
  select coalesce((data->>'draft')::boolean, true) = false into compass_ok from public.brand_compass where id = 1;
  select round(100.0 * count(*) filter (where exists (select 1 from public.client_sources s where s.phone9 = private.phone9(c.phone))) / nullif(count(*), 0)) into src_pct
    from (select distinct r.customer_id from public.rekaz_reservations r where r.status = 'confirmed' and r.start_at >= t0 - interval '30 days' and r.start_at < t0 + interval '1 day'
          and not exists (select 1 from public.rekaz_reservations r2 where r2.customer_id = r.customer_id and r2.status = 'confirmed' and r2.start_at < t0 - interval '30 days')) z
    join public.rekaz_customers c on c.id = z.customer_id;
  crit := jsonb_build_array(
    jsonb_build_object('lv', 1, 't', 'صفحة حجز وموقع شغالين', 'ok', true, 'go', '#/site'),
    jsonb_build_object('lv', 1, 't', 'البوصلة معتمدة (مو مسودة)', 'ok', coalesce(compass_ok, false), 'go', '#/marketing?t=compass'),
    jsonb_build_object('lv', 2, 't', format('١٠٠ تقييم وفوق بمتوسط ٤٫٥ (عندكم %s بمتوسط %s)', rv_n, rv_avg), 'ok', rv_n >= 100 and rv_avg >= 4.5, 'go', '#/site?t=reviews'),
    jsonb_build_object('lv', 2, 't', format('٨ منشورات منشورة في آخر ٣٠ يوم (عندكم %s)', posted30), 'ok', posted30 >= 8, 'go', '#/marketing?t=content'),
    jsonb_build_object('lv', 3, 't', format('١٥٪ من الطلبات تجي من الموقع (الحين %s٪)', coalesce(web_share, 0)), 'ok', coalesce(web_share, 0) >= 15, 'go', '#/sales'),
    jsonb_build_object('lv', 3, 't', format('٣٠ عميلة جديدة بالشهر (آخر ٣٠ يوم: %s)', new30), 'ok', new30 >= 30, 'go', '#/sales?tab=clients'),
    jsonb_build_object('lv', 4, 't', 'حملة في آخر ٩٠ يوم بهدف ونتيجة مسجلة', 'ok', camp_measured > 0, 'go', '#/marketing?t=campaigns'),
    jsonb_build_object('lv', 4, 't', format('مصدر ٧٠٪ من العميلات الجدد مسجل («كيف عرفتنا؟»، الحين %s٪)', coalesce(src_pct, 0)), 'ok', coalesce(src_pct, 0) >= 70, 'go', '#/marketing?t=sources'),
    jsonb_build_object('lv', 5, 't', format('محتوى مجدول لأسبوعين قدام: ٦ منشورات (مجدول %s)', sched14), 'ok', sched14 >= 6, 'go', '#/marketing?t=content'),
    jsonb_build_object('lv', 5, 't', 'كل موسم قريب له حملة قبل وقته', 'ok', prep_ok, 'go', '#/marketing'));
  for i in 1..5 loop
    exit when exists (select 1 from jsonb_array_elements(crit) c where (c->>'lv')::int = i and not (c->>'ok')::boolean);
    lvl := i;
  end loop;
  lv := jsonb_build_object('level', lvl, 'crit', crit);

  r := jsonb_build_object(
    'today', td,
    'ladder', lv,
    -- اليوم: التشغيل
    'd', jsonb_build_object(
      'appts', (select count(*) from public.rekaz_reservations where start_at >= t0 and start_at < t0 + interval '1 day' and status <> 'cancelled'),
      'left', (select count(*) from public.rekaz_reservations where start_at >= now() and start_at < t0 + interval '1 day' and status <> 'cancelled'),
      'lists', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'name', l.name,
                  'total', (select count(*) from public.ops_list_items i where i.list_id = l.id),
                  'done', coalesce((select count(*) from public.ops_runs o, jsonb_each(o.done) e where o.list_id = l.id and o.day = (case when l.kind = 'weekly' then ws else td end) and e.value::text not in ('false', 'null')), 0)) order by l.sort)
                from public.ops_lists l), '[]'::jsonb),
      'maint', (select count(*) from public.maint_issues where status = 'open'),
      'complaints', (select count(*) from public.client_feedback where kind = 'complaint' and status = 'open'),
      'web_pending', (select count(*) from public.rekaz_orders where source = 'website' and status = 'pending' and created_at >= t0 - interval '1 day')),
    -- الأسبوع: التنفيذ
    'w', jsonb_build_object(
      'from', ws,
      'posts', (select jsonb_build_object('n', count(*), 'posted', count(*) filter (where status = 'posted'), 'ready', count(*) filter (where status = 'ready'),
                  'late', count(*) filter (where status <> 'posted' and publish_on < td)) from public.mkt_posts where publish_on between ws and ws + 6),
      'next7', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(total), 0)) from public.rekaz_reservations where start_at >= now() and start_at < t0 + interval '8 days' and status <> 'cancelled'),
      'kpi', private.sd_kpi_t(private.rd(ws), now()),
      'kpi_prev', private.sd_kpi_t(private.rd(ws - 7), now() - interval '7 days'),
      'leaves', (select count(*) from public.team_leaves where status = 'pending')),
    -- الشهر: المطابقة
    'm', jsonb_build_object(
      'from', ms,
      'kpi', private.sd_kpi_t(private.rd(ms), now()),
      'kpi_prev', private.sd_kpi_t(private.rd((ms - interval '1 month')::date), least(private.rd(ms), now() - interval '1 month')),
      'target', (select revenue from public.fin_targets where month = ms),
      'days', extract(day from (ms + interval '1 month' - interval '1 day'))::int,
      'day', extract(day from td)::int,
      'reviews', (select jsonb_build_object('n', count(*), 'avg', round(avg(rating), 2), 'low', count(*) filter (where rating <= 3)) from public.rekaz_reviews where created_at >= private.rd(ms)),
      'campaigns', (select count(*) from public.mkt_campaigns where starts_on <= td and coalesce(ends_on, td) >= ms)),
    -- الربع: المواسم والاتجاه
    'q', jsonb_build_object(
      'from', qs,
      'kpi', private.sd_kpi_t(private.rd(qs), now()),
      'kpi_ly', case when exists (select 1 from public.rekaz_orders where created_at < private.rd((qs - interval '1 year')::date)) then private.sd_kpi_t(private.rd((qs - interval '1 year')::date), now() - interval '1 year') end,
      'seasons', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'emoji', s.emoji, 'starts', s.starts_on, 'in', s.starts_on - td, 'prep', coalesce(s.prep_days, 21),
                  'campaign', exists (select 1 from public.mkt_campaigns c where c.season_id = s.id)) order by s.starts_on)
                from public.mkt_seasons s where s.starts_on >= td and s.starts_on <= td + 100), '[]'::jsonb)),
    -- السنة: الاستراتيجية
    'y', jsonb_build_object(
      'from', ys,
      'months', coalesce((select jsonb_agg(jsonb_build_object('m', m, 'v', v) order by m) from (
                  select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM') m, round(sum(total)) v from public.rekaz_orders
                  where status = 'confirmed' and created_at >= private.rd((ys - interval '1 year')::date) group by 1) z), '[]'::jsonb),
      'clients', (select count(distinct customer_id) from public.rekaz_reservations where status = 'confirmed' and start_at >= private.rd(ys)),
      'returning', (select count(*) from (select customer_id from public.rekaz_reservations where status = 'confirmed' and start_at >= private.rd(ys) group by 1 having count(distinct (start_at at time zone 'Asia/Riyadh')::date) >= 2) z))
  );
  return r;
end $$;
revoke all on function public.biz_lens() from public;
grant execute on function public.biz_lens() to authenticated;
