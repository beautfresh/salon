-- مفاتيح ركاز صارت في أسرار الدوال (Edge Function Secrets)، فالتشغيل ما يعتمد على الخزنة
create or replace function private.rekaz_kick(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'rekaz_sync_secret';
  perform net.http_post(
    url := 'https://enrlujtrysrlzwbjexey.supabase.co/functions/v1/rekaz-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 120000);
exception when others then raise warning 'rekaz_kick failed: %', sqlerrm;
end $$;
