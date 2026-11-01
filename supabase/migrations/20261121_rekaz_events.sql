-- إشعارات فورية من ركاز (Webhooks): حجز جديد، إلغاء، تعديل موعد، دفع
create table if not exists public.rekaz_events (
  id text primary key, type text, subject_type text, subject_id text, received_at timestamptz not null default now()
);
alter table public.rekaz_events enable row level security;
revoke all on public.rekaz_events from anon, authenticated;

create or replace function public.rekaz_hook_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rekaz_webhook_secret'),
    'sync_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rekaz_sync_secret'))
$$;
create or replace function public.rekaz_set_webhook_secret(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'rekaz_webhook_secret';
  if sid is null then perform vault.create_secret(p_secret, 'rekaz_webhook_secret');
  else perform vault.update_secret(sid, p_secret); end if;
end $$;
create or replace function public.rekaz_seen(p_id text, p_type text, p_stype text, p_sid text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rekaz_events (id, type, subject_type, subject_id) values (p_id, p_type, p_stype, p_sid);
  delete from public.rekaz_events where received_at < now() - interval '40 days';
  return false;
exception when unique_violation then return true;
end $$;
create or replace function public.rekaz_notify(p_title text, p_body text, p_url text, p_tag text) returns void
language sql security definer set search_path = '' as $$ select private.push_admins(p_title, p_body, p_url, p_tag, null) $$;

revoke all on function public.rekaz_hook_config(), public.rekaz_set_webhook_secret(text), public.rekaz_seen(text, text, text, text), public.rekaz_notify(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rekaz_hook_config(), public.rekaz_set_webhook_secret(text), public.rekaz_seen(text, text, text, text), public.rekaz_notify(text, text, text, text) to service_role;
