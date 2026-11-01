// بيوتفريش ← ركاز: مزامنة قراءة فقط.
// يناديها pg_cron (x-sync-secret). تقرأ من Rekaz Platform API v1 وتحفظ في جداول rekaz_*.
// ما تكتب أي شي في ركاز: كل الطلبات GET ما عدا طلب التوكن.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.rekaz.io/v1';
const TOKEN_URL = 'https://platform.rekaz.io/connect/token';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function secretKey(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (k?.default) return k.default; } catch (_) { /* */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

type Cfg = { client_id: string; client_secret: string; sync_secret: string };
let token: { v: string; exp: number } | null = null;

async function getToken(cfg: Cfg): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.v;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.client_id, client_secret: cfg.client_secret });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const t = await r.json();
  token = { v: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 };
  return token.v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(cfg: Cfg, path: string, params: Record<string, string>): Promise<any> {
  const u = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => v != null && v !== '' && u.searchParams.set(k, v));
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${await getToken(cfg)}`, Accept: 'application/json' } });
    if (r.status === 429 || r.status === 503) { await sleep((Number(r.headers.get('Retry-After')) || 5) * 1000); continue; }
    if (r.status === 401) { token = null; continue; }
    if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  throw new Error(`${path}: retries exhausted`);
}

async function pull(cfg: Cfg, kind: string, path: string, params: Record<string, string>, maxPages = 400): Promise<number> {
  let cursor = '', n = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await get(cfg, path, { ...params, limit: '200', ...(cursor ? { cursor } : {}) });
    const items = res?.items ?? [];
    if (items.length) {
      const { error } = await db.rpc('rekaz_upsert', { p_kind: kind, p_items: items });
      if (error) throw new Error(`upsert ${kind}: ${error.message}`);
      n += items.length;
    }
    cursor = res?.nextCursor ?? '';
    if (!cursor) break;
  }
  return n;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

async function run(cfg: Cfg, mode: string) {
  const counts: Record<string, number> = {};
  const step = async (k: string, f: () => Promise<number>) => {
    try { counts[k] = await f(); } catch (e) { counts[k] = -1; throw new Error(`${k}: ${(e as Error).message}`); }
  };
  try {
    const full = mode === 'full';
    if (full) {
      await step('providers', () => pull(cfg, 'providers', '/providers', {}));
      await step('products', () => pull(cfg, 'products', '/products', {}));
      await step('customers', () => pull(cfg, 'customers', '/customers', {}));
    } else {
      await step('customers', () => pull(cfg, 'customers', '/customers', { createdAtFrom: iso(days(-3)) }));
    }
    // الحجوزات: نسحبها شهر شهر عشان ما تطول الصفحات
    const from = full ? -400 : -21, to = full ? 120 : 90;
    let total = 0;
    for (let s = from; s < to; s += 30) {
      total += await pull(cfg, 'reservations', '/reservations', { startAtFrom: iso(days(s)), startAtTo: iso(days(Math.min(s + 30, to))) });
    }
    counts.reservations = total;
    await step('orders', () => pull(cfg, 'orders', '/orders', { createdAtFrom: iso(days(full ? -400 : -3)) }));
    if (!full) await step('orders_paid', () => pull(cfg, 'orders', '/orders', { paidAtFrom: iso(days(-3)) }));
    await step('transactions', () => pull(cfg, 'transactions', '/transactions', { processedFrom: iso(days(full ? -400 : -3)) }));
    await step('reviews', () => pull(cfg, 'reviews', '/customer-reviews', full ? {} : { createdAtFrom: iso(days(-30)) }));
    await db.rpc('rekaz_log', { p_mode: mode, p_ok: true, p_counts: counts, p_error: null });
  } catch (e) {
    await db.rpc('rekaz_log', { p_mode: mode, p_ok: false, p_counts: counts, p_error: (e as Error).message });
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const { data: cfg, error } = await db.rpc('rekaz_sync_config');
  if (error || !cfg?.sync_secret) return json({ error: 'config_unavailable' }, 500);
  if (req.headers.get('x-sync-secret') !== cfg.sync_secret) return json({ error: 'forbidden' }, 403);
  if (!cfg.client_id || !cfg.client_secret) return json({ error: 'rekaz_credentials_missing' }, 400);
  let mode = 'quick';
  try { mode = (await req.json())?.mode === 'full' ? 'full' : 'quick'; } catch (_) { /* default */ }
  // نرد فورًا ونكمل بالخلفية
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(run(cfg as Cfg, mode));
  return json({ ok: true, mode });
});
