-- بيوتفريش: المالية (إقفال يومي، مصروفات، شركاء، تقرير شهري)

create table if not exists public.fin_partners (
  id bigint generated always as identity primary key,
  name text not null,
  share_pct numeric(5,2) not null check (share_pct between 0 and 100),
  sort int not null default 0
);
insert into public.fin_partners (name, share_pct, sort)
select * from (values ('شهد', 50::numeric, 1), ('أميرة', 50::numeric, 2)) v
where not exists (select 1 from public.fin_partners);

create table if not exists public.fin_daily (
  day date primary key,
  cash numeric(12,2) not null default 0 check (cash >= 0),
  card numeric(12,2) not null default 0 check (card >= 0),
  transfer numeric(12,2) not null default 0 check (transfer >= 0),
  online numeric(12,2) not null default 0 check (online >= 0),
  bnpl numeric(12,2) not null default 0 check (bnpl >= 0),
  other numeric(12,2) not null default 0 check (other >= 0),
  total numeric(12,2) generated always as (cash + card + transfer + online + bnpl + other) stored,
  clients int check (clients is null or clients >= 0),
  nails numeric(12,2), hair numeric(12,2), makeup numeric(12,2), lashes numeric(12,2), products numeric(12,2), other_cat numeric(12,2),
  note text check (note is null or length(note) <= 500),
  entered_by uuid default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.fin_expenses (
  id bigint generated always as identity primary key,
  day date not null default current_date,
  category text not null check (category in ('rent','salaries','commissions','utilities','telecom','marketing','maintenance','government','subscriptions','hospitality','transport','supplies_other','other')),
  amount numeric(12,2) not null check (amount > 0),
  method text,
  vendor text check (vendor is null or length(vendor) <= 100),
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists fin_expenses_day_idx on public.fin_expenses (day);

alter table public.fin_partners enable row level security;
alter table public.fin_daily enable row level security;
alter table public.fin_expenses enable row level security;
revoke all on public.fin_partners, public.fin_daily, public.fin_expenses from anon;

do $$
declare t text;
begin
  foreach t in array array['fin_partners','fin_daily','fin_expenses'] loop
    execute format('drop policy if exists %1$s_mgr on public.%1$s', t);
    execute format($p$create policy %1$s_mgr on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;

-- التقرير الشهري
create or replace function public.fin_month(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d0 date := date_trunc('month', p_month)::date; d1 date := (date_trunc('month', p_month) + interval '1 month')::date;
  r jsonb; salon numeric; home numeric; purch numeric; exp numeric;
begin
  if private.my_role() not in ('admin','partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  select coalesce(sum(total),0) into salon from public.fin_daily where day >= d0 and day < d1;
  select coalesce(sum(total),0) into home from public.home_bookings
   where payment_status = 'paid' and status <> 'cancelled' and (starts_at at time zone 'Asia/Riyadh')::date >= d0 and (starts_at at time zone 'Asia/Riyadh')::date < d1;
  select coalesce(sum(total_amount),0) into purch from public.purchase_invoices where status = 'approved' and invoice_date >= d0 and invoice_date < d1;
  select coalesce(sum(amount),0) into exp from public.fin_expenses where day >= d0 and day < d1;
  r := jsonb_build_object(
    'month', d0, 'salon', salon, 'home', home, 'revenue', salon + home, 'purchases', purch, 'expenses', exp,
    'net', salon + home - purch - exp,
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', g::date,
        'salon', coalesce((select total from public.fin_daily f where f.day = g::date), 0),
        'home', coalesce((select sum(total) from public.home_bookings b where b.payment_status = 'paid' and b.status <> 'cancelled' and (b.starts_at at time zone 'Asia/Riyadh')::date = g::date), 0),
        'closed', exists (select 1 from public.fin_daily f where f.day = g::date)) order by g)
      from generate_series(d0, d1 - 1, interval '1 day') g), '[]'::jsonb),
    'methods', (select jsonb_build_object('cash', coalesce(sum(cash),0), 'card', coalesce(sum(card),0), 'transfer', coalesce(sum(transfer),0),
        'online', coalesce(sum(online),0), 'bnpl', coalesce(sum(bnpl),0), 'other', coalesce(sum(other),0), 'clients', coalesce(sum(clients),0))
      from public.fin_daily where day >= d0 and day < d1),
    'cats', (select jsonb_build_object('nails', coalesce(sum(nails),0), 'hair', coalesce(sum(hair),0), 'makeup', coalesce(sum(makeup),0),
        'lashes', coalesce(sum(lashes),0), 'products', coalesce(sum(products),0), 'other', coalesce(sum(other_cat),0))
      from public.fin_daily where day >= d0 and day < d1),
    'exp_cats', coalesce((select jsonb_object_agg(category, s) from (select category, sum(amount) s from public.fin_expenses where day >= d0 and day < d1 group by category) x), '{}'::jsonb),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'pct', share_pct, 'amount', round((salon + home - purch - exp) * share_pct / 100, 2)) order by sort) from public.fin_partners), '[]'::jsonb),
    'prev_revenue', (select coalesce(sum(total),0) from public.fin_daily where day >= (d0 - interval '1 month')::date and day < d0)
       + (select coalesce(sum(total),0) from public.home_bookings where payment_status = 'paid' and status <> 'cancelled'
          and (starts_at at time zone 'Asia/Riyadh')::date >= (d0 - interval '1 month')::date and (starts_at at time zone 'Asia/Riyadh')::date < d0)
  );
  return r;
end $$;
revoke all on function public.fin_month(date) from public, anon;
grant execute on function public.fin_month(date) to authenticated;
