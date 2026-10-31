-- بيوتفريش: دفتر العميلات، الزيارات، بطاقة الولاء، الآراء، الهدف الشهري

create table if not exists public.clients (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 60),
  phone text unique check (phone is null or phone ~ '^05[0-9]{8}$'),
  birthday date,
  source text not null default 'salon' check (source in ('salon','home','instagram','tiktok','snap','referral','walkin','other')),
  vip boolean not null default false,
  prefs text check (prefs is null or length(prefs) <= 500),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.client_visits (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  day date not null default current_date,
  channel text not null default 'salon' check (channel in ('salon','home')),
  services text check (services is null or length(services) <= 300),
  amount numeric(10,2) check (amount is null or amount >= 0),
  booking_id uuid unique references public.home_bookings(id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists client_visits_client_idx on public.client_visits (client_id, day desc);

create table if not exists public.loyalty_settings (
  id int primary key default 1 check (id = 1),
  stamps int not null default 6 check (stamps between 3 and 20),
  reward text not null default 'خدمة هدية من اختيارك' check (length(reward) <= 120),
  active boolean not null default true
);
insert into public.loyalty_settings (id) values (1) on conflict do nothing;

create table if not exists public.loyalty_redemptions (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  day date not null default current_date,
  reward text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.client_feedback (
  id bigint generated always as identity primary key,
  client_id bigint references public.clients(id) on delete set null,
  day date not null default current_date,
  kind text not null check (kind in ('praise','complaint','suggestion')),
  rating int check (rating between 1 and 5),
  channel text check (channel in ('salon','whatsapp','instagram','google','call','other')),
  body text not null check (length(trim(body)) between 2 and 1000),
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text check (resolution is null or length(resolution) <= 500),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.fin_targets (
  month date primary key check (extract(day from month) = 1),
  revenue numeric(12,2) not null check (revenue > 0)
);

alter table public.clients enable row level security;
alter table public.client_visits enable row level security;
alter table public.loyalty_settings enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.client_feedback enable row level security;
alter table public.fin_targets enable row level security;
revoke all on public.clients, public.client_visits, public.loyalty_settings, public.loyalty_redemptions, public.client_feedback, public.fin_targets from anon;

-- كل الفريق المفعّل: يشوف ويضيف. التعديل والحذف للإدارة.
do $$
declare t text;
begin
  foreach t in array array['clients','client_visits','loyalty_redemptions','client_feedback'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('drop policy if exists %1$s_add on public.%1$s', t);
    execute format('drop policy if exists %1$s_mgr on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
    execute format('create policy %1$s_add on public.%1$s for insert to authenticated with check (private.is_active_user())', t);
    execute format($p$create policy %1$s_mgr on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;
drop policy if exists loyalty_settings_read on public.loyalty_settings;
create policy loyalty_settings_read on public.loyalty_settings for select to authenticated using (private.is_active_user());
drop policy if exists loyalty_settings_mgr on public.loyalty_settings;
create policy loyalty_settings_mgr on public.loyalty_settings for all to authenticated
  using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));
drop policy if exists fin_targets_mgr on public.fin_targets;
create policy fin_targets_mgr on public.fin_targets for all to authenticated
  using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));

-- الملخص: لكل عميلة زياراتها وصرفها وأختامها وشريحتها
create or replace view public.clients_overview with (security_invoker = true) as
select c.*,
  coalesce(v.visits, 0) as visits,
  coalesce(v.spend, 0) as spend,
  v.first_visit, v.last_visit,
  coalesce(v.visits, 0) - coalesce(r.redeemed, 0) * (select stamps from public.loyalty_settings where id = 1) as stamps,
  case
    when c.vip then 'vip'
    when v.last_visit is null then 'new'
    when v.last_visit < current_date - 45 then 'away'
    when v.visits >= 3 then 'regular'
    else 'new'
  end as segment
from public.clients c
left join (select client_id, count(*) visits, sum(coalesce(amount,0)) spend, min(day) first_visit, max(day) last_visit from public.client_visits group by client_id) v on v.client_id = c.id
left join (select client_id, count(*) redeemed from public.loyalty_redemptions group by client_id) r on r.client_id = c.id;
grant select on public.clients_overview to authenticated;

-- كل حجز منزلي يكتمل يصير زيارة في ملف العميلة تلقائيًا
create or replace function private.bh_to_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid bigint;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    select id into cid from public.clients where phone = new.phone;
    if cid is null then
      insert into public.clients (name, phone, source, created_by) values (new.customer_name, new.phone, 'home', null) returning id into cid;
    end if;
    insert into public.client_visits (client_id, day, channel, services, amount, booking_id, created_by)
    values (cid, (new.starts_at at time zone 'Asia/Riyadh')::date, 'home',
      (select left(string_agg(name || case when qty > 1 then '×' || qty else '' end, '، '), 300) from public.home_booking_items where booking_id = new.id),
      new.total, new.id, null)
    on conflict (booking_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists bh_to_client on public.home_bookings;
create trigger bh_to_client after insert or update of status on public.home_bookings
  for each row execute function private.bh_to_client();

-- ترحيل الحجوزات المكتملة السابقة
do $$
declare b record; cid bigint;
begin
  for b in select * from public.home_bookings where status = 'done' and id not in (select booking_id from public.client_visits where booking_id is not null) loop
    select id into cid from public.clients where phone = b.phone;
    if cid is null then insert into public.clients (name, phone, source, created_by) values (b.customer_name, b.phone, 'home', null) returning id into cid; end if;
    insert into public.client_visits (client_id, day, channel, amount, booking_id, created_by)
    values (cid, (b.starts_at at time zone 'Asia/Riyadh')::date, 'home', b.total, b.id, null);
  end loop;
end $$;
