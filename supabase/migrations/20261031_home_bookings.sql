-- بيوتفريش للعناية المنزلية: الخدمات والحجوزات
-- الجداول محمية بالكامل؛ موقع العميلات يتعامل فقط عبر دوال محددة (bh_*).

create extension if not exists btree_gist;

-- ---------- الخدمات ----------
create table if not exists public.home_services (
  id bigint generated always as identity primary key,
  code text unique,
  name text not null check (length(trim(name)) between 2 and 80),
  category text not null default 'nails' check (category in ('nails','hair','package','other')),
  description text,
  duration_min int not null default 60 check (duration_min between 10 and 600),
  price numeric(10,2) check (price is null or price >= 0),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- الأحياء ورسوم الزيارة ----------
create table if not exists public.home_districts (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 2 and 60),
  visit_fee numeric(10,2) check (visit_fee is null or visit_fee >= 0),
  is_active boolean not null default true,
  sort int not null default 0
);

-- ---------- الإعدادات (صف واحد) ----------
create table if not exists public.home_settings (
  id int primary key default 1 check (id = 1),
  accepting boolean not null default true,
  open_time time not null default '10:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 30 check (slot_minutes between 10 and 120),
  buffer_minutes int not null default 30 check (buffer_minutes between 0 and 180),
  capacity int not null default 1 check (capacity between 1 and 20),
  lead_hours int not null default 3 check (lead_hours between 0 and 72),
  horizon_days int not null default 21 check (horizon_days between 1 and 90),
  closed_weekdays int[] not null default '{}',
  whatsapp text,
  payment_note text default 'نرسل لكِ رابط الدفع بعد تأكيد الموعد.',
  policy_note text default 'يُعد الموعد مؤكدًا بعد رسالة من الفريق تتضمن الخدمة والوقت والإجمالي.',
  updated_at timestamptz not null default now()
);
insert into public.home_settings (id) values (1) on conflict do nothing;

create table if not exists public.home_blackouts (
  day date primary key,
  note text
);

-- ---------- الحجوزات ----------
create sequence if not exists public.home_booking_no start 1001;

create table if not exists public.home_bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('BF-' || nextval('public.home_booking_no')),
  access_token uuid not null unique default gen_random_uuid(),
  customer_name text not null check (length(trim(customer_name)) between 2 and 60),
  phone text not null check (phone ~ '^05[0-9]{8}$'),
  district_id bigint references public.home_districts(id),
  district_name text,
  address text check (address is null or length(address) <= 300),
  map_url text check (map_url is null or length(map_url) <= 500),
  notes text check (notes is null or length(notes) <= 500),
  guests int not null default 1 check (guests between 1 and 10),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  services_total numeric(10,2),
  visit_fee numeric(10,2),
  total numeric(10,2),
  status text not null default 'pending' check (status in ('pending','confirmed','on_way','done','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  payment_method text,
  payment_ref text,
  staff_id uuid references public.profiles(id),
  internal_note text,
  cancel_reason text,
  source text not null default 'web',
  rekaz_reservation_id text,
  rekaz_invoice_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists home_bookings_starts_idx on public.home_bookings (starts_at);
create index if not exists home_bookings_status_idx on public.home_bookings (status);
create index if not exists home_bookings_phone_idx on public.home_bookings (phone);

create table if not exists public.home_booking_items (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.home_bookings(id) on delete cascade,
  service_id bigint references public.home_services(id),
  name text not null,
  price numeric(10,2),
  duration_min int not null,
  qty int not null default 1 check (qty between 1 and 10)
);
create index if not exists home_booking_items_b_idx on public.home_booking_items (booking_id);

create table if not exists public.home_booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.home_bookings(id) on delete cascade,
  kind text not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists home_booking_events_b_idx on public.home_booking_events (booking_id);

-- ---------- الصلاحيات ----------
alter table public.home_services enable row level security;
alter table public.home_districts enable row level security;
alter table public.home_settings enable row level security;
alter table public.home_blackouts enable row level security;
alter table public.home_bookings enable row level security;
alter table public.home_booking_items enable row level security;
alter table public.home_booking_events enable row level security;

revoke all on public.home_services, public.home_districts, public.home_settings, public.home_blackouts,
  public.home_bookings, public.home_booking_items, public.home_booking_events from anon;

-- الإعدادات والخدمات: كل الفريق يقرأ، المدير والشريك يعدّلون
do $$
declare t text;
begin
  foreach t in array array['home_services','home_districts','home_settings','home_blackouts'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format($p$create policy %1$s_write on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;

-- الحجوزات: المدير والشريك كل شي؛ الموظفة تشوف وتحدّث حجوزاتها فقط
drop policy if exists home_bookings_read on public.home_bookings;
create policy home_bookings_read on public.home_bookings for select to authenticated
  using (private.my_role() in ('admin','partner') or (private.my_role() = 'staff' and staff_id = auth.uid()));
drop policy if exists home_bookings_mgr on public.home_bookings;
create policy home_bookings_mgr on public.home_bookings for all to authenticated
  using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));

drop policy if exists home_items_read on public.home_booking_items;
create policy home_items_read on public.home_booking_items for select to authenticated
  using (exists (select 1 from public.home_bookings b where b.id = booking_id));
drop policy if exists home_items_mgr on public.home_booking_items;
create policy home_items_mgr on public.home_booking_items for all to authenticated
  using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));

drop policy if exists home_events_read on public.home_booking_events;
create policy home_events_read on public.home_booking_events for select to authenticated
  using (exists (select 1 from public.home_bookings b where b.id = booking_id));
drop policy if exists home_events_ins on public.home_booking_events;
create policy home_events_ins on public.home_booking_events for insert to authenticated
  with check (exists (select 1 from public.home_bookings b where b.id = booking_id) and created_by = auth.uid());

-- ---------- سجل التغييرات وتحديث الوقت ----------
create or replace function private.home_booking_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into public.home_booking_events (booking_id, kind, note) values (new.id, 'status', old.status || ' → ' || new.status);
  end if;
  if new.payment_status is distinct from old.payment_status then
    insert into public.home_booking_events (booking_id, kind, note) values (new.id, 'payment', old.payment_status || ' → ' || new.payment_status);
  end if;
  if new.starts_at is distinct from old.starts_at then
    insert into public.home_booking_events (booking_id, kind, note) values (new.id, 'reschedule', to_char(old.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' → ' || to_char(new.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'));
  end if;
  if new.staff_id is distinct from old.staff_id then
    insert into public.home_booking_events (booking_id, kind, note) values (new.id, 'staff', null);
  end if;
  return new;
end $$;
drop trigger if exists home_booking_audit on public.home_bookings;
create trigger home_booking_audit before update on public.home_bookings
  for each row execute function private.home_booking_audit();

-- الموظفة تحدّث حالة حجزها فقط (في الطريق / تمت)
create or replace function public.bh_staff_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('on_way','done') then raise exception 'حالة غير مسموحة'; end if;
  update public.home_bookings set status = p_status
   where id = p_id and staff_id = auth.uid() and status in ('confirmed','on_way')
     and private.my_role() is not null;
  if not found then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
end $$;
revoke all on function public.bh_staff_status(uuid, text) from public, anon;
grant execute on function public.bh_staff_status(uuid, text) to authenticated;

-- ---------- إشعار الإدارة ----------
create or replace function private.on_home_booking_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.push_admins(
    'حجز منزلي جديد · ' || new.code,
    new.customer_name || ' · ' || coalesce(new.district_name, '') || ' · '
      || to_char(new.starts_at at time zone 'Asia/Riyadh', 'DD/MM HH24:MI'),
    '#/booking/' || new.id, 'booking-' || new.id, null);
  return new;
exception when others then return new;
end $$;
drop trigger if exists home_booking_created on public.home_bookings;
create trigger home_booking_created after insert on public.home_bookings
  for each row execute function private.on_home_booking_created();

-- ---------- المواعيد المتاحة ----------
create or replace function private.bh_is_free(p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.home_bookings b
           where b.status <> 'cancelled'
             and (p_exclude is null or b.id <> p_exclude)
             and tstzrange(b.starts_at, b.ends_at + make_interval(mins => s.buffer_minutes), '[)')
              && tstzrange(p_start, p_end + make_interval(mins => s.buffer_minutes), '[)')) < s.capacity
  from public.home_settings s where s.id = 1
$$;

create or replace function public.bh_slots(p_day date, p_duration int)
returns table (slot text) language plpgsql stable security definer set search_path = '' as $$
declare s public.home_settings; t time; st timestamptz; en timestamptz; local_now timestamp;
begin
  select * into s from public.home_settings where id = 1;
  if not s.accepting then return; end if;
  if p_duration is null or p_duration < 10 or p_duration > 600 then return; end if;
  local_now := now() at time zone 'Asia/Riyadh';
  if p_day < local_now::date or p_day > local_now::date + s.horizon_days then return; end if;
  if extract(dow from p_day)::int = any (s.closed_weekdays) then return; end if;
  if exists (select 1 from public.home_blackouts where day = p_day) then return; end if;
  t := s.open_time;
  while t + make_interval(mins => p_duration) <= s.close_time and t >= s.open_time loop
    st := (p_day + t) at time zone 'Asia/Riyadh';
    en := st + make_interval(mins => p_duration);
    if st >= now() + make_interval(hours => s.lead_hours) and private.bh_is_free(st, en) then
      slot := to_char(t, 'HH24:MI'); return next;
    end if;
    exit when t + make_interval(mins => s.slot_minutes) <= t; -- حماية من الالتفاف بعد منتصف الليل
    t := t + make_interval(mins => s.slot_minutes);
  end loop;
end $$;

-- ---------- بيانات الموقع العامة ----------
create or replace function public.bh_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('accepting', accepting, 'horizon_days', horizon_days, 'closed_weekdays', closed_weekdays,
                   'open_time', to_char(open_time,'HH24:MI'), 'close_time', to_char(close_time,'HH24:MI'),
                   'whatsapp', whatsapp, 'payment_note', payment_note, 'policy_note', policy_note)
                 from public.home_settings where id = 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'category', category, 'description', description,
                   'duration_min', duration_min, 'price', price) order by sort, id)
                 from public.home_services where is_active), '[]'::jsonb),
    'districts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'visit_fee', visit_fee) order by sort, name)
                 from public.home_districts where is_active), '[]'::jsonb),
    'blackouts', coalesce((select jsonb_agg(day) from public.home_blackouts where day >= current_date), '[]'::jsonb)
  )
$$;

-- ---------- إنشاء حجز من الموقع ----------
create or replace function public.bh_create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.home_settings; d public.home_districts;
  v_name text := trim(coalesce(p->>'name',''));
  v_phone text := regexp_replace(translate(coalesce(p->>'phone',''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
  v_day date; v_time time; st timestamptz; en timestamptz;
  v_dur int := 0; v_sum numeric := 0; v_has_null boolean := false; v_count int := 0;
  r record; b public.home_bookings; v_guests int;
begin
  select * into s from public.home_settings where id = 1;
  if not s.accepting then raise exception 'الحجز متوقف مؤقتًا'; end if;
  if v_phone ~ '^9665[0-9]{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone ~ '^5[0-9]{8}$' then v_phone := '0' || v_phone; end if;
  if v_phone !~ '^05[0-9]{8}$' then raise exception 'رقم الجوال غير صحيح'; end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'الاسم غير صحيح'; end if;
  v_guests := greatest(1, least(10, coalesce((p->>'guests')::int, 1)));

  select * into d from public.home_districts where id = (p->>'district_id')::bigint and is_active;
  if d.id is null then raise exception 'اختاري الحي'; end if;

  -- حد بسيط ضد الإزعاج: ٣ حجوزات قائمة لنفس الرقم
  if (select count(*) from public.home_bookings where phone = v_phone and status in ('pending','confirmed') and starts_at > now()) >= 3 then
    raise exception 'لديكِ حجوزات قائمة، تواصلي معنا لتعديلها';
  end if;

  for r in select sv.*, greatest(1, least(10, coalesce((x->>'qty')::int, 1))) as qty
             from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) x
             join public.home_services sv on sv.id = (x->>'id')::bigint and sv.is_active loop
    v_count := v_count + 1;
    v_dur := v_dur + r.duration_min * r.qty;
    if r.price is null then v_has_null := true; else v_sum := v_sum + r.price * r.qty; end if;
  end loop;
  if v_count = 0 then raise exception 'اختاري خدمة واحدة على الأقل'; end if;
  if v_count > 8 then raise exception 'عدد الخدمات كبير، تواصلي معنا'; end if;

  v_day := (p->>'day')::date; v_time := (p->>'time')::time;
  st := (v_day + v_time) at time zone 'Asia/Riyadh';
  en := st + make_interval(mins => v_dur);

  perform pg_advisory_xact_lock(hashtext('home_booking_slots'));
  if not exists (select 1 from public.bh_slots(v_day, v_dur) x where x.slot = to_char(v_time, 'HH24:MI')) then
    raise exception 'الموعد لم يعد متاحًا، اختاري وقتًا آخر';
  end if;

  insert into public.home_bookings (customer_name, phone, district_id, district_name, address, map_url, notes, guests,
     starts_at, ends_at, services_total, visit_fee, total)
  values (v_name, v_phone, d.id, d.name, nullif(left(trim(coalesce(p->>'address','')), 300), ''),
     nullif(left(trim(coalesce(p->>'map_url','')), 500), ''), nullif(left(trim(coalesce(p->>'notes','')), 500), ''), v_guests,
     st, en, case when v_has_null then null else v_sum end, d.visit_fee,
     case when v_has_null or d.visit_fee is null then null else v_sum + d.visit_fee end)
  returning * into b;

  insert into public.home_booking_items (booking_id, service_id, name, price, duration_min, qty)
  select b.id, sv.id, sv.name, sv.price, sv.duration_min, greatest(1, least(10, coalesce((x->>'qty')::int, 1)))
    from jsonb_array_elements(p->'items') x join public.home_services sv on sv.id = (x->>'id')::bigint and sv.is_active;

  insert into public.home_booking_events (booking_id, kind, note, created_by) values (b.id, 'created', 'من الموقع', null);
  return jsonb_build_object('code', b.code, 'token', b.access_token);
end $$;

-- ---------- صفحة حجز العميلة ----------
create or replace function public.bh_get_booking(p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', b.code, 'name', b.customer_name, 'status', b.status, 'payment_status', b.payment_status,
     'starts_at', b.starts_at, 'ends_at', b.ends_at, 'district', b.district_name, 'address', b.address, 'guests', b.guests,
     'services_total', b.services_total, 'visit_fee', b.visit_fee, 'total', b.total,
     'can_cancel', b.status in ('pending','confirmed') and b.starts_at > now() + interval '6 hours',
     'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty, 'duration_min', i.duration_min) order by i.id)
               from public.home_booking_items i where i.booking_id = b.id),
     'whatsapp', (select whatsapp from public.home_settings where id = 1),
     'payment_note', (select payment_note from public.home_settings where id = 1))
  from public.home_bookings b where b.access_token = p_token
$$;

create or replace function public.bh_cancel_booking(p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.home_bookings;
begin
  update public.home_bookings set status = 'cancelled', cancel_reason = 'ألغته العميلة من الموقع'
   where access_token = p_token and status in ('pending','confirmed') and starts_at > now() + interval '6 hours'
   returning * into b;
  if b.id is null then raise exception 'لا يمكن إلغاء هذا الحجز من الموقع، تواصلي معنا'; end if;
  perform private.push_admins('إلغاء حجز · ' || b.code, b.customer_name || ' ألغت موعد '
     || to_char(b.starts_at at time zone 'Asia/Riyadh', 'DD/MM HH24:MI'), '#/booking/' || b.id, 'booking-' || b.id, null);
end $$;

revoke all on function public.bh_catalog(), public.bh_slots(date, int), public.bh_create_booking(jsonb),
  public.bh_get_booking(uuid), public.bh_cancel_booking(uuid) from public;
grant execute on function public.bh_catalog(), public.bh_slots(date, int), public.bh_create_booking(jsonb),
  public.bh_get_booking(uuid), public.bh_cancel_booking(uuid) to anon, authenticated;
revoke all on function private.bh_is_free(timestamptz, timestamptz, uuid) from public, anon;

-- ---------- بيانات أولية من حزمة الإطلاق ----------
insert into public.home_services (code, name, category, description, duration_min, sort) values
 ('N01','مانيكير كلاسيكي','nails','ترتيب الأظافر والعناية المحيطة بها ولون عادي.',45,10),
 ('N02','بديكير كلاسيكي','nails','عناية بأظافر القدمين وترطيب ولون عادي.',60,20),
 ('N03','كومبو اليدين والقدمين','nails','مانيكير وبديكير كلاسيكي في جلسة واحدة.',90,30),
 ('N04','طلاء أظافر عادي','nails','تطبيق لون عادي لليدين أو القدمين.',20,40),
 ('N05','جيل بوليش','nails','لون جيل للأظافر الطبيعية.',45,50),
 ('N06','إزالة جيل','nails','إزالة طلاء الجيل والعناية بالأظافر بعد الإزالة.',30,60),
 ('H01','استشوار','hair','تصفيف الشعر بالاستشوار بحسب الطول والكثافة.',45,110),
 ('H02','ويفي','hair','تموّجات ناعمة بحسب الطول والكثافة.',60,120),
 ('H03','تسريحة بسيطة','hair','تصفيف خفيف لطلّة يومية أو زيارة.',45,130),
 ('H04','تسريحة مناسبة','hair','تسريحة تُحدّد تفاصيلها مع الأخصائية قبل الموعد.',90,140),
 ('B01','وقت لكِ','package','مانيكير وبديكير كلاسيكي.',90,210),
 ('B02','قبل المناسبة','package','استشوار وطلاء أظافر عادي.',60,220)
on conflict (code) do nothing;
