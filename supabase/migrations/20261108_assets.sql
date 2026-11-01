-- بيوتفريش: الأصول والصيانة والاشتراكات

create table if not exists public.assets (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 80),
  category text not null default 'other' check (category in ('chair','nails','hair','dryer','ac','sterilizer','furniture','electronics','safety','other')),
  model text check (model is null or length(model) <= 80),
  location text check (location is null or length(location) <= 60),
  qty int not null default 1 check (qty between 1 and 100),
  purchase_date date,
  cost numeric(12,2) check (cost is null or cost >= 0),
  life_years numeric(4,1) check (life_years is null or life_years between 0.5 and 30),
  warranty_until date,
  status text not null default 'ok' check (status in ('ok','issue','out')),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.maint_plans (
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.assets(id) on delete cascade,
  task text not null check (length(trim(task)) between 2 and 120),
  every_days int not null check (every_days between 1 and 1000),
  last_done date,
  vendor text check (vendor is null or length(vendor) <= 80)
);

create table if not exists public.maint_issues (
  id bigint generated always as identity primary key,
  asset_id bigint references public.assets(id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 160),
  status text not null default 'open' check (status in ('open','fixed')),
  cost numeric(10,2) check (cost is null or cost >= 0),
  vendor text check (vendor is null or length(vendor) <= 80),
  note text check (note is null or length(note) <= 300),
  reported_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  fixed_at timestamptz
);

create table if not exists public.subscriptions (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 80),
  category text not null default 'system' check (category in ('system','marketing','telecom','design','insurance','other')),
  amount numeric(10,2) not null check (amount >= 0),
  cycle text not null default 'monthly' check (cycle in ('monthly','quarterly','yearly')),
  renews_on date,
  usage text check (usage in ('high','low')),
  last_review date,
  active boolean not null default true,
  notes text check (notes is null or length(notes) <= 300)
);

do $$
declare t text;
begin
  foreach t in array array['assets','maint_plans','maint_issues','subscriptions'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('drop policy if exists %1$s_mgr on public.%1$s', t);
    execute format($p$create policy %1$s_mgr on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
  foreach t in array array['assets','maint_plans','maint_issues'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
  end loop;
end $$;
-- الفريق كله يبلّغ عن عطل، ويسجّل إنجاز صيانة
drop policy if exists maint_issues_report on public.maint_issues;
create policy maint_issues_report on public.maint_issues for insert to authenticated with check (private.is_active_user() and status = 'open');
drop policy if exists maint_plans_done on public.maint_plans;
create policy maint_plans_done on public.maint_plans for update to authenticated using (private.is_active_user()) with check (private.is_active_user());

-- العطل يغيّر حالة الأصل، ويوصل إشعار للإدارة
create or replace function private.issue_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.asset_id is not null then
    update public.assets a set status = case when exists (select 1 from public.maint_issues i where i.asset_id = a.id and i.status = 'open') then case when a.status = 'out' then 'out' else 'issue' end else 'ok' end
    where a.id = new.asset_id;
  end if;
  if tg_op = 'INSERT' then
    begin
      perform private.push_admins('عطل جديد', new.title || coalesce(' · ' || (select name from public.assets where id = new.asset_id), ''), '#/assets?t=maint', 'issue-' || new.id, auth.uid());
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists issue_sync on public.maint_issues;
create trigger issue_sync after insert or update of status on public.maint_issues for each row execute function private.issue_sync();
