// Sends Web Push notifications.
// Called by database triggers (x-notify-secret header) or by a signed-in user to send themselves a test.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys && keys['default']) return keys['default'];
  } catch (_) { /* fall back */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

let cfg: { vapid_public: string; vapid_private: string; notify_secret: string } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!cfg) {
    const { data, error } = await admin.rpc('notify_config');
    if (error || !data?.[0]) return json({ error: 'config_unavailable' }, 500);
    cfg = data[0];
    webpush.setVapidDetails('mailto:noreply@salon.local', cfg!.vapid_public, cfg!.vapid_private);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_) { return json({ error: 'bad_request' }, 400); }

  let userIds: string[] = [];
  const secret = req.headers.get('x-notify-secret');
  if (secret) {
    if (secret !== cfg!.notify_secret) return json({ error: 'forbidden' }, 403);
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true);
    userIds = (admins ?? []).map((a) => a.id).filter((id) => id !== body.exclude);
  } else {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json({ error: 'unauthorized' }, 401);
    const { data: me } = await admin.from('profiles').select('is_active').eq('id', who.user.id).single();
    if (!me?.is_active || !body.test) return json({ error: 'forbidden' }, 403);
    userIds = [who.user.id];
    body = { title: 'إشعار تجريبي', body: 'الإشعارات تعمل على هذا الجهاز', url: '#/home', tag: 'test' };
  }
  if (!userIds.length) return json({ ok: true, sent: 0 });

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  const payload = JSON.stringify({
    title: String(body.title ?? 'مخزون الصالون'),
    body: String(body.body ?? ''),
    url: String(body.url ?? '#/home'),
    tag: body.tag ? String(body.tag) : undefined,
  });

  let sent = 0;
  const failures: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
      failures.push(`${code ?? 'err'}: ${(e as Error).message}`.slice(0, 200));
    }
  }));
  return json({ ok: true, sent, failed: failures.length, failures });
});
