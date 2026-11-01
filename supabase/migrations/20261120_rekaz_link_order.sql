-- عند تساوي المطابقة نعتمد ترتيب الخيارات نفسه في ركاز
create or replace function public.sb_link_rekaz() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; o record; pr jsonb; best text; linked int := 0; missing int := 0; br text;
begin
  for s in select sv.*, p.raw as praw from public.salon_services sv
           left join public.rekaz_products p on p.raw->>'slug' = sv.rekaz_slug loop
    if s.praw is null then
      update public.salon_services set rekaz_price_id = null where id = s.id; missing := missing + 1; continue;
    end if;
    pr := coalesce(s.praw->'pricing', '[]'::jsonb);
    if not exists (select 1 from public.salon_service_options where service_id = s.id and is_active) then
      select e->>'id' into best from jsonb_array_elements(pr) e
        order by (private.rk_num(e->'amount') = s.price) desc, (private.rk_num(e->'discountedAmount') = s.price) desc limit 1;
      update public.salon_services set rekaz_price_id = best where id = s.id;
      if best is not null then linked := linked + 1; else missing := missing + 1; end if;
    else
      update public.salon_services set rekaz_price_id = null where id = s.id;
      for o in select * from public.salon_service_options where service_id = s.id and is_active loop
        select e->>'id' into best from (
          select e, ix,
            (case when private.rk_norm(private.rk_text(e->'name')) = private.rk_norm(o.name) then 4 else 0 end)
          + (case when private.rk_norm(private.rk_text(e->'name')) like '%' || private.rk_norm(split_part(o.name, ' ', array_length(string_to_array(o.name, ' '), 1))) then 2 else 0 end)
          + (case when position(private.rk_norm(split_part(o.name, ' ', 1)) in private.rk_norm(private.rk_text(e->'name'))) > 0 then 1 else 0 end)
          + (case when private.rk_num(e->'amount') = o.price or private.rk_num(e->'discountedAmount') = o.price then 3 else 0 end) as score
          from jsonb_array_elements(pr) with ordinality t(e, ix)) x
        where score >= 3 order by score desc, abs(ix - 1 - o.sort) limit 1;
        update public.salon_service_options set rekaz_price_id = best where id = o.id;
        if best is not null then linked := linked + 1; else missing := missing + 1; end if;
      end loop;
    end if;
  end loop;
  select raw->>'branchId' into br from public.rekaz_reservations where raw->>'branchId' is not null
    group by 1 order by count(*) desc limit 1;
  if br is not null then update public.salon_settings set rekaz_branch_id = br where id = 1; end if;
  return jsonb_build_object('linked', linked, 'missing', missing, 'branch', br is not null);
end $$;
select public.sb_link_rekaz();
