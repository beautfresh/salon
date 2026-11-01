-- بيوتفريش: تشديد الأمان بعد المراجعة الشاملة

-- مفاتيح الإشعارات لا يقرأها إلا الخادم
revoke all on function public.notify_config() from public, anon, authenticated;
grant execute on function public.notify_config() to service_role;

-- الواجهة العامة لا ترى ملخص العميلات
revoke all on public.clients_overview from anon;

-- دوال المحفزات والإشعارات الداخلية: لا تُستدعى من الحسابات
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname not in ('my_role','is_active_user','can_edit_invoice','can_view_invoice') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- أي جدول أو دالة جديدة لا تنفتح للزوار تلقائيًا
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;
