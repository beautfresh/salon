-- بيوتفريش: نظام حجز الصالون (بديل حجوزات ركاز)
-- العميلة تحجز بدون حساب عبر دوال محددة (sb_*)، والجداول محمية بالكامل.

-- ---------- الأقسام والخدمات والخيارات ----------
create table if not exists public.salon_svc_cats (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 2 and 60),
  grp text not null default 'hair' check (grp in ('hair','nails','face')),
  role text not null default 'hair' check (role in ('hair','nails','lashes','makeup','face')),
  sort int not null default 0
);

create table if not exists public.salon_services (
  id bigint generated always as identity primary key,
  cat_id bigint not null references public.salon_svc_cats(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 90),
  description text check (description is null or length(description) <= 400),
  price numeric(10,2) not null default 0 check (price >= 0),
  duration_min int not null default 45 check (duration_min between 5 and 600),
  is_active boolean not null default true,
  popular boolean not null default false,
  sort int not null default 0,
  rekaz_slug text unique,
  created_at timestamptz not null default now()
);
create index if not exists salon_services_cat_idx on public.salon_services (cat_id, sort);

create table if not exists public.salon_service_options (
  id bigint generated always as identity primary key,
  service_id bigint not null references public.salon_services(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 90),
  price numeric(10,2) not null check (price >= 0),
  duration_min int not null check (duration_min between 5 and 600),
  is_active boolean not null default true,
  sort int not null default 0
);
create index if not exists salon_service_options_s_idx on public.salon_service_options (service_id, sort);

-- ---------- الإعدادات ----------
create table if not exists public.salon_settings (
  id int primary key default 1 check (id = 1),
  accepting boolean not null default true,
  open_time time not null default '10:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 30 check (slot_minutes between 10 and 120),
  lead_minutes int not null default 60 check (lead_minutes between 0 and 2880),
  horizon_days int not null default 21 check (horizon_days between 1 and 90),
  closed_weekdays int[] not null default '{}',
  seats int not null default 2 check (seats between 1 and 20),
  max_open_per_phone int not null default 2 check (max_open_per_phone between 1 and 10),
  cancel_hours int not null default 3 check (cancel_hours between 0 and 72),
  whatsapp text not null default '966509492224',
  online_payment boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.salon_settings (id) values (1) on conflict do nothing;

create table if not exists public.salon_blackouts (
  day date primary key,
  note text check (note is null or length(note) <= 200)
);

-- مين تقدر تسوي وش (من الفريق)
alter table public.team_members add column if not exists book_roles text[] not null default '{}';
update public.team_members set book_roles = case role_title
    when 'hair' then '{hair}'::text[] when 'nails' then '{nails}'::text[]
    when 'lashes' then '{lashes,face}'::text[] when 'makeup' then '{makeup,face}'::text[] else '{}'::text[] end
  where book_roles = '{}';
create or replace function private.team_default_roles() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and coalesce(cardinality(new.book_roles), 0) = 0 then
    new.book_roles := case new.role_title when 'hair' then '{hair}'::text[] when 'nails' then '{nails}'::text[]
      when 'lashes' then '{lashes,face}'::text[] when 'makeup' then '{makeup,face}'::text[] else '{}'::text[] end;
  end if;
  return new;
end $$;
drop trigger if exists team_default_roles on public.team_members;
create trigger team_default_roles before insert on public.team_members for each row execute function private.team_default_roles();

-- ---------- الحجوزات ----------
create sequence if not exists public.salon_booking_no start 2001;

create table if not exists public.salon_bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('BS-' || nextval('public.salon_booking_no')),
  access_token uuid not null unique default gen_random_uuid(),
  client_id bigint references public.clients(id) on delete set null,
  customer_name text not null check (length(trim(customer_name)) between 2 and 60),
  phone text not null check (phone ~ '^05[0-9]{8}$'),
  preferred_member bigint references public.team_members(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total numeric(10,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','confirmed','arrived','done','no_show','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','deposit','paid','refunded')),
  paid_amount numeric(10,2) check (paid_amount is null or paid_amount >= 0),
  payment_method text check (payment_method is null or length(payment_method) <= 40),
  notes text check (notes is null or length(notes) <= 500),
  internal_note text check (internal_note is null or length(internal_note) <= 500),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 200),
  source text not null default 'web' check (source in ('web','admin','phone','walkin')),
  confirmed_at timestamptz,
  rekaz_invoice text check (rekaz_invoice is null or length(rekaz_invoice) <= 60),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists salon_bookings_starts_idx on public.salon_bookings (starts_at);
create index if not exists salon_bookings_phone_idx on public.salon_bookings (phone);

create table if not exists public.salon_booking_items (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.salon_bookings(id) on delete cascade,
  service_id bigint references public.salon_services(id) on delete set null,
  option_id bigint references public.salon_service_options(id) on delete set null,
  name text not null,
  role text not null,
  price numeric(10,2) not null default 0,
  duration_min int not null,
  member_id bigint references public.team_members(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);
create index if not exists salon_items_b_idx on public.salon_booking_items (booking_id);
create index if not exists salon_items_m_idx on public.salon_booking_items (member_id, starts_at);

create table if not exists public.salon_booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.salon_bookings(id) on delete cascade,
  kind text not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists salon_events_b_idx on public.salon_booking_events (booking_id);

-- ---------- الصلاحيات ----------
alter table public.salon_svc_cats enable row level security;
alter table public.salon_services enable row level security;
alter table public.salon_service_options enable row level security;
alter table public.salon_settings enable row level security;
alter table public.salon_blackouts enable row level security;
alter table public.salon_bookings enable row level security;
alter table public.salon_booking_items enable row level security;
alter table public.salon_booking_events enable row level security;

revoke all on public.salon_svc_cats, public.salon_services, public.salon_service_options, public.salon_settings,
  public.salon_blackouts, public.salon_bookings, public.salon_booking_items, public.salon_booking_events from anon;

do $$
declare t text;
begin
  foreach t in array array['salon_svc_cats','salon_services','salon_service_options','salon_settings','salon_blackouts'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format($p$create policy %1$s_write on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;

-- الحجوزات: كل الفريق يشوف ويحدّث الحالة (الاستقبال)، والحذف للإدارة
drop policy if exists salon_bookings_read on public.salon_bookings;
create policy salon_bookings_read on public.salon_bookings for select to authenticated using (private.is_active_user());
drop policy if exists salon_bookings_upd on public.salon_bookings;
create policy salon_bookings_upd on public.salon_bookings for update to authenticated
  using (private.is_active_user()) with check (private.is_active_user());
drop policy if exists salon_bookings_del on public.salon_bookings;
create policy salon_bookings_del on public.salon_bookings for delete to authenticated using (private.my_role() in ('admin','partner'));

drop policy if exists salon_items_read on public.salon_booking_items;
create policy salon_items_read on public.salon_booking_items for select to authenticated using (private.is_active_user());
drop policy if exists salon_items_upd on public.salon_booking_items;
create policy salon_items_upd on public.salon_booking_items for update to authenticated
  using (private.is_active_user()) with check (private.is_active_user());

drop policy if exists salon_events_read on public.salon_booking_events;
create policy salon_events_read on public.salon_booking_events for select to authenticated using (private.is_active_user());
drop policy if exists salon_events_ins on public.salon_booking_events;
create policy salon_events_ins on public.salon_booking_events for insert to authenticated
  with check (private.is_active_user() and created_by = auth.uid());

grant select, insert, update, delete on public.salon_svc_cats, public.salon_services, public.salon_service_options,
  public.salon_settings, public.salon_blackouts to authenticated;
grant select, update, delete on public.salon_bookings to authenticated;
grant select, update on public.salon_booking_items to authenticated;
grant select, insert on public.salon_booking_events to authenticated;

-- ---------- سجل التغييرات ----------
create or replace function private.salon_booking_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into public.salon_booking_events (booking_id, kind, note) values (new.id, 'status', old.status || ' → ' || new.status);
    if new.status = 'confirmed' and new.confirmed_at is null then new.confirmed_at := now(); end if;
  end if;
  if new.payment_status is distinct from old.payment_status then
    insert into public.salon_booking_events (booking_id, kind, note) values (new.id, 'payment', old.payment_status || ' → ' || new.payment_status);
  end if;
  return new;
end $$;
drop trigger if exists salon_booking_audit on public.salon_bookings;
create trigger salon_booking_audit before update on public.salon_bookings
  for each row execute function private.salon_booking_audit();

-- الزيارة المكتملة تنضاف لملف العميلة وبطاقة الولاء
alter table public.client_visits add column if not exists salon_booking_id uuid unique references public.salon_bookings(id) on delete set null;
create or replace function private.sb_to_client() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid bigint;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    cid := new.client_id;
    if cid is null then
      select id into cid from public.clients where phone = new.phone;
      if cid is null then
        insert into public.clients (name, phone, source, created_by) values (new.customer_name, new.phone, 'salon', null) returning id into cid;
      end if;
    end if;
    insert into public.client_visits (client_id, day, channel, services, amount, salon_booking_id, created_by)
    values (cid, (new.starts_at at time zone 'Asia/Riyadh')::date, 'salon',
      (select left(string_agg(name, '، ' order by starts_at), 300) from public.salon_booking_items where booking_id = new.id),
      coalesce(new.paid_amount, new.total), new.id, auth.uid())
    on conflict (salon_booking_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists sb_to_client on public.salon_bookings;
create trigger sb_to_client after update of status on public.salon_bookings
  for each row execute function private.sb_to_client();

-- إشعار الإدارة بالحجز الجديد
create or replace function private.on_salon_booking_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'web' then
    perform private.push_admins('حجز جديد في الصالون · ' || new.code,
      new.customer_name || ' · ' || to_char(new.starts_at at time zone 'Asia/Riyadh', 'DD/MM HH24:MI'),
      '#/appts?d=' || to_char(new.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), 'sb-' || new.id, null);
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists salon_booking_created on public.salon_bookings;
create trigger salon_booking_created after insert on public.salon_bookings
  for each row execute function private.on_salon_booking_created();

-- ---------- محرك المواعيد ----------
-- يحوّل اختيارات العميلة إلى بنود: الدور، المدة، السعر، الاسم
create or replace function private.sb_resolve(p_items jsonb)
returns table (ord int, service_id bigint, option_id bigint, name text, role text, price numeric, duration_min int)
language sql stable security definer set search_path = '' as $$
  select x.ord::int, s.id, o.id,
         case when o.id is null then s.name else s.name || ' · ' || o.name end,
         c.role, coalesce(o.price, s.price), coalesce(o.duration_min, s.duration_min)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(v, ord)
    join public.salon_services s on s.id = (x.v->>'service_id')::bigint and s.is_active
    join public.salon_svc_cats c on c.id = s.cat_id
    left join public.salon_service_options o on o.id = nullif(x.v->>'option_id','')::bigint and o.service_id = s.id and o.is_active
   where ((x.v->>'option_id') is null or o.id is not null)
     and (o.id is not null or not exists (select 1 from public.salon_service_options o2 where o2.service_id = s.id and o2.is_active))
   order by x.ord
$$;

-- هل فيه موظفات مسجّلات للحجز؟ إذا لا، نشتغل بعدد الكراسي
create or replace function private.sb_staff_mode() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m join public.team_shifts sh on sh.member_id = m.id
                  where m.active and cardinality(m.book_roles) > 0)
$$;

-- يوزّع البنود على الموظفات بالتسلسل ابتداءً من p_start. يرجع null إذا ما يمدي
create or replace function private.sb_plan(p_start timestamptz, p_items jsonb, p_member bigint default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.salon_settings; r record; t timestamptz := p_start; e timestamptz; pick bigint; prev bigint;
  out jsonb := '[]'::jsonb; staff boolean; ld date; n int := 0;
begin
  select * into s from public.salon_settings where id = 1;
  staff := private.sb_staff_mode();
  for r in select * from private.sb_resolve(p_items) loop
    n := n + 1;
    e := t + make_interval(mins => r.duration_min);
    ld := (t at time zone 'Asia/Riyadh')::date;
    if (e at time zone 'Asia/Riyadh')::time > s.close_time or (e at time zone 'Asia/Riyadh')::date <> ld
       or (t at time zone 'Asia/Riyadh')::time < s.open_time then return null; end if;
    if staff then
      select m.id into pick
        from public.team_members m
        join public.team_shifts sh on sh.member_id = m.id and sh.weekday = extract(dow from ld)::int
       where m.active and r.role = any (m.book_roles)
         and (ld + sh.starts) at time zone 'Asia/Riyadh' <= t and (ld + sh.ends) at time zone 'Asia/Riyadh' >= e
         and not exists (select 1 from public.team_leaves l where l.member_id = m.id and l.status = 'approved' and ld between l.from_day and l.to_day)
         and not exists (select 1 from public.salon_booking_items i join public.salon_bookings b on b.id = i.booking_id
                          where i.member_id = m.id and b.status not in ('cancelled','no_show')
                            and (p_exclude is null or b.id <> p_exclude)
                            and tstzrange(i.starts_at, i.ends_at, '[)') && tstzrange(t, e, '[)'))
         and not exists (select 1 from jsonb_array_elements(out) o where (o->>'m')::bigint = m.id
                            and tstzrange((o->>'s')::timestamptz, (o->>'e')::timestamptz, '[)') && tstzrange(t, e, '[)'))
       order by (m.id = p_member) desc, (m.id = prev) desc,
                (select count(*) from public.salon_booking_items i2 join public.salon_bookings b2 on b2.id = i2.booking_id
                  where i2.member_id = m.id and b2.status not in ('cancelled','no_show')
                    and (i2.starts_at at time zone 'Asia/Riyadh')::date = ld), m.id
       limit 1;
      if pick is null then return null; end if;
      if p_member is not null and n = 1 and pick <> p_member
         and exists (select 1 from public.team_members where id = p_member and r.role = any (book_roles)) then return null; end if;
    else
      if (select count(*) from public.salon_booking_items i join public.salon_bookings b on b.id = i.booking_id
           where b.status not in ('cancelled','no_show') and (p_exclude is null or b.id <> p_exclude)
             and tstzrange(i.starts_at, i.ends_at, '[)') && tstzrange(t, e, '[)')) >= s.seats then return null; end if;
      pick := null;
    end if;
    out := out || jsonb_build_object('ord', r.ord, 'm', pick, 's', t, 'e', e);
    prev := pick; pick := null; t := e;
  end loop;
  if n = 0 then return null; end if;
  return out;
end $$;

create or replace function public.sb_slots(p_day date, p_items jsonb, p_member bigint default null)
returns table (slot text) language plpgsql stable security definer set search_path = '' as $$
declare s public.salon_settings; t time; st timestamptz; local_now timestamp;
begin
  select * into s from public.salon_settings where id = 1;
  if not s.accepting then return; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 6 then return; end if;
  local_now := now() at time zone 'Asia/Riyadh';
  if p_day < local_now::date or p_day > local_now::date + s.horizon_days then return; end if;
  if extract(dow from p_day)::int = any (s.closed_weekdays) then return; end if;
  if exists (select 1 from public.salon_blackouts where day = p_day) then return; end if;
  t := s.open_time;
  while t < s.close_time loop
    st := (p_day + t) at time zone 'Asia/Riyadh';
    if st >= now() + make_interval(mins => s.lead_minutes) and private.sb_plan(st, p_items, p_member) is not null then
      slot := to_char(t, 'HH24:MI'); return next;
    end if;
    exit when t + make_interval(mins => s.slot_minutes) <= t;
    t := t + make_interval(mins => s.slot_minutes);
  end loop;
end $$;

-- أقرب موعد خلال الأيام القادمة
create or replace function public.sb_first(p_items jsonb, p_member bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date; s public.salon_settings; x text;
begin
  select * into s from public.salon_settings where id = 1;
  for i in 0..least(s.horizon_days, 14) loop
    select slot into x from public.sb_slots(d + i, p_items, p_member) limit 1;
    if x is not null then return jsonb_build_object('day', d + i, 'time', x); end if;
  end loop;
  return null;
end $$;

-- ---------- بيانات صفحة الحجز ----------
create or replace function public.sb_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('accepting', accepting, 'horizon_days', horizon_days, 'closed_weekdays', closed_weekdays,
                   'open_time', to_char(open_time,'HH24:MI'), 'close_time', to_char(close_time,'HH24:MI'),
                   'whatsapp', whatsapp, 'online_payment', online_payment, 'cancel_hours', cancel_hours)
                 from public.salon_settings where id = 1),
    'cats', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grp', grp, 'role', role) order by sort, id)
                 from public.salon_svc_cats), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cat', s.cat_id, 'name', s.name, 'desc', s.description,
                   'price', s.price, 'dur', s.duration_min, 'pop', s.popular,
                   'opts', (select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'dur', o.duration_min) order by o.sort, o.id)
                              from public.salon_service_options o where o.service_id = s.id and o.is_active)) order by s.sort, s.id)
                 from public.salon_services s where s.is_active), '[]'::jsonb),
    'staff', case when private.sb_staff_mode() then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', split_part(m.name, ' ', 1), 'roles', m.book_roles, 'color', m.color) order by m.name)
                 from public.team_members m where m.active and cardinality(m.book_roles) > 0
                   and exists (select 1 from public.team_shifts sh where sh.member_id = m.id)), '[]'::jsonb) else '[]'::jsonb end,
    'blackouts', coalesce((select jsonb_agg(day) from public.salon_blackouts where day >= current_date), '[]'::jsonb)
  )
$$;

-- ---------- إنشاء حجز ----------
create or replace function public.sb_create(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.salon_settings;
  v_name text := trim(coalesce(p->>'name',''));
  v_phone text := regexp_replace(translate(coalesce(p->>'phone',''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
  v_day date; v_time time; st timestamptz; plan jsonb; b public.salon_bookings; v_member bigint;
  v_src text := 'web'; v_cid bigint;
begin
  select * into s from public.salon_settings where id = 1;
  if auth.uid() is not null and private.is_active_user() then
    v_src := coalesce(nullif(p->>'source',''), 'admin');
    if v_src not in ('admin','phone','walkin') then v_src := 'admin'; end if;
  elsif not s.accepting then raise exception 'الحجز متوقف مؤقتًا، تواصلي معنا على الواتساب';
  end if;
  if v_phone ~ '^9665[0-9]{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone ~ '^5[0-9]{8}$' then v_phone := '0' || v_phone; end if;
  if v_phone !~ '^05[0-9]{8}$' then raise exception 'رقم الجوال غير صحيح'; end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'اكتبي الاسم'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'اختاري خدمة وحدة على الأقل'; end if;
  if jsonb_array_length(p->'items') > 6 then raise exception 'عدد الخدمات كبير، تواصلي معنا'; end if;
  if (select count(*) from private.sb_resolve(p->'items')) <> jsonb_array_length(p->'items') then raise exception 'فيه خدمة غير متاحة، حدّثي الصفحة'; end if;

  if v_src = 'web' and (select count(*) from public.salon_bookings where phone = v_phone and status in ('pending','confirmed') and starts_at > now()) >= s.max_open_per_phone then
    raise exception 'عندك حجوزات قادمة، تواصلي معنا على الواتساب لو تبين تضيفين';
  end if;

  v_member := nullif(p->>'member_id','')::bigint;
  v_day := (p->>'day')::date; v_time := (p->>'time')::time;
  st := (v_day + v_time) at time zone 'Asia/Riyadh';

  perform pg_advisory_xact_lock(hashtext('salon_booking_slots'));
  if v_src = 'web' and not exists (select 1 from public.sb_slots(v_day, p->'items', v_member) x where x.slot = to_char(v_time, 'HH24:MI')) then
    raise exception 'الموعد انحجز قبل شوي، اختاري وقت ثاني';
  end if;
  plan := private.sb_plan(st, p->'items', v_member);
  if plan is null then raise exception 'الموعد مو متاح، اختاري وقت ثاني'; end if;

  select id into v_cid from public.clients where phone = v_phone;

  insert into public.salon_bookings (client_id, customer_name, phone, preferred_member, starts_at, ends_at, total, notes, source, status)
  values (v_cid, v_name, v_phone, v_member, st,
          (select max((x->>'e')::timestamptz) from jsonb_array_elements(plan) x),
          (select coalesce(sum(price), 0) from private.sb_resolve(p->'items')),
          nullif(left(trim(coalesce(p->>'notes','')), 500), ''), v_src,
          case when v_src = 'web' then 'pending' else 'confirmed' end)
  returning * into b;

  insert into public.salon_booking_items (booking_id, service_id, option_id, name, role, price, duration_min, member_id, starts_at, ends_at)
  select b.id, r.service_id, r.option_id, r.name, r.role, r.price, r.duration_min,
         (x->>'m')::bigint, (x->>'s')::timestamptz, (x->>'e')::timestamptz
    from private.sb_resolve(p->'items') r
    join jsonb_array_elements(plan) x on (x->>'ord')::int = r.ord;

  insert into public.salon_booking_events (booking_id, kind, note, created_by)
  values (b.id, 'created', case v_src when 'web' then 'من الموقع' else 'من لوحة الإدارة' end, auth.uid());
  return jsonb_build_object('code', b.code, 'token', b.access_token, 'id', b.id, 'starts_at', b.starts_at, 'total', b.total);
end $$;

-- ---------- صفحة حجز العميلة (رابط الواتساب) ----------
create or replace function public.sb_get(p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', b.code, 'name', b.customer_name, 'status', b.status,
     'starts_at', b.starts_at, 'ends_at', b.ends_at, 'total', b.total,
     'can_cancel', b.status in ('pending','confirmed') and b.starts_at > now() + make_interval(hours => s.cancel_hours),
     'can_confirm', b.status = 'pending' and b.starts_at > now(),
     'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'dur', i.duration_min,
                 'staff', (select split_part(m.name, ' ', 1) from public.team_members m where m.id = i.member_id)) order by i.starts_at)
               from public.salon_booking_items i where i.booking_id = b.id),
     'whatsapp', s.whatsapp, 'cancel_hours', s.cancel_hours)
  from public.salon_bookings b, public.salon_settings s where b.access_token = p_token and s.id = 1
$$;

create or replace function public.sb_confirm(p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.salon_bookings set status = 'confirmed' where access_token = p_token and status = 'pending' and starts_at > now();
  if not found then raise exception 'الحجز مؤكد من قبل أو انتهى'; end if;
end $$;

create or replace function public.sb_cancel(p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.salon_bookings; h int;
begin
  select cancel_hours into h from public.salon_settings where id = 1;
  update public.salon_bookings set status = 'cancelled', cancel_reason = 'ألغته العميلة من الرابط'
   where access_token = p_token and status in ('pending','confirmed') and starts_at > now() + make_interval(hours => h)
   returning * into b;
  if b.id is null then raise exception 'ما يمدي نلغيه من الرابط، تواصلي معنا على الواتساب'; end if;
  perform private.push_admins('إلغاء موعد · ' || b.code, b.customer_name || ' ألغت موعد '
     || to_char(b.starts_at at time zone 'Asia/Riyadh', 'DD/MM HH24:MI'),
     '#/appts?d=' || to_char(b.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), 'sb-' || b.id, null);
exception when others then
  if b.id is null then raise; end if;
end $$;

revoke all on function public.sb_catalog(), public.sb_slots(date, jsonb, bigint), public.sb_first(jsonb, bigint),
  public.sb_create(jsonb), public.sb_get(uuid), public.sb_confirm(uuid), public.sb_cancel(uuid) from public;
grant execute on function public.sb_catalog(), public.sb_slots(date, jsonb, bigint), public.sb_first(jsonb, bigint),
  public.sb_create(jsonb), public.sb_get(uuid), public.sb_confirm(uuid), public.sb_cancel(uuid) to anon, authenticated;
revoke all on function private.sb_resolve(jsonb), private.sb_plan(timestamptz, jsonb, bigint, uuid), private.sb_staff_mode() from public, anon;
