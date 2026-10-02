import { createClient } from 'npm:@supabase/supabase-js@2';

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

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
const toEmail = (login: string) => (login.includes('@') ? login.toLowerCase() : `${login.toLowerCase()}@salon.local`);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: 'غير مصرح' }, 401);

  const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', who.user.id).single();
  if (!me || !me.is_active || me.role !== 'admin') return json({ error: 'هذه العملية من صلاحية مدير النظام فقط' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_) { return json({ error: 'طلب غير صالح' }, 400); }
  const action = String(body.action ?? '');

  if (action === 'create') {
    const login = String(body.login ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? 'staff');
    if (!login.includes('@') && !LOGIN_RE.test(login))
      return json({ error: 'اسم المستخدم: أحرف إنجليزية صغيرة وأرقام فقط، من 3 إلى 32 خانة' }, 400);
    if (password.length < 8) return json({ error: 'كلمة المرور 8 خانات على الأقل' }, 400);
    if (!fullName) return json({ error: 'الاسم مطلوب' }, 400);
    if (!['admin', 'partner', 'staff'].includes(role)) return json({ error: 'دور غير صالح' }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email: toEmail(login), password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error) {
      const msg = /already/i.test(error.message) ? 'اسم المستخدم أو البريد مستخدم من قبل' : error.message;
      return json({ error: msg }, 400);
    }
    const { error: pErr } = await admin.from('profiles')
      .update({ role, is_active: true, full_name: fullName }).eq('id', data.user.id);
    if (pErr) return json({ error: pErr.message }, 500);
    return json({ ok: true, id: data.user.id });
  }

  if (action === 'set_password') {
    const userId = String(body.user_id ?? '');
    const password = String(body.password ?? '');
    if (password.length < 8) return json({ error: 'كلمة المرور 8 خانات على الأقل' }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'إجراء غير معروف' }, 400);
});
