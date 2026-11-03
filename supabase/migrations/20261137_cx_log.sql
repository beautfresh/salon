-- سجل الفريق على العميلة: وش صار بالزيارة + ملاحظات الموظفات
create table if not exists public.cx_log (
  id bigint generated always as identity primary key,
  customer_id text not null,
  kind text not null default 'note' check (kind in ('visit', 'note')),
  visit_on date, done text, result text, mood text check (mood in ('happy', 'ok', 'upset')), next_time text, text text,
  by_id uuid default auth.uid(), by_name text,
  created_at timestamptz not null default now()
);
create index if not exists cx_log_cust_ix on public.cx_log (customer_id, created_at desc);
alter table public.cx_log enable row level security;
create policy cx_log_read on public.cx_log for select to authenticated using (private.my_role() is not null);
create policy cx_log_add on public.cx_log for insert to authenticated with check (private.my_role() is not null);
create policy cx_log_edit on public.cx_log for update to authenticated
  using (by_id = auth.uid() or coalesce(private.my_role()::text, '') in ('admin', 'partner'))
  with check (by_id = auth.uid() or coalesce(private.my_role()::text, '') in ('admin', 'partner'));
create policy cx_log_del on public.cx_log for delete to authenticated
  using (by_id = auth.uid() or coalesce(private.my_role()::text, '') in ('admin', 'partner'));
grant select, insert, update, delete on public.cx_log to authenticated;
