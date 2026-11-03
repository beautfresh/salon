-- صلاحيات صريحة للجداول الجديدة (Supabase وقف المنح التلقائي لواجهة البيانات)
grant select on public.kb_sources, public.kb_principles, public.kb_cautions, public.kb_scores to authenticated;
grant select, insert, delete on public.kb_feedback to authenticated;
grant usage, select on sequence public.kb_feedback_id_seq to authenticated;
grant select, insert, delete on public.form_entries to authenticated;
grant usage, select on sequence public.form_entries_id_seq to authenticated;
grant all on public.kb_sources, public.kb_principles, public.kb_cautions, public.kb_feedback, public.form_entries, public.rekaz_events to service_role;
