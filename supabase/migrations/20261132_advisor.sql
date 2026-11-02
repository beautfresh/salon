-- المستشار: إجابات الإدارة (الهدف والميزانية ومن يصور) + آخر قرار
create table if not exists public.mkt_advisor (
  id int primary key default 1 check (id = 1),
  answers jsonb not null default '{}'::jsonb,
  decided_at timestamptz,
  decided_by uuid
);
insert into public.mkt_advisor (id) values (1) on conflict do nothing;
alter table public.mkt_advisor enable row level security;
drop policy if exists mkt_advisor_rw on public.mkt_advisor;
create policy mkt_advisor_rw on public.mkt_advisor for all to authenticated
  using (coalesce(private.my_role()::text, '') in ('admin','partner')) with check (coalesce(private.my_role()::text, '') in ('admin','partner'));

-- أرقام المستشار من بيانات الصالون
create or replace function public.advisor_facts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t0 timestamptz := private.rd((now() at time zone 'Asia/Riyadh')::date);
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  return jsonb_build_object(
    'reviews', (select jsonb_build_object('n', count(*), 'avg', round(avg(rating), 2)) from public.rekaz_reviews),
    'clients_90', (select count(distinct customer_id) from public.rekaz_reservations where status = 'confirmed' and start_at >= t0 - interval '90 days'),
    'lapsed', (select count(*) from (select customer_id, max(start_at) l, count(*) n from public.rekaz_reservations where status = 'confirmed' group by 1) z
               where n >= 2 and l < t0 - interval '60 days' and l >= t0 - interval '365 days'),
    'web_share', (select round(100.0 * count(*) filter (where source = 'website') / nullif(count(*), 0)) from public.rekaz_orders where status = 'confirmed' and created_at >= t0 - interval '30 days'),
    'web_unpaid', (select round(100.0 * count(*) filter (where status = 'pending') / nullif(count(*), 0)) from public.rekaz_orders where source = 'website' and created_at >= t0 - interval '60 days' and created_at < t0 - interval '2 days'),
    'quiet_day', (select to_char(d, 'FMDay') from (select (start_at at time zone 'Asia/Riyadh')::date d from public.rekaz_reservations where status = 'confirmed' and start_at >= t0 - interval '90 days' and start_at < t0) z group by extract(dow from d), to_char(d, 'FMDay') order by count(*) limit 1),
    'quiet_dow', (select extract(dow from d)::int from (select (start_at at time zone 'Asia/Riyadh')::date d from public.rekaz_reservations where status = 'confirmed' and start_at >= t0 - interval '90 days' and start_at < t0) z group by 1 order by count(*) limit 1),
    'posts_30', (select count(*) from public.mkt_posts where status = 'posted' and coalesce(publish_on, updated_at::date) >= (t0 - interval '30 days')::date),
    'next_season', (select jsonb_build_object('name', name, 'in', starts_on - (now() at time zone 'Asia/Riyadh')::date) from public.mkt_seasons where starts_on > (now() at time zone 'Asia/Riyadh')::date order by starts_on limit 1),
    'saved', (select jsonb_build_object('answers', answers, 'at', decided_at) from public.mkt_advisor where id = 1)
  );
end $$;
revoke all on function public.advisor_facts() from public;
grant execute on function public.advisor_facts() to authenticated;
