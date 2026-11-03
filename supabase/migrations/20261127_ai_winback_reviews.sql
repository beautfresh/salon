-- الذكاء الاصطناعي ١: استرجاع العميلات الذكي (رسالة شخصية لكل عميلة غايبة) + ٢: محلل الآراء

-- رسائل الاسترجاع
create table if not exists public.winback_msgs (
  id bigint generated always as identity primary key,
  customer_id text not null, name text, phone text,
  last_service text, last_provider text, last_visit date, visits int, spend numeric, days_away int,
  text text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'skipped')),
  created_at timestamptz not null default now(), sent_at timestamptz, created_by uuid
);
create index if not exists winback_msgs_cust_ix on public.winback_msgs (customer_id, created_at desc);
alter table public.winback_msgs enable row level security;
create policy winback_msgs_mgr on public.winback_msgs for all
  using (coalesce(private.my_role()::text, '') in ('admin', 'partner'))
  with check (coalesce(private.my_role()::text, '') in ('admin', 'partner'));

-- تقارير الذكاء الاصطناعي (محلل الآراء وغيره)
create table if not exists public.ai_reports (
  id bigint generated always as identity primary key,
  kind text not null, data jsonb not null, stats jsonb,
  created_at timestamptz not null default now(), created_by uuid
);
create index if not exists ai_reports_kind_ix on public.ai_reports (kind, created_at desc);
alter table public.ai_reports enable row level security;
create policy ai_reports_read on public.ai_reports for select using (coalesce(private.my_role()::text, '') in ('admin', 'partner'));

-- العميلات الغايبات: زيارتين وفوق، آخر زيارة من ٦٠ يوم لين سنة، ما عندها موعد جاي، وما انرسل لها خلال ٦٠ يوم
create or replace function public.winback_pool(p_limit int default 15, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  with v as (
    select customer_id, count(distinct (start_at at time zone 'Asia/Riyadh')::date) visits, sum(total) spend, max(start_at) last_at
    from public.rekaz_reservations where status = 'confirmed' and start_at < now() and customer_id is not null group by 1),
  pool as (
    select v.*, c.name, c.phone from v join public.rekaz_customers c on c.id = v.customer_id
    where v.visits >= 2 and v.last_at < now() - interval '60 days' and v.last_at >= now() - interval '365 days'
      and coalesce(c.phone, '') <> '' and not coalesce(c.blocked, false)
      and not exists (select 1 from public.rekaz_reservations f where f.customer_id = v.customer_id and f.start_at > now() and f.status in ('confirmed', 'pending'))
      and not exists (select 1 from public.winback_msgs w where w.customer_id = v.customer_id and w.created_at > now() - interval '60 days')),
  pick as (select * from pool order by spend desc limit greatest(1, least(p_limit, 30)) offset greatest(0, p_offset))
  select jsonb_build_object('total', (select count(*) from pool), 'spend', (select round(coalesce(sum(spend), 0)) from pool),
    'list', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.customer_id, 'name', p.name, 'phone', p.phone, 'visits', p.visits, 'spend', round(p.spend),
      'last_visit', (p.last_at at time zone 'Asia/Riyadh')::date, 'days_away', ((now() - p.last_at) / interval '1 day')::int,
      'last_service', l.product_name, 'last_provider', l.provider_names,
      'top_service', (select r.product_name from public.rekaz_reservations r where r.customer_id = p.customer_id and r.status = 'confirmed' group by 1 order by count(*) desc limit 1)
    ) order by p.spend desc) from pick p
      left join lateral (select product_name, provider_names from public.rekaz_reservations r where r.customer_id = p.customer_id and r.status = 'confirmed' and r.start_at < now() order by start_at desc limit 1) l on true), '[]'::jsonb))
  into res;
  return res;
end $$;

-- نتيجة الاسترجاع: اللي رجعت = حجزت (طلب مؤكد) خلال ٣٠ يوم من الإرسال
create or replace function public.winback_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  with s as (select * from public.winback_msgs where status = 'sent'),
  back as (
    select s.id, min(o.created_at) first_at, sum(o.total) v from s join public.rekaz_orders o
      on o.customer_id = s.customer_id and o.status = 'confirmed' and o.created_at > s.sent_at and o.created_at < s.sent_at + interval '30 days'
    group by s.id)
  select jsonb_build_object(
    'drafts', (select count(*) from public.winback_msgs where status = 'draft'),
    'sent', (select count(*) from s),
    'sent_30', (select count(*) from s where sent_at > now() - interval '30 days'),
    'back', (select count(*) from back), 'back_value', (select round(coalesce(sum(v), 0)) from back),
    'back_ids', coalesce((select jsonb_object_agg(id, round(v)) from back), '{}'::jsonb))
  into res;
  return res;
end $$;

revoke all on function public.winback_pool(int, int) from public, anon;
revoke all on function public.winback_stats() from public, anon;
grant execute on function public.winback_pool(int, int) to authenticated;
grant execute on function public.winback_stats() to authenticated;
grant select, insert, update on public.winback_msgs to authenticated;
grant select on public.ai_reports to authenticated;
