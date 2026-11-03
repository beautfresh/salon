-- النماذج التفاعلية: تتعبّى على الجهاز وتتوقّع بالإصبع، وتنحفظ مع ملف العميلة أو الموظفة
create table if not exists public.form_entries (
  id bigserial primary key,
  kind text not null,
  customer_id text,            -- عميلة ركاز (اختياري)
  subject text,                -- اسم العميلة أو الموظفة كما انكتب
  data jsonb not null default '{}',
  by_id uuid default auth.uid(),
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists form_entries_cust on public.form_entries (customer_id, created_at desc);
alter table public.form_entries enable row level security;
drop policy if exists fe_read on public.form_entries;
create policy fe_read on public.form_entries for select to authenticated using (private.is_active_user());
drop policy if exists fe_add on public.form_entries;
create policy fe_add on public.form_entries for insert to authenticated with check (private.is_active_user() and by_id = auth.uid());
drop policy if exists fe_del on public.form_entries;
create policy fe_del on public.form_entries for delete to authenticated using (private.is_manager());
