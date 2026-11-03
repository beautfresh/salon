// بيوتفريش ← ركاز: استقبال الأحداث الفورية (Webhooks) وإرسال إشعار للإدارة.
// - طلبات ركاز: موقّعة HMAC-SHA256 (Rekaz-Webhook-*).
// - setup: يناديها قاعدة البيانات (x-sync-secret) لتسجيل الرابط والاشتراك في الأحداث.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.rekaz.io/v1';
const TOKEN_URL = 'https://platform.rekaz.io/connect/token';
const SELF = 'https://enrlujtrysrlzwbjexey.supabase.co/functions/v1/rekaz-hook';
const FAMILIES = ['reservations', 'orders', 'customers'];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (k?.default) return k.default; } catch (_) { /* */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

// تكاملين في ركاز: الأساسي للقراءة، وتكامل «الأحداث» (صلاحيات events.*) لإدارة الـ Webhooks
const tokens: Record<string, { v: string; exp: number }> = {};
async function getToken(kind: 'main' | 'events' = 'main'): Promise<string> {
  const t0 = tokens[kind];
  if (t0 && t0.exp > Date.now() + 60_000) return t0.v;
  const id = kind === 'events' ? Deno.env.get('REKAZ_EVENTS_CLIENT_ID') : Deno.env.get('REKAZ_CLIENT_ID');
  const sec = kind === 'events' ? Deno.env.get('REKAZ_EVENTS_CLIENT_SECRET') : Deno.env.get('REKAZ_CLIENT_SECRET');
  if (!id || !sec) throw new Error(`missing ${kind} credentials`);
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: sec, ...(kind === 'events' ? { scope: FAMILIES.map((f) => `events.${f}`).join(' ') } : {}) }) });
  if (!r.ok) throw new Error(`token ${kind} ${r.status}`);
  const t = await r.json();
  tokens[kind] = { v: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
  return tokens[kind].v;
}
async function call(method: string, path: string, body?: unknown, idem?: string, kind: 'main' | 'events' = 'main'): Promise<any> {
  const h: Record<string, string> = { Authorization: `Bearer ${await getToken(kind)}`, Accept: 'application/json' };
  if (body) h['Content-Type'] = 'application/json';
  if (idem) h['Idempotency-Key'] = idem;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function verify(raw: string, ts: string, sig: string, secret: string): Promise<boolean> {
  if (!ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', b64urlToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`)));
  const expected = 'v1=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
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

async function setup() {
  const steps: string[] = [];
  const list = await call('GET', '/webhook-endpoints', undefined, undefined, 'events');
  let ep = (list?.items || []).find((e: any) => e.url === SELF);
  if (!ep) {
    const c = await call('POST', '/webhook-endpoints', { url: SELF }, crypto.randomUUID(), 'events');
    await db.rpc('rekaz_set_webhook_secret', { p_secret: c.signingSecret });
    ep = c.endpoint; steps.push('endpoint_created');
  } else if (!(await db.rpc('rekaz_hook_config')).data?.webhook_secret) {
    const c = await call('POST', `/webhook-endpoints/${ep.id}/rotate-secret`, {}, crypto.randomUUID(), 'events');
    await db.rpc('rekaz_set_webhook_secret', { p_secret: c.signingSecret });
    steps.push('secret_rotated');
  }
  if (ep.status !== 'verified') { await call('PATCH', `/webhook-endpoints/${ep.id}/verification`, {}, undefined, 'events'); steps.push('verified'); }
  for (const f of FAMILIES) {
    try { await call('POST', '/event-subscriptions', { webhookEndpointId: ep.id, eventFamily: f }, `sub-${ep.id}-${f}`, 'events'); steps.push(`sub_${f}`); }
    catch (e) { steps.push(`sub_${f}_failed: ${(e as Error).message.slice(0, 160)}`); }
  }
  return steps;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await req.text();
  const { data: cfg } = await db.rpc('rekaz_hook_config');

  if (req.headers.get('x-sync-secret')) {
    if (req.headers.get('x-sync-secret') !== cfg?.sync_secret) return json({ error: 'forbidden' }, 403);
    try { return json({ ok: true, steps: await setup() }); } catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }
  }

  const ok = await verify(raw, req.headers.get('rekaz-webhook-timestamp') ?? '', req.headers.get('rekaz-webhook-signature') ?? '', cfg?.webhook_secret ?? '');
  if (!ok) return json({ error: 'bad_signature' }, 401);
  let ev: any; try { ev = JSON.parse(raw); } catch (_) { return json({ error: 'bad_json' }, 400); }
  if (ev && typeof ev.challenge === 'string' && Object.keys(ev).length === 1) return json({ challenge: ev.challenge });

  const st = String(ev?.subject?.type || ev?.type || '').toLowerCase(), sid = ev?.subject?.id;
  if (ev?.id) { const { data: seen } = await db.rpc('rekaz_seen', { p_id: ev.id, p_type: ev.type ?? '', p_stype: st, p_sid: sid ?? '' }); if (seen) return json({ ok: true, duplicate: true }); }
  try {
    if (sid && st.includes('reservation')) await onReservation(sid);
    else if (sid && st.includes('order')) await onOrder(sid);
    else if (sid && st.includes('customer')) await onCustomer(sid);
  } catch (e) {
    console.error('rekaz-hook', ev?.type, (e as Error).message);
    return json({ error: 'retry' }, 500);
  }
  return json({ ok: true });
});
