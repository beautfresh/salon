-- استيراد المكتبة من الحزمة (supabase/kb/bundle.json) — لمدير النظام فقط
create or replace function public.kb_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ns int; np int; nd int;
begin
  if coalesce(private.my_role()::text, '') <> 'admin' then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  insert into public.kb_sources (id, title, title_ar, author, year, kind, school, url, why)
  select x->>'id', x->>'title', x->>'title_ar', x->>'author', nullif(x->>'year', '')::int, coalesce(x->>'kind', 'book'), x->>'school', x->>'url', x->>'why'
  from jsonb_array_elements(p->'sources') x
  on conflict (id) do update set title = excluded.title, title_ar = excluded.title_ar, author = excluded.author, year = excluded.year, kind = excluded.kind, school = excluded.school, url = excluded.url, why = excluded.why;
  get diagnostics ns = row_count;
  insert into public.kb_principles (id, domain, title, idea, salon, example, measure, "when", caution, sources, strength, tags, go, ord)
  select x->>'id', x->>'domain', x->>'title', x->>'idea', x->>'salon', x->>'example', x->>'measure', x->>'when', x->>'caution',
    array(select jsonb_array_elements_text(coalesce(x->'sources', '[]'))), coalesce(x->>'strength', 'practice'),
    array(select jsonb_array_elements_text(coalesce(x->'tags', '[]'))), nullif(x->>'go', ''), coalesce((x->>'ord')::int, 0)
  from jsonb_array_elements(p->'principles') x
  on conflict (id) do update set domain = excluded.domain, title = excluded.title, idea = excluded.idea, salon = excluded.salon, example = excluded.example, measure = excluded.measure,
    "when" = excluded."when", caution = excluded.caution, sources = excluded.sources, strength = excluded.strength, tags = excluded.tags, go = excluded.go, ord = excluded.ord, updated_at = now();
  get diagnostics np = row_count;
  delete from public.kb_principles where id not in (select x->>'id' from jsonb_array_elements(p->'principles') x);
  get diagnostics nd = row_count;
  delete from public.kb_cautions where true;
  insert into public.kb_cautions (domain, text) select x->>'domain', x->>'text' from jsonb_array_elements(coalesce(p->'cautions', '[]')) x;
  return jsonb_build_object('sources', ns, 'principles', np, 'removed', nd);
end $$;
revoke all on function public.kb_import(jsonb) from public, anon;
grant execute on function public.kb_import(jsonb) to authenticated;
