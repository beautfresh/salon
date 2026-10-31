-- بيوتفريش: الفريق (الملفات، المناوبات، الإجازات، العمولات، الوثائق)

create table if not exists public.team_members (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 60),
  role_title text not null default 'nails' check (role_title in ('nails','hair','makeup','lashes','reception','manager','cleaner','other')),
  phone text check (phone is null or phone ~ '^05[0-9]{8}$'),
  color text not null default '#5A2A22' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  profile_id uuid unique references public.profiles(id) on delete set null,
  start_date date,
  active boolean not null default true,
  skills text check (skills is null or length(skills) <= 300),
  created_at timestamptz not null default now()
);

-- بيانات حساسة: للإدارة فقط. تواريخ انتهاء فقط، بدون أرقام هويات
create table if not exists public.team_private (
  member_id bigint primary key references public.team_members(id) on delete cascade,
  salary numeric(10,2) check (salary is null or salary >= 0),
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  iqama_expiry date,
  health_card_expiry date,
  passport_expiry date,
  contract_end date,
  notes text check (notes is null or length(notes) <= 1000)
);

create table if not exists public.team_shifts (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.team_members(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  starts time not null,
  ends time not null,
  unique (member_id, weekday)
);

create table if not exists public.team_leaves (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.team_members(id) on delete cascade,
  kind text not null default 'annual' check (kind in ('annual','sick','emergency','unpaid','other')),
  from_day date not null,
  to_day date not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text check (note is null or length(note) <= 300),
  requested_by uuid default auth.uid() references public.profiles(id),
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);

create table if not exists public.team_sales (
  member_id bigint not null references public.team_members(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  sales numeric(12,2) not null default 0 check (sales >= 0),
  bonus numeric(10,2) not null default 0 check (bonus >= 0),
  primary key (member_id, month)
);

alter table public.team_members enable row level security;
alter table public.team_private enable row level security;
alter table public.team_shifts enable row level security;
alter table public.team_leaves enable row level security;
alter table public.team_sales enable row level security;
revoke all on public.team_members, public.team_private, public.team_shifts, public.team_leaves, public.team_sales from anon;

do $$
declare t text;
begin
  foreach t in array array['team_members','team_shifts','team_leaves'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
  end loop;
  foreach t in array array['team_members','team_private','team_shifts','team_leaves','team_sales'] loop
    execute format('drop policy if exists %1$s_mgr on public.%1$s', t);
    execute format($p$create policy %1$s_mgr on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;
-- أي موظفة تقدر تطلب إجازة (بحالة انتظار)
drop policy if exists team_leaves_req on public.team_leaves;
create policy team_leaves_req on public.team_leaves for insert to authenticated
  with check (private.is_active_user() and status = 'pending');

-- تنبيه الإدارة بطلب الإجازة
create or replace function private.leave_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform private.push_admins('طلب إجازة',
      (select name from public.team_members where id = new.member_id) || ' · ' || to_char(new.from_day, 'DD/MM') ||
      case when new.to_day > new.from_day then ' – ' || to_char(new.to_day, 'DD/MM') else '' end,
      '#/team?t=leaves', 'leave-' || new.id, auth.uid());
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists leave_notify on public.team_leaves;
create trigger leave_notify after insert on public.team_leaves for each row execute function private.leave_notify();
