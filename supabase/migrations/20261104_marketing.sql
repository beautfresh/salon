-- بيوتفريش: التسويق (المواسم، الحملات، لوحة المحتوى)

create table if not exists public.mkt_seasons (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 60),
  starts_on date not null,
  ends_on date,
  prep_days int not null default 21 check (prep_days between 0 and 120),
  approx boolean not null default false,
  ideas text check (ideas is null or length(ideas) <= 1500),
  emoji text check (emoji is null or length(emoji) <= 8),
  created_at timestamptz not null default now()
);

create table if not exists public.mkt_campaigns (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 80),
  season_id bigint references public.mkt_seasons(id) on delete set null,
  offer text check (offer is null or length(offer) <= 300),
  channels text[] not null default '{}',
  starts_on date not null default current_date,
  ends_on date,
  budget numeric(12,2) check (budget is null or budget >= 0),
  spent numeric(12,2) check (spent is null or spent >= 0),
  goal_clients int check (goal_clients is null or goal_clients >= 0),
  new_clients int check (new_clients is null or new_clients >= 0),
  bookings int check (bookings is null or bookings >= 0),
  revenue numeric(12,2) check (revenue is null or revenue >= 0),
  status text not null default 'planned' check (status in ('planned','live','done')),
  learnings text check (learnings is null or length(learnings) <= 1000),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.mkt_posts (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 120),
  kind text not null default 'reel' check (kind in ('reel','story','post','tiktok','snap')),
  pillar text check (pillar in ('before_after','color','behind','review','trend','service','tip','team','offer')),
  status text not null default 'idea' check (status in ('idea','shoot','ready','posted')),
  publish_on date,
  campaign_id bigint references public.mkt_campaigns(id) on delete set null,
  notes text check (notes is null or length(notes) <= 1000),
  link text check (link is null or length(link) <= 500),
  owner uuid references public.profiles(id),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_posts_publish_idx on public.mkt_posts (publish_on);

alter table public.mkt_seasons enable row level security;
alter table public.mkt_campaigns enable row level security;
alter table public.mkt_posts enable row level security;
revoke all on public.mkt_seasons, public.mkt_campaigns, public.mkt_posts from anon;

drop policy if exists mkt_seasons_read on public.mkt_seasons;
create policy mkt_seasons_read on public.mkt_seasons for select to authenticated using (private.is_active_user());
drop policy if exists mkt_seasons_mgr on public.mkt_seasons;
create policy mkt_seasons_mgr on public.mkt_seasons for all to authenticated using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));
drop policy if exists mkt_campaigns_read on public.mkt_campaigns;
create policy mkt_campaigns_read on public.mkt_campaigns for select to authenticated using (private.is_active_user());
drop policy if exists mkt_campaigns_mgr on public.mkt_campaigns;
create policy mkt_campaigns_mgr on public.mkt_campaigns for all to authenticated using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));
-- المحتوى: الفريق كله يضيف ويحرّك، والحذف للإدارة
drop policy if exists mkt_posts_read on public.mkt_posts;
create policy mkt_posts_read on public.mkt_posts for select to authenticated using (private.is_active_user());
drop policy if exists mkt_posts_add on public.mkt_posts;
create policy mkt_posts_add on public.mkt_posts for insert to authenticated with check (private.is_active_user());
drop policy if exists mkt_posts_edit on public.mkt_posts;
create policy mkt_posts_edit on public.mkt_posts for update to authenticated using (private.is_active_user()) with check (private.is_active_user());
drop policy if exists mkt_posts_del on public.mkt_posts;
create policy mkt_posts_del on public.mkt_posts for delete to authenticated using (private.my_role() in ('admin','partner'));

insert into public.mkt_seasons (name, starts_on, ends_on, prep_days, approx, emoji, ideas)
select * from (values
  ('الجمعة البيضاء', date '2026-11-27', date '2026-11-30', 21, false, '🤍', 'باقة بسعر خاص لأول ٤٨ ساعة\nبطاقات هدايا بخصم، تنفع للأعياد والمناسبات\nستوري عدّ تنازلي قبلها بأسبوع'),
  ('يوم التأسيس', date '2027-02-22', null, 14, false, '🌿', 'تصاميم أظافر بألوان ونقشات سدو\nمكياج وتسريحات تراثية\nريل «إطلالة التأسيس»'),
  ('رمضان', date '2027-02-08', date '2027-03-09', 30, true, '🌙', 'تعديل ساعات الدوام لبعد التراويح\nباقات «جاهزة للعيد» تُحجز من أول رمضان\nمحتوى عناية خفيف يناسب الصيام'),
  ('ليالي العيد', date '2027-03-03', date '2027-03-12', 30, true, '✨', 'افتحوا الحجز بدري، وحددوا سقف لكل يوم\nحنّا وأظافر وتسريحات\nقائمة انتظار للأوقات المحجوزة\nزيدوا المخزون من الجيل والصبغات قبلها بأسبوعين'),
  ('يوم الأم', date '2027-03-21', null, 14, false, '💐', 'بطاقة هدية «دلّعي أمك»\nباقة أم وبنت\nريل لعميلة مع أمها'),
  ('موسم التخرج', date '2027-05-09', date '2027-06-10', 21, true, '🎓', 'باقة التخرج: مكياج وتسريحة وأظافر\nخصم للمجموعات من نفس الدفعة\nمحتوى «إطلالة حفل التخرج»'),
  ('عيد الأضحى', date '2027-05-16', date '2027-05-20', 21, true, '🐑', 'نفس تجهيز عيد الفطر بس بوقت أقصر\nحجوزات منزلية ليلة العيد'),
  ('موسم الأعراس', date '2027-06-01', date '2027-08-31', 45, false, '💍', 'باقة العروس الكاملة وتجربة قبل الزواج\nباقة أهل العروس والمعازيم\nألبوم «عرايس بيوتفريش» في الهايلايت'),
  ('العودة للمدارس', date '2027-08-15', date '2027-08-29', 14, true, '📚', 'قصّات بنات\nعرض للأمهات بعد توصيل المدارس (الصباح الهادئ)'),
  ('اليوم الوطني', date '2027-09-23', null, 21, false, '💚', 'أظافر وإطلالات بالأخضر\nعرض ٩٧ لليوم الوطني الـ٩٧\nمسابقة في الانستقرام')
) v(name, starts_on, ends_on, prep_days, approx, emoji, ideas)
where not exists (select 1 from public.mkt_seasons);
update public.mkt_seasons set ideas = replace(ideas, '\n', E'\n') where ideas like '%\n%';
