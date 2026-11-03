-- بحث المكتبة أذكى: توحيد الهمزات، جذع خفيف للكلمة، ووزن أعلى للكلمات النادرة
create or replace function private.ar_norm(t text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(translate(coalesce(t, ''), 'أإآٱةىئؤـ', 'ااااهييو'), '[ً-ْ]', '', 'g'))
$$;
create or replace function private.ar_stem(w text) returns text language sql immutable set search_path = '' as $$
  select case when length(x) > 4 then regexp_replace(x, '(ات|ين|ون|ها|هم|يه|ه|ي)$', '') else x end
  from (select case when length(w) > 4 then regexp_replace(w, '^(وال|بال|فال|كال|لل|ال)', '') else w end x) z
$$;

create or replace function public.kb_search(p_q text, p_domain text default null, p_limit int default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare words text[]; n int; res jsonb;
begin
  if not private.is_active_user() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden'; end if;
  select array_agg(distinct private.ar_stem(w)) into words from regexp_split_to_table(private.ar_norm(p_q), '[^[:alnum:]ء-ي]+') w
    where length(w) >= 3 and w not in ('اللي', 'هذا', 'هذي', 'كيف', 'ليش', 'متي', 'عشان', 'عندنا', 'نسوي', 'تسوي', 'ابي', 'نبي', 'يعني', 'مثل', 'علي', 'الي', 'كل', 'ولا', 'لما', 'اذا', 'بعد', 'قبل', 'اكثر', 'افضل', 'احسن', 'وش', 'شي', 'زين', 'كذا');
  select count(*) into n from public.kb_principles;
  with base as (
    select p.*, private.ar_norm(p.title) nt, private.ar_norm(array_to_string(p.tags, ' ')) ng, private.ar_norm(p.doc) nd
    from public.kb_principles p where p_domain is null or p.domain = p_domain),
  idf as (
    select w, ln((n + 1.0) / (1 + (select count(*) from base b where b.nd like '%' || w || '%' or b.ng like '%' || w || '%'))) + 0.2 wt
    from unnest(coalesce(words, '{}')) w),
  sc as (
    select b.*, (select coalesce(sum(i.wt * (case when b.nt like '%' || i.w || '%' then 4 else 0 end + case when b.ng like '%' || i.w || '%' then 3 else 0 end + case when b.nd like '%' || i.w || '%' then 1 else 0 end)), 0) from idf i) s
    from base b)
  select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc), '[]'::jsonb) into res from (
    select jsonb_build_object('id', sc.id, 'domain', sc.domain, 'title', sc.title, 'idea', sc.idea, 'salon', sc.salon, 'example', sc.example,
      'measure', sc.measure, 'when', sc."when", 'caution', sc.caution, 'strength', sc.strength, 'go', sc.go, 'score', round(sc.s::numeric, 2),
      'refs', (select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'title_ar', s.title_ar, 'author', s.author, 'year', s.year, 'kind', s.kind)) from public.kb_sources s where s.id = any(sc.sources))) x
    from sc where sc.s > 0 order by sc.s desc, sc.ord limit least(coalesce(p_limit, 6), 15)) z;
  return res;
end $$;
revoke all on function public.kb_search(text, text, int) from public, anon;
grant execute on function public.kb_search(text, text, int) to authenticated, service_role;
