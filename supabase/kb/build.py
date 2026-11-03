#!/usr/bin/env python3
"""يبني seed.sql لمكتبة بيوتفريش من ملفات المجالات (marketing.json ...) — يتحقق من المراجع ويرفض الكلمات الممنوعة."""
import json, glob, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ['marketing', 'sales', 'experience', 'operations', 'people', 'growth']
BANNED = ['كمان', 'هلق', 'ازاي', 'إزاي', 'بدّي', 'منيح', 'هيك', 'عشان كده', 'دلوقتي']
GO_OK = {None, 'winback', 'reviews', 'campaigns', 'writer', 'after', 'appts', 'away', 'vip', 'sales', 'finance', 'team', 'gifts', 'seasons', 'rules', 'kit'}
KINDS = {'book', 'study', 'school', 'gov', 'law', 'guide', 'org'}
STR = {'law', 'evidence', 'consensus', 'practice'}
ALIAS = {'kimes-singh-spa': 'kimes-singh-2009'}

def lit(v):
    if v is None or v == '': return 'null'
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
def arr(xs): return "array[" + ",".join(lit(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"

src, pr, cau, errs = {}, [], [], []
files = [f for d in ORDER for f in [os.path.join(HERE, d + '.json')] if os.path.exists(f)]
for f in files:
    d = json.load(open(f, encoding='utf-8'))
    dom = d.get('domain') or os.path.basename(f)[:-5]
    for s in d.get('sources', []):
        if s.get('kind') not in KINDS: s['kind'] = 'guide'
        y = s.get('year'); s['year'] = int(y) if isinstance(y, (int, float)) or (isinstance(y, str) and y.isdigit()) else None
        sid = ALIAS.get(s['id'], s['id']); s['id'] = sid
        src.setdefault(sid, s)  # نفس المعرف في أكثر من مجال = نفس المرجع
    for i, p in enumerate(d.get('principles', [])):
        p['domain'] = dom; p['ord'] = i
        p['sources'] = list(dict.fromkeys(ALIAS.get(x, x) for x in p.get('sources', [])))
        miss = [x for x in p['sources'] if x not in src]
        if miss: errs.append(f"{p['id']}: مرجع مفقود {miss}")
        if not p['sources']: errs.append(f"{p['id']}: بدون مرجع")
        txt = json.dumps(p, ensure_ascii=False)
        bad = [w for w in BANNED if re.search(r'(^|[\s،.])' + w + r'($|[\s،.])', txt)]
        if bad: errs.append(f"{p['id']}: كلمات ممنوعة {bad}")
        if p.get('go') not in GO_OK: p['go'] = None
        if p.get('strength') not in STR: p['strength'] = 'practice'
        pr.append(p)
    for c in d.get('cautions', []) or []: cau.append((dom, c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)))

ids = [p['id'] for p in pr]
dup = {x for x in ids if ids.count(x) > 1}
if dup: errs.append(f"معرفات مكررة: {dup}")
if errs:
    print('\n'.join(errs)); sys.exit(1)

out = ["-- مولّد آليًا من supabase/kb/*.json — لا تعدّلونه يدويًا", "begin;",
       "delete from public.kb_cautions where true;"]
for s in src.values():
    out.append("insert into public.kb_sources (id,title,title_ar,author,year,kind,school,url,why) values (" + ",".join([lit(s['id']), lit(s.get('title')), lit(s.get('title_ar')), lit(s.get('author')), lit(s.get('year')), lit(s.get('kind')), lit(s.get('school')), lit(s.get('url')), lit(s.get('why'))]) +
               ") on conflict (id) do update set title=excluded.title,title_ar=excluded.title_ar,author=excluded.author,year=excluded.year,kind=excluded.kind,school=excluded.school,url=excluded.url,why=excluded.why;")
for p in pr:
    out.append('insert into public.kb_principles (id,domain,title,idea,salon,example,measure,"when",caution,sources,strength,tags,go,ord) values (' + ",".join([lit(p['id']), lit(p['domain']), lit(p['title']), lit(p['idea']), lit(p.get('salon')), lit(p.get('example')), lit(p.get('measure')), lit(p.get('when')), lit(p.get('caution')), arr(p['sources']), lit(p['strength']), arr(p.get('tags') or []), lit(p.get('go')), str(p['ord'])]) +
               ') on conflict (id) do update set domain=excluded.domain,title=excluded.title,idea=excluded.idea,salon=excluded.salon,example=excluded.example,measure=excluded.measure,"when"=excluded."when",caution=excluded.caution,sources=excluded.sources,strength=excluded.strength,tags=excluded.tags,go=excluded.go,ord=excluded.ord,updated_at=now();')
for dom, c in cau: out.append(f"insert into public.kb_cautions (domain,text) values ({lit(dom)},{lit(c)});")
out.append("delete from public.kb_principles where id <> all(" + arr(ids) + ");")
out.append("commit;")
open(os.path.join(HERE, 'seed.sql'), 'w', encoding='utf-8').write("\n".join(out) + "\n")
bundle = {'sources': list(src.values()), 'principles': [{k: p.get(k) for k in ['id', 'domain', 'title', 'idea', 'salon', 'example', 'measure', 'when', 'caution', 'sources', 'strength', 'tags', 'go', 'ord']} for p in pr], 'cautions': [{'domain': d, 'text': c} for d, c in cau]}
json.dump(bundle, open(os.path.join(HERE, 'bundle.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f"ok: {len(files)} ملفات · {len(src)} مرجع · {len(pr)} مبدأ · {len(cau)} تحذير")
