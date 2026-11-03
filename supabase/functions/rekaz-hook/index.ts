// بيوتفريش ← ركاز: استقبال الأحداث الفورية (Webhooks) وإرسال إشعار للإدارة.
// - طلبات ركاز: موقّعة HMAC-SHA256 (Rekaz-Webhook-*).
// - الربط يتسوى من لوحة ركاز: الإعدادات ← مفاتيح API ← Webhook (رابط هذي الدالة)، والمفتاح يتحط في أسرار الدوال باسم REKAZ_WEBHOOK_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.rekaz.io/v1';
const TOKEN_URL = 'https://platform.rekaz.io/connect/token';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (k?.default) return k.default; } catch (_) { /* */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

let token: { v: string; exp: number } | null = null;
async function getToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.v;
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: Deno.env.get('REKAZ_CLIENT_ID') ?? '', client_secret: Deno.env.get('REKAZ_CLIENT_SECRET') ?? '' }) });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const t = await r.json();
  token = { v: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
  return token.v;
}
async function call(method: string, path: string, body?: unknown, idem?: string): Promise<any> {
  const h: Record<string, string> = { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' };
  if (body) h['Content-Type'] = 'application/json';
  if (idem) h['Idempotency-Key'] = idem;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

// توقيع ركاز: X-Rekaz-Signature = HMAC-SHA256(جسم الطلب الخام، المفتاح) بصيغة hex صغيرة
async function verify(raw: Uint8Array, sig: string, secret: string): Promise<boolean> {
  if (!sig || !secret) return false;
  sig = sig.trim().toLowerCase().replace(/^sha256=/, '');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < expected.length; i++) d |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

const money = (m: any) => (m && typeof m === 'object' ? Number(m.amount) : Number(m)) || 0;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const when = (s: string) => {
  const d = new Date(s);
  const day = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'numeric' });
  const t = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit' }).replace('AM', 'ص').replace('PM', 'م');
  return `${day} ${t}`;
};
const rDay = (s: string) => new Date(s).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

async function onReservation(id: string) {
  const { data: before } = await db.from('rekaz_reservations').select('status,start_at').eq('id', id).maybeSingle();
  const r = await call('GET', `/reservations/${id}`);
  await db.rpc('rekaz_upsert', { p_kind: 'reservations', p_items: [r] });
  const who = r.customerName || 'عميلة', what = r.productName || '', url = `#/appts?d=${rDay(r.startAt)}`;
  const prov = (r.providers || []).map((p: any) => p.name).filter(Boolean).join('، ');
  if (!before && r.status !== 'cancelled') {
    await db.rpc('rekaz_notify', { p_title: 'حجز جديد', p_body: `${who} · ${what}${prov ? ' · ' + prov : ''} · ${when(r.startAt)}`, p_url: url, p_tag: `rk-${id}` });
  } else if (before && before.status !== 'cancelled' && r.status === 'cancelled') {
    await db.rpc('rekaz_notify', { p_title: 'إلغاء موعد', p_body: `${who} · ${what} · ${when(r.startAt)}`, p_url: url, p_tag: `rk-${id}` });
  } else if (before && before.start_at && +new Date(before.start_at) !== +new Date(r.startAt)) {
    await db.rpc('rekaz_notify', { p_title: 'تعديل موعد', p_body: `${who} · ${what} · صار ${when(r.startAt)}`, p_url: url, p_tag: `rk-${id}` });
  }
}
async function onOrder(id: string) {
  const { data: before } = await db.from('rekaz_orders').select('paid').eq('id', id).maybeSingle();
  const o = await call('GET', `/orders/${id}`);
  await db.rpc('rekaz_upsert', { p_kind: 'orders', p_items: [o] });
  const paid = money(o.paidAmount), prev = Number(before?.paid || 0);
  if (paid > prev + 0.009) {
    await db.rpc('rekaz_notify', { p_title: `دفع ${fmt(paid - prev)} ريال`, p_body: `${o.customerName || 'عميلة'} · طلب رقم ${o.sequentialNumber ?? ''}${money(o.remainingAmount) > 0 ? ` · المتبقي ${fmt(money(o.remainingAmount))}` : ''}`, p_url: '#/sales', p_tag: `rko-${id}` });
  }
}
async function onCustomer(id: string) {
  const c = await call('GET', `/customers/${id}`);
  await db.rpc('rekaz_upsert', { p_kind: 'customers', p_items: [c] });
}

// أي حركة مالية أو طلب: نشغّل المزامنة السريعة فورًا بدل ما ننتظر ١٠ دقايق
async function kickQuick(syncSecret: string) {
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/rekaz-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-secret': syncSecret }, body: JSON.stringify({ mode: 'quick' }) });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true, hint: 'rekaz webhook receiver' });
  const raw = new Uint8Array(await req.arrayBuffer());
  const { data: cfg } = await db.rpc('rekaz_hook_config');
  const secret = Deno.env.get('REKAZ_WEBHOOK_SECRET') || cfg?.webhook_secret || '';
  if (!(await verify(raw, req.headers.get('x-rekaz-signature') ?? '', secret))) return json({ error: 'bad_signature' }, 401);
  let ev: any; try { ev = JSON.parse(new TextDecoder().decode(raw)); } catch (_) { return json({ error: 'bad_json' }, 400); }
  const id = String(ev?.Id ?? ev?.id ?? ''), name = String(ev?.EventName ?? ev?.eventName ?? ''), data = ev?.Data ?? ev?.data ?? {};
  const sid = String(data?.Id ?? data?.id ?? '');
  if (id) { const { data: seen } = await db.rpc('rekaz_seen', { p_id: id, p_type: name, p_stype: name.replace(/(Created|Confirmed|Done|Cancelled|Canceled|Updated|Paid|Refunded|Completed|Activated|Redeemed)?Event$/, ''), p_sid: sid }); if (seen) return json({ ok: true, duplicate: true }); }
  // نرد على ركاز فورًا، والشغل يكمل بالخلفية
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil((async () => {
    try {
      if (name.startsWith('Reservation') && sid) await onReservation(sid);
      if (name.startsWith('Transaction') || name.startsWith('MerchandiseOrder') || name.startsWith('Gift') || name.startsWith('Subscription')) await kickQuick(cfg?.sync_secret ?? '');
      else if (name.startsWith('Reservation')) await kickQuick(cfg?.sync_secret ?? '');
    } catch (e) { console.error('rekaz-hook', name, (e as Error).message); }
  })());
  return json({ ok: true });
});
