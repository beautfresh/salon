-- رسالة بعد الزيارة: الاستقبال ترسل سؤال التجربة لكل عميلة خلصت زيارتها، وتسجل الرد
create table if not exists public.visit_followups (
  customer_id text not null, day date not null,
  sent_at timestamptz, sent_by uuid default auth.uid(),
  outcome text check (outcome in ('happy', 'issue')), note text, review_sent boolean not null default false,
  primary key (customer_id, day)
);
alter table public.visit_followups enable row level security;
create policy visit_followups_front on public.visit_followups for all to authenticated using (private.is_front()) with check (private.is_front());
grant select, insert, update on public.visit_followups to authenticated;

create or replace function public.followup_list(p_day date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Riyadh')::date); res jsonb;
begin
  if not private.is_front() then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select coalesce(jsonb_agg(x order by x->>'end' desc), '[]'::jsonb) into res from (
    select jsonb_build_object('cid', r.customer_id, 'name', max(c.name), 'phone', max(c.phone),
      'svc', string_agg(distinct r.product_name, ' + '), 'by', string_agg(distinct r.provider_names, '، '),
      'end', max(r.end_at), 'done', max(r.end_at) < now(),
      'f', (select to_jsonb(f) - 'customer_id' - 'day' from public.visit_followups f where f.customer_id = r.customer_id and f.day = d)) x
    from public.rekaz_reservations r join public.rekaz_customers c on c.id = r.customer_id
    where r.status in ('confirmed', 'pending') and r.start_at >= private.rd(d) and r.start_at < private.rd(d + 1) and r.customer_id is not null
    group by r.customer_id) z;
  return res;
end $$;
revoke all on function public.followup_list(date) from public, anon;
grant execute on function public.followup_list(date) to authenticated;
