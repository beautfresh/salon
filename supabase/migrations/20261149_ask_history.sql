-- سجل «اسألي الموقع»: الأسئلة وأجوبتها تنحفظ وترجع لها بعدين
create table if not exists public.ask_history (
  id bigserial primary key,
  by_id uuid not null default auth.uid(),
  q text not null, answer text, clients jsonb not null default '[]', go text[] not null default '{}', refs jsonb not null default '[]',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ask_history_at on public.ask_history (created_at desc);
alter table public.ask_history enable row level security;
drop policy if exists ah_read on public.ask_history;
create policy ah_read on public.ask_history for select to authenticated using (private.is_manager());
drop policy if exists ah_add on public.ask_history;
create policy ah_add on public.ask_history for insert to authenticated with check (private.is_manager() and by_id = auth.uid());
drop policy if exists ah_upd on public.ask_history;
create policy ah_upd on public.ask_history for update to authenticated using (private.is_manager());
drop policy if exists ah_del on public.ask_history;
create policy ah_del on public.ask_history for delete to authenticated using (private.is_manager());
grant select, insert, update, delete on public.ask_history to authenticated;
grant usage, select on sequence public.ask_history_id_seq to authenticated;
