// بيوتفريش ← ركاز: صفحة الحجز تحجز داخل تقويم ركاز.
// public endpoint (CORS) — actions: slots | first | book
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.rekaz.io/v1';
const TOKEN_URL = 'https://platform.rekaz.io/connect/token';
const ORIGINS = ['https://beautfresh.com', 'https://www.beautfresh.com', 'http://localhost:8765'];

function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (k?.default) return k.default; } catch (_) { /* */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

let cfg: { client_id: string; client_secret: string } | null = null;
let token: { v: string; exp: number } | null = null;
async function getToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.v;
  if (!cfg) cfg = { client_id: Deno.env.get('REKAZ_CLIENT_ID') ?? '', client_secret: Deno.env.get('REKAZ_CLIENT_SECRET') ?? '' };
  if (!cfg?.client_id || !cfg?.client_secret) throw new Error('rekaz_not_connected');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.client_id, client_secret: cfg.client_secret }) });
  if (!r.ok) { cfg = null; throw new Error('rekaz_token_failed'); }
  const t = await r.json();
  token = { v: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
  return token.v;
}
async function call(method: string, path: string, body?: unknown, idem?: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    const h: Record<string, string> = { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' };
    if (body) h['Content-Type'] = 'application/json';
    if (idem) h['Idempotency-Key'] = idem;
    const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status === 503) { await new Promise((s) => setTimeout(s, (Number(r.headers.get('Retry-After')) || 2) * 1000)); continue; }
    if (r.status === 401) { token = null; continue; }
    const txt = await r.text();
    let j: any = null; try { j = JSON.parse(txt); } catch (_) { /* */ }
    if (!r.ok) { const e = new Error(j?.code || `http_${r.status}`); (e as any).detail = j?.detail || txt.slice(0, 300); throw e; }
    return j;
  }
  throw new Error('rate_limited');
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const riyadhHM = (s: string) => new Date(s).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false });
const riyadhDay = (s: string) => new Date(s).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const dayStartUTC = (day: string) => new Date(`${day}T00:00:00+03:00`);

type Item = { service_id: number; option_id?: number | null };
type Line = { priceId: string; name: string };

let FORCE = false;
async function resolve(items: Item[]): Promise<{ lines: Line[]; branchId: string; maxOpen: number }> {
  if (!Array.isArray(items) || !items.length || items.length > 6) throw new Error('bad_items');
  const { data: set } = await db.from('salon_settings').select('rekaz_booking,rekaz_branch_id,max_open_per_phone').eq('id', 1).single();
  if (!(set?.rekaz_booking || FORCE) || !set?.rekaz_branch_id) throw new Error('rekaz_booking_off');
  const lines: Line[] = [];
  for (const it of items) {
    if (it.option_id) {
      const { data } = await db.from('salon_service_options').select('name,rekaz_price_id,salon_services(name)').eq('id', it.option_id).eq('service_id', it.service_id).eq('is_active', true).maybeSingle();
      if (!data?.rekaz_price_id) throw new Error('service_not_linked');
      lines.push({ priceId: data.rekaz_price_id, name: `${(data as any).salon_services?.name} · ${data.name}` });
    } else {
      const { data } = await db.from('salon_services').select('name,rekaz_price_id').eq('id', it.service_id).eq('is_active', true).maybeSingle();
      if (!data?.rekaz_price_id) throw new Error('service_not_linked');
      lines.push({ priceId: data.rekaz_price_id, name: data.name });
    }
  }
  return { lines, branchId: set.rekaz_branch_id, maxOpen: set.max_open_per_phone || 2 };
}

type Slot = { startAt: string; endAt: string; isAvailable: boolean; availableProviders: { id: string }[] };
async function search(priceId: string, branchId: string, from: Date, to: Date, member: string | null): Promise<Slot[]> {
  const r = await call('POST', '/reservations/slot-searches', {
    priceId, branchId, window: { startAt: iso(from), endAt: iso(to) },
    providers: member ? { mode: 'exact', ids: [member] } : { mode: 'automatic', count: 1 },
  });
  return (r?.items ?? []).filter((s: Slot) => s.isAvailable);
}

// يجمع الخدمات بالتسلسل: كل خدمة تبدأ بعد اللي قبلها بـ ٠–٢٠ دقيقة
async function plans(lines: Line[], branchId: string, from: Date, to: Date, member: string | null, onlyStart?: string) {
  const per = await Promise.all(lines.map((l, k) => search(l.priceId, branchId, from, k === 0 ? to : new Date(to.getTime() + 8 * 3600_000), k === 0 ? member : null)));
  const out: { time: string; day: string; steps: { priceId: string; startAt: string; endAt: string; providerId: string | null }[] }[] = [];
  for (const s1 of per[0]) {
    if (onlyStart && s1.startAt !== onlyStart) continue;
    const steps = [{ priceId: lines[0].priceId, startAt: s1.startAt, endAt: s1.endAt, providerId: s1.availableProviders?.[0]?.id ?? member }];
    let ok = true, t = +new Date(s1.endAt);
    for (let k = 1; k < lines.length; k++) {
      const nx = per[k].find((s) => { const st = +new Date(s.startAt); return st >= t && st - t <= 20 * 60_000; });
      if (!nx) { ok = false; break; }
      steps.push({ priceId: lines[k].priceId, startAt: nx.startAt, endAt: nx.endAt, providerId: nx.availableProviders?.[0]?.id ?? null });
      t = +new Date(nx.endAt);
    }
    if (ok) out.push({ time: riyadhHM(s1.startAt), day: riyadhDay(s1.startAt), steps });
  }
  return out;
}

const normPhone = (p: string) => {
  let d = String(p || '').replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/\D/g, '');
  if (d.startsWith('966')) d = '0' + d.slice(3);
  if (/^5\d{8}$/.test(d)) d = '0' + d;
  return /^05\d{8}$/.test(d) ? d : '';
};

async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

const MSG: Record<string, string> = {
  rekaz_not_connected: 'الحجز غير متاح مؤقتًا، تواصلي معنا على الواتساب',
  rekaz_booking_off: 'الحجز غير متاح مؤقتًا، تواصلي معنا على الواتساب',
  service_not_linked: 'وحدة من الخدمات غير متاحة للحجز أونلاين، تواصلي معنا',
  bad_items: 'اختاري خدمة وحدة على الأقل',
  slot_taken: 'الموعد انحجز قبل شوي، اختاري وقت ثاني',
  bad_phone: 'رقم الجوال غير صحيح',
  bad_name: 'اكتبي الاسم',
  too_many: 'عندك حجوزات قادمة، تواصلي معنا على الواتساب لو تبين تضيفين',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const cors = { 'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0], 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'method_not_allowed' }, 405);
  let b: any; try { b = await req.json(); } catch (_) { return out({ error: 'bad_request' }, 400); }
  FORCE = false;
  if (b.preview_key) { const { data } = await db.rpc('rekaz_sync_config'); FORCE = !!data?.sync_secret && data.sync_secret === b.preview_key; }
  try {
    const member = b.member ? String(b.member) : null;
    if (b.action === 'slots') {
      const { lines, branchId } = await resolve(b.items);
      const from = dayStartUTC(b.day), to = new Date(from.getTime() + 86_400_000);
      const p = await plans(lines, branchId, new Date(Math.max(from.getTime(), Date.now() + 30 * 60_000)), to, member);
      return out({ slots: p.filter((x) => x.day === b.day).map((x) => x.time) });
    }
    if (b.action === 'first') {
      const { lines, branchId } = await resolve(b.items);
      const from = new Date(Date.now() + 30 * 60_000);
      for (let w = 0; w < 3; w++) {
        const f = new Date(from.getTime() + w * 5 * 86_400_000), t = new Date(f.getTime() + 5 * 86_400_000);
        const p = await plans(lines, branchId, f, t, member);
        if (p.length) return out({ first: { day: p[0].day, time: p[0].time } });
      }
      return out({ first: null });
    }
    if (b.action === 'book') {
      const name = String(b.name || '').trim();
      if (name.length < 2 || name.length > 60) throw new Error('bad_name');
      const phone = normPhone(b.phone); if (!phone) throw new Error('bad_phone');
      const { lines, branchId, maxOpen } = await resolve(b.items);
      const { count } = await db.from('rekaz_reservations').select('id', { count: 'exact', head: true }).eq('phone', phone).gt('start_at', new Date().toISOString()).not('status', 'in', '(cancelled,done)');
      if ((count || 0) >= maxOpen) throw new Error('too_many');
      // نفس نافذة البحث اللي طلعت منها الأوقات للعميلة (اليوم كامل)، ونطابق الوقت
      const dayFrom = dayStartUTC(b.day), dayTo = new Date(dayFrom.getTime() + 86_400_000);
      const p = await plans(lines, branchId, new Date(Math.max(dayFrom.getTime(), Date.now() + 5 * 60_000)), dayTo, member);
      const plan = p.find((x) => x.time === b.time && x.day === b.day);
      if (!plan) throw new Error('slot_taken');
      const intl = '966' + phone.slice(1);
      const found = await call('GET', `/customers?mobileNumber=${intl}&limit=1`);
      let customerId = found?.items?.[0]?.id;
      if (!customerId) {
        const c = await call('POST', '/customers', { name, mobileNumber: intl, type: 'individuals', branchId }, await sha('cust:' + intl));
        customerId = c.id;
      }
      const key = await sha(['book', intl, b.day, b.time, plan.steps.map((s) => s.priceId).join(',')].join('|'));
      const r = await call('POST', '/reservations/batches', {
        customerId, branchId, source: 'website',
        items: plan.steps.map((s) => ({ priceId: s.priceId, startAt: s.startAt, endAt: s.endAt, quantity: 1, ...(s.providerId ? { providerIds: [s.providerId] } : {}) })),
      }, key);
      let number: number | null = null;
      try { const rv = await call('GET', `/reservations/${r.reservationIds[0]}`); number = rv?.number ?? null; } catch (_) { /* optional */ }
      return out({ ok: true, number, orderId: r.orderId, paymentLink: r.paymentLink, lines: lines.map((l) => l.name) });
    }
    return out({ error: 'unknown_action' }, 400);
  } catch (e) {
    const code = (e as Error).message;
    const mapped = code === 'reservation_slot_conflict' || code.startsWith('sp_') ? 'slot_taken' : code;
    console.error('rekaz-book', code, (e as any).detail || '');
    return out({ error: mapped, message: MSG[mapped] || 'صار خطأ، جرّبي مرة ثانية أو تواصلي معنا على الواتساب' }, 400);
  }
});
