-- البوصلة: هوية بيوتفريش ونبرتها، يقرأها الكاتب الذكي قبل أي كتابة
create table if not exists public.brand_compass (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.brand_compass (id, data) values (1, jsonb_build_object(
  'who', 'بيوتفريش صالون عناية وجمال نسائي في الأحساء. نهتم بالشعر والأظافر والوجه والرموش، ونشتغل بمنتجات نختارها بعناية وأيادي مدرّبة. نبي كل وحدة تطلع من عندنا مرتاحة وواثقة، مو بس شكلها أحلى.',
  'promise', 'The Fresh Version of You: تطلعين منا بنسخة أنعش منك، بدون تعقيد ولا انتظار.',
  'audience', E'الموظفة المشغولة: تبي موعد مضبوط وشغل سريع ومرتب.\nالبنت اللي تحب الجديد: تتابع الترندات وتبي ألوان وأشكال مختلفة.\nالعروس وأهلها: يبون ثقة وتنظيم وتجربة ما تنسى.',
  'personality', E'دافية وقريبة\nمرتبة ودقيقة\nواثقة بدون غرور\nمرحة بخفة',
  'tone_do', E'نكلمها مثل صديقة تفهم في الجمال\nجمل قصيرة وواضحة باللهجة السعودية\nنوصف الإحساس والنتيجة، مو بس الخدمة\nنذكر السعر الحقيقي لما نتكلم عن عرض',
  'tone_dont', E'لا مبالغة ولا وعود طبية\nلا كلمات فصحى ثقيلة ولا ترجمة حرفية\nلا نقارن نفسنا بأحد بالاسم\nلا نخترع أرقام أو آراء',
  'words_use', E'تدلّعي، نعومة، لمسة، مرتب، مريح، فرش، طلّة',
  'words_avoid', E'أفضل صالون في العالم، مضمون ١٠٠٪، رخيص',
  'talk', E'الشغل المرتب والنظيف (أكثر شي تكتبه العميلات في آرائهن)\nالراحة والهدوء أثناء الجلسة\nابتسامة الأخصائيات وتعاملهن\nالدقة في المواعيد',
  'proof', 'تقييم ٤٫٨ من ٥ من مئات العميلات اللي زارونا.',
  'draft', true
)) on conflict (id) do nothing;

alter table public.brand_compass enable row level security;
drop policy if exists brand_compass_read on public.brand_compass;
create policy brand_compass_read on public.brand_compass for select to authenticated using (true);
drop policy if exists brand_compass_write on public.brand_compass;
create policy brand_compass_write on public.brand_compass for update to authenticated
  using (coalesce(private.my_role()::text, '') in ('admin','partner')) with check (coalesce(private.my_role()::text, '') in ('admin','partner'));

-- سجل الكاتب الذكي (للحد الشهري والمراجعة)
create table if not exists public.ai_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  kind text not null,
  prompt text,
  output jsonb,
  tokens int
);
create index if not exists ai_log_at_idx on public.ai_log (at);
alter table public.ai_log enable row level security;
drop policy if exists ai_log_read on public.ai_log;
create policy ai_log_read on public.ai_log for select to authenticated using (coalesce(private.my_role()::text, '') in ('admin','partner'));

-- موقع الصالون على الخريطة: إحداثيات لخريطة مدمجة + رابط نظيف
alter table public.site_conf add column if not exists lat numeric, add column if not exists lng numeric;
update public.site_conf set map_url = coalesce(map_url, 'https://maps.google.com/?cid=4446565183545573077'), lat = coalesce(lat, 25.3957625), lng = coalesce(lng, 49.5599338) where id = 1;
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
    'conf', (select jsonb_build_object('hours', c.hours, 'address', c.address, 'map_url', c.map_url, 'lat', c.lat, 'lng', c.lng, 'sections', c.sections) from public.site_conf c where id = 1),
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
