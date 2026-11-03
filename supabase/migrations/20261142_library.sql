-- 📚 مكتبة بيوتفريش: مبادئ من الكتب والمدارس والأنظمة، يرجع لها الذكاء قبل ما ينصح ويذكر مرجعها
create table if not exists public.kb_sources (
  id text primary key, title text not null, title_ar text, author text, year int,
  kind text not null default 'book', school text, url text, why text
);
create table if not exists public.kb_principles (
  id text primary key, domain text not null, title text not null, idea text not null, salon text, example text, measure text,
  "when" text, caution text, sources text[] not null default '{}', strength text not null default 'practice', tags text[] not null default '{}',
  go text, ord int not null default 0, updated_at timestamptz not null default now(),
  doc text generated always as (title || ' ' || idea || ' ' || coalesce(salon, '') || ' ' || coalesce("when", '') || ' ' || coalesce(example, '')) stored
);
create table if not exists public.kb_cautions (id serial primary key, domain text not null, text text not null);
-- «جربناه»: تقييم الفريق للمبدأ بعد التطبيق
create table if not exists public.kb_feedback (
  id bigserial primary key, principle_id text not null references public.kb_principles(id) on delete cascade,
  verdict text not null check (verdict in ('worked', 'didnt', 'saved')), note text,
  by_id uuid default auth.uid(), at timestamptz not null default now()
);
create index if not exists kb_feedback_p on public.kb_feedback (principle_id);

alter table public.kb_sources enable row level security;
alter table public.kb_principles enable row level security;
alter table public.kb_cautions enable row level security;
alter table public.kb_feedback enable row level security;
drop policy if exists kb_sources_read on public.kb_sources;
create policy kb_sources_read on public.kb_sources for select to authenticated using (private.is_active_user());
drop policy if exists kb_principles_read on public.kb_principles;
create policy kb_principles_read on public.kb_principles for select to authenticated using (private.is_active_user());
drop policy if exists kb_cautions_read on public.kb_cautions;
create policy kb_cautions_read on public.kb_cautions for select to authenticated using (private.is_active_user());
drop policy if exists kb_feedback_read on public.kb_feedback;
create policy kb_feedback_read on public.kb_feedback for select to authenticated using (private.is_active_user());
drop policy if exists kb_feedback_add on public.kb_feedback;
create policy kb_feedback_add on public.kb_feedback for insert to authenticated with check (private.is_active_user() and by_id = auth.uid());
drop policy if exists kb_feedback_del on public.kb_feedback;
create policy kb_feedback_del on public.kb_feedback for delete to authenticated using (by_id = auth.uid() or private.is_manager());

-- توحيد الحروف العربية للبحث (أ إ آ ← ا، ة ← ه، ى ← ي، وحذف التشكيل والتطويل)
create or replace function private.ar_norm(t text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(translate(coalesce(t, ''), 'أإآٱةىـ', 'اااايه'), '[ً-ْ]', '', 'g'))
$$;

-- البحث: كل كلمة من السؤال تعطي نقاط حسب مكانها (العنوان والوسوم أقوى)
create or replace function public.kb_search(p_q text, p_domain text default null, p_limit int default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare words text[]; res jsonb;
begin
  if not private.is_active_user() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden'; end if;
  select array_agg(w) into words from (
    select distinct w from regexp_split_to_table(private.ar_norm(p_q), '[^[:alnum:]؀-ۿ]+') w
    where length(w) >= 3 and w not in ('اللي', 'هذا', 'هذي', 'وش', 'كيف', 'ليش', 'متى', 'عشان', 'عندنا', 'نسوي', 'تسوي', 'ابي', 'نبي', 'يعني', 'مثل', 'على', 'الى', 'الي', 'من', 'في', 'عن', 'مع', 'كل', 'او', 'ولا', 'هل', 'لما', 'اذا', 'بعد', 'قبل', 'اكثر', 'افضل', 'احسن')) z;
  with sc as (
    select p.*, (
      select coalesce(sum(
        case when private.ar_norm(p.title) like '%' || w || '%' then 4 else 0 end
        + case when exists (select 1 from unnest(p.tags) t where private.ar_norm(t) like '%' || w || '%' or w like '%' || private.ar_norm(t) || '%') then 3 else 0 end
        + case when private.ar_norm(p.doc) like '%' || w || '%' then 1 else 0 end), 0)
      from unnest(coalesce(words, '{}')) w) s
    from public.kb_principles p where p_domain is null or p.domain = p_domain)
  select coalesce(jsonb_agg(x order by (x->>'score')::int desc), '[]'::jsonb) into res from (
    select jsonb_build_object('id', sc.id, 'domain', sc.domain, 'title', sc.title, 'idea', sc.idea, 'salon', sc.salon, 'example', sc.example,
      'measure', sc.measure, 'when', sc."when", 'caution', sc.caution, 'strength', sc.strength, 'go', sc.go, 'score', sc.s,
      'refs', (select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'title_ar', s.title_ar, 'author', s.author, 'year', s.year, 'kind', s.kind)) from public.kb_sources s where s.id = any(sc.sources))) x
    from sc where sc.s > 0 order by sc.s desc, sc.ord limit least(coalesce(p_limit, 6), 15)) z;
  return res;
end $$;
grant execute on function public.kb_search(text, text, int) to authenticated, service_role;

-- إحصائيات «جربناه» لكل مبدأ
create or replace view public.kb_scores with (security_invoker = true) as
  select principle_id, count(*) filter (where verdict = 'worked') worked, count(*) filter (where verdict = 'didnt') didnt, count(*) filter (where verdict = 'saved') saved
  from public.kb_feedback group by principle_id;
grant select on public.kb_scores to authenticated;
