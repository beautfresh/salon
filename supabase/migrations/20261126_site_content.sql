-- محتوى الموقع العام: العروض، المعرض، الفريق، الآراء، الزيارة. يتحكم فيه الإدارة، ويقرأه الموقع عبر site_public()

create table if not exists public.site_offers (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 60),
  subtitle text check (subtitle is null or length(subtitle) <= 160),
  price_text text check (price_text is null or length(price_text) <= 40),
  was_text text check (was_text is null or length(was_text) <= 40),
  service_ids bigint[] not null default '{}',
  image_url text,
  starts_on date,
  ends_on date,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.site_gallery (
  id bigint generated always as identity primary key,
  image_url text not null,
  caption text check (caption is null or length(caption) <= 120),
  service_id bigint references public.salon_services(id) on delete set null,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- تخصيص عرض الأخصائيات في الموقع (المصدر: مزودو الخدمة في ركاز)
create table if not exists public.site_team (
  provider_id text primary key,
  display_name text check (display_name is null or length(display_name) <= 40),
  title text check (title is null or length(title) <= 60),
  photo_url text,
  visible boolean,
  sort int not null default 0
);

-- تثبيت أو إخفاء آراء معيّنة
create table if not exists public.site_review_mod (
  review_id text primary key,
  state text not null check (state in ('pin', 'hide'))
);

-- إعدادات عامة (صف واحد)
create table if not exists public.site_conf (
  id int primary key default 1 check (id = 1),
  hours text default 'يوميًا من ١٠ الصبح إلى ١٠ الليل',
  address text default 'الأحساء',
  map_url text,
  sections jsonb not null default '["offers","reviews","team","gallery"]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_conf (id) values (1) on conflict do nothing;

alter table public.site_offers enable row level security;
alter table public.site_gallery enable row level security;
alter table public.site_team enable row level security;
alter table public.site_review_mod enable row level security;
alter table public.site_conf enable row level security;

do $$ declare t text; begin
  foreach t in array array['site_offers','site_gallery','site_team','site_review_mod','site_conf'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format($p$create policy %1$s_write on public.%1$s for all to authenticated using (coalesce(private.my_role()::text, '') in ('admin','partner')) with check (coalesce(private.my_role()::text, '') in ('admin','partner'))$p$, t);
  end loop;
end $$;

-- مخزن الصور العامة للموقع
insert into storage.buckets (id, name, public) values ('site', 'site', true) on conflict (id) do update set public = true;
drop policy if exists site_media_write on storage.objects;
create policy site_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and coalesce(private.my_role()::text, '') in ('admin','partner'));
drop policy if exists site_media_update on storage.objects;
create policy site_media_update on storage.objects for update to authenticated
  using (bucket_id = 'site' and coalesce(private.my_role()::text, '') in ('admin','partner'));
drop policy if exists site_media_delete on storage.objects;
create policy site_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site' and coalesce(private.my_role()::text, '') in ('admin','partner'));

-- اسم مختصر للخصوصية: الاسم الأول + أول حرف من الثاني
create or replace function private.short_name(n text) returns text
language sql immutable set search_path = '' as $$
  select case
    when n is null or trim(n) = '' then 'عميلة'
    else split_part(regexp_replace(trim(n), '\s+', ' ', 'g'), ' ', 1)
      || coalesce(' ' || nullif(left(split_part(regexp_replace(trim(n), '\s+', ' ', 'g'), ' ', 2), 1), '') || '.', '')
  end
$$;

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
           (select rv2.product_name from rv rv2 where rv2.provider_names ilike '%' || p.name || '%' group by 1 order by count(*) desc limit 1) top_service,
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
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', pid, 'name', name, 'title', title, 'photo', photo_url, 'n', n, 'avg', avg, 'top', top_service) order by sort, n desc)
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

-- للإدارة: كل الآراء المكتوبة مع حالتها، عشان التثبيت والإخفاء
create or replace function public.site_reviews_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(private.my_role()::text, '') not in ('admin', 'partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id::text, 'name', private.short_name(r.customer_name), 'rating', r.rating,
      'text', r.description, 'service', r.product_name, 'by', r.provider_names, 'at', to_char(r.created_at, 'YYYY-MM-DD'), 'state', m.state) order by r.created_at desc)
    from public.rekaz_reviews r left join public.site_review_mod m on m.review_id = r.id::text
    where length(trim(coalesce(r.description, ''))) > 3), '[]'::jsonb);
end $$;
revoke all on function public.site_reviews_admin() from public;
grant execute on function public.site_reviews_admin() to authenticated;
