-- الفريق: أكثر ٣ خدمات لكل أخصائية بدل وحدة
-- كل ما يحتاجه الموقع العام في طلب واحد
create or replace function public.site_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  with rv as (
    select r.id::text id, r.rating, r.description, r.product_name, r.provider_names, r.created_at, r.customer_name, m.state,
           s.id service_id
    from public.rekaz_reviews r
    left join public.site_review_mod m on m.review_id = r.id::text
    left join lateral (select x.id from public.salon_services x where x.name = r.product_name and x.is_active limit 1) s on true
    where coalesce(m.state, '') <> 'hide'
  ),
  team as (
    select p.id::text pid, coalesce(t.display_name, p.name) name, t.title, t.photo_url, coalesce(t.sort, 0) sort,
           count(rv.*) n, round(avg(rv.rating), 1) avg,
           (select array_agg(z.product_name) from (select rv2.product_name from rv rv2 where rv2.provider_names ilike '%' || p.name || '%' and rv2.product_name is not null group by 1 order by count(*) desc limit 3) z) top_service,
           coalesce(t.visible, count(rv.*) >= 5) visible
    from public.rekaz_providers p
    left join public.site_team t on t.provider_id = p.id::text
    left join rv on rv.provider_names ilike '%' || p.name || '%'
    where p.name not ilike '%الافتراضي%'
    group by p.id, p.name, t.display_name, t.title, t.photo_url, t.sort, t.visible
  )
  select jsonb_build_object(
    'conf', (select jsonb_build_object('hours', c.hours, 'address', c.address, 'map_url', c.map_url, 'sections', c.sections) from public.site_conf c where id = 1),
    'stats', (select jsonb_build_object('avg', round(avg(rating), 2), 'n', count(*), 'five', count(*) filter (where rating = 5)) from public.rekaz_reviews),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'subtitle', o.subtitle, 'price', o.price_text, 'was', o.was_text,
                  'services', o.service_ids, 'image', o.image_url, 'ends', o.ends_on) order by o.sort, o.id desc)
                from public.site_offers o
                where o.active and (o.starts_on is null or o.starts_on <= (now() at time zone 'Asia/Riyadh')::date)
                  and (o.ends_on is null or o.ends_on >= (now() at time zone 'Asia/Riyadh')::date)), '[]'::jsonb),
    'gallery', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'image', g.image_url, 'caption', g.caption, 'service_id', g.service_id, 'service', s.name) order by g.sort, g.id desc)
                from public.site_gallery g left join public.salon_services s on s.id = g.service_id where g.active), '[]'::jsonb),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', pid, 'name', name, 'title', title, 'photo', photo_url, 'n', n, 'avg', avg, 'tops', top_service) order by sort, n desc)
                from team where visible), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(x order by (x->>'pin')::boolean desc, x->>'at' desc) from (
                select jsonb_build_object('id', id, 'name', private.short_name(customer_name), 'rating', rating, 'text', left(trim(description), 400),
                  'service', product_name, 'service_id', service_id, 'by', provider_names, 'at', to_char(created_at, 'YYYY-MM'), 'pin', coalesce(state = 'pin', false)) x
                from rv where state = 'pin' or (rating >= 4 and length(trim(coalesce(description, ''))) > 15)
                order by coalesce(state = 'pin', false) desc, created_at desc limit 60) z), '[]'::jsonb)
  )
$$;
revoke all on function public.site_public() from public;
grant execute on function public.site_public() to anon, authenticated;
