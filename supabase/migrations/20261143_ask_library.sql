-- «اسألي الموقع» + أداة المكتبة: أدوات قراءة آمنة يستخدمها الذكاء الاصطناعي ليجاوب من الأرقام الحقيقية (للدالة فقط، مو للمتصفح)
create or replace function public.ask_tool(p_name text, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d0 date := coalesce(nullif(p->>'from', '')::date, date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date);
  d1 date := coalesce(nullif(p->>'to', '')::date, (now() at time zone 'Asia/Riyadh')::date);
  t0 timestamptz := private.rd(d0); t1 timestamptz := least(private.rd(d1 + 1), now());
  lim int := least(coalesce((p->>'limit')::int, 30), 80);
  prov text := nullif(trim(coalesce(p->>'provider', '')), '');
  svc text := nullif(trim(coalesce(p->>'service', '')), '');
  res jsonb;
begin
  if p_name = 'sales_summary' then
    return private.sd_kpi(d0, d1 + 1) || jsonb_build_object('from', d0, 'to', d1);
  elsif p_name = 'daily_series' then
    select coalesce(jsonb_agg(jsonb_build_object('day', dd, 'sales', s, 'orders', n) order by dd), '[]'::jsonb) into res from (
      select (created_at at time zone 'Asia/Riyadh')::date dd, round(sum(total)) s, count(*) n from public.rekaz_orders
      where status = 'confirmed' and created_at >= t0 and created_at < t1 group by 1) z;
    return res;
  elsif p_name = 'by_provider' then
    select coalesce(jsonb_agg(x order by (x->>'value')::numeric desc), '[]'::jsonb) into res from (
      select jsonb_build_object('provider', trim(pn), 'services', count(*), 'value', round(sum(r.total)), 'clients', count(distinct r.customer_id)) x
      from public.rekaz_reservations r, unnest(string_to_array(coalesce(r.provider_names, ''), ',')) pn
      where r.status = 'confirmed' and r.start_at >= t0 and r.start_at < t1 and trim(pn) not in ('', 'مزود الخدمة الافتراضي')
        and (svc is null or r.product_name ilike '%' || svc || '%') group by trim(pn)) z;
    return res;
  elsif p_name = 'by_service' then
    select coalesce(jsonb_agg(x order by (x->>'value')::numeric desc), '[]'::jsonb) into res from (
      select jsonb_build_object('service', r.product_name, 'count', count(*), 'value', round(sum(r.total)), 'clients', count(distinct r.customer_id)) x
      from public.rekaz_reservations r
      where r.status = 'confirmed' and r.start_at >= t0 and r.start_at < t1
        and (prov is null or r.provider_names ilike '%' || prov || '%') and (svc is null or r.product_name ilike '%' || svc || '%')
      group by r.product_name order by sum(r.total) desc limit lim) z;
    return res;
  elsif p_name = 'find_clients' then
    perform 1;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('id', s.customer_id, 'name', c.name, 'phone', c.phone, 'visits', s.visits, 'spend', round(s.spend),
        'last_visit', (s.last_at at time zone 'Asia/Riyadh')::date, 'days_away', (extract(epoch from now() - s.last_at) / 86400)::int,
        'has_upcoming', s.next_at is not null, 'cadence_days', s.cadence,
        'last_service', l.product_name, 'last_provider', l.provider_names) x
      from public.cx_stats s join public.rekaz_customers c on c.id = s.customer_id
      left join lateral (select product_name, provider_names from public.rekaz_reservations r where r.customer_id = s.customer_id and r.status = 'confirmed' and r.start_at < now() order by r.start_at desc limit 1) l on true
      where s.visits >= coalesce((p->>'min_visits')::int, 1) and s.visits <= coalesce((p->>'max_visits')::int, 100000)
        and (p->>'min_days_away' is null or s.last_at < now() - make_interval(days => (p->>'min_days_away')::int))
        and (p->>'max_days_away' is null or s.last_at >= now() - make_interval(days => (p->>'max_days_away')::int))
        and (coalesce((p->>'no_upcoming')::boolean, false) = false or s.next_at is null)
        and (svc is null or exists (select 1 from public.rekaz_reservations r where r.customer_id = s.customer_id and r.status = 'confirmed' and r.product_name ilike '%' || svc || '%'))
        and (prov is null or exists (select 1 from public.rekaz_reservations r where r.customer_id = s.customer_id and r.status = 'confirmed' and r.provider_names ilike '%' || prov || '%'))
      order by case when p->>'sort' = 'recent' then extract(epoch from s.last_at) end desc nulls last, s.spend desc
      limit lim) z;
    return jsonb_build_object('count_shown', jsonb_array_length(res), 'clients', res);
  elsif p_name = 'reviews' then
    select jsonb_build_object('avg', round(avg(rating)::numeric, 2), 'n', count(*),
      'samples', coalesce((select jsonb_agg(jsonb_build_object('rating', rating, 'text', description, 'service', product_name, 'provider', provider_names, 'date', created_at::date))
        from (select * from public.rekaz_reviews r where r.created_at >= t0 and r.created_at < t1 and length(coalesce(r.description, '')) > 3
          and (prov is null or r.provider_names ilike '%' || prov || '%') and (p->>'max_rating' is null or r.rating <= (p->>'max_rating')::int)
          order by r.created_at desc limit 15) z), '[]'::jsonb))
    into res from public.rekaz_reviews r
    where r.created_at >= t0 and r.created_at < t1 and (prov is null or r.provider_names ilike '%' || prov || '%') and (p->>'max_rating' is null or r.rating <= (p->>'max_rating')::int);
    return res;
  elsif p_name = 'library' then
    return public.kb_search(coalesce(p->>'q', ''), nullif(p->>'domain', ''), coalesce((p->>'limit')::int, 5));
  elsif p_name = 'lists' then
    return jsonb_build_object('providers', (select jsonb_agg(name) from public.rekaz_providers where name <> 'مزود الخدمة الافتراضي'),
      'services', (select jsonb_agg(distinct product_name) from public.rekaz_reservations where start_at > now() - interval '120 days'));
  end if;
  raise exception 'unknown tool';
end $$;
revoke all on function public.ask_tool(text, jsonb) from public, anon, authenticated;
grant execute on function public.ask_tool(text, jsonb) to service_role;
