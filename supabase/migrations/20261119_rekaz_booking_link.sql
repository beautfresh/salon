-- ربط خدمات صفحة الحجز بأسعار ركاز، عشان الحجز من موقعنا ينزل في تقويم ركاز

alter table public.salon_services add column if not exists rekaz_price_id text;
alter table public.salon_service_options add column if not exists rekaz_price_id text;
alter table public.salon_settings add column if not exists rekaz_booking boolean not null default false;
alter table public.salon_settings add column if not exists rekaz_branch_id text;

-- روابط الخدمات اللي ما كانت داخل أقسام ركاز
update public.salon_services s set rekaz_slug = m.slug from (values
 ('قناع DR.AN · Hydrate','qnaa-dran-hydrate'), ('BB Touch · حراري','bb-touchdran-hrary-s'), ('BB Touch · بارد','bb-touchdran-bard'),
 ('جلسة القوة الثلاثية','jlsh-alqwh-althlathyh'), ('علاج الأمبولات الطبية','alaj-alambwlat-altbyh'), ('DR.AN Spider','dran-spider'),
 ('صبغ جذور','sba-jdhwr'), ('Combo Hair Color','combo-color'), ('رنساج','rnsaj'), ('مكياج','mykb'), ('غسيل شعر','ghsyl-shar'),
 ('تدريم الشعر · قص أطراف','s-alshar-ma-astshwar-1'), ('بيوتفريش طيب','bywtfrysh-tyb-beautfresh-teeb'),
 ('استشارة شعر · صبغة، بروتين، معالج','astsharh-shar-sbghh-brwtyn-maalj-kshf-balswnar'), ('بدكير بيوتفريش','bdkyr-bywtfrysh'),
 ('سوفت جيل','swft-jyl'), ('بولي جيل','bwly-jyl'), ('لون جيل كوتور','lwn-jyl-kwtwr'), ('إضافة إكسسوار (للظفر)','adafh-aksswar-adhfr'),
 ('تركيب رموش · Signature Sweep (كلاسيك)','beautfresh-signature-sweepclassic'),
 ('تركيب رموش · Flawless Blend (هايبرد)','beautfresh-flawless-blend-hybrid-trkyb-rmwsh'),
 ('تركيب رموش · Foxy Lift (عين القطة)','beautfresh-foxy-lift-cat-eye-trkyb-rmwsh'),
 ('تركيب رموش · Airy Wisps (ويسبي)','beautfresh-airy-wisps-wispy-trkyb-rmwsh'),
 ('تركيب رموش · Velvet Volume (فوليوم)','beautfresh-velvet-volume-volume-trkyb-rmwsh'),
 ('رفع الرموش · Lash Lift','rfa-alrmwsh-lash-lift'), ('رفع الحواجب · Brow Lift','rfa-hwajb-brow-lift'),
 ('رفع الرموش والحواجب','brow-lash-lift-rfa-alrmwsh-w-alhwajb')
) as m(name, slug)
where s.name = m.name;

create or replace function private.rk_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select translate(lower(regexp_replace(coalesce(t, ''), '[\s\-·ـ|()،,.]+', '', 'g')), 'أإآةى', 'اااهي')
$$;

-- يربط كل خدمة وخيار بسعر ركاز المطابق (يتشغّل بعد كل مزامنة)
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
          select e,
            (case when private.rk_norm(private.rk_text(e->'name')) = private.rk_norm(o.name) then 4 else 0 end)
          + (case when private.rk_norm(private.rk_text(e->'name')) like '%' || private.rk_norm(split_part(o.name, ' ', array_length(string_to_array(o.name, ' '), 1))) then 2 else 0 end)
          + (case when position(private.rk_norm(split_part(o.name, ' ', 1)) in private.rk_norm(private.rk_text(e->'name'))) > 0 then 1 else 0 end)
          + (case when private.rk_num(e->'amount') = o.price or private.rk_num(e->'discountedAmount') = o.price then 3 else 0 end) as score
          from jsonb_array_elements(pr) e) x
        where score >= 3 order by score desc limit 1;
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
revoke all on function public.sb_link_rekaz() from public, anon;
grant execute on function public.sb_link_rekaz() to authenticated, service_role;

-- صفحة الحجز تعرف إذا الحجز يروح لركاز
create or replace function public.sb_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('accepting', accepting, 'horizon_days', horizon_days, 'closed_weekdays', closed_weekdays,
                   'open_time', to_char(open_time,'HH24:MI'), 'close_time', to_char(close_time,'HH24:MI'),
                   'whatsapp', whatsapp, 'online_payment', online_payment, 'cancel_hours', cancel_hours,
                   'rekaz', rekaz_booking and rekaz_branch_id is not null)
                 from public.salon_settings where id = 1),
    'cats', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grp', grp, 'role', role) order by sort, id)
                 from public.salon_svc_cats), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cat', s.cat_id, 'name', s.name, 'desc', s.description,
                   'price', s.price, 'dur', s.duration_min, 'pop', s.popular,
                   'opts', (select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'dur', o.duration_min) order by o.sort, o.id)
                              from public.salon_service_options o where o.service_id = s.id and o.is_active
                                and (not st.rekaz_booking or o.rekaz_price_id is not null))) order by s.sort, s.id)
                 from public.salon_services s, public.salon_settings st
                 where st.id = 1 and s.is_active
                   and (not st.rekaz_booking or s.rekaz_price_id is not null
                        or exists (select 1 from public.salon_service_options o2 where o2.service_id = s.id and o2.is_active and o2.rekaz_price_id is not null))), '[]'::jsonb),
    'staff', case when (select rekaz_booking from public.salon_settings where id = 1) then '[]'::jsonb
                  when private.sb_staff_mode() then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', split_part(m.name, ' ', 1), 'roles', m.book_roles, 'color', m.color) order by m.name)
                 from public.team_members m where m.active and cardinality(m.book_roles) > 0
                   and exists (select 1 from public.team_shifts sh where sh.member_id = m.id)), '[]'::jsonb) else '[]'::jsonb end,
    'blackouts', coalesce((select jsonb_agg(day) from public.salon_blackouts where day >= current_date), '[]'::jsonb)
  )
$$;

select public.sb_link_rekaz();
