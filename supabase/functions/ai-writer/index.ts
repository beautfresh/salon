// الكاتب الذكي لبيوتفريش: يكتب بصوت الصالون من البوصلة والبيانات الحقيقية، ولا يخترع أرقام ولا آراء.
// المفتاح ANTHROPIC_API_KEY يحطه صاحب المشروع في أسرار الدوال (Edge Function Secrets).
const URL_ = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MODEL = Deno.env.get('AI_MODEL') || 'claude-sonnet-5-5';
const MONTH_CAP = Number(Deno.env.get('AI_MONTH_CAP') || 400);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const db = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`db ${r.status}: ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
};

const KINDS: Record<string, { label: string; shape: string }> = {
  post: { label: 'نص منشور', shape: '{"angles":[{"angle":"اسم الزاوية بكلمتين","hook":"السطر الأول الخاطف","body":"النص","cta":"الدعوة للفعل","hashtags":["..."]}]} بثلاث زوايا مختلفة فعلًا (مثلًا: إحساس، معلومة، قصة)' },
  reel: { label: 'سيناريو مقطع قصير', shape: '{"title":"","seconds":25,"beats":[{"t":"0-2","shot":"وصف اللقطة للمصورة","text":"النص على الشاشة","voice":"الكلام أو الصوت"}],"shots":["قائمة اللقطات المطلوبة"],"cta":"","caption":"وصف المنشور"}' },
  brief: { label: 'ورقة حملة للمصورة أو الوكالة', shape: '{"goal":"","truth":"الحقيقة عن العميلة اللي تبني عليها الحملة","message":"الرسالة بجملة","deliverables":["..."],"must":["..."],"avoid":["..."],"timing":""}' },
  reply: { label: 'رد على رأي عميلة', shape: '{"options":[{"tone":"","text":""}]} بثلاث صيغ قصيرة' },
  whatsapp: { label: 'رسالة واتساب للعميلات', shape: '{"options":[{"tone":"","text":""}]} بثلاث صيغ، كل وحدة أقل من ٦٠ كلمة' },
  ideas: { label: 'أفكار محتوى للأسبوع', shape: '{"ideas":[{"title":"","kind":"reel|story|post|tiktok|snap","pillar":"before_after|color|behind|review|trend|service|tip|team|offer","why":""}]} سبع أفكار' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    // الهوية والصلاحية
    const auth = req.headers.get('Authorization') || '';
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
    if (!u.ok) return json({ error: 'auth', message: 'سجّلي دخولك من جديد' }, 401);
    const user = await u.json();
    const prof = (await db(`profiles?id=eq.${user.id}&select=role`))?.[0];
    if (!prof || !['admin', 'partner'].includes(String(prof.role))) return json({ error: 'role', message: 'الكاتب الذكي للإدارة فقط' }, 403);
    if (!KEY) return json({ error: 'no_key', message: 'الكاتب الذكي يحتاج مفتاح ANTHROPIC_API_KEY في أسرار الدوال' }, 503);

    const b = await req.json().catch(() => ({}));
    const kind = String(b.kind || 'post');
    const logUse = (prompt: string, out: unknown, j: any) => db('ai_log', { method: 'POST', body: JSON.stringify({ user_id: user.id, kind, prompt: prompt.slice(0, 2000), output: out, tokens: (j?.usage?.input_tokens || 0) + (j?.usage?.output_tokens || 0) }) }).catch(() => {});
    if (kind === 'winback' || kind === 'reviews' || kind === 'ask') {
      const capR = await fetch(`${URL_}/rest/v1/ai_log?select=id&at=gte.${new Date(new Date().setUTCDate(1)).toISOString().slice(0, 10)}`, { method: 'HEAD', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, Prefer: 'count=exact' } });
      if (Number((capR.headers.get('content-range') || '*/0').split('/')[1] || 0) >= MONTH_CAP) return json({ error: 'cap', message: `وصلتوا الحد الشهري (${MONTH_CAP} طلب)` }, 429);
      return kind === 'winback' ? await winback(b, auth, user.id, logUse) : kind === 'ask' ? await askSite(b, logUse) : await reviews(user.id, logUse);
    }
    const K = KINDS[kind]; if (!K) return json({ error: 'kind' }, 400);
    const topic = String(b.topic || '').slice(0, 600);
    const channel = String(b.channel || '').slice(0, 30);
    const extra = String(b.extra || '').slice(0, 1500);

    const m0 = new Date(); m0.setUTCDate(1); m0.setUTCHours(0, 0, 0, 0);
    const used = await fetch(`${URL_}/rest/v1/ai_log?select=id&at=gte.${m0.toISOString()}`, { method: 'HEAD', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, Prefer: 'count=exact' } });
    const n = Number((used.headers.get('content-range') || '*/0').split('/')[1] || 0);
    if (n >= MONTH_CAP) return json({ error: 'cap', message: `وصلتوا الحد الشهري (${MONTH_CAP} طلب)` }, 429);

    // السياق الحقيقي
    const [comp, svcs, pub, seasons] = await Promise.all([
      db('brand_compass?id=eq.1&select=data'),
      db('salon_services?is_active=eq.true&select=name,price,duration_min&order=popular.desc,sort.asc&limit=80'),
      fetch(`${URL_}/rest/v1/rpc/site_public`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()),
      db(`mkt_seasons?select=name,starts_on,ideas&starts_on=gte.${new Date().toISOString().slice(0, 10)}&order=starts_on&limit=3`),
    ]);
    const c = comp?.[0]?.data || {};
    const quotes = (pub?.reviews || []).slice(0, 14).map((r: any) => `«${r.text}» — ${r.name}${r.service ? ` (${r.service})` : ''}`).join('\n');
    const offers = (pub?.offers || []).map((o: any) => `${o.title}${o.price ? `: ${o.price}` : ''}${o.was ? ` بدل ${o.was}` : ''}${o.ends ? ` لين ${o.ends}` : ''}`).join('\n') || 'لا يوجد';
    const team = (pub?.team || []).map((t: any) => `${t.name} (★${t.avg} من ${t.n} رأي)`).join('، ');

    const system = `أنتِ كاتبة محتوى صالون «بيوتفريش» في الأحساء. تكتبين باللهجة السعودية الخليجية فقط (لا شامي ولا مصري، لا «كمان» ولا «هيك»)، وبصوت الصالون كما في البوصلة.

# البوصلة
من نحن: ${c.who || ''}
الوعد: ${c.promise || ''}
عميلاتنا: ${c.audience || ''}
الشخصية: ${c.personality || ''}
نسوي: ${c.tone_do || ''}
ما نسوي: ${c.tone_dont || ''}
كلمات نحبها: ${c.words_use || ''}
كلمات نتجنبها: ${c.words_avoid || ''}
وش يخلي العميلة تتكلم عنا: ${c.talk || ''}
الدليل: ${c.proof || ''}

# حقائق تقدرين تستخدمينها (ولا شي غيرها)
التقييم: ${pub?.stats ? `${pub.stats.avg} من 5 من ${pub.stats.n} تقييم` : 'غير متوفر'}
الخدمات والأسعار (ر.س): ${(svcs || []).map((s: any) => `${s.name} ${Number(s.price)}`).join('، ')}
العروض الحالية: ${offers}
الأخصائيات: ${team}
المواسم الجاية: ${(seasons || []).map((s: any) => `${s.name} (${s.starts_on})`).join('، ') || 'لا يوجد'}
آراء حقيقية (تقدرين تقتبسينها حرفيًا مع الاسم المختصر فقط):
${quotes}

# قواعد لا تنكسر
- لا تخترعين أرقام أو أسعار أو نسب أو خصومات غير الموجودة فوق.
- لا تخترعين آراء أو شهادات. الاقتباس فقط من الآراء الحقيقية فوق، حرفيًا.
- لا وعود طبية أو علاجية، ولا «مضمون».
- لا تخترعين ندرة أو زحمة أو «المواعيد تخلص» أو «لفترة محدودة» إلا إذا العرض له تاريخ نهاية فوق.
- اكتبي أسماء الخدمات زي ما هي في القائمة بالضبط.
- إيموجي قليل ومدروس.
- ردّك JSON صالح فقط، بدون أي نص قبله أو بعده، بهذا الشكل: ${K.shape}`;
    const userMsg = `المطلوب: ${K.label}${channel ? ` لقناة ${channel}` : ''}.\nالموضوع: ${topic || 'اختاري الأنسب للصالون الحين'}${extra ? `\nتفاصيل إضافية: ${extra}` : ''}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system, messages: [{ role: 'user', content: userMsg }] }),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: 'ai', message: 'الكاتب ما رد، جربي بعد شوي', detail: j?.error?.message }, 502);
    const txt = (j.content || []).map((x: any) => x.text || '').join('').trim();
    let out: unknown; try { out = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { out = { raw: txt }; }
    await db('ai_log', { method: 'POST', body: JSON.stringify({ user_id: user.id, kind, prompt: userMsg.slice(0, 2000), output: out, tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0) }) }).catch(() => {});
    return json({ kind, out, left: MONTH_CAP - n - 1 });
  } catch (e) {
    const msg = String((e as Error).message || e); return json({ error: 'server', message: /[\u0600-\u06FF]/.test(msg) ? msg : 'صار خطأ، جربي مرة ثانية', detail: msg.slice(0, 300) }, 500);
  }
});


// ===== الذكاء الاصطناعي ١: رسائل استرجاع شخصية =====
const ask = async (system: string, user: string, max = 4000) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'ai');
  const txt = (j.content || []).map((x: any) => x.text || '').join('').trim();
  let out: any; try { out = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { out = { raw: txt }; }
  if (!txt) throw new Error(`empty:${j.stop_reason}:${(j.content || []).map((x: any) => x.type).join('+')}:${j.usage?.output_tokens}`);
  return { out, j };
};
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || '';

async function winback(b: any, auth: string, uid: string, logUse: any) {
  const n = Math.min(20, Math.max(1, Number(b.n || 12)));
  const pr = await fetch(`${URL_}/rest/v1/rpc/winback_pool`, { method: 'POST', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: n, p_offset: 0 }) });
  const pool = await pr.json();
  if (!pr.ok) return json({ error: 'pool', message: pool?.message || 'ما قدرنا نجيب القائمة' }, 400);
  if (!pool?.list?.length) return json({ kind: 'winback', made: 0, total: pool?.total || 0 });
  const pub = await fetch(`${URL_}/rest/v1/rpc/site_public`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => ({}));
  const offers = (pub?.offers || []).map((o: any) => `${o.title}${o.price ? `: ${o.price}` : ''}${o.ends ? ` لين ${o.ends}` : ''}`).join('\n') || 'لا يوجد';
  const system = `أنتِ تكتبين رسائل واتساب من صالون «بيوتفريش» في الأحساء لعميلات غابوا عنّا فترة. اللهجة سعودية خليجية فقط (لا «كمان» ولا «هيك»).
لكل عميلة رسالة وحدة شخصية، دافية وقصيرة (أقل من ٤٥ كلمة):
- ابدئي باسمها الأول فقط.
- اذكري خدمتها المعتادة أو الأخيرة بشكل طبيعي، واسم أخصائيتها الأول لو موجود (مثلًا «روز مشتاقة لك»).
- لا تذكرين عدد الأيام ولا المبالغ ولا إنها «غابت».
- لا تخترعين خصومات أو هدايا أو عروض. العروض المسموحة فقط هذي:\n${offers}
- لا ضغط ولا استعجال مصطنع.
- نوّعي البدايات، لا تبدأ كل الرسائل بنفس الكلمة.
- اختمي برابط الحجز: beautfresh.com/book
- إيموجي واحد أو اثنين بالكثير.
ردك JSON صالح فقط: {"msgs":[{"id":"","text":""}]}`;
  const lines = pool.list.map((c: any) => `id=${c.id} | الاسم: ${first(c.name)} | آخر خدمة: ${c.last_service || '-'} | المعتادة: ${c.top_service || '-'} | الأخصائية: ${first(String(c.last_provider || '').split(',')[0]) || '-'} | زيارات: ${c.visits}`).join('\n');
  const { out, j } = await ask(system, `اكتبي رسالة لكل وحدة:\n${lines}`, 8000);
  if (!out?.msgs) throw new Error('ما اكتملت الرسائل هالمرة، جربي مرة ثانية');
  const by: Record<string, string> = {}; (out?.msgs || []).forEach((m: any) => { if (m?.id && m?.text) by[String(m.id)] = String(m.text).slice(0, 700); });
  const rows = pool.list.filter((c: any) => by[c.id]).map((c: any) => ({
    customer_id: c.id, name: c.name, phone: c.phone, last_service: c.last_service, last_provider: c.last_provider, last_visit: c.last_visit,
    visits: c.visits, spend: c.spend, days_away: c.days_away, text: by[c.id], status: 'draft', created_by: uid,
  }));
  if (rows.length) await db('winback_msgs', { method: 'POST', body: JSON.stringify(rows) });
  await logUse(`winback x${rows.length}`, { made: rows.length }, j);
  return json({ kind: 'winback', made: rows.length, total: pool.total });
}

// ===== الذكاء الاصطناعي ٢: محلل الآراء =====
async function reviews(uid: string, logUse: any) {
  const R: any[] = await db('rekaz_reviews?select=id,customer_name,product_name,provider_names,rating,description,reply,created_at&order=created_at.desc&limit=800');
  if (!R?.length) return json({ error: 'empty', message: 'ما فيه آراء' }, 400);
  const avg = (a: any[]) => (a.length ? Math.round((a.reduce((s, x) => s + Number(x.rating || 0), 0) / a.length) * 100) / 100 : 0);
  const group = (key: (x: any) => string[]) => { const m: Record<string, any[]> = {}; R.forEach((x) => key(x).forEach((k) => { if (k) (m[k] ||= []).push(x); })); return Object.entries(m).map(([k, a]) => ({ name: k, n: a.length, avg: avg(a), low: a.filter((x) => x.rating <= 3).length })).sort((a, b) => b.n - a.n); };
  const dist = [1, 2, 3, 4, 5].map((s) => R.filter((x) => Number(x.rating) === s).length);
  const months: Record<string, any[]> = {}; R.forEach((x) => { const m = String(x.created_at).slice(0, 7); (months[m] ||= []).push(x); });
  const stats = {
    n: R.length, avg: avg(R), dist, with_text: R.filter((x) => String(x.description || '').trim().length > 3).length,
    providers: group((x) => String(x.provider_names || '').split(',').map((s) => s.trim())).slice(0, 15),
    services: group((x) => [String(x.product_name || '').trim()]).slice(0, 15),
    months: Object.entries(months).sort().slice(-8).map(([m, a]) => ({ m, n: a.length, avg: avg(a) })),
    first: R[R.length - 1]?.created_at, last: R[0]?.created_at,
  };
  const texts = R.filter((x) => String(x.description || '').trim().length > 3).slice(0, 320)
    .map((x) => `[${x.id}] ★${x.rating} | ${x.product_name || '-'} | ${x.provider_names || '-'} | ${String(x.created_at).slice(0, 10)} | ${String(x.description).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const recentLow = R.filter((x) => x.rating <= 3 && !x.reply && String(x.description || '').trim().length > 3 && Date.now() - new Date(x.created_at).getTime() < 120 * 86400000).slice(0, 12).map((x) => x.id);
  const system = `أنتِ محللة تجربة العملاء لصالون «بيوتفريش» في الأحساء. اقرئي الآراء الحقيقية وطلّعي تقرير عملي للإدارة باللهجة السعودية الخليجية، مختصر وواضح.
قواعد:
- الاقتباسات حرفية فقط من النصوص، بدون أي تعديل، وجملة قصيرة.
- لا تخترعين أرقام. العدد التقريبي لكل موضوع من قراءتك (n).
- كوني منصفة: المديح والملاحظات.
- اقتراحات الحل عملية ومحددة تقدر الإدارة تسويها هالأسبوع.
- لا تذكرين أي معرّفات (id) ولا ملاحظات تقنية في الملخص أو التنبيهات. التنبيهات فقط لأشياء تخص الصالون وتحتاج تصرف.
- الردود الجاهزة للتقييمات المنخفضة: محترمة، تعتذر بدون تبرير، تدعو العميلة تتواصل، أقل من ٤٠ كلمة، باللهجة.
ردك JSON صالح فقط:
{"summary":"٣ جمل","praise":[{"theme":"","n":0,"quotes":[""]}],"complaints":[{"theme":"","n":0,"severity":"high|mid|low","who":"خدمة أو أخصائية لو واضح","quotes":[""],"fix":""}],"providers":[{"name":"","strength":"","watch":""}],"alerts":[""],"replies":[{"id":"","text":""}]}`;
  const user = `الإحصائيات: ${JSON.stringify({ n: stats.n, avg: stats.avg, dist, providers: stats.providers.slice(0, 10), services: stats.services.slice(0, 10), months: stats.months })}
الآراء المكتوبة (id ★ | الخدمة | الأخصائية | التاريخ | النص):
${texts}

اكتبي ردود جاهزة لهذي الآراء المنخفضة فقط (لو موجودة في القائمة): ${recentLow.join(', ') || 'لا يوجد'}`;
  const { out, j } = await ask(system, user, 16000);
  if (!out || out.raw != null || !out.summary) throw new Error('التحليل ما اكتمل هالمرة، جربي مرة ثانية');
  const rep = await db('ai_reports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ kind: 'reviews', data: out, stats, created_by: uid }) });
  await logUse('reviews report', { id: rep?.[0]?.id }, j);
  return json({ kind: 'reviews', report: rep?.[0] || { data: out, stats } });
}


// ===== «اسألي الموقع»: يجاوب من أرقام الصالون عن طريق أدوات قراءة آمنة =====
const TOOLS = [
  { name: 'sales_summary', description: 'ملخص فترة: المبيعات (sales شامل الضريبة)، صافي المبيعات، المحصّل، الطلبات، الحجوزات، العميلات، الجدد، متوسط الزيارة، الإلغاء وعدم الحضور. التواريخ YYYY-MM-DD.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'daily_series', description: 'المبيعات يوم بيوم في فترة.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'by_provider', description: 'أداء الأخصائيات في فترة: عدد الخدمات وقيمتها وعدد العميلات. اختياري: service لفلترة خدمة.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, service: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'by_service', description: 'الخدمات في فترة: العدد والقيمة. اختياري: provider أو service (بحث جزئي).', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, provider: { type: 'string' }, service: { type: 'string' }, limit: { type: 'integer' } }, required: ['from', 'to'] } },
  { name: 'find_clients', description: 'تبحث عن عميلات: service (سوّت هالخدمة مرة على الأقل)، provider (تعاملت معها)، min_days_away/max_days_away (من آخر زيارة)، min_visits/max_visits، no_upcoming (ما عندها موعد جاي)، sort (spend أو recent)، limit. ترجع الأسماء والجوالات وآخر زيارة وصرفها.', input_schema: { type: 'object', properties: { service: { type: 'string' }, provider: { type: 'string' }, min_days_away: { type: 'integer' }, max_days_away: { type: 'integer' }, min_visits: { type: 'integer' }, max_visits: { type: 'integer' }, no_upcoming: { type: 'boolean' }, sort: { type: 'string' }, limit: { type: 'integer' } } } },
  { name: 'reviews', description: 'التقييمات في فترة: المتوسط والعدد وعينات من النصوص. اختياري: provider، max_rating.', input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, provider: { type: 'string' }, max_rating: { type: 'integer' } }, required: ['from', 'to'] } },
  { name: 'lists', description: 'أسماء الأخصائيات والخدمات بالضبط مثل ما هي في ركاز. استخدميها لو مو متأكدة من الاسم.', input_schema: { type: 'object', properties: {} } },
];
async function askSite(b: any, logUse: any) {
  const question = String(b.q || '').slice(0, 500).trim();
  if (!question) return json({ error: 'q', message: 'اكتبي سؤالك' }, 400);
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const system = `أنتِ مساعدة إدارة صالون «بيوتفريش» في الأحساء. تجاوبين شهد وأميرة (مالكات الصالون) من أرقام الصالون الحقيقية بس، باستخدام الأدوات. اليوم ${today} (توقيت الرياض)، والأسبوع يبدأ السبت.
قواعد:
- لا تخترعين أي رقم أو اسم. كل رقم لازم يجي من أداة. لو الأدوات ما تكفي، قولي بصراحة وش ما تقدرين تعرفينه.
- البيانات الكاملة من يناير ٢٠٢٦، وقبلها ناقصة. المبيعات من ديسمبر ٢٠٢٥.
- «المبيعات» = sales (شامل الضريبة) مثل ركاز.
- جاوبي باللهجة السعودية الخليجية، مختصر ومباشر: الجواب أول سطر، بعدها تفاصيل قليلة لو تفيد، واقتراح عملي واحد لو مناسب.
- الأرقام بالأرقام الإنجليزية مع فواصل، والمبالغ بـ «ر.س».
- لو السؤال يطلب قائمة عميلات، استخدمي find_clients وحطي معرفاتهن في client_ids.
- لا تذكرين الأدوات ولا حدودها ولا أي كلام تقني، ولا تكتبين أرقام الجوالات في النص (القائمة تطلع لحالها تحت الجواب).
- استخدمي أقل عدد أدوات يكفي، وخلّي الجواب قصير.
- ردك الأخير JSON فقط: {"answer":"النص","client_ids":["..."]}`;
  const msgs: any[] = [{ role: 'user', content: question }];
  const found: Record<string, any> = {}; let usage = { input_tokens: 0, output_tokens: 0 };
  for (let i = 0; i < 7; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, tools: TOOLS, messages: msgs }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || 'ai');
    usage.input_tokens += j.usage?.input_tokens || 0; usage.output_tokens += j.usage?.output_tokens || 0;
    const uses = (j.content || []).filter((x: any) => x.type === 'tool_use');
    if (j.stop_reason === 'tool_use' && uses.length) {
      msgs.push({ role: 'assistant', content: j.content });
      const results = [];
      for (const u of uses) {
        let out: any;
        try {
          out = await fetch(`${URL_}/rest/v1/rpc/ask_tool`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_name: u.name, p: u.input || {} }) }).then((x) => x.json());
          if (u.name === 'find_clients') (out?.clients || []).forEach((c: any) => { found[c.id] = c; });
        } catch (e) { out = { error: String(e) }; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) });
      }
      msgs.push({ role: 'user', content: results });
      continue;
    }
    const txt = (j.content || []).map((x: any) => x.text || '').join('').trim();
    let out: any; try { out = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { out = { answer: txt }; }
    const clients = (out.client_ids || []).map((id: string) => found[id]).filter(Boolean).slice(0, 80);
    await logUse(`ask: ${question}`, { answer: String(out.answer || '').slice(0, 500), n: clients.length }, { usage });
    return json({ kind: 'ask', answer: out.answer || txt, clients });
  }
  throw new Error('السؤال طوّل، جربي تسألينه بشكل أبسط');
}
