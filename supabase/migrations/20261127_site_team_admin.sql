-- للإدارة: كل أخصائيات ركاز مع آرائهن (حتى المخفيات)
create or replace function public.site_team_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'n')::int desc) from (
    select jsonb_build_object('id', p.id::text, 'name', p.name,
      'n', (select count(*) from public.rekaz_reviews r where r.provider_names ilike '%' || p.name || '%'),
      'avg', (select round(avg(r.rating), 1) from public.rekaz_reviews r where r.provider_names ilike '%' || p.name || '%'),
      'top', (select r.product_name from public.rekaz_reviews r where r.provider_names ilike '%' || p.name || '%' group by 1 order by count(*) desc limit 1)) x
    from public.rekaz_providers p where p.name not ilike '%الافتراضي%') z), '[]'::jsonb);
end $$;
revoke all on function public.site_team_admin() from public;
grant execute on function public.site_team_admin() to authenticated;
