/* مخزون الصالون — واجهة إدارة المخزون */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG;
  const sb = window.__SUPABASE_CLIENT__ || window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  /* ======================= state ======================= */
  const S = {
    session: null,
    profile: null,
    profiles: new Map(),
    categories: [],
    suppliers: [],
    items: [],
    costs: new Map(),
    shellReady: false,
  };
  const isAdmin = () => S.profile?.role === 'admin';
  const isManager = () => ['admin', 'partner'].includes(S.profile?.role);

  const ROLE_LABEL = { admin: 'مدير النظام', partner: 'الإدارة', staff: 'موظف' };
  const MOVE_LABEL = { purchase: 'شراء', issue: 'صرف', damage: 'تالف', expired: 'منتهي الصلاحية', count_adjust: 'تسوية جرد' };
  const MOVE_BADGE = { purchase: 'ok', issue: 'accent', damage: 'danger', expired: 'warn', count_adjust: '' };
  const STATUS_LABEL = { draft: 'مسودة', approved: 'معتمدة', cancelled: 'ملغاة' };
  const STATUS_BADGE = { draft: 'warn', approved: 'ok', cancelled: '' };
  const UNITS = ['حبة', 'علبة', 'عبوة', 'زجاجة', 'أنبوب', 'كيس', 'لفة', 'باكيت', 'كرتون', 'جالون', 'طقم', 'زوج', 'لتر', 'كيلو'];

  /* ======================= utils ======================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: d });
  const money = (v) => `${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
  const today = () => new Date().toISOString().slice(0, 10);
  const initial = (name) => (String(name || '?').trim()[0] || '?');
  const itemById = (id) => S.items.find((i) => i.id === Number(id));
  const catName = (id) => S.categories.find((c) => c.id === id)?.name || 'بدون فئة';
  const supName = (id) => S.suppliers.find((s) => s.id === id)?.name || 'بدون مورد';
  const personName = (id) => S.profiles.get(id)?.full_name || S.profiles.get(id)?.login || '—';
  const isLow = (it) => Number(it.qty_on_hand) <= Number(it.min_qty);

  function errMsg(e) {
    const m = String(e?.message || e || '');
    if (/Invalid login credentials/i.test(m)) return 'اسم المستخدم أو كلمة المرور غير صحيحة';
    if (/row-level security|permission denied/i.test(m)) return 'ليس لديك صلاحية لهذا الإجراء';
    if (/duplicate key|already exists/i.test(m)) return 'هذه القيمة مسجلة من قبل';
    if (/foreign key/i.test(m)) return 'لا يمكن الحذف لارتباطه ببيانات أخرى';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'تعذر الاتصال، تحقق من الإنترنت';
    if (/JWT|session/i.test(m)) return 'انتهت الجلسة، سجّل الدخول من جديد';
    return m || 'حدث خطأ غير متوقع';
  }

  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 4200 : 2600);
  }

  function modal(html, onMount) {
    const root = $('#modal-root');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    root.appendChild(back);
    $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
    onMount && onMount(back, close);
    const first = $('input, select, textarea', back);
    if (first) setTimeout(() => first.focus(), 50);
    return close;
  }

  function confirmBox(title, text, okLabel = 'تأكيد', danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const close = modal(`
        <h3>${esc(title)}</h3>
        <p class="muted" style="margin-top:-6px">${text}</p>
        <div class="actions end mt">
          <button class="btn" data-no>إلغاء</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button>
        </div>`, (el, c) => {
        $('[data-no]', el).onclick = () => { done = true; c(); resolve(false); };
        $('[data-yes]', el).onclick = () => { done = true; c(); resolve(true); };
      });
      // resolve false if closed by backdrop / Esc
      const obs = new MutationObserver(() => {
        if (!document.body.contains($('.modal-back:last-child') || null) && !done) { obs.disconnect(); resolve(false); }
      });
      obs.observe($('#modal-root'), { childList: true });
      void close;
    });
  }

  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>'; }
    try { return await fn(); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
  }

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  /* ======================= icons ======================= */
  const I = {
    kit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12h18M10 12v2h4v-2"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 0-5-5L13 5z"/><path d="M3 21l6-6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.6-2-1-.9.9a3.6 3.6 0 0 1-1.9-1.9l.9-.9-1-2L9 9.5z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M8 14h3M8 17h6"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
    invoice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H6"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 21h18"/><path d="M7 17V10M12 17V5M17 17v-4"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.5 12h-11z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };

  /* ======================= data ======================= */
  async function loadRefs() {
    const [cats, sups, items, profs] = await Promise.all([
      q(sb.from('categories').select('id,name,sort_order').order('sort_order').order('name')),
      q(sb.from('suppliers').select('id,name,phone,notes,is_active').order('name')),
      q(sb.from('items').select('id,name,category_id,unit,min_qty,track_expiry,qty_on_hand,is_active,notes').order('name')),
      q(sb.from('profiles').select('id,full_name,login,role,is_active,approved_at,created_at').order('full_name')),
    ]);
    S.categories = cats; S.suppliers = sups; S.items = items;
    S.profiles = new Map(profs.map((p) => [p.id, p]));
    if (isManager()) {
      const costs = await q(sb.from('item_costs').select('item_id,avg_cost,last_cost'));
      S.costs = new Map(costs.map((c) => [c.item_id, c]));
    }
  }
  async function reloadItems() {
    S.items = await q(sb.from('items').select('id,name,category_id,unit,min_qty,track_expiry,qty_on_hand,is_active,notes').order('name'));
    if (isManager()) {
      const costs = await q(sb.from('item_costs').select('item_id,avg_cost,last_cost'));
      S.costs = new Map(costs.map((c) => [c.item_id, c]));
    }
  }

  /* ======================= auth ======================= */
  const toEmail = (login) => (login.includes('@') ? login.trim() : `${login.trim().toLowerCase()}@${CFG.loginDomain}`);

  function renderLogin(msg, mode = 'login') {
    S.shellReady = false;
    const signup = mode === 'signup';
    $('#app').innerHTML = `
      <div class="auth">
        <aside class="auth-brand" aria-hidden="true"><img src="../home/assets/Beautfresh-brown.svg" alt=""><span>The Fresh Version of You</span></aside>
        <form class="auth-card" id="auth-form" autocomplete="on">
          <img class="auth-logo-sm" src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش">
          <h1>${signup ? 'إنشاء حساب' : esc(CFG.appName)}</h1>
          <p class="sub">${signup ? 'بعد التسجيل يراجع مدير النظام طلبك ويحدد صلاحياتك.' : 'إدارة بيوتفريش كاملة، في مكان واحد.'}</p>
          ${msg ? `<div class="notice ${msg.ok ? 'info' : 'danger'}">${esc(msg.text || msg)}</div>` : ''}
          ${signup ? `<div class="field">
            <label for="full_name">الاسم</label>
            <input class="input" id="full_name" name="name" autocomplete="name" required>
          </div>` : ''}
          <div class="field">
            <label for="email">البريد الإلكتروني</label>
            <input class="input" id="email" name="email" type="${signup ? 'email' : 'text'}" dir="ltr" autocapitalize="none" autocomplete="${signup ? 'email' : 'username'}" required>
          </div>
          <div class="field">
            <label for="password">كلمة المرور</label>
            <input class="input" id="password" name="password" type="password" dir="ltr" ${signup ? 'minlength="8"' : ''} autocomplete="${signup ? 'new-password' : 'current-password'}" required>
            ${signup ? '<div class="hint">8 خانات على الأقل.</div>' : ''}
          </div>
          <button class="btn primary block" type="submit">${signup ? 'تسجيل' : 'دخول'}</button>
          <p class="small muted" style="text-align:center;margin:16px 0 0">
            ${signup ? 'لديك حساب؟ <a href="#" id="switch-mode">تسجيل الدخول</a>' : 'ليس لديك حساب؟ <a href="#" id="switch-mode">إنشاء حساب</a>'}
          </p>
          <a class="auth-install" href="install.html">ثبّت التطبيق على جوالك ←</a>
        </form>
      </div>`;
    $('#switch-mode').onclick = (e) => { e.preventDefault(); renderLogin(null, signup ? 'login' : 'signup'); };
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', e.target);
      await busy(btn, async () => {
        const email = toEmail($('#email').value);
        const password = $('#password').value;
        if (!signup) {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) toast(errMsg(error), true);
          return;
        }
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: $('#full_name').value.trim() } } });
        if (error) return toast(/registered|exists/i.test(error.message) ? 'هذا البريد مسجل من قبل، سجّل الدخول' : errMsg(error), true);
        if (!data.session) renderLogin({ ok: true, text: 'تم إنشاء الحساب. سجّل الدخول بعد اعتماده من مدير النظام.' });
      });
    });
  }

  function renderPending() {
    S.shellReady = false;
    const p = S.profile;
    $('#app').innerHTML = `
      <div class="auth"><div class="auth-card">
        <img src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش" style="height:56px;width:auto;margin-bottom:18px">
        <h1>الحساب بانتظار الاعتماد</h1>
        <p class="sub">أهلاً ${esc(p?.full_name || '')}، تم تسجيل حسابك وسيظهر لمدير النظام لاعتماده وتحديد صلاحياتك. بعد الاعتماد اضغط «تحديث».</p>
        <div class="actions"><button class="btn primary" id="pending-refresh" style="flex:1">تحديث</button><button class="btn" id="pending-out" style="flex:1">تسجيل الخروج</button></div>
      </div></div>`;
    $('#pending-out').onclick = () => sb.auth.signOut();
    $('#pending-refresh').onclick = () => boot();
  }

  function renderSetPassword() {
    S.shellReady = false;
    $('#app').innerHTML = `
      <div class="auth"><form class="auth-card" id="setpw">
        <img src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش" style="height:56px;width:auto;margin-bottom:18px">
        <h1>تعيين كلمة المرور</h1>
        <p class="sub">اختر كلمة مرور جديدة لحسابك</p>
        <div class="field"><label>كلمة المرور الجديدة</label><input class="input" type="password" id="pw1" dir="ltr" minlength="8" required autocomplete="new-password"></div>
        <div class="field"><label>تأكيد كلمة المرور</label><input class="input" type="password" id="pw2" dir="ltr" minlength="8" required autocomplete="new-password"></div>
        <button class="btn primary block">حفظ</button>
      </form></div>`;
    $('#setpw').addEventListener('submit', async (e) => {
      e.preventDefault();
      if ($('#pw1').value !== $('#pw2').value) return toast('كلمتا المرور غير متطابقتين', true);
      await busy($('button', e.target), async () => {
        const { error } = await sb.auth.updateUser({ password: $('#pw1').value });
        if (error) return toast(errMsg(error), true);
        toast('تم حفظ كلمة المرور');
        history.replaceState(null, '', location.pathname + '#/home');
        await boot();
      });
    });
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    if (!S.session) return renderLogin();
    try {
      const prof = await q(sb.from('profiles').select('id,full_name,login,role,is_active').eq('id', S.session.user.id).maybeSingle());
      S.profile = prof;
      if (!prof || !prof.is_active) return renderPending();
      await loadRefs();
      renderShell();
      route();
      syncPushOnLogin();
    } catch (e) {
      $('#app').innerHTML = `<div class="auth"><div class="auth-card"><h1>تعذر التحميل</h1><p class="sub">${esc(errMsg(e))}</p><button class="btn primary block" onclick="location.reload()">إعادة المحاولة</button></div></div>`;
    }
  }

  /* ======================= shell & router ======================= */
  function navLinks() {
    const M = isManager(), A = isAdmin();
    const G = [
      ['اليوم', [M && ['sales', 'المبيعات والأداء', I.chart], ['home', 'الرئيسية', I.home], ['appts', 'مواعيد الصالون', I.cal], ['bookings', 'الحجوزات المنزلية', I.home]]],
      ['العميلات والنمو', [['clients', 'العميلات', I.heart], ['marketing', 'التسويق', I.mega], M && ['site', 'الموقع', I.home], M && ['finance', 'المالية', I.coin]]],
      ['الفريق والتشغيل', [['team', 'الفريق', I.users], ['ops', 'التشغيل', I.check], ['assets', 'الأصول والصيانة', I.wrench], ['rules', 'قواعد بيوتفريش', I.shield]]],
      ['المخزون', [['items', 'الأصناف', I.box], ['issue', 'صرف من المخزون', I.out], ['invoices', 'فواتير الشراء', I.invoice], ['shopping', 'قائمة المشتريات', I.cart], ['movements', 'سجل الحركات', I.list], M && ['reports', 'التقارير', I.chart]]],
      ['العُدّة والنظام', [['kit', 'عُدّة بيوتفريش', I.kit], A && ['users', 'المستخدمين', I.users], A && ['catalog', 'الفئات والموردين', I.tag], ['more', 'الإعدادات', I.key]]],
    ];
    const L = [];
    G.forEach(([g, its]) => { L.push({ group: g }); its.filter(Boolean).forEach(([k, l, ic]) => L.push({ href: `#/${k}`, label: l, icon: ic, key: k, group: g })); });
    return L;
  }

  function renderShell() {
    const p = S.profile;
    $('#app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand"><img class="logo" src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><span>لوحة الإدارة</span></div>
          <nav>${navLinks().map((l) => !l.href ? `<div class="nav-g">${l.group}</div>` : `<a href="${l.href}" data-nav="${l.key}"><span class="ic">${l.icon}</span>${l.label}</a>`).join('')}</nav>
          <div class="foot">
            <div style="color:#fff;font-weight:600">${esc(p.full_name || p.login)}</div>
            <div>${ROLE_LABEL[p.role]}</div>
            <div style="margin-top:8px;display:flex;gap:12px"><button data-act="pw">كلمة المرور</button><button data-act="out">خروج</button></div>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="tb-title"><img class="tb-logo" src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><h1 id="page-title"></h1></div>
            <button type="button" class="tb-quick" id="fab2" aria-label="إجراء سريع">${I.plus}<b>إجراء سريع</b></button><a class="tb-tour" href="#/tour"><span>✦</span><b>جولة المميزات</b></a><div class="who"><span class="hide-sm">${esc(p.full_name || p.login)}</span><span class="avatar">${esc(initial(p.full_name || p.login))}</span></div>
          </header>
          <div class="content" id="view"></div>
        </div>
        <nav class="bottomnav">
          <a href="#/home" data-nav="home"><span class="ic">${I.home}</span>الرئيسية</a>
          <a href="#/appts" data-nav="appts"><span class="ic">${I.cal}</span>المواعيد</a>
          <button type="button" class="fab" id="fab" aria-label="إجراء سريع"><span class="ic">${I.plus}</span>إجراء</button>
          ${isManager() ? `<a href="#/sales" data-nav="sales"><span class="ic">${I.chart}</span>المبيعات</a>` : `<a href="#/clients" data-nav="clients"><span class="ic">${I.heart}</span>العميلات</a>`}
          <a href="#/more" data-nav="more"><span class="ic">${I.more}</span>المزيد</a>
        </nav>
      </div>`;
    $('#fab').onclick = quickActions; $('#fab2').onclick = quickActions;
    $('[data-act=out]').onclick = () => sb.auth.signOut();
    $('[data-act=pw]').onclick = changePassword;
    S.shellReady = true;
  }

  function setTitle(t) { $('#page-title').textContent = t; document.title = `${t} · ${CFG.appName}`; }
  function setActive(key) {
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    return { parts, params: new URLSearchParams(qs || '') };
  }

  const ROUTES = {
    home: { title: 'الرئيسية', nav: 'home', fn: pageHome },
    bookings: { title: 'الحجوزات المنزلية', nav: 'bookings', fn: pageBookings },
    booking: { title: 'تفاصيل الحجز', nav: 'bookings', fn: pageBooking },
    homesvc: { title: 'خدمات هوم والإعدادات', nav: 'bookings', fn: pageHomeSvc, manager: true },
    clients: { title: 'العميلات', nav: 'clients', fn: pageClients },
    client: { title: 'ملف العميلة', nav: 'clients', fn: pageClient },
    feedback: { title: 'الآراء والملاحظات', nav: 'clients', fn: pageFeedback },
    rules: { title: 'قواعد بيوتفريش', nav: 'rules', fn: pageRules },
    ops: { title: 'التشغيل', nav: 'ops', fn: pageOps },
    svc: { title: 'بطاقة الخدمة', nav: 'ops', fn: pageSvc },
    assets: { title: 'الأصول والصيانة', nav: 'assets', fn: pageAssets },
    asset: { title: 'الأصل', nav: 'assets', fn: pageAsset },
    team: { title: 'الفريق', nav: 'team', fn: pageTeam },
    member: { title: 'ملف الموظفة', nav: 'team', fn: pageMember },
    marketing: { title: 'التسويق', nav: 'marketing', fn: pageMarketing },
    site: { title: 'الموقع', nav: 'site', fn: pageSite, manager: true },
    sales: { title: 'المبيعات والأداء', nav: 'sales', fn: pageSales, manager: true },
    finance: { title: 'المالية', nav: 'finance', fn: pageFinance, manager: true },
    closing: { title: 'إقفال اليوم', nav: 'finance', fn: pageClosing, manager: true },
    expenses: { title: 'المصروفات', nav: 'finance', fn: pageExpenses, manager: true },
    items: { title: 'الأصناف', nav: 'items', fn: pageItems },
    item: { title: 'تفاصيل الصنف', nav: 'items', fn: pageItem },
    issue: { title: 'صرف من المخزون', nav: 'issue', fn: pageIssue },
    invoices: { title: 'فواتير الشراء', nav: 'invoices', fn: pageInvoices },
    invoice: { title: 'فاتورة شراء', nav: 'invoices', fn: pageInvoice },
    shopping: { title: 'قائمة المشتريات', nav: 'shopping', fn: pageShopping },
    movements: { title: 'سجل الحركات', nav: 'movements', fn: pageMovements },
    reports: { title: 'التقارير', nav: 'reports', fn: pageReports, manager: true },
    users: { title: 'المستخدمين', nav: 'users', fn: pageUsers, admin: true },
    catalog: { title: 'الفئات والموردين', nav: 'catalog', fn: pageCatalog, admin: true },
    tour: { title: 'جولة في بيوتفريش', nav: 'home', fn: pageTour },
    naqla: { title: 'نقلة بيوتفريش', nav: 'home', fn: pageNaqla },
    appts: { title: 'مواعيد الصالون', nav: 'appts', fn: pageAppts },
    kit: { title: 'عُدّة بيوتفريش', nav: 'kit', fn: pageKit },
    more: { title: 'الإعدادات', nav: 'more', fn: pageMore },
  };

  let routeSeq = 0;
  async function route() {
    if (!S.shellReady) return;
    const { parts, params } = parseHash();
    let r = ROUTES[parts[0]];
    if (!r || (r.admin && !isAdmin()) || (r.manager && !isManager())) {
      if (location.hash !== '#/home') { location.hash = '#/home'; return; }
      r = ROUTES.home;
    }
    const seq = ++routeSeq;
    setTitle(r.title);
    setActive(r.nav);
    const view = $('#view');
    // نفس الصفحة (تبويب أو فترة أو حفظ): بدون وميض ولا رجوع لفوق، والمؤشر ينزلق للتبويب الجديد
    const soft = S.lastRoute === parts[0] && view.children.length && !view.querySelector('.boot');
    S.lastRoute = parts[0];
    let from = null;
    if (soft) {
      const tabs = $$('.lens a, .chips a.chip', view);
      const old = tabs.find((a) => a.classList.contains('on'));
      if (old) from = { rect: old.getBoundingClientRect(), group: old.parentElement.className };
      tabs.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === location.hash));
      view.classList.add('soft');
    } else {
      view.innerHTML = '<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>';
      window.scrollTo(0, 0);
    }
    try {
      await r.fn(view, parts.slice(1), params, () => seq === routeSeq);
    } catch (e) {
      if (seq === routeSeq) view.innerHTML = `<div class="notice danger">${esc(errMsg(e))}</div>`;
    } finally {
      if (seq === routeSeq && soft) {
        view.classList.remove('soft', 'soft-in'); void view.offsetWidth; view.classList.add('soft-in');
        if (from) {
          const now = $$('.lens a.on, .chips a.chip.on', view).find((a) => a.parentElement.className === from.group);
          if (now) {
            const r2 = now.getBoundingClientRect(), dx = from.rect.left - r2.left, sx = from.rect.width / (r2.width || 1);
            if (Math.abs(dx) > 1) now.animate([{ transform: `translateX(${dx}px) scaleX(${sx})` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
          }
        }
      }
    }
  }

  /* ======================= item picker ======================= */
  function itemPicker(container, { value = null, onPick, activeOnly = true, placeholder = 'ابحث عن الصنف…' } = {}) {
    container.classList.add('picker');
    container.innerHTML = `<input class="input" type="search" placeholder="${esc(placeholder)}" autocomplete="off"><div class="picker-list" hidden></div>`;
    const input = $('input', container);
    const listEl = $('.picker-list', container);
    let selected = value ? itemById(value) : null;
    let hl = 0;
    let matches = [];
    if (selected) input.value = selected.name;

    const pool = () => S.items.filter((i) => !activeOnly || i.is_active);
    function draw() {
      const t = input.value.trim();
      matches = pool().filter((i) => !t || i.name.includes(t) || catName(i.category_id).includes(t)).slice(0, 30);
      if (!matches.length) { listEl.innerHTML = '<div class="empty">لا يوجد صنف بهذا الاسم</div>'; listEl.hidden = false; return; }
      hl = Math.min(hl, matches.length - 1);
      listEl.innerHTML = matches.map((i, k) => `
        <button type="button" data-id="${i.id}" class="${k === hl ? 'hl' : ''}">
          <span>${esc(i.name)}<div class="meta">${esc(catName(i.category_id))}</div></span>
          <span class="meta num">${num(i.qty_on_hand)} ${esc(i.unit)}</span>
        </button>`).join('');
      listEl.hidden = false;
    }
    function pick(id) {
      selected = itemById(id);
      input.value = selected ? selected.name : '';
      listEl.hidden = true;
      onPick && onPick(selected);
    }
    input.addEventListener('focus', draw);
    input.addEventListener('input', () => { hl = 0; if (selected && input.value !== selected.name) { selected = null; onPick && onPick(null); } draw(); });
    input.addEventListener('keydown', (e) => {
      if (listEl.hidden) return;
      if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, matches.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && matches[hl]) { pick(matches[hl].id); e.preventDefault(); }
    });
    listEl.addEventListener('mousedown', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) { e.preventDefault(); pick(b.dataset.id); }
    });
    input.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; if (!selected) input.value = input.value; }, 120));
    return { get: () => (selected ? itemById(selected.id) || selected : null), set: (id) => pick(id) };
  }

  /* ======================= pages ======================= */
  /* ======================= العدسات الخمس ======================= */
  const LENS = [['d', 'اليوم', 'التشغيل'], ['w', 'الأسبوع', 'التنفيذ'], ['m', 'الشهر', 'المطابقة'], ['q', 'الربع', 'المواسم والاتجاه'], ['y', 'السنة', 'الاستراتيجية']];
  const LADDER = ['موجود', 'معروف', 'مطلوب', 'مقيس', 'مُدار'];
  function lensHome(L, hl, auto) {
    const pc = (a, b) => (Number(b) > 0 ? Math.round(((Number(a) - Number(b)) / Number(b)) * 100) : null);
    const chip = (v, txt) => v == null ? '' : `<em class="lz-d ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}٪ ${txt}</em>`;
    const tile = (lbl, val, sub = '', href = '', cls = '') => `<${href ? `a href="${href}"` : 'div'} class="lz-t ${cls}"><span>${lbl}</span><b class="num">${val}</b>${sub ? `<small>${sub}</small>` : ''}</${href ? 'a' : 'div'}>`;
    const todo = (items) => items.filter(Boolean).length ? `<div class="lz-todo">${items.filter(Boolean).map(([t, h, c]) => `<a href="${h}" class="${c || ''}">${t}<i>←</i></a>`).join('')}</div>` : '<div class="lz-todo"><span class="lz-ok">كل شي تمام في هالعدسة 🤍</span></div>';
    let body = '';
    if (hl === 'd') {
      const d = L.d, lists = d.lists || [];
      body = `<div class="lz-grid">${tile('مواعيد اليوم', d.appts, d.left ? `باقي ${d.left}` : 'خلصت مواعيد اليوم', '#/appts')}
        ${lists.filter((x) => x.kind !== 'weekly').map((x) => tile(x.name, `${x.done}/${x.total}`, x.done >= x.total && x.total ? 'مكتملة ✓' : 'لسه', '#/ops', x.done >= x.total && x.total ? 'ok' : '')).join('')}
        ${tile('حجوزات موقع معلّقة', d.web_pending, 'تنتظر الدفع', '#/sales', d.web_pending ? 'warn' : '')}</div>
        ${todo([d.complaints && [`${d.complaints} شكوى مفتوحة، ردّوا عليها اليوم`, '#/feedback', 'bad'], d.maint && [`${d.maint} عطل مفتوح`, '#/assets?t=maint', 'warn'], d.web_pending && [`${d.web_pending} حجز من الموقع ما دفع، تواصلوا معهن`, '#/sales', 'warn']])}`;
    } else if (hl === 'w') {
      const w = L.w, p = w.posts || {}, k = w.kpi || {}, kp = w.kpi_prev || {};
      body = `<div class="lz-grid">${tile('مبيعات الأسبوع', sar(k.sales), chip(pc(k.sales, kp.sales), 'عن نفس الوقت الأسبوع الماضي'), '#/sales?l=w')}
        ${tile('محتوى الأسبوع', `${p.posted || 0}/${p.n || 0}`, p.n ? 'منشور من المخطط' : 'ما فيه محتوى مخطط', '#/marketing?t=content', p.n ? '' : 'warn')}
        ${tile('محجوز للأسبوع الجاي', sar(w.next7?.v), `${w.next7?.n || 0} حجز`, '#/appts')}
        ${tile('عميلات جدد', k.new_clients || 0, 'هالأسبوع', '#/sales?l=w&tab=clients')}</div>
        ${todo([!p.n && ['خططوا ٣ منشورات للأسبوع، الكاتب الذكي يعطيكم أفكار جاهزة', '#/marketing?t=writer'], p.ready && [`${p.ready} منشور ينتظر اعتمادكم`, '#/marketing?t=content', 'warn'], p.late && [`${p.late} منشور فات موعده`, '#/marketing?t=content', 'bad'], w.leaves && [`${w.leaves} طلب إجازة ينتظر`, '#/team', 'warn']])}`;
    } else if (hl === 'm') {
      const m = L.m, k = m.kpi || {}, kp = m.kpi_prev || {}, T = Number(m.target || 0), fc = m.day ? Math.round((Number(k.sales) / Math.max(1, m.day - 0.5)) * m.days) : 0;
      body = `<div class="lz-grid">${tile('مبيعات الشهر', sar(k.sales), chip(pc(k.sales, kp.sales), 'عن نفس الوقت الشهر الماضي'), '#/sales?l=m')}
        ${tile(T ? 'من هدف الشهر' : 'المتوقع لنهاية الشهر', T ? `${Math.round((Number(k.sales) / T) * 100)}٪` : sar(fc), T ? `الهدف ${sar(T)} · المتوقع ${sar(fc)}` : 'على المعدل الحالي', '#/sales?l=m')}
        ${tile('تقييمات الشهر', m.reviews?.n ? `★ ${m.reviews.avg}` : '—', m.reviews?.n ? `${m.reviews.n} تقييم${m.reviews.low ? ` · ${m.reviews.low} أقل من ٤` : ''}` : 'لسه ما فيه', '#/site?t=reviews', m.reviews?.low ? 'warn' : '')}
        ${tile('عميلات جدد', k.new_clients || 0, chip(pc(k.new_clients, kp.new_clients), ''), '#/sales?l=m&tab=clients')}</div>
        ${todo([!T && ['حطّوا هدف للشهر عشان نقيس عليه', '#/sales?l=m'], !m.campaigns && ['ما فيه حملة شغالة هالشهر', '#/marketing?t=campaigns', 'warn'], m.reviews?.low && [`${m.reviews.low} تقييم منخفض، شوفوا وش صار`, '#/site?t=reviews&f=low', 'bad']])}`;
    } else if (hl === 'q') {
      const qq = L.q, k = qq.kpi || {}, ly = qq.kpi_ly, se = qq.seasons || [];
      body = `<div class="lz-grid">${tile('مبيعات الربع', sar(k.sales), ly ? chip(pc(k.sales, ly.sales), 'عن نفس الوقت السنة الماضية') : 'أول ربع نقارنه', '#/sales?l=q')}
        ${tile('عميلات الربع', k.clients || 0, `منهم ${k.new_clients || 0} جدد`, '#/sales?l=q&tab=clients')}</div>
        <div class="lz-seasons">${se.length ? se.map((x) => { const st = x.campaign ? ['ok', 'حملته جاهزة'] : x.in <= x.prep ? ['bad', 'دخلتوا وقت التجهيز وما فيه حملة'] : ['', `التجهيز يبدأ بعد ${x.in - x.prep} يوم`]; return `<a href="#/marketing" class="lz-se ${st[0]}"><span class="e">${esc(x.emoji || '✦')}</span><div><b>${esc(x.name)}</b><small>${st[1]}</small></div><span class="in num">${x.in}<small>يوم</small></span></a>`; }).join('') : '<div class="muted">ما فيه مواسم في الـ١٠٠ يوم الجاية</div>'}</div>`;
    } else {
      const y = L.y, lad = L.ladder || { level: 0, crit: [] }, nxt = Math.min(5, lad.level + 1);
      const miss = lad.crit.filter((c) => c.lv === nxt && !c.ok);
      const mx = Math.max(1, ...y.months.map((x) => Number(x.v)));
      body = `<div class="lz-ladder"><div class="lz-steps">${LADDER.map((n, i) => `<div class="${i < lad.level ? 'done' : i === lad.level ? 'next' : ''}"><i>${i + 1}</i><span>${n}</span></div>`).join('')}</div>
          <p>${lad.level ? `تسويقكم في درجة <b>«${LADDER[lad.level - 1]}»</b>.` : 'تسويقكم قبل الدرجة الأولى.'} ${lad.level < 5 ? `عشان تصعدون إلى <b>«${LADDER[nxt - 1]}»</b> ينقصكم:` : 'وصلتوا أعلى درجة 🤍'}</p>
          ${miss.length ? `<div class="lz-todo">${miss.map((c) => `<a href="${c.go}">${esc(c.t)}<i>←</i></a>`).join('')}</div>` : ''}</div>
        <div class="lz-grid">${tile('عميلات السنة', y.clients, `${Math.round((y.returning / Math.max(1, y.clients)) * 100)}٪ رجعوا أكثر من مرة`, '#/sales?l=y&tab=clients')}</div>
        <div class="lz-bars">${y.months.slice(-12).map((x) => `<div title="${x.m}: ${sar(x.v)} ر.س"><i style="height:${Math.max(4, (Number(x.v) / mx) * 100)}%"></i><span>${MONTHS_AR[Number(x.m.slice(5)) - 1].slice(0, 3)}</span></div>`).join('')}</div>`;
    }
    const cur = LENS.find((x) => x[0] === hl);
    return `<section class="lz">
      <div class="lens lz-bar"><span class="lz-ind" aria-hidden="true"></span>${LENS.map(([k, l]) => `<a href="#/home?l=${k}" class="${k === hl ? 'on' : ''}">${l}${k === auto ? '<i class="lz-auto" title="عدسة هالوقت"></i>' : ''}</a>`).join('')}</div>
      <div class="lz-card"><div class="lz-h"><span class="lz-eb">عدسة ${cur[1]}</span><h3>${cur[2]}</h3></div>${body}</div>
    </section>`;
  }

  async function pageHome(view, _a, _p, alive) {
    const low = S.items.filter((i) => i.is_active && isLow(i));
    const pendingUsers = isAdmin() ? [...S.profiles.values()].filter((p) => !p.is_active && !p.approved_at).length : 0;
    const hello = (S.profile.full_name || '').split(' ')[0];
    const tk = todayR();
    const dayStart = new Date(tk + 'T00:00:00+03:00'), dayEnd = new Date(dayStart.getTime() + 86400000);
    // العدسة تنفتح لحالها حسب الوقت، ولو اخترتوا وحدة تبقى لين نهاية اليوم
    const autoLens = () => { const t = D(tk), dd = t.getDate(), mo = t.getMonth(), wd = t.getDay(); if (mo === 0 && dd <= 7) return 'y'; if (mo % 3 === 0 && dd <= 5) return 'q'; if (dd <= 3) return 'm'; if (wd === 6) return 'w'; return 'd'; };
    let hl = _p.get('l') || (() => { try { return sessionStorage.getItem('bf-lens-' + tk); } catch { return null; } })() || autoLens();
    if (!['d', 'w', 'm', 'q', 'y'].includes(hl)) hl = 'd';
    if (_p.get('l')) { try { sessionStorage.setItem('bf-lens-' + tk, hl); } catch {} }
    const [hs, he] = lensRange(hl, D(tk)), [ms0, me0] = lensRange('m', D(tk));
    const yday = dk(lensShift('d', D(tk), -1));
    const M = isManager(), cnt = (pr) => pr.then((x) => x.count || 0, () => 0);
    // كل الطلبات مع بعض بدل وحدة ورا الثانية
    const lzP = M ? q(sb.rpc('biz_lens')).catch(() => null) : Promise.resolve(null);
    let LZ = null;
    const [expiring, drafts, moves, bkTd, bkPd, bkNx, spA, spB, spR, _lz0, fr, tg, yc, cl, ocN, Ly, tpv, tms, tlv, mr, mIss, mPl, me] = await Promise.all([
      q(sb.rpc('get_expiring', { p_days: CFG.expiryWarningDays })).catch(() => []),
      q(sb.from('purchase_invoices').select('id', { count: 'exact', head: false }).eq('status', 'draft')).catch(() => []),
      q(sb.from('stock_movements').select('id,item_id,movement_type,qty,reason,created_by,created_at').order('created_at', { ascending: false }).limit(8)).catch(() => []),
      q(sb.from('home_bookings').select('id,customer_name,starts_at,status').gte('starts_at', dayStart.toISOString()).lt('starts_at', dayEnd.toISOString()).neq('status', 'cancelled').order('starts_at')).catch(() => []),
      cnt(sb.from('home_bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      q(sb.from('home_bookings').select('id,customer_name,starts_at,district_name').gte('starts_at', new Date().toISOString()).in('status', ['pending', 'confirmed']).order('starts_at').limit(1)).catch(() => []),
      cnt(sb.from('salon_bookings').select('id', { count: 'exact', head: true }).gte('starts_at', dayStart.toISOString()).lt('starts_at', dayEnd.toISOString()).not('status', 'in', '(cancelled,no_show)')),
      cnt(sb.from('salon_bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending').gte('starts_at', new Date().toISOString())),
      cnt(sb.from('rekaz_reservations').select('id', { count: 'exact', head: true }).gte('start_at', dayStart.toISOString()).lt('start_at', dayEnd.toISOString()).not('status', 'ilike', '%cancel%')),
      null,
      M ? q(sb.rpc('fin_range', { p_from: dk(hs), p_to: dk(he) })).catch(() => null) : null,
      M ? q(sb.from('fin_targets').select('revenue').eq('month', monthKey(D(tk))).maybeSingle()).catch(() => null) : null,
      M ? q(sb.from('fin_daily').select('day').eq('day', yday).maybeSingle()).catch(() => 'x') : 'x',
      q(sb.from('clients_overview').select('id,name,phone,birthday,segment,stamps,last_visit').limit(3000)).catch(() => []),
      cnt(sb.from('client_feedback').select('id', { count: 'exact', head: true }).eq('kind', 'complaint').eq('status', 'open')),
      loyalty().catch(() => ({ active: false })),
      M ? q(sb.from('team_private').select('*')).catch(() => []) : [],
      M ? q(sb.from('team_members').select('id,name,active')).catch(() => []) : [],
      M ? cnt(sb.from('team_leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : 0,
      M && hl !== 'm' ? q(sb.rpc('fin_range', { p_from: dk(ms0), p_to: dk(me0) })).catch(() => null) : null,
      q(sb.from('maint_issues').select('id,title,created_at').eq('status', 'open')).catch(() => []),
      q(sb.from('maint_plans').select('*')).catch(() => []),
      q(sb.from('team_members').select('*').eq('profile_id', S.profile.id).maybeSingle()).catch(() => null),
    ]);
    if (!alive()) return;
    const bk = { today: bkTd, pending: bkPd, next: bkNx[0] || null };
    const sp = { today: spA + spR, pending: spB };
    const oc = { count: ocN }, L = Ly;
    let mrev = null;
    if (M && tg && hl !== 'm') mrev = mr?.revenue;
    else if (fr && hl === 'm') mrev = fr.revenue;
    if (!alive()) return;
    const soon = (c) => { if (!c.birthday) return null; const b = D(c.birthday); const t = D(tk); let n = new Date(t.getFullYear(), b.getMonth(), b.getDate(), 12); if (n < t) n = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate(), 12); const d = Math.round((n - t) / 86400000); return d <= 7 ? d : null; };
    const bdays = cl.map((c) => [c, soon(c)]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
    const ready = L.active ? cl.filter((c) => c.stamps >= L.stamps).length : 0;
    const away = cl.filter((c) => c.segment === 'away').length;
    const alerts = [];
    if (sp.pending) alerts.push(['warn', I.cal, sp.pending === 1 ? 'حجز من الموقع بانتظار التأكيد' : `${sp.pending} حجوزات من الموقع بانتظار التأكيد`, 'أرسلوا التأكيد على الواتساب', '#/appts?t=pending']);
    if (sp.today) alerts.push(['', I.cal, `${sp.today === 1 ? 'موعد واحد' : sp.today + ' مواعيد'} في الصالون اليوم`, 'جدول اليوم', '#/appts']);
    if (isManager()) { try { const rc = JSON.parse(localStorage.getItem('bf-rules') || 'null'); if (rc && rc.risk) alerts.unshift(['danger', I.shield, `${rc.risk === 1 ? 'قاعدة وحدة' : rc.risk + ' قواعد'} في خطر`, `صحة بيوتفريش ${rc.score}٪`, '#/rules']); else if (!rc) alerts.push(['', I.shield, 'افحصوا صحة بيوتفريش', 'قواعد تنفحص على بيانات الصالون', '#/rules']); } catch {} }
    const mLate = mPl.filter((p) => planSt(p) === 'bad').length;
    if (mIss.length) alerts.push([mIss.some((i) => (Date.now() - new Date(i.created_at)) / 86400000 > 3) ? 'danger' : 'warn', I.wrench, mIss.length === 1 ? `عطل مفتوح: ${esc(mIss[0].title.slice(0, 40))}` : `${mIss.length} أعطال مفتوحة`, 'تابعوا إصلاحها', '#/assets?t=maint']);
    if (mLate) alerts.push(['warn', I.wrench, `${mLate === 1 ? 'مهمة صيانة' : mLate + ' مهام صيانة'} فات موعدها`, 'الأصول والصيانة', '#/assets?t=maint']);
    if (tlv) alerts.push(['warn', I.users, tlv === 1 ? 'طلب إجازة بانتظار اعتمادك' : `${tlv} طلبات إجازة بانتظار اعتمادك`, 'اعتمدوها أو ردّوا عليها', '#/team?t=leaves']);
    tpv.forEach((p) => { const m = tms.find((x) => x.id === p.member_id && x.active); if (!m) return; docState(p).forEach((d) => alerts.push([d.cls, I.key, docTxt(d), esc(m.name), `#/member/${m.id}`])); });
    if (oc.count) alerts.push(['danger', I.heart, `${oc.count === 1 ? 'شكوى مفتوحة' : oc.count + ' شكاوى مفتوحة'}`, 'ردّوا عليها وسجّلوا الحل', '#/feedback?t=open']);
    bdays.slice(0, 3).forEach(([c, d]) => alerts.push(['gold', '🎂', `ميلاد ${esc(firstName(c.name))} ${d === 0 ? 'اليوم' : d === 1 ? 'بكرة' : d === 2 ? 'بعد يومين' : `بعد ${d} أيام`}`, 'رسالة تهنئة صغيرة تفرق', `#/client/${c.id}`]));
    if (ready) alerts.push(['ok', `<img src="${ROSETTE}" alt="">`, `${ready === 1 ? 'عميلة وصلت' : ready + ' عميلات وصلوا'} لمكافأة الولاء`, 'بلغوهم عشان يستلمونها', '#/clients?s=reward']);
    if (away) alerts.push(['', I.heart, `${away} ${away === 1 ? 'عميلة غابت' : away <= 10 ? 'عميلات غابوا' : 'عميلة غابوا'} أكثر من ٤٥ يوم`, 'رسالة «وحشتينا» ممكن ترجّعهم', '#/clients?s=away']);
    const HL = { d: 'اليوم', w: 'الأسبوع', m: 'الشهر', q: 'الربع', y: 'السنة' };
    const fdelta = fr && fr.prev_revenue > 0 ? Math.round(((fr.revenue - fr.prev_revenue) / fr.prev_revenue) * 100) : null;
    const tpct = tg && mrev != null ? Math.min(100, (mrev / Number(tg.revenue)) * 100) : null;
    const pulse = !fr ? '' : `<div class="pulse">
        <a class="pulse-body" href="#/sales?l=${hl}&at=${tk}">
          <div><span>مبيعات ${hl === 'd' ? 'اليوم' : hl === 'y' ? 'هذي السنة' : 'هذا ' + HL[hl]}</span><b class="num">${sar(fr.revenue)}</b>${fdelta != null ? `<em class="${fdelta >= 0 ? 'up' : 'down'}">${fdelta >= 0 ? '▲' : '▼'} ${Math.abs(fdelta)}٪</em>` : ''}</div>
          <div><span>صافي الربح</span><b class="num">${sar(fr.net)}</b></div>
          ${tpct != null ? `<div class="pulse-ring" style="--p:${tpct}"><b class="num">${Math.round(tpct)}٪</b><span>من هدف الشهر</span></div>` : `<div class="pulse-ring empty"><span>حطّوا هدف للشهر</span></div>`}
        </a>
      </div>`;
    // ورديتي: لأي حساب مربوط بملف في الفريق
    let myShift = '';
    if (me) {
      const wdN = D(tk).getDay();
      const [sh, lv, gds, rds, lists, litems, runs, myBk] = await Promise.all([
        q(sb.from('team_shifts').select('*').eq('member_id', me.id)).catch(() => []),
        q(sb.from('team_leaves').select('*').eq('member_id', me.id).gte('to_day', tk).order('from_day')).catch(() => []),
        q(sb.from('guides').select('id,title,version')).catch(() => []),
        q(sb.from('guide_reads').select('*').eq('profile_id', S.profile.id)).catch(() => []),
        q(sb.from('ops_lists').select('*').order('sort')).catch(() => []),
        q(sb.from('ops_list_items').select('id,list_id')).catch(() => []),
        q(sb.from('ops_runs').select('*').eq('day', tk)).catch(() => []),
        q(sb.from('home_bookings').select('id,customer_name,starts_at,district_name,status').eq('staff_id', S.profile.id).gte('starts_at', new Date(tk + 'T00:00:00+03:00').toISOString()).lt('starts_at', new Date(tk + 'T23:59:59+03:00').toISOString()).neq('status', 'cancelled').order('starts_at')).catch(() => []),
      ]);
      if (!alive()) return;
      const todayS = sh.find((x) => x.weekday === wdN); const offToday = lv.find((l) => l.status === 'approved' && l.from_day <= tk && l.to_day >= tk);
      const nextS = !todayS ? [1, 2, 3, 4, 5, 6, 7].map((i) => lensShift('d', D(tk), i)).find((d) => sh.some((x) => x.weekday === d.getDay())) : null;
      const unsigned = gds.filter((g) => !rds.some((r) => r.guide_id === g.id && r.version === g.version));
      const daily = lists.filter((l) => l.kind !== 'weekly').map((l) => { const n = litems.filter((i) => i.list_id === l.id).length; const d = Object.keys(runs.find((r) => r.list_id === l.id)?.done || {}).length; return [l, d, n]; });
      const pend = lv.filter((l) => l.status === 'pending');
      myShift = `<div class="myshift" style="--c:${me.color}">
        <div class="ms-top"><span class="tm-av sm">${esc(initial(me.name))}</span><div class="grow"><span class="sh-eyebrow">ورديتي</span><b>${offToday ? 'إجازة اليوم 🤍' : todayS ? `اليوم ${h12(todayS.starts)} – ${h12(todayS.ends)}` : 'ما عندك دوام اليوم'}</b>${!todayS && nextS ? `<span>دوامك الجاي ${WDAYS[nextS.getDay()]} ${h12(sh.find((x) => x.weekday === nextS.getDay()).starts)}</span>` : ''}</div></div>
        ${todayS && !offToday ? `<div class="ms-lists">${daily.map(([l, d, n]) => `<a href="#/ops" class="${d === n && n ? 'done' : ''}"><span>${esc(l.name)}</span><b class="num">${d}/${n}</b></a>`).join('')}</div>` : ''}
        ${myBk.length ? `<div class="ms-bk"><span>حجوزاتك المنزلية اليوم</span>${myBk.map((b) => `<a href="#/booking/${b.id}"><b class="num">${rTime(b.starts_at)}</b> ${esc(b.customer_name)}${b.district_name ? ` · ${esc(b.district_name)}` : ''}</a>`).join('')}</div>` : ''}
        ${unsigned.length ? `<a class="ms-row" href="#/ops?t=manual">📖 ${unsigned.length === 1 ? `دليل «${esc(unsigned[0].title)}» بانتظار توقيعك` : `${unsigned.length} أدلة بانتظار توقيعك`}</a>` : ''}
        ${pend.length ? `<a class="ms-row" href="#/member/${me.id}">⏳ طلب إجازتك ${dShort(pend[0].from_day)} بانتظار الاعتماد</a>` : ''}
        <div class="ms-acts"><button class="btn sm" id="ms-issue">${I.wrench} بلّغ عن عطل</button><button class="btn sm" id="ms-leave">${I.cal} طلب إجازة</button></div>
      </div>`;
    }
    const alertsHtml = alerts.length ? `<div class="section-title"><h2>يحتاج انتباهك</h2></div><div class="alerts">${alerts.map(([c, ic, t, sub, h]) => `<a class="alert ${c}" href="${h}"><span class="al-ic">${ic}</span><div><b>${t}</b><span>${sub}</span></div></a>`).join('')}</div>` : '';
    const hourNow = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }));
    const greet = hourNow >= 4 && hourNow < 12 ? 'صباح الخير' : 'مساء الخير';
    view.innerHTML = `
      <div class="hello"><div><span class="eyebrow">${greet}</span><h2>${esc(hello || 'أهلًا')}</h2></div><img src="../home/assets/rosette-1.svg" alt=""></div>
      ${M ? `<section class="lz" id="lz-slot"><div class="lens lz-bar">${LENS.map(([k, l]) => `<a class="${k === hl ? 'on' : ''}">${l}</a>`).join('')}</div><div class="lz-card lz-skel"><span></span><span></span><span></span></div></section>` : ''}
      <a class="tour-banner" href="#/tour"><div class="tb-txt"><span>جديد في بيوتفريش ✦</span><b>جولة في كل المميزات</b><small>٢٢ ميزة، وحدة وحدة، في خمس دقايق</small></div><span class="tb-play">▶</span><img src="../home/assets/rosette-3.svg" alt=""></a>
      ${isManager() ? `<a class="tour-banner nq" href="#/naqla"><div class="tb-txt"><span>قبل وبعد ✦</span><b>نقلة بيوتفريش</b><small>الحجز من ركاز إلى موقعنا: المقارنة كاملة</small></div><span class="tb-play">▶</span><img src="../home/assets/rosette-1.svg" alt=""></a>` : ''}
      ${myShift}
      ${pulse}
      ${alertsHtml}
      <a class="bk-card" href="#/bookings${bk.pending ? '?t=pending' : '?t=today'}">
        <div class="bk-top"><span class="bk-label">الحجوزات المنزلية</span><span class="bk-go">عرض الحجوزات ←</span></div>
        <div class="bk-nums">
          <div><b class="num">${bk.today.length}</b><span>حجوزات اليوم</span></div>
          <div class="${bk.pending ? 'hot' : ''}"><b class="num">${bk.pending}</b><span>بانتظار التأكيد</span></div>
        </div>
        <div class="bk-next">${bk.next ? `الموعد الجاي: <b>${esc(bk.next.customer_name)}</b> · ${esc(fmtDateTime(bk.next.starts_at))}${bk.next.district_name ? ' · ' + esc(bk.next.district_name) : ''}` : 'ما فيه مواعيد قادمة'}</div>
      </a>
      <div class="section-title"><h2>المخزون</h2></div>
      <div id="push-home"></div>
      ${pendingUsers ? `<a class="notice info" style="display:block" href="#/users">يوجد ${pendingUsers} ${pendingUsers === 1 ? 'طلب تسجيل' : 'طلبات تسجيل'} بانتظار اعتمادك ←</a>` : ''}
      <div class="stats">
        <a class="stat danger" href="#/shopping"><div class="label">أصناف ناقصة</div><div class="value num">${low.length}</div></a>
        <a class="stat warn" href="#expiring"><div class="label">تقرب صلاحيتها تنتهي</div><div class="value num">${expiring.length}</div></a>
        <a class="stat accent" href="#/invoices"><div class="label">${isAdmin() ? 'فواتير بانتظار الاعتماد' : 'فواتير مسودة'}</div><div class="value num">${drafts.length}</div></a>
        <a class="stat" href="#/items"><div class="label">الأصناف النشطة</div><div class="value num">${S.items.filter((i) => i.is_active).length}</div></a>
      </div>

      <div class="actions mt">
        <a class="btn primary" href="#/issue">${I.out.replace('<svg', '<svg width="18" height="18"')} صرف من المخزون</a>
        <a class="btn" href="#/invoice/new">${I.plus} فاتورة شراء</a>
      </div>

      <div class="section-title"><h2>أصناف وصلت للحد الأدنى</h2><a href="#/shopping" class="small">قائمة المشتريات</a></div>
      <div class="list">${low.length ? low.slice(0, 8).map(itemRow).join('') : '<div class="empty">كل الأصناف فوق الحد الأدنى</div>'}</div>

      <div class="section-title" id="expiring"><h2>تقرب صلاحيتها تنتهي (${CFG.expiryWarningDays} يوم)</h2></div>
      <div class="list">${expiring.length ? expiring.map((x) => {
        const days = Math.ceil((new Date(x.expiry_date) - new Date(today())) / 86400000);
        const cls = days < 0 ? 'danger' : days <= 14 ? 'warn' : 'gold';
        const txt = days < 0 ? `انتهت منذ ${-days} يوم` : days === 0 ? 'تنتهي اليوم' : `بعد ${days} يوم`;
        return `<a class="row" href="#/item/${x.item_id}"><div class="grow"><div class="title">${esc(x.item_name)}</div><div class="meta">تاريخ الانتهاء ${fmtDate(x.expiry_date)} · الرصيد ${num(x.qty_on_hand)}</div></div><span class="badge ${cls}">${txt}</span></a>`;
      }).join('') : '<div class="empty">لا توجد منتجات تقرب صلاحيتها من الانتهاء</div>'}</div>

      <div class="section-title"><h2>${isManager() ? 'آخر الحركات' : 'آخر حركاتك'}</h2><a href="#/movements" class="small">السجل الكامل</a></div>
      <div class="list">${moves.length ? moves.map(moveRow).join('') : '<div class="empty">لا توجد حركات بعد</div>'}</div>`;
    renderPushCard($('#push-home'), { compact: true });
    $('#ms-issue')?.addEventListener('click', async () => issueForm(await q(sb.from('assets').select('id,name,category,location').order('name')).catch(() => []), null));
    $('#ms-leave')?.addEventListener('click', async () => leaveForm(await teamData()));
    const expLink = $('a[href="#expiring"]', view);
    expLink.addEventListener('click', (e) => { e.preventDefault(); $('#expiring').scrollIntoView({ behavior: 'smooth' }); });
    // العدسات تتحمّل بعد ما تطلع الصفحة، والتبديل بينها فوري
    LZ = await lzP;
    if (!alive()) return;
    const slot = $('#lz-slot', view);
    if (slot && !LZ) slot.remove();
    if (slot && LZ) {
      const tmp0 = document.createElement('div'); tmp0.innerHTML = lensHome(LZ, hl, autoLens()); slot.replaceWith(tmp0.firstElementChild);
      const pulseFor = async (k) => {
        const pb = $('.pulse-body', view); if (!pb) return;
        pb.classList.add('lz-busy');
        const [a, b] = lensRange(k, D(tk));
        const f = await q(sb.rpc('fin_range', { p_from: dk(a), p_to: dk(b) })).catch(() => null);
        if (!f || !pb.isConnected) return;
        const dl = f.prev_revenue > 0 ? Math.round(((f.revenue - f.prev_revenue) / f.prev_revenue) * 100) : null;
        const [c1, c2] = pb.children;
        c1.innerHTML = `<span>مبيعات ${k === 'd' ? 'اليوم' : k === 'y' ? 'هذي السنة' : 'هذا ' + HL[k]}</span><b class="num">${sar(f.revenue)}</b>${dl != null ? `<em class="${dl >= 0 ? 'up' : 'down'}">${dl >= 0 ? '▲' : '▼'} ${Math.abs(dl)}٪</em>` : ''}`;
        c2.innerHTML = `<span>صافي الربح</span><b class="num">${sar(f.net)}</b>`;
        pb.setAttribute('href', `#/sales?l=${k}&at=${tk}`); pb.classList.remove('lz-busy');
      };
      const bar = $('.lz-bar', view), ind = $('.lz-ind', bar);
      const place = (anim) => { const a = $('a.on', bar); if (!a) return; ind.style.transition = anim ? '' : 'none'; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft}px)`; if (!anim) { void ind.offsetWidth; ind.style.transition = ''; } };
      requestAnimationFrame(() => place(false)); document.fonts?.ready.then(() => place(false));
      window.addEventListener('resize', () => place(false), { passive: true });
      const order = LENS.map((x) => x[0]);
      $$('a', bar).forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        const k = new URLSearchParams(a.getAttribute('href').split('?')[1]).get('l');
        if (k === hl) return;
        const dir = order.indexOf(k) > order.indexOf(hl) ? 1 : -1;
        hl = k; try { sessionStorage.setItem('bf-lens-' + tk, k); } catch {}
        history.replaceState(null, '', `#/home?l=${k}`);
        $$('a', bar).forEach((x) => x.classList.toggle('on', x === a)); place(true);
        const card = $('.lz-card', view), h0 = card.offsetHeight;
        const tmp = document.createElement('div'); tmp.innerHTML = lensHome(LZ, k, autoLens());
        const nc = $('.lz-card', tmp);
        card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 24}px)` }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).onfinish = () => {
          card.replaceWith(nc); nc.style.animation = 'none';
          const h1 = nc.offsetHeight;
          nc.animate([{ opacity: 0, transform: `translateX(${-dir * 24}px)`, height: h0 + 'px' }, { opacity: 1, transform: 'none', height: h1 + 'px' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
        };
        pulseFor(k);
      }));
    }
  }

  function itemRow(i) {
    const low = isLow(i);
    const cost = isManager() ? S.costs.get(i.id) : null;
    return `<a class="row" href="#/item/${i.id}">
      <div class="grow">
        <div class="title">${esc(i.name)} ${i.is_active ? '' : '<span class="badge">موقوف</span>'}</div>
        <div class="meta">${esc(catName(i.category_id))} · الحد الأدنى ${num(i.min_qty)}${cost && Number(cost.avg_cost) ? ` · ${money(cost.avg_cost)}` : ''}</div>
      </div>
      <div class="end"><div class="qty num ${low ? 'low' : ''}">${num(i.qty_on_hand)} <small>${esc(i.unit)}</small></div></div>
    </a>`;
  }

  function moveRow(m) {
    const it = itemById(m.item_id);
    const sign = Number(m.qty) > 0 ? '+' : '−';
    return `<div class="row">
      <div class="grow">
        <div class="title">${esc(it?.name || 'صنف')}</div>
        <div class="meta">${esc(personName(m.created_by))} · ${fmtDateTime(m.created_at)}${m.reason ? ` · ${esc(m.reason)}` : ''}</div>
      </div>
      <div class="end"><span class="badge ${MOVE_BADGE[m.movement_type]}">${MOVE_LABEL[m.movement_type]}</span>
        <div class="num" dir="ltr" style="font-weight:700;margin-top:4px;color:${Number(m.qty) > 0 ? 'var(--ok)' : 'var(--ink)'}">${sign}${num(Math.abs(m.qty))}</div></div>
    </div>`;
  }

  /* ---------- items ---------- */
  let itemsFilter = { q: '', cat: 'all' };
  async function pageItems(view) {
    await reloadItems();
    view.innerHTML = `
      <div class="toolbar">
        <input class="input" type="search" id="item-q" placeholder="بحث باسم الصنف…" value="${esc(itemsFilter.q)}">
        ${isAdmin() ? `<button class="btn primary" id="item-new">${I.plus} صنف جديد</button>` : ''}
      </div>
      <div class="chips" id="cat-chips"></div>
      <div class="list" id="items-list"></div>`;
    const chips = [{ id: 'all', name: 'الكل' }, { id: 'low', name: 'ناقصة' }, ...S.categories, ...(isAdmin() ? [{ id: 'inactive', name: 'موقوفة' }] : [])];
    const drawChips = () => {
      $('#cat-chips').innerHTML = chips.map((c) => `<button class="chip ${String(itemsFilter.cat) === String(c.id) ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('');
    };
    const draw = () => {
      const t = itemsFilter.q.trim();
      let list = S.items.filter((i) => !t || i.name.includes(t));
      if (itemsFilter.cat === 'inactive') list = list.filter((i) => !i.is_active);
      else {
        list = list.filter((i) => i.is_active);
        if (itemsFilter.cat === 'low') list = list.filter(isLow);
        else if (itemsFilter.cat !== 'all') list = list.filter((i) => String(i.category_id) === String(itemsFilter.cat));
      }
      $('#items-list').innerHTML = list.length ? list.map(itemRow).join('')
        : `<div class="empty">${S.items.length ? 'لا توجد أصناف مطابقة' : (isAdmin() ? 'لا توجد أصناف بعد. ابدأ بإضافة أول صنف.' : 'لا توجد أصناف بعد')}</div>`;
    };
    drawChips(); draw();
    $('#item-q').addEventListener('input', (e) => { itemsFilter.q = e.target.value; draw(); });
    $('#cat-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      itemsFilter.cat = b.dataset.cat; drawChips(); draw();
    });
    if (isAdmin()) $('#item-new').onclick = () => itemForm(null, () => route());
  }

  function itemForm(item, after) {
    const it = item || { name: '', category_id: S.categories[0]?.id || null, unit: 'حبة', min_qty: 0, track_expiry: false, is_active: true, notes: '' };
    modal(`
      <h3>${item ? 'تعديل الصنف' : 'صنف جديد'}</h3>
      <form id="item-form">
        <div class="field"><label>اسم الصنف</label><input class="input" name="name" required value="${esc(it.name)}" placeholder="مثال: صبغة لوريال 6.0"></div>
        <div class="grid2">
          <div class="field"><label>الفئة</label><select class="input" name="category_id">
            <option value="">بدون فئة</option>
            ${S.categories.map((c) => `<option value="${c.id}" ${c.id === it.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
          <div class="field"><label>الوحدة</label>
            <select class="input" name="unit_sel" id="unit-sel">
              ${UNITS.map((u) => `<option value="${u}" ${u === it.unit ? 'selected' : ''}>${u}</option>`).join('')}
              <option value="__other" ${UNITS.includes(it.unit) ? '' : 'selected'}>أخرى…</option>
            </select>
            <input class="input" name="unit_other" id="unit-other" placeholder="اكتب الوحدة" style="margin-top:8px" value="${UNITS.includes(it.unit) ? '' : esc(it.unit)}" ${UNITS.includes(it.unit) ? 'hidden' : ''}></div>
        </div>
        <div class="field"><label>الحد الأدنى</label><input class="input num" name="min_qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(it.min_qty)}">
          <div class="hint">يظهر تنبيه وينضاف الصنف لقائمة المشتريات إذا وصل رصيده لهذا الحد.</div></div>
        <div class="field"><label class="check"><input type="checkbox" name="track_expiry" ${it.track_expiry ? 'checked' : ''}> تتبع تاريخ الصلاحية</label>
          <div class="hint">عند التفعيل يُطلب تاريخ الانتهاء مع كل فاتورة شراء لهذا الصنف.</div></div>
        ${item ? `<div class="field"><label class="check"><input type="checkbox" name="is_active" ${it.is_active ? 'checked' : ''}> الصنف نشط</label></div>` : ''}
        <div class="field"><label>ملاحظات</label><textarea class="input" name="notes">${esc(it.notes || '')}</textarea></div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">حفظ</button></div>
      </form>`, (el, close) => {
      $('#unit-sel', el).addEventListener('change', (e) => {
        const other = $('#unit-other', el);
        other.hidden = e.target.value !== '__other';
        if (!other.hidden) other.focus();
      });
      $('#item-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const unit = f.get('unit_sel') === '__other' ? String(f.get('unit_other') || '').trim() : f.get('unit_sel');
        if (!unit) return toast('اكتب الوحدة', true);
        const row = {
          name: f.get('name').trim(),
          category_id: f.get('category_id') ? Number(f.get('category_id')) : null,
          unit,
          min_qty: Number(f.get('min_qty') || 0),
          track_expiry: !!f.get('track_expiry'),
          notes: f.get('notes').trim() || null,
        };
        if (item) row.is_active = !!f.get('is_active');
        await busy($('button.primary', el), async () => {
          try {
            if (item) await q(sb.from('items').update(row).eq('id', item.id));
            else await q(sb.from('items').insert(row));
            await reloadItems();
            toast('تم حفظ الصنف'); close(); after && after();
          } catch (err) { toast(errMsg(err), true); }
        });
      });
    });
  }

  async function pageItem(view, [id]) {
    await reloadItems();
    const it = itemById(id);
    if (!it) { view.innerHTML = '<div class="notice danger">الصنف غير موجود</div>'; return; }
    setTitle(it.name);
    const moves = await q(sb.from('stock_movements').select('id,item_id,movement_type,qty,reason,created_by,created_at').eq('item_id', it.id).order('created_at', { ascending: false }).limit(50));
    const cost = S.costs.get(it.id);
    view.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div><h2 style="font-size:20px">${esc(it.name)}</h2><div class="muted small">${esc(catName(it.category_id))}</div></div>
          <div class="qty num ${isLow(it) ? 'low' : ''}" style="font-size:28px">${num(it.qty_on_hand)} <small>${esc(it.unit)}</small></div>
        </div>
        <dl class="kv mt">
          <dt>الحد الأدنى</dt><dd class="num">${num(it.min_qty)} ${esc(it.unit)}</dd>
          <dt>الحالة</dt><dd>${!it.is_active ? '<span class="badge">موقوف</span>' : isLow(it) ? '<span class="badge danger">ناقص</span>' : '<span class="badge ok">متوفر</span>'}</dd>
          <dt>تتبع الصلاحية</dt><dd>${it.track_expiry ? 'نعم' : 'لا'}</dd>
          ${isManager() && cost ? `<dt>متوسط التكلفة</dt><dd class="num">${money(cost.avg_cost)}</dd><dt>آخر سعر شراء</dt><dd class="num">${money(cost.last_cost)}</dd><dt>قيمة الرصيد</dt><dd class="num">${money(Number(cost.avg_cost) * Number(it.qty_on_hand))}</dd>` : ''}
          ${it.notes ? `<dt>ملاحظات</dt><dd style="font-weight:400">${esc(it.notes)}</dd>` : ''}
        </dl>
        <div class="actions mt">
          ${it.is_active ? `<a class="btn primary" href="#/issue?item=${it.id}">صرف من هذا الصنف</a>` : ''}
          ${isAdmin() ? '<button class="btn" id="edit-item">تعديل</button>' : ''}
        </div>
      </div>
      <div class="section-title"><h2>${isManager() ? 'حركات الصنف' : 'حركاتك على هذا الصنف'}</h2></div>
      <div class="list">${moves.length ? moves.map(moveRow).join('') : '<div class="empty">لا توجد حركات</div>'}</div>`;
    if (isAdmin()) $('#edit-item').onclick = () => itemForm(it, () => route());
  }

  /* ---------- issue ---------- */
  async function pageIssue(view, _a, params) {
    await reloadItems();
    let type = 'issue';
    view.innerHTML = `
      <div class="card" style="max-width:560px">
        <form id="issue-form">
          <div class="field"><label>نوع العملية</label>
            <div class="seg" id="type-seg">
              <button type="button" data-t="issue" class="on">صرف للاستخدام</button>
              <button type="button" data-t="damage">تالف</button>
              <button type="button" data-t="expired">منتهي الصلاحية</button>
            </div></div>
          <div class="field"><label>الصنف</label><div id="issue-picker"></div>
            <div class="hint" id="issue-stock"></div></div>
          <div class="field"><label>الكمية</label>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn" data-step="-1" style="width:52px">−</button>
              <input class="input num" id="issue-qty" type="number" inputmode="decimal" min="0" step="any" value="1" style="text-align:center">
              <button type="button" class="btn" data-step="1" style="width:52px">+</button>
            </div></div>
          <div class="field"><label id="reason-label">ملاحظة (اختياري)</label>
            <textarea class="input" id="issue-reason" placeholder="مثال: لعميلة صبغة كاملة"></textarea></div>
          <button class="btn primary block" id="issue-submit">تسجيل الصرف</button>
        </form>
      </div>`;
    const picker = itemPicker($('#issue-picker'), {
      value: params.get('item'),
      onPick: (it) => {
        $('#issue-stock').innerHTML = it ? `الرصيد الحالي: <b class="num">${num(it.qty_on_hand)} ${esc(it.unit)}</b>` : '';
      },
    });
    if (params.get('item')) picker.set(params.get('item'));
    const setType = (t) => {
      type = t;
      $$('#type-seg button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      const needs = t !== 'issue';
      $('#reason-label').textContent = needs ? 'السبب (مطلوب)' : 'ملاحظة (اختياري)';
      $('#issue-reason').placeholder = t === 'damage' ? 'مثال: انكسرت العبوة' : t === 'expired' ? 'مثال: انتهت الصلاحية قبل الاستخدام' : 'مثال: لعميلة صبغة كاملة';
      $('#issue-submit').textContent = t === 'issue' ? 'تسجيل الصرف' : t === 'damage' ? 'تسجيل التالف' : 'تسجيل المنتهي';
      $('#issue-submit').className = 'btn block ' + (t === 'issue' ? 'primary' : 'danger');
    };
    $('#type-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) setType(b.dataset.t); });
    $$('[data-step]', view).forEach((b) => b.addEventListener('click', () => {
      const inp = $('#issue-qty');
      inp.value = Math.max(1, Number(inp.value || 0) + Number(b.dataset.step));
    }));
    $('#issue-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const it = picker.get();
      const qty = Number($('#issue-qty').value);
      const reason = $('#issue-reason').value.trim();
      if (!it) return toast('اختر الصنف أولاً', true);
      if (!(qty > 0)) return toast('أدخل كمية صحيحة', true);
      if (type !== 'issue' && !reason) return toast('اكتب السبب', true);
      if (qty > Number(it.qty_on_hand)) return toast(`الرصيد المتاح ${num(it.qty_on_hand)} ${it.unit} فقط`, true);
      await busy($('#issue-submit'), async () => {
        try {
          await q(sb.rpc('record_outflow', { p_item_id: it.id, p_type: type, p_qty: qty, p_reason: reason || null }));
          await reloadItems();
          toast(`تم تسجيل ${MOVE_LABEL[type]}: ${num(qty)} ${it.unit} من ${it.name}`);
          $('#issue-qty').value = 1; $('#issue-reason').value = '';
          const fresh = itemById(it.id);
          $('#issue-stock').innerHTML = `الرصيد الحالي: <b class="num">${num(fresh.qty_on_hand)} ${esc(fresh.unit)}</b>`;
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  /* ---------- invoices ---------- */
  let invTab = 'draft';
  async function pageInvoices(view, _a, _p, alive) {
    const rows = await q(sb.from('purchase_invoices')
      .select('id,supplier_id,invoice_no,invoice_date,total_amount,status,created_by,created_at,purchase_invoice_lines(qty,unit_cost)')
      .order('created_at', { ascending: false }).limit(300));
    if (!alive()) return;
    view.innerHTML = `
      <div class="toolbar">
        <div class="seg" id="inv-tabs" style="flex:1;max-width:420px">
          <button data-tab="draft">المسودات</button><button data-tab="approved">المعتمدة</button><button data-tab="all">الكل</button>
        </div>
        <a class="btn primary" href="#/invoice/new">${I.plus} فاتورة جديدة</a>
      </div>
      ${!isManager() ? '<div class="notice info">تظهر هنا الفواتير التي أدخلتها. المخزون يتحدث بعد اعتماد مدير النظام للفاتورة.</div>' : ''}
      <div class="list" id="inv-list"></div>`;
    const draw = () => {
      $$('#inv-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === invTab));
      const list = rows.filter((r) => invTab === 'all' || r.status === invTab);
      $('#inv-list').innerHTML = list.length ? list.map((r) => {
        const sum = (r.purchase_invoice_lines || []).reduce((a, l) => a + Number(l.qty) * Number(l.unit_cost), 0);
        return `<a class="row" href="#/invoice/${r.id}">
          <div class="grow"><div class="title">${esc(supName(r.supplier_id))}</div>
            <div class="meta">${r.invoice_no ? `رقم ${esc(r.invoice_no)} · ` : ''}${fmtDate(r.invoice_date)} · ${(r.purchase_invoice_lines || []).length} بند · ${esc(personName(r.created_by))}</div></div>
          <div class="end"><span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span><div class="num small" style="margin-top:4px;font-weight:600">${money(sum)}</div></div>
        </a>`;
      }).join('') : `<div class="empty">${invTab === 'draft' ? 'لا توجد فواتير مسودة' : 'لا توجد فواتير'}</div>`;
    };
    draw();
    $('#inv-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { invTab = b.dataset.tab; draw(); } });
  }

  async function pageInvoice(view, [id]) {
    await reloadItems();
    if (id === 'new') return invoiceEditor(view, null, []);
    const inv = await q(sb.from('purchase_invoices').select('*').eq('id', Number(id)).maybeSingle());
    if (!inv) { view.innerHTML = '<div class="notice danger">الفاتورة غير موجودة أو لا تملك صلاحية عرضها</div>'; return; }
    const lines = await q(sb.from('purchase_invoice_lines').select('*').eq('invoice_id', inv.id).order('id'));
    const canEdit = inv.status === 'draft' && (isManager() || inv.created_by === S.profile.id);
    if (canEdit) return invoiceEditor(view, inv, lines);
    return invoiceView(view, inv, lines);
  }

  async function signedUrl(path) {
    if (!path) return null;
    const { data } = await sb.storage.from('invoices').createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  }

  async function invoiceView(view, inv, lines) {
    setTitle(`فاتورة ${inv.invoice_no ? '#' + inv.invoice_no : ''}`.trim());
    const sum = lines.reduce((a, l) => a + Number(l.qty) * Number(l.unit_cost), 0);
    const url = await signedUrl(inv.image_path);
    view.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div><h2 style="font-size:19px">${esc(supName(inv.supplier_id))}</h2><div class="muted small">${inv.invoice_no ? `فاتورة رقم ${esc(inv.invoice_no)} · ` : ''}${fmtDate(inv.invoice_date)}</div></div>
          <span class="badge ${STATUS_BADGE[inv.status]}">${STATUS_LABEL[inv.status]}</span>
        </div>
        <dl class="kv mt">
          <dt>أدخلتها</dt><dd>${esc(personName(inv.created_by))} · ${fmtDateTime(inv.created_at)}</dd>
          ${inv.approved_by ? `<dt>اعتمدتها</dt><dd>${esc(personName(inv.approved_by))} · ${fmtDateTime(inv.approved_at)}</dd>` : ''}
          ${inv.total_amount != null ? `<dt>إجمالي الفاتورة</dt><dd class="num">${money(inv.total_amount)}</dd>` : ''}
          ${inv.notes ? `<dt>ملاحظات</dt><dd style="font-weight:400">${esc(inv.notes)}</dd>` : ''}
        </dl>
      </div>
      <div class="section-title"><h2>البنود</h2></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الصنف</th><th class="n">الكمية</th><th class="n">سعر الوحدة</th><th class="n">الإجمالي</th><th>الصلاحية</th></tr></thead>
        <tbody>${lines.map((l) => { const it = itemById(l.item_id); return `<tr><td>${esc(it?.name || '—')}</td><td class="n">${num(l.qty)} ${esc(it?.unit || '')}</td><td class="n">${money(l.unit_cost)}</td><td class="n">${money(l.qty * l.unit_cost)}</td><td>${l.expiry_date ? fmtDate(l.expiry_date) : '—'}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><th colspan="3">المجموع</th><th class="n">${money(sum)}</th><th></th></tr></tfoot>
      </table></div>
      ${url ? `<div class="section-title"><h2>صورة الفاتورة</h2></div>${/\.pdf$/i.test(inv.image_path) ? `<a class="btn" href="${url}" target="_blank" rel="noopener">فتح ملف الفاتورة</a>` : `<a href="${url}" target="_blank" rel="noopener"><img class="thumb" src="${url}" alt="صورة الفاتورة"></a>`}` : ''}
      <div class="actions mt"><a class="btn" href="#/invoices">رجوع للفواتير</a></div>`;
  }

  function invoiceEditor(view, inv, lines) {
    const isNew = !inv;
    setTitle(isNew ? 'فاتورة شراء جديدة' : 'تعديل مسودة الفاتورة');
    const state = {
      lines: lines.length ? lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_cost: l.unit_cost, expiry_date: l.expiry_date || '' }))
        : [{ item_id: null, qty: 1, unit_cost: '', expiry_date: '' }],
      file: null,
    };
    const activeSuppliers = S.suppliers.filter((s) => s.is_active || s.id === inv?.supplier_id);
    view.innerHTML = `
      <form id="inv-form">
        ${isNew ? '<div class="notice info">سجّل بيانات الفاتورة كما هي. لا يتحدث المخزون إلا بعد اعتماد الفاتورة من مدير النظام.</div>' : `<div class="notice warn">هذه الفاتورة مسودة${inv.created_by !== S.profile.id ? ` أدخلتها ${esc(personName(inv.created_by))}` : ''}، ولم تُضف للمخزون بعد.</div>`}
        <div class="card">
          <div class="field"><label>المورد</label>
            <div style="display:flex;gap:8px">
              <select class="input" name="supplier_id" id="inv-sup"><option value="">اختر المورد</option>
                ${activeSuppliers.map((s) => `<option value="${s.id}" ${s.id === inv?.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
              ${isAdmin() ? `<button type="button" class="btn" id="add-sup" title="مورد جديد">${I.plus}</button>` : ''}
            </div></div>
          <div class="grid2">
            <div class="field"><label>رقم الفاتورة</label><input class="input" name="invoice_no" dir="ltr" value="${esc(inv?.invoice_no || '')}"></div>
            <div class="field"><label>تاريخ الفاتورة</label><input class="input" type="date" name="invoice_date" required value="${esc(inv?.invoice_date || today())}"></div>
          </div>
          <div class="field"><label>إجمالي الفاتورة (كما هو مكتوب فيها)</label><input class="input num" type="number" step="any" min="0" inputmode="decimal" name="total_amount" value="${esc(inv?.total_amount ?? '')}">
            <div class="hint">للمطابقة مع مجموع البنود.</div></div>
          <div class="field"><label>صورة الفاتورة</label>
            <input class="input" type="file" id="inv-file" accept="image/*,application/pdf">
            ${inv?.image_path ? '<div class="hint">توجد صورة محفوظة. اختر ملفاً جديداً فقط عند الحاجة لاستبدالها.</div>' : ''}</div>
          <div class="field" style="margin-bottom:0"><label>ملاحظات</label><textarea class="input" name="notes">${esc(inv?.notes || '')}</textarea></div>
        </div>

        <div class="section-title"><h2>البنود</h2><button type="button" class="btn sm" id="add-line">${I.plus} بند</button></div>
        <div class="lines" id="lines"></div>
        <div class="totals"><span>مجموع البنود</span><span class="num" id="lines-total">0</span></div>
        <div class="diff-warn" id="diff-warn" hidden></div>

        <div class="actions mt" style="justify-content:space-between">
          <div class="actions">
            <button class="btn primary" id="save-draft">حفظ المسودة</button>
            ${isAdmin() ? '<button type="button" class="btn gold" id="save-approve">حفظ واعتماد</button>' : ''}
          </div>
          ${!isNew ? '<button type="button" class="btn danger" id="del-inv">حذف المسودة</button>' : ''}
        </div>
      </form>`;

    const linesEl = $('#lines');
    const total = () => state.lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
    const updateTotal = () => {
      const t = total();
      $('#lines-total').textContent = money(t);
      const declared = $('[name=total_amount]').value;
      const w = $('#diff-warn');
      if (declared !== '' && Math.abs(Number(declared) - t) > 0.5) {
        w.hidden = false;
        w.textContent = `يوجد فرق ${money(Math.abs(Number(declared) - t))} بين مجموع البنود وإجمالي الفاتورة. قد يكون بسبب الضريبة أو خصم، تأكد قبل الاعتماد.`;
      } else w.hidden = true;
    };
    const drawLines = () => {
      linesEl.innerHTML = state.lines.map((l, k) => `
        <div class="line" data-k="${k}">
          <div class="line-head"><span>البند ${k + 1}</span>${state.lines.length > 1 ? `<button type="button" class="btn ghost sm" data-del="${k}">حذف</button>` : ''}</div>
          <div class="field"><div data-picker="${k}"></div></div>
          <div class="grid3">
            <div class="field" style="margin:0"><label>الكمية</label><input class="input num" type="number" step="any" min="0" inputmode="decimal" data-f="qty" value="${esc(l.qty)}"></div>
            <div class="field" style="margin:0"><label>سعر الوحدة</label><input class="input num" type="number" step="any" min="0" inputmode="decimal" data-f="unit_cost" value="${esc(l.unit_cost)}"></div>
            <div class="field" style="margin:0"><label>الإجمالي</label><div class="input num" style="background:var(--surface-2);display:flex;align-items:center" data-sum>${money((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</div></div>
          </div>
          <div class="field" data-exp style="margin:10px 0 0" ${l.item_id && itemById(l.item_id)?.track_expiry ? '' : 'hidden'}><label>تاريخ انتهاء الصلاحية</label><input class="input" type="date" data-f="expiry_date" value="${esc(l.expiry_date)}"></div>
        </div>`).join('');
      state.lines.forEach((l, k) => {
        const box = $(`[data-picker="${k}"]`, linesEl);
        itemPicker(box, {
          value: l.item_id,
          placeholder: 'اختر الصنف…',
          onPick: (it) => {
            l.item_id = it ? it.id : null;
            const exp = $(`.line[data-k="${k}"] [data-exp]`, linesEl);
            exp.hidden = !(it && it.track_expiry);
          },
        });
      });
      updateTotal();
    };
    linesEl.addEventListener('input', (e) => {
      const f = e.target.dataset.f; if (!f) return;
      const k = Number(e.target.closest('.line').dataset.k);
      state.lines[k][f] = e.target.value;
      const l = state.lines[k];
      $(`.line[data-k="${k}"] [data-sum]`, linesEl).textContent = money((Number(l.qty) || 0) * (Number(l.unit_cost) || 0));
      updateTotal();
    });
    linesEl.addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      state.lines.splice(Number(d.dataset.del), 1); drawLines();
    });
    $('#add-line').onclick = () => { state.lines.push({ item_id: null, qty: 1, unit_cost: '', expiry_date: '' }); drawLines(); };
    $('[name=total_amount]').addEventListener('input', updateTotal);
    $('#inv-file').addEventListener('change', (e) => { state.file = e.target.files[0] || null; });
    if (isAdmin()) $('#add-sup').onclick = () => supplierForm(null, (s) => {
      const sel = $('#inv-sup');
      sel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${esc(s.name)}</option>`);
      sel.value = s.id;
    });
    drawLines();

    const validate = () => {
      if (!state.lines.length) return 'أضف بنداً واحداً على الأقل';
      for (const [k, l] of state.lines.entries()) {
        if (!l.item_id) return `اختر الصنف في البند ${k + 1}`;
        if (!(Number(l.qty) > 0)) return `أدخل كمية صحيحة في البند ${k + 1}`;
        if (l.unit_cost === '' || !(Number(l.unit_cost) >= 0)) return `أدخل سعر الوحدة في البند ${k + 1}`;
        if (itemById(l.item_id)?.track_expiry && !l.expiry_date) return `أدخل تاريخ الصلاحية في البند ${k + 1}`;
      }
      return null;
    };

    const save = async () => {
      const f = new FormData($('#inv-form'));
      const head = {
        supplier_id: f.get('supplier_id') ? Number(f.get('supplier_id')) : null,
        invoice_no: f.get('invoice_no').trim() || null,
        invoice_date: f.get('invoice_date'),
        total_amount: f.get('total_amount') === '' ? null : Number(f.get('total_amount')),
        notes: f.get('notes').trim() || null,
      };
      if (state.file) {
        if (state.file.size > 10 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 10 ميجابايت');
        const ext = (state.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${S.profile.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await sb.storage.from('invoices').upload(path, state.file, { contentType: state.file.type || undefined });
        if (error) throw error;
        head.image_path = path;
      }
      let invId = inv?.id;
      if (isNew) {
        const created = await q(sb.from('purchase_invoices').insert(head).select('id').single());
        invId = created.id;
      } else {
        await q(sb.from('purchase_invoices').update(head).eq('id', invId));
        await q(sb.from('purchase_invoice_lines').delete().eq('invoice_id', invId));
      }
      await q(sb.from('purchase_invoice_lines').insert(state.lines.map((l) => ({
        invoice_id: invId, item_id: l.item_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost),
        expiry_date: itemById(l.item_id)?.track_expiry && l.expiry_date ? l.expiry_date : null,
      }))));
      return invId;
    };

    $('#inv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = validate(); if (v) return toast(v, true);
      await busy($('#save-draft'), async () => {
        try {
          const invId = await save();
          toast('تم حفظ الفاتورة كمسودة');
          location.hash = `#/invoice/${invId}`;
          if (!isNew) route();
        } catch (err) { toast(errMsg(err), true); }
      });
    });

    if (isAdmin()) $('#save-approve').onclick = async () => {
      const v = validate(); if (v) return toast(v, true);
      const ok = await confirmBox('اعتماد الفاتورة', `سيتم إضافة الكميات للمخزون (${state.lines.length} بند بمجموع ${money(total())}). لا يمكن تعديل الفاتورة بعد الاعتماد.`, 'اعتماد');
      if (!ok) return;
      await busy($('#save-approve'), async () => {
        try {
          const invId = await save();
          await q(sb.rpc('approve_invoice', { p_invoice_id: invId }));
          await reloadItems();
          toast('تم اعتماد الفاتورة وتحديث المخزون');
          if (location.hash === `#/invoice/${invId}`) route(); else location.hash = `#/invoice/${invId}`;
        } catch (err) { toast(errMsg(err), true); }
      });
    };

    if (!isNew) $('#del-inv').onclick = async () => {
      const ok = await confirmBox('حذف المسودة', 'سيتم حذف هذه المسودة نهائياً.', 'حذف', true);
      if (!ok) return;
      try {
        await q(sb.from('purchase_invoices').delete().eq('id', inv.id));
        toast('تم حذف المسودة');
        location.hash = '#/invoices';
      } catch (err) { toast(errMsg(err), true); }
    };
  }

  /* ---------- shopping list ---------- */
  async function pageShopping(view) {
    await reloadItems();
    const low = S.items.filter((i) => i.is_active && isLow(i)).sort((a, b) => a.category_id - b.category_id || a.name.localeCompare(b.name, 'ar'));
    const suggest = (i) => Math.max(Math.ceil(Number(i.min_qty) * 2 - Number(i.qty_on_hand)), 1);
    let est = 0;
    const rows = low.map((i) => {
      const c = S.costs.get(i.id);
      const s = suggest(i);
      if (c) est += s * Number(c.last_cost || c.avg_cost || 0);
      return `<tr><td><a href="#/item/${i.id}">${esc(i.name)}</a><div class="muted small">${esc(catName(i.category_id))}</div></td>
        <td class="n">${num(i.qty_on_hand)}</td><td class="n">${num(i.min_qty)}</td><td class="n"><b>${num(s)}</b> ${esc(i.unit)}</td>
        ${isManager() ? `<td class="n">${c && Number(c.last_cost) ? money(c.last_cost) : '—'}</td>` : ''}</tr>`;
    }).join('');
    view.innerHTML = low.length ? `
      <p class="muted" style="margin-top:0">الأصناف التي وصل رصيدها للحد الأدنى أو أقل. الكمية المقترحة توصل الرصيد لضعف الحد الأدنى.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الصنف</th><th class="n">الرصيد</th><th class="n">الحد الأدنى</th><th class="n">المقترح</th>${isManager() ? '<th class="n">آخر سعر</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${isManager() && est ? `<div class="totals"><span>التكلفة التقديرية بآخر الأسعار</span><span class="num">${money(est)}</span></div>` : ''}
      <div class="actions mt"><button class="btn primary" id="share-list">نسخ القائمة لإرسالها</button></div>`
      : '<div class="card empty">لا توجد أصناف ناقصة حالياً</div>';
    if (low.length) $('#share-list').onclick = async () => {
      const text = `قائمة مشتريات الصالون (${fmtDate(new Date())})\n\n` + low.map((i) => `• ${i.name}: ${num(suggest(i))} ${i.unit}`).join('\n');
      try {
        if (navigator.share) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toast('تم نسخ القائمة'); }
      } catch (_) { /* user cancelled */ }
    };
  }

  /* ---------- movements ---------- */
  let moveFilter = 'all';
  async function pageMovements(view, _a, _p, alive) {
    const rows = await q(sb.from('stock_movements').select('id,item_id,movement_type,qty,invoice_id,reason,created_by,created_at').order('created_at', { ascending: false }).limit(400));
    if (!alive()) return;
    const types = [['all', 'الكل'], ['purchase', 'شراء'], ['issue', 'صرف'], ['damage', 'تالف'], ['expired', 'منتهي']];
    view.innerHTML = `
      ${!isManager() ? '<div class="notice info">يظهر هنا سجل الحركات التي سجّلتها أنت.</div>' : ''}
      <div class="chips" id="mv-chips"></div>
      <div class="list" id="mv-list"></div>
      <p class="muted small">يعرض آخر 400 حركة.</p>`;
    const draw = () => {
      $('#mv-chips').innerHTML = types.map(([k, l]) => `<button class="chip ${moveFilter === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
      const list = rows.filter((r) => moveFilter === 'all' || r.movement_type === moveFilter);
      $('#mv-list').innerHTML = list.length ? list.map(moveRow).join('') : '<div class="empty">لا توجد حركات</div>';
    };
    draw();
    $('#mv-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { moveFilter = b.dataset.k; draw(); } });
  }

  /* ---------- reports ---------- */
  async function pageReports(view) {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    view.innerHTML = `
      <div class="card">
        <div class="grid2">
          <div class="field" style="margin:0"><label>من</label><input class="input" type="date" id="r-from" value="${first}"></div>
          <div class="field" style="margin:0"><label>إلى</label><input class="input" type="date" id="r-to" value="${today()}"></div>
        </div>
      </div>
      <div id="r-body" class="mt"></div>`;
    const run = async () => {
      const from = $('#r-from').value, to = $('#r-to').value;
      if (!from || !to) return;
      const body = $('#r-body');
      body.innerHTML = '<div class="boot" style="min-height:20vh"><div class="spinner"></div></div>';
      try {
        const [cons, purch] = await Promise.all([
          q(sb.rpc('consumption_report', { p_from: from, p_to: to })),
          q(sb.rpc('purchases_report', { p_from: from, p_to: to })),
        ]);
        const sumBy = (t) => cons.filter((r) => r.movement_type === t).reduce((a, r) => a + Number(r.cost), 0);
        const used = sumBy('issue'), dmg = sumBy('damage'), exp = sumBy('expired');
        const purchTotal = purch.reduce((a, r) => a + Number(r.amount), 0);
        const byCat = new Map();
        cons.forEach((r) => byCat.set(r.category_name || 'بدون فئة', (byCat.get(r.category_name || 'بدون فئة') || 0) + Number(r.cost)));
        const items = new Map();
        cons.forEach((r) => {
          const k = r.item_id;
          const o = items.get(k) || { name: r.item_name, qty: 0, cost: 0, lost: 0 };
          o.qty += Number(r.qty); o.cost += Number(r.cost);
          if (r.movement_type !== 'issue') o.lost += Number(r.cost);
          items.set(k, o);
        });
        const top = [...items.values()].sort((a, b) => b.cost - a.cost).slice(0, 15);
        const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
        const consTotal = used + dmg + exp;
        body.innerHTML = `
          <div class="stats">
            <div class="stat accent"><div class="label">تكلفة الاستهلاك</div><div class="value num" style="font-size:20px">${money(used)}</div></div>
            <div class="stat danger"><div class="label">تالف ومنتهي</div><div class="value num" style="font-size:20px">${money(dmg + exp)}</div></div>
            <div class="stat"><div class="label">المشتريات المعتمدة</div><div class="value num" style="font-size:20px">${money(purchTotal)}</div></div>
            <div class="stat warn"><div class="label">نسبة الهدر</div><div class="value num" style="font-size:20px">${consTotal ? num(((dmg + exp) / consTotal) * 100, 1) : 0}%</div></div>
          </div>
          <div class="section-title"><h2>الاستهلاك حسب الفئة</h2></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الفئة</th><th class="n">التكلفة</th><th class="n">النسبة</th></tr></thead>
            <tbody>${catRows.length ? catRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${money(v)}</td><td class="n">${consTotal ? num((v / consTotal) * 100, 1) : 0}%</td></tr>`).join('') : '<tr><td colspan="3" class="empty">لا توجد بيانات في هذه الفترة</td></tr>'}</tbody></table></div>
          <div class="section-title"><h2>الأصناف الأعلى تكلفة</h2></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الصنف</th><th class="n">الكمية</th><th class="n">التكلفة</th><th class="n">منها هدر</th></tr></thead>
            <tbody>${top.length ? top.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${num(r.qty)}</td><td class="n">${money(r.cost)}</td><td class="n">${r.lost ? money(r.lost) : '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">لا توجد بيانات</td></tr>'}</tbody></table></div>
          <div class="section-title"><h2>المشتريات حسب المورد</h2></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المورد</th><th class="n">عدد الفواتير</th><th class="n">المبلغ</th></tr></thead>
            <tbody>${purch.length ? purch.map((r) => `<tr><td>${esc(r.supplier_name)}</td><td class="n">${num(r.invoices)}</td><td class="n">${money(r.amount)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">لا توجد مشتريات معتمدة</td></tr>'}</tbody></table></div>
          <p class="muted small mt">تُحسب تكلفة الاستهلاك بمتوسط تكلفة الصنف وقت الصرف. مبالغ المشتريات من بنود الفواتير قبل أي ضريبة أو خصم غير مسجل في البنود.</p>`;
      } catch (e) { body.innerHTML = `<div class="notice danger">${esc(errMsg(e))}</div>`; }
    };
    $('#r-from').addEventListener('change', run);
    $('#r-to').addEventListener('change', run);
    run();
  }

  /* ---------- users (admin) ---------- */
  async function pageUsers(view) {
    const profs = await q(sb.from('profiles').select('id,full_name,login,role,is_active,approved_at,created_at').order('created_at'));
    S.profiles = new Map(profs.map((p) => [p.id, p]));
    const pending = profs.filter((p) => !p.is_active && !p.approved_at);
    const others = profs.filter((p) => p.is_active || p.approved_at);
    const userRow = (p) => `
        <button class="row" data-id="${p.id}">
          <span class="avatar">${esc(initial(p.full_name || p.login))}</span>
          <div class="grow"><div class="title">${esc(p.full_name || '—')}${p.id === S.profile.id ? ' <span class="muted small">(أنت)</span>' : ''}</div><div class="meta" dir="ltr" style="text-align:right">${esc(p.login || '')}</div></div>
          <div class="end"><span class="badge ${p.role === 'admin' ? 'accent' : p.role === 'partner' ? 'gold' : ''}">${ROLE_LABEL[p.role]}</span>
            ${p.is_active ? '' : '<div style="margin-top:4px"><span class="badge danger">موقوف</span></div>'}</div>
        </button>`;
    view.innerHTML = `
      ${pending.length ? `
        <div class="section-title"><h2>طلبات تسجيل بانتظار الاعتماد (${pending.length})</h2></div>
        <div class="list">${pending.map((p) => `
          <div class="row">
            <span class="avatar">${esc(initial(p.full_name || p.login))}</span>
            <div class="grow"><div class="title">${esc(p.full_name || '—')}</div><div class="meta" dir="ltr" style="text-align:right">${esc(p.login || '')} · ${fmtDate(p.created_at)}</div></div>
            <button class="btn sm primary" data-approve="${p.id}">اعتماد</button>
            <button class="btn sm danger" data-reject="${p.id}">رفض</button>
          </div>`).join('')}</div>` : ''}
      <div class="section-title"><h2>المستخدمون</h2><button class="btn sm" id="user-new">${I.plus} إضافة مستخدم</button></div>
      <div class="list">${others.map(userRow).join('') || '<div class="empty">لا يوجد مستخدمون</div>'}</div>
      <p class="muted small">يسجّل المستخدم من صفحة «إنشاء حساب»، ثم يظهر هنا لاعتماده وتحديد صلاحيته. ويمكن أيضاً إضافة مستخدم مباشرة باسم مستخدم وكلمة مرور.</p>`;
    $('#user-new').onclick = () => userCreateForm(() => route());
    $$('button.row[data-id]', view).forEach((b) => b.addEventListener('click', () => userEditForm(S.profiles.get(b.dataset.id), () => route())));
    $$('[data-approve]', view).forEach((b) => b.onclick = () => approveUserForm(S.profiles.get(b.dataset.approve), () => route()));
    $$('[data-reject]', view).forEach((b) => b.onclick = async () => {
      const p = S.profiles.get(b.dataset.reject);
      if (!(await confirmBox('رفض الطلب', `رفض طلب «${esc(p.full_name || p.login)}»؟ يبقى الحساب موقوفاً ولا يستطيع الدخول للنظام.`, 'رفض', true))) return;
      try { await q(sb.rpc('mark_profile_rejected', { p_id: p.id })); toast('تم رفض الطلب'); route(); }
      catch (err) { toast(errMsg(err), true); }
    });
  }

  function approveUserForm(p, after) {
    modal(`
      <h3>اعتماد ${esc(p.full_name || p.login)}</h3>
      <p class="muted" style="margin-top:-8px" dir="ltr">${esc(p.login || '')}</p>
      <form id="ap-form">
        <div class="field"><label>الصلاحية</label><select class="input" name="role">${roleOptions('staff')}</select>
          <div class="hint">الموظف: صرف وإدخال فواتير مسودة بدون رؤية الأسعار. الإدارة: ترى كل شيء والتقارير. مدير النظام: كل الصلاحيات.</div></div>
        <div class="field"><label>الاسم</label><input class="input" name="full_name" value="${esc(p.full_name || '')}" required></div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">اعتماد الحساب</button></div>
      </form>`, (el, close) => {
      $('#ap-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        await busy($('button.primary', el), async () => {
          try {
            await q(sb.from('profiles').update({ role: f.get('role'), full_name: f.get('full_name').trim(), is_active: true }).eq('id', p.id));
            toast('تم اعتماد الحساب'); close(); after && after();
          } catch (err) { toast(errMsg(err), true); }
        });
      });
    });
  }

  async function invokeAdmin(body) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function roleOptions(sel) {
    return Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  }

  function userCreateForm(after) {
    modal(`
      <h3>مستخدم جديد</h3>
      <form id="u-form">
        <div class="field"><label>الاسم</label><input class="input" name="full_name" required placeholder="مثال: نورة"></div>
        <div class="field"><label>اسم المستخدم للدخول</label><input class="input" name="login" dir="ltr" required pattern="[a-zA-Z0-9._\\-]{3,32}" autocapitalize="none" placeholder="noura">
          <div class="hint">حروف إنجليزية وأرقام فقط، بدون مسافات.</div></div>
        <div class="field"><label>كلمة المرور</label><input class="input" name="password" dir="ltr" required minlength="8" autocomplete="new-password">
          <div class="hint">8 خانات على الأقل. يمكن للمستخدم تغييرها بعد الدخول.</div></div>
        <div class="field"><label>الصلاحية</label><select class="input" name="role">${roleOptions('staff')}</select></div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">إنشاء الحساب</button></div>
      </form>`, (el, close) => {
      $('#u-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        await busy($('button.primary', el), async () => {
          try {
            await invokeAdmin({ action: 'create', full_name: f.get('full_name').trim(), login: f.get('login').trim().toLowerCase(), password: f.get('password'), role: f.get('role') });
            toast('تم إنشاء الحساب'); close(); after && after();
          } catch (err) { toast(errMsg(err), true); }
        });
      });
    });
  }

  function userEditForm(p, after) {
    const self = p.id === S.profile.id;
    modal(`
      <h3>${esc(p.full_name || p.login)}</h3>
      <form id="ue-form">
        <div class="field"><label>الاسم</label><input class="input" name="full_name" value="${esc(p.full_name)}" required></div>
        <div class="field"><label>اسم المستخدم</label><input class="input" value="${esc(p.login || '')}" dir="ltr" disabled></div>
        <div class="field"><label>الصلاحية</label><select class="input" name="role" ${self ? 'disabled' : ''}>${roleOptions(p.role)}</select></div>
        <div class="field"><label class="check"><input type="checkbox" name="is_active" ${p.is_active ? 'checked' : ''} ${self ? 'disabled' : ''}> الحساب مفعّل</label>
          ${self ? '<div class="hint">لا يمكنك تغيير صلاحية حسابك أو إيقافه.</div>' : ''}</div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">حفظ</button></div>
      </form>
      <div class="section-title"><h2>تعيين كلمة مرور جديدة</h2></div>
      <form id="pw-form" style="display:flex;gap:8px">
        <input class="input" name="password" dir="ltr" minlength="8" required placeholder="8 خانات على الأقل" autocomplete="new-password">
        <button class="btn">تعيين</button>
      </form>`, (el, close) => {
      $('#ue-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const row = { full_name: f.get('full_name').trim() };
        if (!self) { row.role = f.get('role'); row.is_active = !!f.get('is_active'); }
        await busy($('#ue-form button.primary', el), async () => {
          try { await q(sb.from('profiles').update(row).eq('id', p.id)); toast('تم الحفظ'); close(); after && after(); }
          catch (err) { toast(errMsg(err), true); }
        });
      });
      $('#pw-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = new FormData(e.target).get('password');
        await busy($('#pw-form button', el), async () => {
          try { await invokeAdmin({ action: 'set_password', user_id: p.id, password: pw }); toast('تم تعيين كلمة المرور'); e.target.reset(); }
          catch (err) { toast(errMsg(err), true); }
        });
      });
    });
  }

  function changePassword() {
    modal(`
      <h3>تغيير كلمة المرور</h3>
      <form id="cp-form">
        <div class="field"><label>كلمة المرور الجديدة</label><input class="input" type="password" name="p1" dir="ltr" minlength="8" required autocomplete="new-password"></div>
        <div class="field"><label>تأكيد كلمة المرور</label><input class="input" type="password" name="p2" dir="ltr" minlength="8" required autocomplete="new-password"></div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">حفظ</button></div>
      </form>`, (el, close) => {
      $('#cp-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        if (f.get('p1') !== f.get('p2')) return toast('كلمتا المرور غير متطابقتين', true);
        await busy($('button.primary', el), async () => {
          const { error } = await sb.auth.updateUser({ password: f.get('p1') });
          if (error) return toast(errMsg(error), true);
          toast('تم تغيير كلمة المرور'); close();
        });
      });
    });
  }

  /* ---------- catalog (admin) ---------- */
  async function pageCatalog(view) {
    await loadRefs();
    view.innerHTML = `
      <div class="section-title"><h2>الفئات</h2><button class="btn sm primary" id="cat-new">${I.plus} فئة</button></div>
      <div class="list">${S.categories.map((c) => `
        <div class="row"><div class="grow"><div class="title">${esc(c.name)}</div><div class="meta">${S.items.filter((i) => i.category_id === c.id).length} صنف</div></div>
          <button class="btn sm" data-cat-edit="${c.id}">تعديل</button><button class="btn sm danger" data-cat-del="${c.id}">حذف</button></div>`).join('') || '<div class="empty">لا توجد فئات</div>'}</div>

      <div class="section-title"><h2>الموردين</h2><button class="btn sm primary" id="sup-new">${I.plus} مورد</button></div>
      <div class="list">${S.suppliers.map((s) => `
        <button class="row" data-sup="${s.id}"><div class="grow"><div class="title">${esc(s.name)} ${s.is_active ? '' : '<span class="badge">موقوف</span>'}</div><div class="meta" dir="ltr" style="text-align:right">${esc(s.phone || '')}</div></div></button>`).join('') || '<div class="empty">لا يوجد موردين بعد</div>'}</div>`;
    $('#cat-new').onclick = () => categoryForm(null);
    $$('[data-cat-edit]', view).forEach((b) => b.onclick = () => categoryForm(S.categories.find((c) => c.id === Number(b.dataset.catEdit))));
    $$('[data-cat-del]', view).forEach((b) => b.onclick = async () => {
      const c = S.categories.find((x) => x.id === Number(b.dataset.catDel));
      if (S.items.some((i) => i.category_id === c.id)) return toast('لا يمكن حذف فئة فيها أصناف. انقل الأصناف لفئة أخرى أولاً.', true);
      if (!(await confirmBox('حذف الفئة', `حذف فئة «${esc(c.name)}»؟`, 'حذف', true))) return;
      try { await q(sb.from('categories').delete().eq('id', c.id)); toast('تم الحذف'); route(); } catch (err) { toast(errMsg(err), true); }
    });
    $('#sup-new').onclick = () => supplierForm(null, () => route());
    $$('[data-sup]', view).forEach((b) => b.onclick = () => supplierForm(S.suppliers.find((s) => s.id === Number(b.dataset.sup)), () => route()));
  }

  function categoryForm(c) {
    modal(`
      <h3>${c ? 'تعديل الفئة' : 'فئة جديدة'}</h3>
      <form id="c-form">
        <div class="field"><label>اسم الفئة</label><input class="input" name="name" required value="${esc(c?.name || '')}"></div>
        <div class="field"><label>الترتيب</label><input class="input num" name="sort_order" type="number" value="${esc(c?.sort_order ?? S.categories.length + 1)}"></div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">حفظ</button></div>
      </form>`, (el, close) => {
      $('#c-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const row = { name: f.get('name').trim(), sort_order: Number(f.get('sort_order') || 0) };
        await busy($('button.primary', el), async () => {
          try {
            if (c) await q(sb.from('categories').update(row).eq('id', c.id));
            else await q(sb.from('categories').insert(row));
            toast('تم الحفظ'); close(); route();
          } catch (err) { toast(errMsg(err), true); }
        });
      });
    });
  }

  function supplierForm(s, after) {
    modal(`
      <h3>${s ? 'تعديل المورد' : 'مورد جديد'}</h3>
      <form id="s-form">
        <div class="field"><label>اسم المورد</label><input class="input" name="name" required value="${esc(s?.name || '')}"></div>
        <div class="field"><label>رقم التواصل</label><input class="input" name="phone" dir="ltr" inputmode="tel" value="${esc(s?.phone || '')}"></div>
        <div class="field"><label>ملاحظات</label><textarea class="input" name="notes">${esc(s?.notes || '')}</textarea></div>
        ${s ? `<div class="field"><label class="check"><input type="checkbox" name="is_active" ${s.is_active ? 'checked' : ''}> المورد نشط</label></div>` : ''}
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">حفظ</button></div>
      </form>`, (el, close) => {
      $('#s-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const row = { name: f.get('name').trim(), phone: f.get('phone').trim() || null, notes: f.get('notes').trim() || null };
        if (s) row.is_active = !!f.get('is_active');
        await busy($('button.primary', el), async () => {
          try {
            let saved;
            if (s) saved = await q(sb.from('suppliers').update(row).eq('id', s.id).select('id,name,phone,notes,is_active').single());
            else saved = await q(sb.from('suppliers').insert(row).select('id,name,phone,notes,is_active').single());
            S.suppliers = await q(sb.from('suppliers').select('id,name,phone,notes,is_active').order('name'));
            toast('تم حفظ المورد'); close(); after && after(saved);
          } catch (err) { toast(errMsg(err), true); }
        });
      });
    });
  }

  /* ======================= push notifications ======================= */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function pushStatus() {
    if (!pushSupported()) return isIOS && !isStandalone() ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      return sub ? 'on' : 'off';
    } catch (_) { return 'off'; }
  }

  async function saveSubscription(sub) {
    const j = sub.toJSON();
    await q(sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent }));
  }

  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('لم يتم السماح بالإشعارات. فعّلها من إعدادات المتصفح ثم حاول مرة أخرى.');
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
    await saveSubscription(sub);
  }

  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    await q(sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint }));
    await sub.unsubscribe();
  }

  async function testPush() {
    const { data, error } = await sb.functions.invoke('notify', { body: { test: true } });
    if (error) throw error;
    if (!data?.sent) throw new Error('لم يصل الإشعار. أوقف الإشعارات وفعّلها من جديد على هذا الجهاز.');
  }

  // keeps this device linked to the signed-in admin
  async function syncPushOnLogin() {
    if (!isAdmin() || !pushSupported() || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await saveSubscription(sub);
    } catch (_) { /* ignore */ }
  }

  async function renderPushCard(box, { compact = false } = {}) {
    if (!isAdmin()) { box.innerHTML = ''; return; }
    const st = await pushStatus();
    if (compact && (st === 'on' || st === 'unsupported')) { box.innerHTML = ''; return; }
    const msg = {
      on: 'الإشعارات مفعّلة على هذا الجهاز. يصلك تنبيه عند وجود فاتورة بانتظار الاعتماد، أو طلب تسجيل، أو صنف وصل للحد الأدنى، أو تالف، وملخص يومي الساعة 8 صباحاً.',
      off: 'فعّل الإشعارات على هذا الجهاز ليصلك تنبيه فوري بكل ما يحتاج انتباهك.',
      denied: 'الإشعارات مرفوضة في إعدادات المتصفح لهذا الموقع. اسمح بها من إعدادات المتصفح ثم ارجع هنا.',
      'ios-install': 'لتفعيل الإشعارات على الآيفون: افتح الموقع من Safari، واضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية»، وافتحه من الأيقونة وفعّل الإشعارات من هنا.',
      unsupported: 'هذا المتصفح لا يدعم الإشعارات.',
    }[st];
    box.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
          <b>إشعارات الجوال</b>
          <span class="badge ${st === 'on' ? 'ok' : st === 'off' ? 'warn' : ''}">${st === 'on' ? 'مفعّلة' : 'غير مفعّلة'}</span>
        </div>
        <p class="muted small" style="margin:0 0 10px">${msg}</p>
        <div class="actions">
          ${st === 'off' ? '<button class="btn primary sm" data-push="on">تفعيل الإشعارات</button>' : ''}
          ${st === 'on' ? '<button class="btn sm" data-push="test">إرسال إشعار تجريبي</button><button class="btn sm ghost" data-push="off">إيقاف على هذا الجهاز</button>' : ''}
        </div>
      </div>`;
    $$('[data-push]', box).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      try {
        if (b.dataset.push === 'on') { await enablePush(); toast('تم تفعيل الإشعارات'); }
        if (b.dataset.push === 'off') { await disablePush(); toast('تم إيقاف الإشعارات على هذا الجهاز'); }
        if (b.dataset.push === 'test') { await testPush(); toast('تم الإرسال، يفترض يوصلك الإشعار خلال ثوانٍ'); return; }
        renderPushCard(box, { compact });
      } catch (err) { toast(errMsg(err), true); }
    })));
  }

  /* ---------- more (mobile) ---------- */
  async function pageMore(view) {
    const links = navLinks().filter((l) => l.href && !['home', 'more'].includes(l.key));
    const groups = [...new Set(links.map((l) => l.group))];
    view.innerHTML = `
      <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span class="avatar" style="width:44px;height:44px;font-size:18px">${esc(initial(S.profile.full_name || S.profile.login))}</span>
        <div><div style="font-weight:700">${esc(S.profile.full_name || S.profile.login)}</div><div class="muted small">${ROLE_LABEL[S.profile.role]}</div></div>
      </div>
      <div id="push-box"></div>
      ${groups.map((g) => `<div class="svc-cat-h">${g}</div><div class="more-grid">${links.filter((l) => l.group === g).map((l) => `<a class="mtile" href="${l.href}"><span class="ic">${l.icon}</span><b>${l.label}</b></a>`).join('')}</div>`).join('')}
      <div class="list mt">
        ${isManager() ? `<a class="row" href="#/naqla"><span class="ic" style="color:var(--accent)">✦</span><div class="grow title">نقلة بيوتفريش · عرض قبل وبعد</div></a>` : ''}
        ${isManager() ? `<button class="row" id="m-exp"><span class="ic" style="color:var(--accent)">${I.invoice}</span><div class="grow title">تصدير البيانات إلى Excel</div></button>` : ''}
        <a class="row" href="install.html"><span class="ic" style="color:var(--accent)">${I.home}</span><div class="grow title">ثبّت التطبيق على الجوال</div></a>
        <button class="row" id="m-pw"><span class="ic" style="color:var(--accent)">${I.key}</span><div class="grow title">تغيير كلمة المرور</div></button>
        <button class="row" id="m-out"><span class="ic" style="color:var(--danger)">${I.logout}</span><div class="grow title" style="color:var(--danger)">تسجيل الخروج</div></button>
      </div>`;
    $('#m-pw').onclick = changePassword;
    $('#m-exp')?.addEventListener('click', exportForm);
    $('#m-out').onclick = () => sb.auth.signOut();
    renderPushCard($('#push-box'));
  }

  /* ======================= home-service bookings ======================= */
  const BK_STATUS = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', on_way: 'في الطريق', done: 'تمت', cancelled: 'ملغي' };
  const BK_BADGE = { pending: 'warn', confirmed: 'ok', on_way: 'accent', done: '', cancelled: 'danger' };
  const PAY_STATUS = { unpaid: 'غير مدفوع', paid: 'مدفوع', refunded: 'مسترجع' };
  const PAY_METHODS = ['ركاز', 'رابط دفع', 'تحويل بنكي', 'مدى عند الزيارة', 'نقدًا'];
  const SVC_CAT = { nails: 'الأظافر', hair: 'الشعر', package: 'الباقات', other: 'أخرى' };
  const WDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const BOOK_SITE = new URL('../home/', location.href.split('#')[0]).href;

  const rDay = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const rTime = (ts) => {
    const hm = new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false });
    const [h, m] = hm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
  };
  const rHM = (ts) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false });
  const rDayLabel = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    const t = rDay(Date.now());
    const tm = rDay(Date.now() + 86400000);
    const base = dt.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
    return d === t ? `اليوم · ${base}` : d === tm ? `بكرة · ${base}` : base;
  };
  const waNum = (p) => { const n = String(p || '').replace(/\D/g, ''); return n.startsWith('0') ? '966' + n.slice(1) : n; };
  const durTxt = (m) => (m < 60 ? `${m} د` : `${Math.floor(m / 60)} س${m % 60 ? ` ${m % 60} د` : ''}`);
  const bkMinutes = (b) => Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000);

  function waTemplates(b, items) {
    const first = (b.customer_name || '').split(' ')[0];
    const svc = items.map((i) => i.name + (i.qty > 1 ? ` × ${i.qty}` : '')).join('، ');
    const when = `${rDayLabel(rDay(b.starts_at)).replace(/^(اليوم|بكرة) · /, '')} الساعة ${rTime(b.starts_at)}`;
    const staff = b.staff_id ? (S.profiles.get(b.staff_id)?.full_name || '') : '';
    const totalLine = b.total != null ? `الإجمالي: ${money(b.total)}` : '';
    const link = `${BOOK_SITE}#/b/${b.access_token}`;
    return [
      { key: 'confirm', label: 'تأكيد الحجز', text: `أهلًا ${first} 🤍\nتم تأكيد وقتك الخاص مع بيوتفريش\nرقم الحجز: ${b.code}\nالخدمة: ${svc}\nالموعد: ${when}\n${totalLine}${staff ? `\nالأخصائية: ${staff}` : ''}\nنحتاج مكان فيه إضاءة جيدة وكرسي وفيش كهرباء قريب.\nتفاصيل حجزك: ${link}` },
      { key: 'pay', label: 'رابط الدفع', text: `أهلًا ${first} 🤍\nهذا رابط الدفع لحجزك ${b.code}:\n[رابط الدفع]\n${totalLine}` },
      { key: 'remind', label: 'تذكير', text: `أهلًا ${first}، نذكّرك بزيارتنا ${when} لخدمة ${svc}.\nإذا احتجتي تعديل، بلغينا ونراجع التوفّر 🤍` },
      { key: 'onway', label: 'في الطريق', text: `أهلًا ${first}، ${staff ? `أخصائيتك ${staff}` : 'أخصائيتك'} في الطريق إليكِ 🤍\nالوصول المتوقع خلال [المدة].` },
      { key: 'thanks', label: 'شكر بعد الزيارة', text: `شكرًا لأنك فتحتي لنا بابك يا ${first} 🤍\nنتمنى الزيارة عجبتك، ويسعدنا نسمع رأيك.` },
    ];
  }

  async function pageBookings(view, _a, params, alive) {
    const tab = params.get('t') || 'upcoming';
    const now = new Date();
    const startToday = new Date(rDay(now) + 'T00:00:00+03:00');
    let qy = sb.from('home_bookings').select('id,code,customer_name,phone,district_name,starts_at,ends_at,status,payment_status,total,staff_id,guests,home_booking_items(name,qty)');
    if (tab === 'today') qy = qy.gte('starts_at', startToday.toISOString()).lt('starts_at', new Date(startToday.getTime() + 86400000).toISOString()).order('starts_at');
    else if (tab === 'pending') qy = qy.eq('status', 'pending').order('starts_at');
    else if (tab === 'past') qy = qy.lt('starts_at', startToday.toISOString()).order('starts_at', { ascending: false }).limit(100);
    else qy = qy.gte('starts_at', startToday.toISOString()).neq('status', 'cancelled').order('starts_at').limit(200);
    const [rows, pendRes] = await Promise.all([
      q(qy),
      sb.from('home_bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    if (!alive()) return;
    const pendingCount = pendRes.count || 0;
    const groups = new Map();
    rows.forEach((b) => { const k = rDay(b.starts_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
    view.innerHTML = `
      <div class="chips">
        ${[['upcoming', 'القادمة'], ['today', 'اليوم'], ['pending', `بانتظار التأكيد${pendingCount ? ` (${pendingCount})` : ''}`], ['past', 'السابقة']].map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/bookings?t=${k}">${l}</a>`).join('')}
      </div>
      ${isManager() ? `<div class="actions" style="margin-bottom:14px"><button class="btn primary" id="bk-new">${I.plus} حجز يدوي</button><a class="btn" href="#/homesvc">الخدمات والإعدادات</a><a class="btn" href="${BOOK_SITE}" target="_blank" rel="noopener">موقع الحجز ↗</a></div>` : ''}
      ${rows.length ? [...groups].map(([d, list]) => `
        <div class="section-title"><h2>${esc(rDayLabel(d))}</h2><span class="muted small">${list.length} ${list.length === 1 ? 'حجز' : 'حجوزات'}</span></div>
        <div class="list">${list.map((b) => `
          <a class="row" href="#/booking/${b.id}">
            <div style="width:62px;flex:none;text-align:center"><div style="font-weight:700" class="num">${rTime(b.starts_at).split(' ')[0]}</div><div class="meta">${rTime(b.starts_at).split(' ')[1]} · ${durTxt(bkMinutes(b))}</div></div>
            <div class="grow"><div class="title">${esc(b.customer_name)}${b.guests > 1 ? ` <span class="muted small">+${b.guests - 1}</span>` : ''}</div>
              <div class="meta">${esc((b.home_booking_items || []).map((i) => i.name + (i.qty > 1 ? `×${i.qty}` : '')).join('، '))} · ${esc(b.district_name || '')}${b.staff_id ? ` · ${esc(personName(b.staff_id))}` : ''}</div></div>
            <div class="end"><span class="badge ${BK_BADGE[b.status]}">${BK_STATUS[b.status]}</span>${b.payment_status === 'paid' ? '<div class="meta" style="margin-top:4px">مدفوع</div>' : ''}</div>
          </a>`).join('')}</div>`).join('')
        : `<div class="list"><div class="empty">${tab === 'pending' ? 'ما فيه حجوزات بانتظار التأكيد' : 'ما فيه حجوزات هنا'}</div></div>`}`;
    $('#bk-new')?.addEventListener('click', manualBookingForm);
  }

  async function manualBookingForm() {
    const cat = await q(sb.rpc('bh_catalog'));
    if (!cat.districts.length) { toast('أضف حيًا واحدًا على الأقل من الإعدادات', true); location.hash = '#/homesvc?t=districts'; return; }
    const tomorrow = rDay(Date.now() + 86400000);
    modal(`
      <h3>حجز يدوي</h3>
      <p class="muted small" style="margin-top:-6px">للحجوزات اللي توصل بالواتساب أو الاتصال.</p>
      <div class="grid2"><div class="field"><label>الاسم</label><input class="input" id="m-name"></div><div class="field"><label>الجوال</label><input class="input" id="m-phone" dir="ltr" inputmode="tel" placeholder="05xxxxxxxx"></div></div>
      <div class="field"><label>الخدمات</label><div id="m-svcs" style="max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px 10px">${cat.services.map((s) => `<label class="check" style="padding:4px 0"><input type="checkbox" value="${s.id}"> ${esc(s.name)} <span class="muted small">· ${durTxt(s.duration_min)}</span></label>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>اليوم</label><input class="input" type="date" id="m-day" value="${tomorrow}"></div><div class="field"><label>الوقت</label><select class="input" id="m-time"><option value="">اختر الخدمات واليوم</option></select></div></div>
      <div class="field"><label>الحي</label><select class="input" id="m-dist">${cat.districts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>العنوان</label><input class="input" id="m-addr"></div>
      <div class="field"><label>ملاحظات</label><input class="input" id="m-notes"></div>
      <div class="actions end mt"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="m-save">حفظ الحجز</button></div>`, (el, close) => {
      const dur = () => $$('#m-svcs input:checked', el).reduce((s, c) => s + (cat.services.find((x) => x.id === Number(c.value))?.duration_min || 0), 0);
      const loadTimes = async () => {
        const d = dur(); const day = $('#m-day', el).value; const sel = $('#m-time', el);
        if (!d || !day) { sel.innerHTML = '<option value="">اختر الخدمات واليوم</option>'; return; }
        const rows = await q(sb.rpc('bh_slots', { p_day: day, p_duration: d }));
        sel.innerHTML = rows.length ? rows.map((r) => { const [h, m] = r.slot.split(':').map(Number); return `<option value="${r.slot}">${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}</option>`; }).join('') : '<option value="">ما فيه وقت متاح</option>';
      };
      $('#m-svcs', el).addEventListener('change', loadTimes);
      $('#m-day', el).addEventListener('change', loadTimes);
      $('#m-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const items = $$('#m-svcs input:checked', el).map((c) => ({ id: Number(c.value), qty: 1 }));
        if (!items.length) return toast('اختر خدمة', true);
        if (!$('#m-time', el).value) return toast('اختر الوقت', true);
        try {
          const res = await q(sb.rpc('bh_create_booking', { p: { name: $('#m-name', el).value, phone: $('#m-phone', el).value, district_id: Number($('#m-dist', el).value), address: $('#m-addr', el).value, notes: $('#m-notes', el).value, day: $('#m-day', el).value, time: $('#m-time', el).value, items } }));
          const b = await q(sb.from('home_bookings').update({ source: 'admin' }).eq('access_token', res.token).select('id').single());
          toast(`تم إنشاء الحجز ${res.code}`); close(); location.hash = `#/booking/${b.id}`;
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  async function pageBooking(view, [id], _p, alive) {
    const [b, items, events] = await Promise.all([
      q(sb.from('home_bookings').select('*').eq('id', id).maybeSingle()),
      q(sb.from('home_booking_items').select('*').eq('booking_id', id).order('id')),
      q(sb.from('home_booking_events').select('*').eq('booking_id', id).order('created_at', { ascending: false })),
    ]);
    if (!alive()) return;
    if (!b) { view.innerHTML = '<div class="notice danger">الحجز غير موجود أو ليس لديك صلاحية</div>'; return; }
    setTitle(`حجز ${b.code}`);
    const mgr = isManager();
    const mine = b.staff_id === S.profile.id;
    const staffList = [...S.profiles.values()].filter((p) => p.is_active);
    const svcSum = items.every((i) => i.price != null) ? items.reduce((s, i) => s + Number(i.price) * i.qty, 0) : null;
    const next = { pending: ['confirmed'], confirmed: ['on_way', 'done'], on_way: ['done'], done: [], cancelled: [] }[b.status];
    const nextLabel = { confirmed: 'تأكيد الحجز', on_way: 'في الطريق', done: 'تمت الزيارة' };
    const tpls = waTemplates(b, items);
    view.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
          <div><div style="font-size:20px;font-weight:700">${esc(b.customer_name)}</div><div class="muted small num">${esc(b.code)} · ${b.source === 'admin' ? 'حجز يدوي' : 'من الموقع'} · ${fmtDateTime(b.created_at)}</div></div>
          <span class="badge ${BK_BADGE[b.status]}">${BK_STATUS[b.status]}</span>
        </div>
        <div style="font-size:17px;margin-top:12px;font-weight:600">${esc(rDayLabel(rDay(b.starts_at)))} · ${rTime(b.starts_at)} – ${rTime(b.ends_at)}</div>
        <div class="actions mt">
          ${next.filter((s) => mgr || (mine && s !== 'confirmed')).map((s) => `<button class="btn primary" data-status="${s}">${nextLabel[s]}</button>`).join('')}
          <a class="btn" href="tel:${esc(b.phone)}">اتصال</a>
          ${mgr && !['done', 'cancelled'].includes(b.status) ? '<button class="btn" id="bk-cancel" style="color:var(--danger)">إلغاء الحجز</button>' : ''}
        </div>
      </div>

      <div class="section-title"><h2>رسائل واتساب جاهزة</h2></div>
      <div class="chips" style="flex-wrap:wrap">${tpls.map((t) => `<a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(b.phone)}?text=${encodeURIComponent(t.text)}">${t.label}</a>`).join('')}</div>

      <div class="section-title"><h2>العميلة والعنوان</h2></div>
      <div class="list">
        <div class="row"><div class="grow"><div class="meta">الجوال</div><div class="title num" dir="ltr" style="text-align:right">${esc(b.phone)}</div></div></div>
        <div class="row"><div class="grow"><div class="meta">العنوان</div><div style="white-space:normal">${esc(b.district_name || '')}${b.address ? '، ' + esc(b.address) : ''}</div></div>${b.map_url && /^https?:\/\//.test(b.map_url) ? `<a class="btn" href="${esc(b.map_url)}" target="_blank" rel="noopener">الخريطة</a>` : ''}</div>
        ${b.notes ? `<div class="row"><div class="grow"><div class="meta">ملاحظات العميلة</div><div style="white-space:normal">${esc(b.notes)}</div></div></div>` : ''}
      </div>

      <div class="section-title"><h2>الخدمات والمبالغ</h2></div>
      <div class="list">
        ${items.map((i) => `<div class="row"><div class="grow"><div class="title">${esc(i.name)}${i.qty > 1 ? ` × ${i.qty}` : ''}</div><div class="meta">${durTxt(i.duration_min * i.qty)}</div></div><div class="end num">${i.price != null ? money(i.price * i.qty) : '<span class="muted">بدون سعر</span>'}</div></div>`).join('')}
        <div class="row"><div class="grow">رسوم الزيارة</div><div class="end num">${b.visit_fee != null ? money(b.visit_fee) : '—'}</div></div>
        <div class="row"><div class="grow" style="font-weight:700">الإجمالي</div><div class="end num" style="font-weight:700">${b.total != null ? money(b.total) : '<span class="badge warn">يحتاج تحديد</span>'}</div></div>
      </div>

      ${mgr ? `
      <div class="section-title"><h2>الإدارة</h2></div>
      <div class="card">
        <div class="grid2">
          <div class="field"><label>الأخصائية</label><select class="input" id="f-staff"><option value="">بدون تعيين</option>${staffList.map((p) => `<option value="${p.id}" ${p.id === b.staff_id ? 'selected' : ''}>${esc(p.full_name || p.login)}</option>`).join('')}</select></div>
          <div class="field"><label>الإجمالي النهائي (ر.س)</label><input class="input num" id="f-total" type="number" min="0" step="0.01" value="${b.total ?? (svcSum != null && b.visit_fee != null ? svcSum + Number(b.visit_fee) : '')}"></div>
        </div>
        <div class="grid3">
          <div class="field"><label>الدفع</label><select class="input" id="f-pay">${Object.entries(PAY_STATUS).map(([k, l]) => `<option value="${k}" ${k === b.payment_status ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>طريقة الدفع</label><select class="input" id="f-method"><option value="">—</option>${PAY_METHODS.map((m) => `<option ${m === b.payment_method ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="field"><label>رقم العملية / ركاز</label><input class="input" id="f-ref" value="${esc(b.payment_ref || b.rekaz_reservation_id || '')}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>نقل الموعد: اليوم</label><input class="input" type="date" id="f-day" value="${rDay(b.starts_at)}"></div>
          <div class="field"><label>الوقت</label><input class="input" type="time" id="f-time" value="${rHM(b.starts_at)}" step="900"></div>
        </div>
        <div class="field"><label>ملاحظة داخلية</label><textarea class="input" id="f-note">${esc(b.internal_note || '')}</textarea></div>
        <div class="actions end"><button class="btn primary" id="f-save">حفظ التعديلات</button></div>
      </div>` : ''}

      <div class="section-title"><h2>السجل</h2></div>
      <div class="list">${events.map((e) => `<div class="row"><div class="grow"><div>${esc({ created: 'إنشاء الحجز', status: 'تغيير الحالة', payment: 'تغيير الدفع', reschedule: 'نقل الموعد', staff: 'تعيين أخصائية', note: 'ملاحظة' }[e.kind] || e.kind)} ${e.note ? `<span class="muted small">${esc(e.note.replace(/pending|confirmed|on_way|done|cancelled|unpaid|paid|refunded/g, (m) => BK_STATUS[m] || PAY_STATUS[m]))}</span>` : ''}</div><div class="meta">${fmtDateTime(e.created_at)}${e.created_by ? ' · ' + esc(personName(e.created_by)) : ''}</div></div></div>`).join('') || '<div class="empty">لا يوجد سجل</div>'}</div>`;

    $$('[data-status]', view).forEach((btn) => btn.onclick = () => busy(btn, async () => {
      try {
        if (mgr) await q(sb.from('home_bookings').update({ status: btn.dataset.status }).eq('id', b.id));
        else await q(sb.rpc('bh_staff_status', { p_id: b.id, p_status: btn.dataset.status }));
        toast('تم التحديث');
        if (btn.dataset.status === 'confirmed') toast('تم التأكيد، أرسل رسالة التأكيد للعميلة');
        route();
      } catch (err) { toast(errMsg(err), true); }
    }));
    $('#bk-cancel')?.addEventListener('click', async () => {
      if (!(await confirmBox('إلغاء الحجز', `إلغاء حجز ${esc(b.customer_name)}؟ يتحرر الوقت للحجوزات الثانية.`, 'إلغاء الحجز', true))) return;
      try { await q(sb.from('home_bookings').update({ status: 'cancelled', cancel_reason: 'ألغته الإدارة' }).eq('id', b.id)); toast('تم الإلغاء'); route(); } catch (err) { toast(errMsg(err), true); }
    });
    $('#f-save')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const patch = {
        staff_id: $('#f-staff').value || null,
        total: $('#f-total').value === '' ? null : Number($('#f-total').value),
        payment_status: $('#f-pay').value,
        payment_method: $('#f-method').value || null,
        payment_ref: $('#f-ref').value.trim() || null,
        internal_note: $('#f-note').value.trim() || null,
      };
      const day = $('#f-day').value; const tm = $('#f-time').value;
      if (day && tm && (day !== rDay(b.starts_at) || tm !== rHM(b.starts_at))) {
        const mins = bkMinutes(b);
        const st = new Date(`${day}T${tm}:00+03:00`);
        patch.starts_at = st.toISOString();
        patch.ends_at = new Date(st.getTime() + mins * 60000).toISOString();
      }
      try { await q(sb.from('home_bookings').update(patch).eq('id', b.id)); toast('تم الحفظ'); route(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  async function pageHomeSvc(view, _a, params, alive) {
    const tab = params.get('t') || 'services';
    const [services, districts, settings, blackouts] = await Promise.all([
      q(sb.from('home_services').select('*').order('sort').order('id')),
      q(sb.from('home_districts').select('*').order('sort').order('name')),
      q(sb.from('home_settings').select('*').eq('id', 1).single()),
      q(sb.from('home_blackouts').select('*').gte('day', rDay(Date.now())).order('day')),
    ]);
    if (!alive()) return;
    const tabs = [['services', 'الخدمات'], ['districts', 'الأحياء'], ['settings', 'المواعيد والإعدادات'], ['off', 'الإجازات']];
    let body = '';
    if (tab === 'services') {
      body = `<div class="actions" style="margin-bottom:12px"><button class="btn primary" id="svc-new">${I.plus} خدمة جديدة</button></div>
        ${Object.entries(SVC_CAT).filter(([k]) => services.some((s) => s.category === k)).map(([k, l]) => `
          <div class="section-title"><h2>${l}</h2></div>
          <div class="list">${services.filter((s) => s.category === k).map((s) => `<button class="row" data-svc="${s.id}"><div class="grow"><div class="title">${esc(s.name)}${s.is_active ? '' : ' <span class="badge">موقوفة</span>'}</div><div class="meta">${durTxt(s.duration_min)}${s.description ? ' · ' + esc(s.description) : ''}</div></div><div class="end num">${s.price != null ? money(s.price) : '<span class="badge warn">بدون سعر</span>'}</div></button>`).join('')}</div>`).join('')}
        <p class="muted small mt">الخدمة اللي بدون سعر تظهر للعميلة «يُحدد عند التأكيد».</p>`;
    } else if (tab === 'districts') {
      body = `<div class="actions" style="margin-bottom:12px"><button class="btn primary" id="dist-new">${I.plus} حي جديد</button></div>
        <div class="list">${districts.map((d) => `<button class="row" data-dist="${d.id}"><div class="grow"><div class="title">${esc(d.name)}${d.is_active ? '' : ' <span class="badge">موقوف</span>'}</div></div><div class="end num">${d.visit_fee != null ? money(d.visit_fee) : '<span class="muted">رسوم تُحدد</span>'}</div></button>`).join('') || '<div class="empty">أضف الأحياء اللي تغطونها. الحجز ما يفتح بدونها.</div>'}</div>`;
    } else if (tab === 'settings') {
      const s = settings;
      body = `<div class="card">
        <label class="check" style="margin-bottom:16px;font-weight:600"><input type="checkbox" id="s-acc" ${s.accepting ? 'checked' : ''}> استقبال الحجوزات من الموقع</label>
        <div class="grid2"><div class="field"><label>بداية الاستقبال</label><input class="input" type="time" id="s-open" value="${s.open_time.slice(0, 5)}"></div><div class="field"><label>آخر وقت للانتهاء</label><input class="input" type="time" id="s-close" value="${s.close_time.slice(0, 5)}"></div></div>
        <div class="grid3">
          <div class="field"><label>عدد الفرق في نفس الوقت</label><input class="input num" type="number" min="1" max="20" id="s-cap" value="${s.capacity}"></div>
          <div class="field"><label>وقت التنقل بين الزيارات (د)</label><input class="input num" type="number" min="0" max="180" id="s-buf" value="${s.buffer_minutes}"></div>
          <div class="field"><label>الفاصل بين الأوقات (د)</label><input class="input num" type="number" min="10" max="120" id="s-slot" value="${s.slot_minutes}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>أقل مدة قبل الموعد (ساعات)</label><input class="input num" type="number" min="0" max="72" id="s-lead" value="${s.lead_hours}"></div>
          <div class="field"><label>يفتح الحجز لكم يوم قدّام</label><input class="input num" type="number" min="1" max="90" id="s-hor" value="${s.horizon_days}"></div>
        </div>
        <div class="field"><label>أيام الإجازة الأسبوعية</label><div style="display:flex;flex-wrap:wrap;gap:12px">${WDAYS.map((d, i) => `<label class="check"><input type="checkbox" data-wd="${i}" ${s.closed_weekdays.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
        <div class="field"><label>رقم واتساب الخدمة</label><input class="input" id="s-wa" dir="ltr" value="${esc(s.whatsapp || '')}" placeholder="05xxxxxxxx"></div>
        <div class="field"><label>نص الدفع للعميلة</label><input class="input" id="s-pay" value="${esc(s.payment_note || '')}"></div>
        <div class="field"><label>نص سياسة الحجز</label><textarea class="input" id="s-pol">${esc(s.policy_note || '')}</textarea></div>
        <div class="actions end"><button class="btn primary" id="s-save">حفظ</button></div>
      </div>`;
    } else {
      body = `<div class="card"><div class="grid2"><div class="field"><label>اليوم</label><input class="input" type="date" id="o-day" min="${rDay(Date.now())}"></div><div class="field"><label>ملاحظة</label><input class="input" id="o-note" placeholder="مثلًا: إجازة العيد"></div></div><div class="actions end"><button class="btn primary" id="o-add">إضافة</button></div></div>
        <div class="list mt">${blackouts.map((o) => `<div class="row"><div class="grow"><div class="title">${esc(rDayLabel(o.day))}</div>${o.note ? `<div class="meta">${esc(o.note)}</div>` : ''}</div><button class="btn" data-off="${o.day}">حذف</button></div>`).join('') || '<div class="empty">ما فيه إجازات قادمة</div>'}</div>`;
    }
    view.innerHTML = `<div class="chips">${tabs.map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/homesvc?t=${k}">${l}</a>`).join('')}</div>${body}`;

    const svcForm = (s) => modal(`
      <h3>${s ? 'تعديل خدمة' : 'خدمة جديدة'}</h3>
      <div class="field"><label>الاسم</label><input class="input" id="v-name" value="${esc(s?.name || '')}"></div>
      <div class="grid2"><div class="field"><label>القسم</label><select class="input" id="v-cat">${Object.entries(SVC_CAT).map(([k, l]) => `<option value="${k}" ${s?.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>الترتيب</label><input class="input num" type="number" id="v-sort" value="${s?.sort ?? 0}"></div></div>
      <div class="grid2"><div class="field"><label>المدة (دقيقة)</label><input class="input num" type="number" min="10" max="600" id="v-dur" value="${s?.duration_min ?? 60}"></div>
      <div class="field"><label>السعر (ر.س)</label><input class="input num" type="number" min="0" step="0.01" id="v-price" value="${s?.price ?? ''}" placeholder="فارغ = يُحدد عند التأكيد"></div></div>
      <div class="field"><label>الوصف</label><textarea class="input" id="v-desc">${esc(s?.description || '')}</textarea></div>
      <label class="check"><input type="checkbox" id="v-act" ${s?.is_active !== false ? 'checked' : ''}> تظهر في موقع الحجز</label>
      <div class="actions end mt"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="v-save">حفظ</button></div>`, (el, close) => {
      $('#v-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#v-name', el).value.trim(), category: $('#v-cat', el).value, sort: Number($('#v-sort', el).value) || 0, duration_min: Number($('#v-dur', el).value), price: $('#v-price', el).value === '' ? null : Number($('#v-price', el).value), description: $('#v-desc', el).value.trim() || null, is_active: $('#v-act', el).checked };
        try { if (s) await q(sb.from('home_services').update(row).eq('id', s.id)); else await q(sb.from('home_services').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    });
    const distForm = (d) => modal(`
      <h3>${d ? 'تعديل حي' : 'حي جديد'}</h3>
      <div class="field"><label>اسم الحي</label><input class="input" id="d-name" value="${esc(d?.name || '')}"></div>
      <div class="grid2"><div class="field"><label>رسوم الزيارة (ر.س)</label><input class="input num" type="number" min="0" step="0.01" id="d-fee" value="${d?.visit_fee ?? ''}" placeholder="فارغ = تُحدد عند التأكيد"></div><div class="field"><label>الترتيب</label><input class="input num" type="number" id="d-sort" value="${d?.sort ?? 0}"></div></div>
      <label class="check"><input type="checkbox" id="d-act" ${d?.is_active !== false ? 'checked' : ''}> متاح للحجز</label>
      <div class="actions end mt"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="d-save">حفظ</button></div>`, (el, close) => {
      $('#d-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#d-name', el).value.trim(), visit_fee: $('#d-fee', el).value === '' ? null : Number($('#d-fee', el).value), sort: Number($('#d-sort', el).value) || 0, is_active: $('#d-act', el).checked };
        try { if (d) await q(sb.from('home_districts').update(row).eq('id', d.id)); else await q(sb.from('home_districts').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    });
    $('#svc-new')?.addEventListener('click', () => svcForm(null));
    $$('[data-svc]', view).forEach((b) => b.onclick = () => svcForm(services.find((s) => s.id === Number(b.dataset.svc))));
    $('#dist-new')?.addEventListener('click', () => distForm(null));
    $$('[data-dist]', view).forEach((b) => b.onclick = () => distForm(districts.find((d) => d.id === Number(b.dataset.dist))));
    $('#s-save')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const row = {
        accepting: $('#s-acc').checked, open_time: $('#s-open').value, close_time: $('#s-close').value,
        capacity: Number($('#s-cap').value), buffer_minutes: Number($('#s-buf').value), slot_minutes: Number($('#s-slot').value),
        lead_hours: Number($('#s-lead').value), horizon_days: Number($('#s-hor').value),
        closed_weekdays: $$('[data-wd]:checked', view).map((c) => Number(c.dataset.wd)),
        whatsapp: $('#s-wa').value.trim() || null, payment_note: $('#s-pay').value.trim() || null, policy_note: $('#s-pol').value.trim() || null,
        updated_at: new Date().toISOString(),
      };
      try { await q(sb.from('home_settings').update(row).eq('id', 1)); toast('تم الحفظ'); } catch (err) { toast(errMsg(err), true); }
    }));
    $('#o-add')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const day = $('#o-day').value; if (!day) return toast('اختر اليوم', true);
      try { await q(sb.from('home_blackouts').upsert({ day, note: $('#o-note').value.trim() || null })); toast('تمت الإضافة'); route(); } catch (err) { toast(errMsg(err), true); }
    }));
    $$('[data-off]', view).forEach((b) => b.onclick = () => busy(b, async () => {
      try { await q(sb.from('home_blackouts').delete().eq('day', b.dataset.off)); route(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  /* ======================= clients ======================= */
  const SEG = { new: ['جديدة', 'accent'], regular: ['دائمة', 'ok'], vip: ['VIP', 'gold'], away: ['غابت عنّا', 'warn'] };
  const SRC = { salon: 'الصالون', home: 'هوم', instagram: 'انستقرام', tiktok: 'تيك توك', snap: 'سناب', referral: 'من صديقة', walkin: 'مرّت علينا', other: 'أخرى' };
  const QUICK_SVC = ['مانيكير', 'بديكير', 'جيل', 'أكريليك', 'استشوار', 'صبغة', 'قص', 'بروتين', 'مكياج', 'رموش', 'حواجب'];
  const FB_KIND = { praise: ['مديح', 'ok'], complaint: ['شكوى', 'danger'], suggestion: ['اقتراح', 'accent'] };
  const FB_CH = { salon: 'في الصالون', whatsapp: 'واتساب', instagram: 'انستقرام', google: 'قوقل', call: 'اتصال', other: 'أخرى' };
  const ago = (d) => {
    if (!d) return 'ما زارتنا بعد';
    const n = Math.round((D(todayR()) - D(d)) / 86400000);
    if (n <= 0) return 'اليوم'; if (n === 1) return 'أمس'; if (n === 2) return 'قبل يومين';
    if (n < 11) return `قبل ${n} أيام`; if (n < 60) return `قبل ${n} يوم`;
    const m = Math.round(n / 30); return m < 11 ? `قبل ${m} أشهر` : m < 12 ? `قبل ${m} شهر` : 'قبل أكثر من سنة';
  };
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
  const ROSETTE = '../home/assets/rosette-1.svg';
  let LOYAL = null;
  async function loyalty() { if (!LOYAL) LOYAL = await q(sb.from('loyalty_settings').select('*').eq('id', 1).maybeSingle()) || { stamps: 6, reward: 'خدمة هدية', active: true }; return LOYAL; }

  function stampRow(n, total, size = '') {
    return `<div class="stamps ${size}">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}" style="--d:${i * 60}ms">${i < n ? `<img src="${ROSETTE}" alt="">` : `<b>${i + 1}</b>`}</i>`).join('')}</div>`;
  }

  async function pageClients(view, _a, params, alive) {
    const seg = params.get('s') || 'all';
    const [rows, L] = await Promise.all([q(sb.from('clients_overview').select('*').order('last_visit', { ascending: false, nullsFirst: false }).limit(3000)), loyalty()]);
    if (!alive()) return;
    const mNow = new Date(todayR()).getMonth();
    const bday = (c) => c.birthday && D(c.birthday).getMonth() === mNow;
    const count = { all: rows.length, regular: 0, vip: 0, away: 0, new: 0, bday: rows.filter(bday).length, reward: rows.filter((c) => L.active && c.stamps >= L.stamps).length };
    rows.forEach((c) => { count[c.segment]++; });
    const tiles = [['all', 'كل العميلات', ''], ['regular', 'دائمات', 'ok'], ['vip', 'VIP', 'gold'], ['away', 'غابوا عنّا', 'warn']];
    view.innerHTML = `
      <div class="seg-tiles">${tiles.map(([k, l, c]) => `<a class="seg-tile ${c} ${seg === k ? 'on' : ''}" href="#/clients?s=${k}"><b class="num">${count[k]}</b><span>${l}</span></a>`).join('')}</div>
      <div class="chips wrap" style="margin:12px 0">
        <a class="chip ${seg === 'new' ? 'on' : ''}" href="#/clients?s=new">جديدات (${count.new})</a>
        <a class="chip ${seg === 'bday' ? 'on' : ''}" href="#/clients?s=bday">🎂 ميلادها هالشهر (${count.bday})</a>
        ${L.active ? `<a class="chip ${seg === 'reward' ? 'on' : ''}" href="#/clients?s=reward">مكافأتها جاهزة (${count.reward})</a>` : ''}
      </div>
      <div class="cl-bar"><input class="input" id="cl-q" type="search" placeholder="بحث بالاسم أو الجوال" autocomplete="off">
        <button class="btn primary" id="cl-new">${I.plus} عميلة</button></div>
      <div class="actions" style="margin:-4px 0 14px"><a class="btn sm" href="#/feedback">الآراء والملاحظات</a>${isManager() ? '<button class="btn sm" id="cl-loyal">بطاقة الولاء</button>' : ''}</div>
      ${seg === 'away' && count.away ? '<div class="notice info">هذولي آخر زيارة لهم قبل أكثر من ٤٥ يوم. رسالة «وحشتينا» وحدة ممكن ترجّعهم.</div>' : ''}
      <div class="list" id="cl-list"></div>`;
    const list = $('#cl-list');
    const pool = rows.filter((c) => seg === 'all' ? true : seg === 'bday' ? bday(c) : seg === 'reward' ? L.active && c.stamps >= L.stamps : c.segment === seg);
    const draw = () => {
      const t = $('#cl-q').value.trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      const res = t ? pool.filter((c) => c.name.includes(t) || (c.phone || '').includes(t.replace(/\D/g, '') || '~')) : pool;
      list.innerHTML = res.length ? res.slice(0, 300).map((c) => `
        <a class="row" href="#/client/${c.id}">
          <span class="cav ${c.segment}">${esc(initial(c.name))}</span>
          <div class="grow"><div class="title">${esc(c.name)} ${c.segment !== 'new' ? `<span class="badge ${SEG[c.segment][1]}">${SEG[c.segment][0]}</span>` : ''}</div>
            <div class="meta">${ago(c.last_visit)}${c.visits ? ` · ${c.visits} ${c.visits === 1 ? 'زيارة' : c.visits <= 10 ? 'زيارات' : 'زيارة'}` : ''}${c.spend > 0 ? ` · ${sar(c.spend)} ر.س` : ''}</div></div>
          <div class="end">${L.active ? `<span class="mini-st ${c.stamps >= L.stamps ? 'full' : ''}"><img src="${ROSETTE}" alt="">${Math.min(c.stamps, L.stamps)}/${L.stamps}</span>` : ''}
            ${seg === 'away' && c.phone ? `<span class="wa-mini" data-wa="${c.id}">وحشتينا</span>` : ''}</div>
        </a>`).join('') : `<div class="empty">${rows.length ? 'ما فيه نتائج' : 'ابدؤوا بإضافة أول عميلة. وكل حجز منزلي يكتمل ينضاف هنا تلقائيًا.'}</div>`;
      $$('[data-wa]', list).forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault(); const c = rows.find((x) => String(x.id) === b.dataset.wa);
        window.open(`https://wa.me/${waNum(c.phone)}?text=${encodeURIComponent(waTpl(c, L).miss)}`, '_blank', 'noopener');
      }));
    };
    $('#cl-q').addEventListener('input', draw); draw();
    $('#cl-new').onclick = () => clientForm(null, (id) => { location.hash = `#/client/${id}`; });
    $('#cl-loyal')?.addEventListener('click', loyaltyForm);
  }

  function waTpl(c, L) {
    const n = firstName(c.name); const left = Math.max(0, L.stamps - c.stamps);
    return {
      thanks: `هلا ${n} 🤍\nشكرًا لزيارتك بيوتفريش اليوم، إن شاء الله عجبتك النتيجة.\nرأيك يهمنا، وإذا فيه أي ملاحظة قولي لنا.`,
      miss: `هلا ${n} 🤍\nوحشتينا في بيوتفريش! صار لك فترة ما جيتي.\nودّك نرتب لك موعد هالأسبوع؟`,
      bday: `كل عام وأنتِ بخير يا ${n} 🎂\nبمناسبة ميلادك، هديتك من بيوتفريش بانتظارك هالشهر.`,
      stamps: left ? `هلا ${n} 🤍\nباقي لك ${left === 1 ? 'زيارة وحدة' : left === 2 ? 'زيارتين' : left + ' زيارات'} وتوصلين لمكافأتك في بيوتفريش: ${L.reward}.` : `هلا ${n} 🤍\nمبروك! وصلتي لمكافأتك في بيوتفريش: ${L.reward}.\nنستناك بزيارتك الجاية.`,
      remind: `هلا ${n} 🤍\nنذكّرك بموعدك في بيوتفريش.\nإذا تبين تغيرين الوقت كلمينا هنا.`,
    };
  }

  async function pageClient(view, args, _p, alive) {
    const id = Number(args[0]);
    const [c, visits, reds, fb, L] = await Promise.all([
      q(sb.from('clients_overview').select('*').eq('id', id).maybeSingle()),
      q(sb.from('client_visits').select('*').eq('client_id', id).order('day', { ascending: false }).order('id', { ascending: false }).limit(200)),
      q(sb.from('loyalty_redemptions').select('*').eq('client_id', id).order('day', { ascending: false })),
      q(sb.from('client_feedback').select('*').eq('client_id', id).order('day', { ascending: false })),
      loyalty(),
    ]);
    if (!alive()) return;
    if (!c) { view.innerHTML = '<div class="notice danger">ما لقينا هذي العميلة</div>'; return; }
    setTitle(c.name);
    const avg = c.visits ? c.spend / c.visits : 0;
    const full = L.active && c.stamps >= L.stamps;
    const T = waTpl(c, L);
    const tok = (await q(sb.from('clients').select('card_token').eq('id', id).maybeSingle()).catch(() => null))?.card_token;
    const cardUrl = tok ? new URL(`../card/#${tok}`, location.href).href : null;
    if (cardUrl) T.card = `هلا ${firstName(c.name)} 🤍\nهذي بطاقتك في بيوتفريش، تشوفين فيها أختامك ومكافأتك وزياراتك:\n${cardUrl}`;
    const tpls = [['thanks', 'شكر بعد الزيارة'], ['remind', 'تذكير بموعد'], ['stamps', full ? 'مكافأتك جاهزة' : 'كم باقي للمكافأة'], ...(cardUrl ? [['card', '🪪 رابط بطاقتها']] : []), ['miss', 'وحشتينا'], ['bday', 'عيد ميلاد']];
    let freq = null;
    if (visits.length >= 3) { const ds = visits.map((v) => D(v.day)).sort((a, b) => a - b); freq = Math.round((ds[ds.length - 1] - ds[0]) / 86400000 / (ds.length - 1)); }
    const nextDue = freq && c.last_visit ? new Date(D(c.last_visit).getTime() + freq * 86400000) : null;
    view.innerHTML = `
      <div class="cl-hero">
        <span class="cav big ${c.segment}">${esc(initial(c.name))}</span>
        <div class="grow"><h2>${esc(c.name)}</h2>
          <div class="cl-sub"><span class="badge ${SEG[c.segment][1]}">${SEG[c.segment][0]}</span>${c.phone ? `<span class="num" dir="ltr">${esc(c.phone)}</span>` : ''}${c.birthday ? `<span>🎂 ${D(c.birthday).getDate()} ${MONTHS_AR[D(c.birthday).getMonth()]}</span>` : ''}<span>${SRC[c.source] || ''}</span></div></div>
        <div class="cl-acts">${c.phone ? `<a class="icon-btn" href="https://wa.me/${waNum(c.phone)}" target="_blank" rel="noopener" aria-label="واتساب">${I.wa}</a><a class="icon-btn" href="tel:${esc(c.phone)}" aria-label="اتصال">${I.phone}</a>` : ''}<button class="icon-btn" id="c-edit" aria-label="تعديل">${I.edit}</button></div>
      </div>
      <div class="cl-stats">
        <div><b class="num">${c.visits}</b><span>زيارة</span></div>
        <div><b class="num">${sar(c.spend)}</b><span>إجمالي ر.س</span></div>
        <div><b class="num">${sar(avg)}</b><span>متوسط الزيارة</span></div>
        <div class="lv"><b>${c.last_visit ? ago(c.last_visit) : '—'}</b><span>آخر زيارة</span></div>
      </div>
      ${freq ? `<div class="cl-rhythm">${I.cal}<span>تزورنا كل <b>${freq}</b> يوم تقريبًا${nextDue ? `، وزيارتها الجاية المتوقعة ${D(dk(nextDue)) < D(todayR()) ? `<b class="late">تأخرت ${Math.round((D(todayR()) - nextDue) / 86400000)} يوم</b>` : `حوالي <b>${nextDue.getDate()} ${MONTHS_AR[nextDue.getMonth()]}</b>`}` : ''}</span></div>` : ''}

      ${L.active ? `<div class="loyal-card ${full ? 'full' : ''}">
        <div class="lc-top"><img class="lc-logo" src="../home/assets/Beautfresh-brown.svg" alt=""><span>بطاقة الولاء</span></div>
        ${stampRow(Math.min(c.stamps, L.stamps), L.stamps)}
        <div class="lc-foot">${full ? `<b>وصلت لمكافأتها 🤍</b><span>${esc(L.reward)}</span>` : `<span>باقي ${L.stamps - c.stamps} وتوصل لـ: ${esc(L.reward)}</span>`}</div>
        <div class="lc-acts"><button class="btn on-oud" id="c-visit">${I.plus} ختم زيارة</button>${full ? '<button class="btn on-oud ghost" id="c-redeem">استلمت المكافأة</button>' : ''}</div>
      </div>` : `<div class="actions"><button class="btn primary" id="c-visit">${I.plus} زيارة</button></div>`}

      <div class="section-title"><h2>رسالة جاهزة</h2></div>
      <div class="chips wrap">${c.phone ? tpls.map(([k, l]) => `<a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(c.phone)}?text=${encodeURIComponent(T[k])}">${l}</a>`).join('') : '<span class="muted small">أضيفوا رقم جوالها عشان تطلع الرسائل</span>'}</div>

      ${c.prefs || c.notes ? `<div class="fin-grid">
        ${c.prefs ? `<div><div class="section-title"><h2>تفضيلاتها</h2></div><div class="card note-card">${esc(c.prefs)}</div></div>` : ''}
        ${c.notes ? `<div><div class="section-title"><h2>ملاحظات</h2></div><div class="card note-card">${esc(c.notes)}</div></div>` : ''}
      </div>` : `<button class="add-note" id="c-addpref">${I.plus} أضيفوا تفضيلاتها: لونها المفضل، شكل الأظافر، أي حساسية…</button>`}

      <div class="section-title"><h2>الزيارات</h2><span class="muted small">${visits.length}</span></div>
      <div class="list">${visits.length ? visits.map((v) => `
        <div class="row"><span class="vdot ${v.channel}">${v.channel === 'home' ? I.home : '<img src="' + ROSETTE + '" alt="">'}</span>
          <div class="grow"><div class="title">${esc(v.services || (v.channel === 'home' ? 'زيارة منزلية' : 'زيارة'))}</div><div class="meta">${D(v.day).getDate()} ${MONTHS_AR[D(v.day).getMonth()]} ${D(v.day).getFullYear()} · ${v.channel === 'home' ? 'هوم' : 'الصالون'}${v.note ? ' · ' + esc(v.note) : ''}</div></div>
          <div class="end">${v.amount != null ? `<b class="num">${sar(v.amount)}</b> <span class="muted small">ر.س</span>` : ''}${isManager() && !v.booking_id ? `<button class="x-btn" data-delv="${v.id}" aria-label="حذف">×</button>` : ''}</div></div>`).join('') : '<div class="empty">ما فيه زيارات مسجلة</div>'}</div>
      ${reds.length ? `<p class="muted small mt">استلمت مكافأة الولاء ${reds.length} ${reds.length === 1 ? 'مرة' : 'مرات'}، آخرها ${ago(reds[0].day)}.</p>` : ''}

      <div class="section-title"><h2>آراؤها</h2><button class="btn sm" id="c-fb">${I.plus} رأي أو ملاحظة</button></div>
      ${fb.length ? `<div class="list">${fb.map(fbRow).join('')}</div>` : '<div class="muted small">ما فيه شي مسجل</div>'}
      ${isManager() ? '<div class="actions end mt"><button class="btn danger sm" id="c-del">حذف ملف العميلة</button></div>' : ''}`;
    $('#c-edit').onclick = () => clientForm(c, () => route());
    $('#c-addpref')?.addEventListener('click', () => clientForm(c, () => route()));
    $('#c-visit').onclick = () => visitForm(c, () => route());
    $('#c-fb').onclick = () => feedbackForm(null, c, () => route());
    $('#c-redeem')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try { await q(sb.from('loyalty_redemptions').insert({ client_id: c.id, reward: L.reward })); toast('تم تسجيل المكافأة، البطاقة بدأت من جديد'); route(); } catch (err) { toast(errMsg(err), true); }
    }));
    $$('[data-delv]', view).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('حذف الزيارة', 'تنحذف الزيارة من ملفها ومن أختام البطاقة.', 'حذف', true))) return;
      try { await q(sb.from('client_visits').delete().eq('id', Number(b.dataset.delv))); route(); } catch (err) { toast(errMsg(err), true); }
    }));
    bindFb(view);
    $('#c-del')?.addEventListener('click', async () => {
      if (!(await confirmBox('حذف ملف العميلة', `ينحذف ملف ${esc(c.name)} وكل زياراتها. ما يمكن التراجع.`, 'حذف', true))) return;
      try { await q(sb.from('clients').delete().eq('id', c.id)); toast('تم الحذف'); location.hash = '#/clients'; } catch (err) { toast(errMsg(err), true); }
    });
  }

  const normPhone = (v) => { let p = String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, ''); if (p.startsWith('966')) p = '0' + p.slice(3); if (/^5\d{8}$/.test(p)) p = '0' + p; return p; };

  function clientForm(c, done) {
    let src = c?.source || 'salon', vip = !!c?.vip;
    modal(`
      <h3>${c ? 'تعديل بيانات العميلة' : 'عميلة جديدة'}</h3>
      <div class="field"><label>الاسم</label><input class="input" id="k-name" value="${esc(c?.name || '')}" maxlength="60"></div>
      <div class="grid2"><div class="field"><label>الجوال</label><input class="input num" id="k-phone" inputmode="tel" dir="ltr" placeholder="05xxxxxxxx" value="${esc(c?.phone || '')}"></div>
      <div class="field"><label>تاريخ الميلاد <span class="muted small">(اختياري)</span></label><input class="input" id="k-bd" type="date" value="${c?.birthday || ''}"></div></div>
      <div class="field"><label>عرفتنا من</label><div class="chips wrap" id="k-src">${Object.entries(SRC).map(([k, l]) => `<button type="button" class="chip ${k === src ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <label class="toggle-row"><span><b>عميلة VIP</b><small>تطلع بلون مميز في القائمة</small></span><button type="button" class="sw ${vip ? 'on' : ''}" id="k-vip" aria-pressed="${vip}"></button></label>
      <div class="field"><label>تفضيلاتها</label><textarea class="input" id="k-prefs" rows="2" maxlength="500" placeholder="مثلًا: تحب النود، أظافر قصيرة مربعة، حساسية من…">${esc(c?.prefs || '')}</textarea></div>
      <div class="field"><label>ملاحظات</label><textarea class="input" id="k-notes" rows="2" maxlength="1000">${esc(c?.notes || '')}</textarea></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="k-save">حفظ</button></div>`, (el, close) => {
      $$('#k-src .chip', el).forEach((b) => b.onclick = () => { src = b.dataset.k; $$('#k-src .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#k-vip', el).onclick = (e) => { vip = !vip; e.currentTarget.classList.toggle('on', vip); };
      $('#k-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const phone = normPhone($('#k-phone', el).value);
        if ($('#k-name', el).value.trim().length < 2) return toast('اكتبوا الاسم', true);
        if (phone && !/^05\d{8}$/.test(phone)) return toast('رقم الجوال غير صحيح', true);
        const row = { name: $('#k-name', el).value.trim(), phone: phone || null, birthday: $('#k-bd', el).value || null, source: src, vip, prefs: $('#k-prefs', el).value.trim() || null, notes: $('#k-notes', el).value.trim() || null };
        try {
          let id = c?.id;
          if (c) await q(sb.from('clients').update(row).eq('id', c.id));
          else id = (await q(sb.from('clients').insert(row).select('id').single())).id;
          toast('تم الحفظ'); close(); done && done(id);
        } catch (err) { toast(err.code === '23505' ? 'هذا الرقم مسجل لعميلة ثانية' : errMsg(err), true); }
      });
    });
  }

  function visitForm(c, done) {
    let ch = 'salon'; const picked = new Set();
    modal(`
      <h3>زيارة لـ ${esc(firstName(c.name))}</h3>
      <div class="grid2"><div class="field"><label>اليوم</label><input class="input" id="v-day" type="date" value="${todayR()}" max="${todayR()}"></div>
      <div class="field"><label>المبلغ (ر.س)</label><input class="input num" id="v-amt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="اختياري"></div></div>
      <div class="field"><label>وين</label><div class="chips" id="v-ch"><button type="button" class="chip on" data-k="salon">الصالون</button><button type="button" class="chip" data-k="home">هوم</button></div></div>
      <div class="field"><label>الخدمات</label><div class="chips wrap" id="v-q">${QUICK_SVC.map((s) => `<button type="button" class="chip" data-s="${s}">${s}</button>`).join('')}</div>
        <input class="input mt" id="v-svc" maxlength="300" placeholder="أو اكتبوها"></div>
      <div class="field"><label>ملاحظة</label><input class="input" id="v-note" maxlength="300" placeholder="مثلًا: لون جديد، أو اسم الموظفة"></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="v-save">${I.plus} ختم الزيارة</button></div>`, (el, close) => {
      $$('#v-ch .chip', el).forEach((b) => b.onclick = () => { ch = b.dataset.k; $$('#v-ch .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $$('#v-q .chip', el).forEach((b) => b.onclick = () => { const s = b.dataset.s; picked.has(s) ? picked.delete(s) : picked.add(s); b.classList.toggle('on'); $('#v-svc', el).value = [...picked].join('، '); });
      $('#v-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const a = $('#v-amt', el).value;
        try {
          await q(sb.from('client_visits').insert({ client_id: c.id, day: $('#v-day', el).value || todayR(), channel: ch, services: $('#v-svc', el).value.trim() || null, amount: a === '' ? null : Number(a), note: $('#v-note', el).value.trim() || null }));
          const L = await loyalty(); const n = c.stamps + 1;
          toast(L.active && n === L.stamps ? `ختم ${n} من ${L.stamps} 🤍 وصلت لمكافأتها!` : L.active ? `ختم ${Math.min(n, L.stamps)} من ${L.stamps}` : 'تم تسجيل الزيارة');
          close(); done && done();
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  async function loyaltyForm() {
    const L = await loyalty();
    let on = L.active;
    modal(`
      <h3>بطاقة الولاء</h3>
      <p class="muted" style="margin-top:-6px">كل زيارة تاخذ ختم. لما تكتمل الأختام تستحق العميلة مكافأتها، وتبدأ البطاقة من جديد.</p>
      <div class="field"><label>عدد الأختام</label><div class="chips" id="l-n">${[5, 6, 8, 10].map((n) => `<button type="button" class="chip ${n === L.stamps ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}</div></div>
      <div class="field"><label>المكافأة</label><input class="input" id="l-rw" maxlength="120" value="${esc(L.reward)}" placeholder="مثلًا: مانيكير هدية"></div>
      <label class="toggle-row"><span><b>البطاقة مفعّلة</b></span><button type="button" class="sw ${on ? 'on' : ''}" id="l-on"></button></label>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="l-save">حفظ</button></div>`, (el, close) => {
      let n = L.stamps;
      $$('#l-n .chip', el).forEach((b) => b.onclick = () => { n = Number(b.dataset.n); $$('#l-n .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#l-on', el).onclick = (e) => { on = !on; e.currentTarget.classList.toggle('on', on); };
      $('#l-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        try { await q(sb.from('loyalty_settings').update({ stamps: n, reward: $('#l-rw', el).value.trim() || 'خدمة هدية', active: on }).eq('id', 1)); LOYAL = null; toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  /* ---------- feedback ---------- */
  function fbRow(f) {
    return `<div class="row fb ${f.status}">
      <span class="badge ${FB_KIND[f.kind][1]}">${FB_KIND[f.kind][0]}</span>
      <div class="grow"><div class="fb-body">${esc(f.body)}</div>
        <div class="meta">${f.rating ? '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating) + ' · ' : ''}${ago(f.day)}${f.channel ? ' · ' + FB_CH[f.channel] : ''}${f._client ? ` · <a href="#/client/${f.client_id}">${esc(f._client)}</a>` : ''}</div>
        ${f.resolution ? `<div class="fb-res">✓ ${esc(f.resolution)}</div>` : ''}</div>
      <div class="end">${f.kind === 'complaint' && f.status === 'open' ? `<button class="btn sm" data-resolve="${f.id}">تم الحل</button>` : ''}</div></div>`;
  }
  function bindFb(view) {
    $$('[data-resolve]', view).forEach((b) => b.addEventListener('click', () => modal(`
      <h3>كيف انحلت الشكوى؟</h3>
      <div class="field"><textarea class="input" id="r-txt" rows="3" maxlength="500" placeholder="مثلًا: اعتذرنا وعدّلنا الأظافر مجانًا"></textarea></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="r-save">حفظ</button></div>`, (el, close) => {
      $('#r-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        try { await q(sb.from('client_feedback').update({ status: 'resolved', resolution: $('#r-txt', el).value.trim() || null, resolved_at: new Date().toISOString() }).eq('id', Number(b.dataset.resolve))); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    })));
  }

  function feedbackForm(f, c, done) {
    let kind = 'praise', rating = 0, ch = 'salon';
    modal(`
      <h3>رأي أو ملاحظة${c ? ` من ${esc(firstName(c.name))}` : ''}</h3>
      <div class="field"><label>النوع</label><div class="chips" id="f-k">${Object.entries(FB_KIND).map(([k, [l]]) => `<button type="button" class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>التقييم <span class="muted small">(اختياري)</span></label><div class="rate" id="f-r">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}">★</button>`).join('')}</div></div>
      <div class="field"><label>وصلنا عن طريق</label><div class="chips wrap" id="f-ch">${Object.entries(FB_CH).map(([k, l]) => `<button type="button" class="chip ${k === ch ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>وش قالت</label><textarea class="input" id="f-body" rows="3" maxlength="1000"></textarea></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="f-save">حفظ</button></div>`, (el, close) => {
      const pick = (sel, set) => $$(sel + ' .chip', el).forEach((b) => b.onclick = () => { set(b.dataset.k); $$(sel + ' .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      pick('#f-k', (v) => { kind = v; }); pick('#f-ch', (v) => { ch = v; });
      $$('#f-r button', el).forEach((b) => b.onclick = () => { rating = Number(b.dataset.r) === rating ? 0 : Number(b.dataset.r); $$('#f-r button', el).forEach((x) => x.classList.toggle('on', Number(x.dataset.r) <= rating)); });
      $('#f-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        if ($('#f-body', el).value.trim().length < 2) return toast('اكتبوا الملاحظة', true);
        try { await q(sb.from('client_feedback').insert({ client_id: c?.id || null, kind, rating: rating || null, channel: ch, body: $('#f-body', el).value.trim() })); toast('تم الحفظ'); close(); done && done(); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  async function pageFeedback(view, _a, params, alive) {
    const tab = params.get('t') || 'all';
    const rows = await q(sb.from('client_feedback').select('*, clients(name)').order('day', { ascending: false }).order('id', { ascending: false }).limit(300));
    if (!alive()) return;
    rows.forEach((f) => { f._client = f.clients?.name; });
    const m0 = todayR().slice(0, 7);
    const mon = rows.filter((f) => f.day.slice(0, 7) === m0);
    const rated = rows.filter((f) => f.rating);
    const avg = rated.length ? rated.reduce((s, f) => s + f.rating, 0) / rated.length : null;
    const open = rows.filter((f) => f.kind === 'complaint' && f.status === 'open').length;
    const shown = tab === 'open' ? rows.filter((f) => f.kind === 'complaint' && f.status === 'open') : tab === 'all' ? rows : rows.filter((f) => f.kind === tab);
    view.innerHTML = `
      <div class="seg-tiles">
        <div class="seg-tile gold"><b class="num">${avg ? avg.toFixed(1) : '—'}</b><span>متوسط التقييم</span></div>
        <div class="seg-tile ok"><b class="num">${mon.filter((f) => f.kind === 'praise').length}</b><span>مديح هالشهر</span></div>
        <div class="seg-tile warn"><b class="num">${open}</b><span>شكوى مفتوحة</span></div>
        <div class="seg-tile"><b class="num">${mon.filter((f) => f.kind === 'suggestion').length}</b><span>اقتراح هالشهر</span></div>
      </div>
      <div class="chips wrap" style="margin:14px 0">${[['all', 'الكل'], ['open', `شكاوى مفتوحة${open ? ` (${open})` : ''}`], ['praise', 'مديح'], ['complaint', 'شكاوى'], ['suggestion', 'اقتراحات']].map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/feedback?t=${k}">${l}</a>`).join('')}</div>
      <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="fb-new">${I.plus} رأي أو ملاحظة</button></div>
      <div class="list">${shown.length ? shown.map(fbRow).join('') : '<div class="empty">ما فيه شي هنا. سجّلوا آراء العميلات أول بأول، من الصالون أو الواتساب أو قوقل، عشان تعرفون وش يحبون ووش يزعجهم.</div>'}</div>`;
    $('#fb-new').onclick = () => feedbackForm(null, null, () => route());
    bindFb(view);
  }

  /* ======================= marketing ======================= */
  const POST_KIND = { reel: 'ريل', story: 'ستوري', post: 'بوست', tiktok: 'تيك توك', snap: 'سناب' };
  const PILLAR = { before_after: 'قبل وبعد', color: 'لون الأسبوع', behind: 'خلف الكواليس', review: 'رأي عميلة', trend: 'ترند', service: 'تعريف بخدمة', tip: 'نصيحة عناية', team: 'الفريق', offer: 'عرض' };
  const POST_ST = [['idea', 'فكرة'], ['shoot', 'للتصوير'], ['ready', 'جاهز'], ['posted', 'منشور']];
  const CH = { instagram: 'انستقرام', tiktok: 'تيك توك', snap: 'سناب', whatsapp: 'واتساب', google: 'قوقل', influencer: 'مؤثرة', inshop: 'داخل الصالون' };
  const CMP_ST = { planned: ['مخططة', 'accent'], live: ['شغالة', 'ok'], done: ['خلصت', ''] };
  const IDEAS = [
    ['before_after', 'reel', 'قبل وبعد لأظافر عميلة (بإذنها)'], ['color', 'post', 'لون الأسبوع: ثلاث أيادي بنفس اللون في إضاءات مختلفة'],
    ['behind', 'reel', 'يوم في بيوتفريش: من فتح الباب إلى الإقفال'], ['behind', 'story', 'خلف الكواليس: تعقيم الأدوات خطوة بخطوة'],
    ['review', 'story', 'رسالة مديح من عميلة (بإذنها)'], ['trend', 'reel', 'إطلالة سريعة على صوت ترند هالأسبوع'],
    ['service', 'reel', 'وش الفرق بين الجيل والأكريليك؟'], ['tip', 'post', 'كيف تحافظين على الجيل أسبوعين بدون تقشير'],
    ['team', 'reel', 'تعرفوا على أخصائية الأظافر عندنا'], ['offer', 'story', 'عرض الأسبوع بستوري تصويت'],
    ['behind', 'tiktok', 'ASMR تنظيف وترتيب الأظافر'], ['service', 'story', 'سؤال وجواب: أكثر سؤال يجينا بالواتساب'],
    ['tip', 'reel', 'روتين عناية الشعر بعد الصبغة'], ['before_after', 'reel', 'تحوّل لون شعر كامل في ٣٠ ثانية'],
  ];
  const daysTxt = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوم`);
  const xTimes = (v) => `\u2066${v.toFixed(1)}×\u2069`;
  const until = (d) => Math.round((D(d) - D(todayR())) / 86400000);
  const dShort = (d) => `${D(d).getDate()} ${MONTHS_AR[D(d).getMonth()]}`;

  async function pageMarketing(view, _a, params, alive) {
    const tab = params.get('t') || 'seasons';
    const tabs = [['seasons', 'المواسم'], ['content', 'المحتوى'], ...(isManager() ? [['advisor', 'المستشار'], ['campaigns', 'الحملات'], ['writer', '✦ الكاتب الذكي'], ['studio', 'الاستوديو']] : []), ['compass', 'البوصلة']];
    const head = `<div class="lens" style="margin-bottom:16px">${tabs.map(([k, l]) => `<a href="#/marketing?t=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    if (tab === 'content') return mktContent(view, params, alive, head);
    if (tab === 'compass') return mktCompass(view, alive, head);
    if (tab === 'advisor' && isManager()) return mktAdvisor(view, alive, head);
    if (tab === 'writer' && isManager()) return mktWriter(view, alive, head);
    if (tab === 'studio' && isManager()) return mktStudio(view, alive, head);
    if (tab === 'campaigns' && isManager()) return mktCampaigns(view, alive, head);
    return mktSeasons(view, alive, head);
  }

  /* ======================= البوصلة ======================= */
  const COMPASS_F = [
    ['who', 'من نحن', 'جملتين: وش بيوتفريش ولمين', 3],
    ['promise', 'وعدنا', 'وش تطلع فيه العميلة من عندنا', 2],
    ['audience', 'عميلاتنا', 'كل نوع في سطر: مين هي ووش تبي', 4],
    ['personality', 'شخصيتنا', 'لو بيوتفريش إنسانة، كيف تكون؟ صفة في كل سطر', 4],
    ['tone_do', 'كذا نتكلم', 'سطر لكل قاعدة', 4],
    ['tone_dont', 'كذا ما نتكلم', 'سطر لكل قاعدة', 4],
    ['words_use', 'كلمات تشبهنا', 'مفصولة بفاصلة', 2],
    ['words_avoid', 'كلمات ما تشبهنا', 'مفصولة بفاصلة', 2],
    ['talk', 'وش يخلي العميلة تتكلم عنا', 'من آرائهن الحقيقية: سطر لكل سبب', 4],
    ['proof', 'دليلنا', 'رقم حقيقي يثبت كلامنا', 2],
  ];
  async function mktCompass(view, alive, head) {
    const row = await q(sb.from('brand_compass').select('*').eq('id', 1).maybeSingle());
    if (!alive()) return;
    const c = (row && row.data) || {};
    const filled = COMPASS_F.filter(([k]) => String(c[k] || '').trim()).length;
    view.innerHTML = `${head}
      <div class="cmp-hero card"><div class="grow"><h2>البوصلة</h2><p class="muted">هوية بيوتفريش ونبرتها في مكان واحد. الكاتب الذكي يقرأها قبل كل كلمة يكتبها، والوكالة والمصورة يرجعون لها.</p></div>
        <div class="cmp-ring" style="--p:${Math.round((filled / COMPASS_F.length) * 100)}"><b class="num">${filled}/${COMPASS_F.length}</b><span>مكتملة</span></div></div>
      ${c.draft ? '<div class="notice warn">هذي مسودة كتبناها من آراء عميلاتكم وهوية الصالون. راجعوها وعدّلوها بكلامكم، وبعد الحفظ تصير معتمدة.</div>' : ''}
      ${isManager() ? '' : '<div class="notice">للقراءة. التعديل للإدارة.</div>'}
      <div class="cmp-grid">${COMPASS_F.map(([k, l, h, r]) => `<div class="card cmp-f"><label for="cf-${k}">${l}</label><span class="muted small">${h}</span>
        <textarea class="input" id="cf-${k}" rows="${r}" ${isManager() ? '' : 'readonly'}>${esc(c[k] || '')}</textarea></div>`).join('')}</div>
      ${isManager() ? '<div class="actions end mt"><a class="btn" href="#/marketing?t=writer">جربي الكاتب الذكي ←</a><button class="btn primary" id="cf-save">حفظ البوصلة</button></div>' : ''}`;
    $('#cf-save', view)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const data = {}; COMPASS_F.forEach(([k]) => { data[k] = $(`#cf-${k}`, view).value.trim(); }); data.draft = false;
      try { await q(sb.from('brand_compass').update({ data, updated_at: new Date().toISOString(), updated_by: S.profile?.id || null }).eq('id', 1)); toast('انحفظت البوصلة، والكاتب صار يكتب بها'); route(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  /* ======================= الكاتب الذكي ======================= */
  const WRITER_K = [['post', 'نص منشور', 'ثلاث زوايا، لكل وحدة خطّاف ودعوة'], ['reel', 'سيناريو ريل', 'بالثواني، مع قائمة اللقطات للمصورة'], ['ideas', 'أفكار الأسبوع', 'سبع أفكار تنضاف للوحة المحتوى'], ['brief', 'ورقة حملة', 'للمصورة أو الوكالة: الهدف والمطلوب والممنوع'], ['whatsapp', 'رسالة واتساب', 'للعميلات، ثلاث صيغ'], ['reply', 'رد على رأي', 'رد على تقييم عميلة، ثلاث صيغ']];
  const WRITER_CH = ['إنستقرام', 'تيك توك', 'سناب', 'ستوري', 'واتساب'];
  async function mktWriter(view, alive, head) {
    const [pub, seasons] = await Promise.all([q(sb.rpc('site_public')), q(sb.from('mkt_seasons').select('id,name,starts_on').gte('starts_on', todayR()).order('starts_on').limit(4))]);
    if (!alive()) return;
    let kind = 'post', ch = 'إنستقرام';
    const sugg = [...pub.offers.map((o) => `عرض: ${o.title}${o.price ? ` بـ${o.price}` : ''}`), ...seasons.map((s) => `تجهيز لموسم ${s.name}`), 'ليش العميلات يرجعون لنا', 'خلف الكواليس: يوم في الصالون', ...pub.team.slice(0, 2).map((t) => `تعريف بالأخصائية ${t.name}`)].slice(0, 8);
    view.innerHTML = `${head}
      <div class="wr card">
        <div class="wr-h"><div><h2>الكاتب الذكي</h2><p class="muted">يكتب بصوت بيوتفريش من <a href="#/marketing?t=compass">البوصلة</a>، ويستخدم أسعاركم وعروضكم وآراء عميلاتكم الحقيقية. ما يخترع أرقام ولا آراء.</p></div></div>
        <div class="wr-k">${WRITER_K.map(([k, l, d]) => `<button class="wr-kb ${k === kind ? 'on' : ''}" data-k="${k}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>
        <div class="field" id="wr-chw"><label>القناة</label><div class="chips">${WRITER_CH.map((c) => `<button type="button" class="chip ${c === ch ? 'on' : ''}" data-ch="${c}">${c}</button>`).join('')}</div></div>
        <div class="field"><label id="wr-tl">عن وش؟</label><textarea class="input" id="wr-t" rows="2" maxlength="600" placeholder="مثلًا: عرض المانيكير والبديكير لنهاية الأسبوع"></textarea>
          <div class="chips wrap" style="margin-top:8px">${sugg.map((x) => `<button type="button" class="chip sm" data-s="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>
        <div class="actions end"><button class="btn primary" id="wr-go">✦ اكتبي</button></div>
      </div>
      <div id="wr-out"></div>`;
    const setKind = (k) => { kind = k; $$('.wr-kb', view).forEach((b) => b.classList.toggle('on', b.dataset.k === k)); $('#wr-chw', view).hidden = !['post', 'reel'].includes(k); $('#wr-tl', view).textContent = k === 'reply' ? 'الصقي رأي العميلة' : k === 'ideas' ? 'وش التركيز هالأسبوع؟ (اختياري)' : 'عن وش؟'; };
    $$('.wr-kb', view).forEach((b) => b.onclick = () => setKind(b.dataset.k));
    $$('[data-ch]', view).forEach((b) => b.onclick = () => { ch = b.dataset.ch; $$('[data-ch]', view).forEach((x) => x.classList.toggle('on', x === b)); });
    $$('[data-s]', view).forEach((b) => b.onclick = () => { $('#wr-t', view).value = b.dataset.s; });
    $('#wr-go', view).onclick = (e) => busy(e.currentTarget, async () => {
      const out = $('#wr-out', view);
      out.innerHTML = '<div class="card wr-wait"><span class="spinner"></span> تكتب لك الحين… <span class="muted small">تقرأ البوصلة والأسعار والآراء أول</span></div>';
      try {
        const { data: s0 } = await sb.auth.getSession();
        const r = await fetch(`${CFG.supabaseUrl}/functions/v1/ai-writer`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey, Authorization: `Bearer ${s0.session?.access_token}` }, body: JSON.stringify({ kind, topic: $('#wr-t', view).value.trim(), channel: ['post', 'reel'].includes(kind) ? ch : '' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { out.innerHTML = `<div class="card notice warn">${esc(j.message || 'الكاتب ما رد')}${j.error === 'no_key' ? '<br><span class="small">يحتاج صالح يحط مفتاح الكاتب في إعدادات Supabase مرة وحدة.</span>' : ''}</div>`; return; }
        out.innerHTML = wrRender(kind, j.out) + `<p class="muted small" style="text-align:center">باقي ${j.left} طلب هالشهر · راجعي النص قبل النشر</p>`;
        $$('[data-copy]', out).forEach((b) => b.onclick = () => copyTxt(b.closest('.wr-r').querySelector('.wr-txt').innerText, 'النص'));
        $$('[data-add]', out).forEach((b) => b.onclick = () => busy(b, async () => {
          const x = JSON.parse(b.dataset.add);
          try { await q(sb.from('mkt_posts').insert({ title: x.title.slice(0, 120), kind: x.kind || 'post', pillar: x.pillar || null, notes: (x.notes || '').slice(0, 1000), status: 'idea' })); b.textContent = 'انضافت ✓'; b.disabled = true; } catch (err) { toast(errMsg(err), true); }
        }));
      } catch (err) { out.innerHTML = `<div class="card notice warn">${esc(errMsg(err))}</div>`; }
    });
  }
  function wrRender(kind, o) {
    if (!o || o.raw) return `<div class="card wr-r"><div class="wr-txt" style="white-space:pre-wrap">${esc(o?.raw || '')}</div><div class="actions"><button class="btn sm" data-copy>نسخ</button></div></div>`;
    const add = (title, k, pillar, notes) => `<button class="btn sm" data-add='${esc(JSON.stringify({ title, kind: k, pillar, notes }))}'>${I.plus} للوحة المحتوى</button>`;
    const box = (h, body, extra = '') => `<div class="card wr-r">${h ? `<div class="wr-rh">${h}</div>` : ''}<div class="wr-txt">${body}</div><div class="actions"><button class="btn sm" data-copy>نسخ</button>${extra}</div></div>`;
    const P = (t) => `<p>${esc(t || '').replace(/\n/g, '<br>')}</p>`;
    if (kind === 'post') return (o.angles || []).map((a) => box(esc(a.angle), `<p><b>${esc(a.hook)}</b></p>${P(a.body)}<p><b>${esc(a.cta)}</b></p>${(a.hashtags || []).length ? `<p class="muted">${a.hashtags.map((h) => esc(h.startsWith('#') ? h : '#' + h)).join(' ')}</p>` : ''}`, add(a.hook || a.angle, 'post', null, `${a.hook}\n${a.body}\n${a.cta}`))).join('');
    if (kind === 'reel') return box(`${esc(o.title)} · ${o.seconds || ''} ثانية`, `<table class="wr-tb"><tr><th>الثواني</th><th>اللقطة</th><th>على الشاشة</th><th>الصوت</th></tr>${(o.beats || []).map((b) => `<tr><td class="num">${esc(b.t)}</td><td>${esc(b.shot)}</td><td>${esc(b.text)}</td><td>${esc(b.voice)}</td></tr>`).join('')}</table>${(o.shots || []).length ? `<p><b>قائمة اللقطات</b></p><ul>${o.shots.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}<p><b>الدعوة:</b> ${esc(o.cta)}</p>${o.caption ? `<p><b>الوصف:</b> ${esc(o.caption)}</p>` : ''}`, add(o.title, 'reel', null, (o.beats || []).map((b) => `${b.t}: ${b.shot}`).join('\n')));
    if (kind === 'brief') return box('ورقة الحملة', `<p><b>الهدف:</b> ${esc(o.goal)}</p><p><b>الحقيقة عن العميلة:</b> ${esc(o.truth)}</p><p><b>الرسالة:</b> ${esc(o.message)}</p><p><b>المطلوب تسليمه</b></p><ul>${(o.deliverables || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p><b>لازم</b></p><ul>${(o.must || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p><b>ممنوع</b></p><ul>${(o.avoid || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${o.timing ? `<p><b>التوقيت:</b> ${esc(o.timing)}</p>` : ''}`);
    if (kind === 'ideas') return `<div class="card"><div class="list">${(o.ideas || []).map((x) => `<div class="row"><div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">${POST_KIND[x.kind] || ''}${PILLAR[x.pillar] ? ' · ' + PILLAR[x.pillar] : ''} · ${esc(x.why || '')}</div></div>${add(x.title, POST_KIND[x.kind] ? x.kind : 'post', PILLAR[x.pillar] ? x.pillar : null, x.why)}</div>`).join('')}</div></div>`;
    return (o.options || []).map((x) => box(esc(x.tone), P(x.text), kind === 'whatsapp' ? `<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(x.text || '')}">${I.wa} افتحي في واتساب</a>` : '')).join('');
  }

  /* ======================= استوديو التصاميم ======================= */
  const STU_SIZES = { post: [1080, 1350, 'منشور'], sq: [1080, 1080, 'مربع'], story: [1080, 1920, 'ستوري'] };
  const STU_THEMES = { oud: ['#6A3229', '#3F1D17', '#F3EBDF', '#E3C690'], cream: ['#FBF6EF', '#E8DFD1', '#4A2620', '#9C6A45'], rose: ['#C99286', '#7E4639', '#FFF6F1', '#FFE3C2'], gold: ['#EBD5A4', '#A8834C', '#3F1D17', '#5A2A22'] };
  const STU_T = [['offer', 'عرض'], ['review', 'كلمة عميلة'], ['service', 'خدمة الأسبوع'], ['count', 'عدّ تنازلي'], ['season', 'تهنئة موسم'], ['team', 'أخصائية'], ['hours', 'أوقات العمل']];
  async function mktStudio(view, alive, head) {
    const [pub, svcs, seasons] = await Promise.all([q(sb.rpc('site_public')), q(sb.from('salon_services').select('id,name,price,description').eq('is_active', true).order('popular', { ascending: false }).limit(80)), q(sb.from('mkt_seasons').select('name,emoji,starts_on').gte('starts_on', todayR()).order('starts_on').limit(6))]);
    if (!alive()) return;
    const st = { t: 'offer', size: 'post', theme: 'oud', photo: null, f: {} };
    const defaults = () => {
      const o = pub.offers[0] || {}, r = pub.reviews.find((x) => x.text.length < 160) || pub.reviews[0] || {}, s = svcs[0] || {}, se = seasons[0] || {}, tm = pub.team[0] || {};
      return {
        offer: { k: 'عرض خاص', h: o.title || 'باقة دلّعي نفسك', s: o.subtitle || 'مانيكير + بديكير + استشوار', p: o.price || '٢٩٩ ريال', w: o.was || '' },
        review: { k: `★ ${pub.stats ? Number(pub.stats.avg).toFixed(1) : ''} من ${pub.stats ? pub.stats.n : ''} تقييم`, h: r.text || '', s: `${r.name || ''}${r.service ? ' · ' + r.service : ''}` },
        service: { k: 'خدمة الأسبوع', h: s.name || '', s: (s.description || '').slice(0, 90), p: s.price ? `${Number(s.price)} ريال` : '' },
        count: { k: o.title || 'العرض', h: o.ends ? String(Math.max(0, Math.ceil((new Date(o.ends + 'T23:59:59+03:00') - Date.now()) / 864e5))) : '٣', s: 'أيام وينتهي', p: o.price || '' },
        season: { k: se.emoji || '✦', h: se.name ? `${se.name}` : 'كل عام وأنتم بخير', s: 'من كل قلب، فريق بيوتفريش' },
        team: { k: 'تعرّفي على', h: tm.name || '', s: tm.n ? `★ ${tm.avg} من ${tm.n} رأي` : '' },
        hours: { k: 'أوقات العمل', h: (pub.conf && pub.conf.hours) || 'يوميًا ١٠ص – ١٠م', s: (pub.conf && pub.conf.address) || 'الأحساء' },
      };
    };
    let D0 = defaults();
    view.innerHTML = `${head}
      <div class="stu">
        <div class="stu-side card">
          <div class="field"><label>القالب</label><div class="chips wrap">${STU_T.map(([k, l]) => `<button type="button" class="chip ${k === st.t ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div></div>
          <div class="field"><label>المقاس</label><div class="chips">${Object.entries(STU_SIZES).map(([k, v]) => `<button type="button" class="chip ${k === st.size ? 'on' : ''}" data-z="${k}">${v[2]}</button>`).join('')}</div></div>
          <div class="field"><label>الألوان</label><div class="stu-sw">${Object.entries(STU_THEMES).map(([k, c]) => `<button type="button" class="${k === st.theme ? 'on' : ''}" data-th="${k}" style="background:linear-gradient(135deg,${c[0]},${c[1]})"></button>`).join('')}</div></div>
          <div id="stu-fields"></div>
          <div class="field"><label>صورة (اختياري)</label><input type="file" accept="image/*" class="input" id="stu-ph"></div>
          <button class="btn primary" id="stu-dl" style="width:100%">نزّلي التصميم</button>
        </div>
        <div class="stu-stage"><div class="stu-scale" id="stu-scale"><div id="stu-art"></div></div></div>
      </div>`;
    const fieldsFor = (t) => {
      const F = { offer: [['k', 'السطر الصغير'], ['h', 'العنوان'], ['s', 'الوصف'], ['p', 'السعر'], ['w', 'بدل']], review: [['k', 'فوق'], ['h', 'كلام العميلة'], ['s', 'الاسم والخدمة']], service: [['k', 'فوق'], ['h', 'الخدمة'], ['s', 'وصف'], ['p', 'السعر']], count: [['k', 'العرض'], ['h', 'الرقم'], ['s', 'تحت الرقم'], ['p', 'السعر']], season: [['k', 'رمز'], ['h', 'العنوان'], ['s', 'الكلمة']], team: [['k', 'فوق'], ['h', 'الاسم'], ['s', 'سطر تحت']], hours: [['k', 'فوق'], ['h', 'الأوقات'], ['s', 'المكان']] }[t];
      const pick = t === 'review' ? `<div class="field"><label>اختاري رأي حقيقي</label><select class="input" id="stu-rv">${pub.reviews.slice(0, 40).map((r, i) => `<option value="${i}">${esc(r.name)}: ${esc(r.text.slice(0, 50))}</option>`).join('')}</select></div>`
        : t === 'service' ? `<div class="field"><label>الخدمة</label><select class="input" id="stu-sv">${svcs.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select></div>`
        : t === 'team' ? `<div class="field"><label>الأخصائية</label><select class="input" id="stu-tm">${pub.team.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select></div>` : '';
      $('#stu-fields', view).innerHTML = pick + F.map(([k, l]) => `<div class="field"><label>${l}</label>${k === 'h' && t === 'review' ? `<textarea class="input" rows="3" data-f="${k}">${esc(D0[t][k] || '')}</textarea>` : `<input class="input" data-f="${k}" value="${esc(D0[t][k] || '')}">`}</div>`).join('');
      st.f = { ...D0[t] };
      $$('[data-f]', view).forEach((x) => x.oninput = () => { st.f[x.dataset.f] = x.value; draw(); });
      $('#stu-rv', view)?.addEventListener('change', (e) => { const r = pub.reviews[+e.target.value]; setF({ h: r.text, s: `${r.name}${r.service ? ' · ' + r.service : ''}` }); });
      $('#stu-sv', view)?.addEventListener('change', (e) => { const s = svcs[+e.target.value]; setF({ h: s.name, s: (s.description || '').slice(0, 90), p: s.price ? `${Number(s.price)} ريال` : '' }); });
      $('#stu-tm', view)?.addEventListener('change', (e) => { const x = pub.team[+e.target.value]; setF({ h: x.name, s: x.n ? `★ ${x.avg} من ${x.n} رأي` : '' }); });
    };
    const setF = (o) => { Object.assign(st.f, o); Object.entries(o).forEach(([k, v]) => { const el = $(`[data-f="${k}"]`, view); if (el) el.value = v; }); draw(); };
    const draw = () => {
      const [W, H] = STU_SIZES[st.size], [c1, c2, fg, ac] = STU_THEMES[st.theme], f = st.f, t = st.t;
      const light = st.theme === 'cream' || st.theme === 'gold';
      const logo = `../home/assets/Beautfresh-${light ? 'brown' : 'cream'}.svg`;
      const big = t === 'count' ? `<div class="sa-num">${esc(f.h)}</div>` : t === 'review' ? `<div class="sa-q">«${esc(f.h)}»</div>` : `<div class="sa-h">${esc(f.h)}</div>`;
      $('#stu-art', view).innerHTML = `<div class="sa sa-${t} ${st.photo ? 'has-ph' : ''}" style="width:${W}px;height:${H}px;--c1:${c1};--c2:${c2};--fg:${fg};--ac:${ac}">
        <div class="sa-pat" style="${light ? '' : 'filter:brightness(0) invert(1)'}"></div>
        ${st.photo ? `<div class="sa-ph" style="background-image:url('${st.photo}')"></div>` : ''}
        <img class="sa-logo" src="${logo}" alt="">
        <div class="sa-body"><div class="sa-k">${esc(f.k || '')}</div>${big}${t === 'review' ? '<div class="sa-st">★★★★★</div>' : ''}${f.s ? `<div class="sa-s">${esc(f.s)}</div>` : ''}
          ${f.p ? `<div class="sa-p"><b>${esc(f.p)}</b>${f.w ? `<s>${esc(f.w)}</s>` : ''}</div>` : ''}</div>
        <div class="sa-foot">beautfresh.com/book</div></div>`;
      const stage = $('.stu-stage', view), k = Math.min((stage.clientWidth - 24) / W, 640 / H);
      const sc = $('#stu-scale', view); sc.style.width = W * k + 'px'; sc.style.height = H * k + 'px'; $('#stu-art', view).style.transform = `scale(${k})`;
    };
    $$('[data-t]', view).forEach((b) => b.onclick = () => { st.t = b.dataset.t; $$('[data-t]', view).forEach((x) => x.classList.toggle('on', x === b)); fieldsFor(st.t); draw(); });
    $$('[data-z]', view).forEach((b) => b.onclick = () => { st.size = b.dataset.z; $$('[data-z]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    $$('[data-th]', view).forEach((b) => b.onclick = () => { st.theme = b.dataset.th; $$('[data-th]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    $('#stu-ph', view).onchange = (e) => { const f = e.target.files[0]; if (!f) { st.photo = null; draw(); return; } const r = new FileReader(); r.onload = () => { st.photo = r.result; draw(); }; r.readAsDataURL(f); };
    $('#stu-dl', view).onclick = (e) => busy(e.currentTarget, async () => {
      try {
        await stuLib(); const node = $('#stu-art .sa', view);
        const prev = $('#stu-art', view).style.transform; $('#stu-art', view).style.transform = 'none';
        const url = await window.htmlToImage.toPng(node, { pixelRatio: 1, fontEmbedCSS: await stuFonts(), cacheBust: true });
        $('#stu-art', view).style.transform = prev;
        const a = document.createElement('a'); a.href = url; a.download = `beautfresh-${st.t}-${st.size}.png`; a.click(); toast('نزل التصميم');
      } catch (err) { toast('ما قدرت أنزّله، جربي مرة ثانية', true); }
    });
    window.addEventListener('resize', draw, { passive: true });
    fieldsFor(st.t); draw();
  }
  let STU_FONT_CSS = null;
  async function stuLib() { if (window.htmlToImage) return; await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function stuFonts() {
    if (STU_FONT_CSS) return STU_FONT_CSS;
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Aref+Ruqaa:wght@700&display=swap')).text();
    let out = css.split('/*').filter((b) => /^\s*(arabic|latin)\s*\*\//.test(b)).map((b) => b.replace(/^[^*]*\*\//, '')).join('\n');
    const urls = [...new Set([...out.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    await Promise.all(urls.map(async (u) => { const bl = await (await fetch(u)).blob(); const d = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(bl); }); out = out.split(u).join(d); }));
    return (STU_FONT_CSS = out);
  }

  /* ======================= المستشار ======================= */
  const ADV_Q = [
    ['goal', 'وش أهم شي لكم الحين؟', [['new', 'عميلات جدد'], ['back', 'ترجع العميلات القديمات'], ['quiet', 'نعبّي الأوقات الهادية'], ['season', 'نستعد للموسم الجاي']]],
    ['budget', 'كم تقدرون تصرفون على الإعلانات بالشهر؟', [['0', 'ولا شي'], ['1000', 'أقل من ١٠٠٠'], ['3000', '١٠٠٠ – ٣٠٠٠'], ['9000', 'أكثر من ٣٠٠٠']]],
    ['shoot', 'مين يصوّر المحتوى؟', [['phone', 'احنا بالجوال'], ['free', 'مصورة مستقلة'], ['agency', 'وكالة']]],
    ['time', 'كم وقت تقدرون تعطون المحتوى بالأسبوع؟', [['1', 'ساعة'], ['3', 'ثلاث ساعات'], ['6', 'أكثر']]],
  ];
  function advDecide(a, F) {
    const B = Number(a.budget || 0), T = Number(a.time || 1), g = a.goal || 'new';
    const lapsed = F.lapsed || 0, rv = F.reviews || {}, ws = F.web_share || 0, wu = F.web_unpaid || 0, ns = F.next_season;
    const dayAr = { Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت' }[F.quiet_day] || F.quiet_day || '';
    const D = [];
    D.push(['واتساب', g === 'back' || g === 'quiet' ? 'yes' : 'yes', g === 'quiet' ? `نعم: رسالة عرض لـ«${dayAr}» بس، لمن وافقوا` : 'نعم: رسالة وحدة بالأسبوع، لمن وافقوا بس',
      `${lapsed.toLocaleString('en')} عميلة زارتكم مرتين وفوق وغابت أكثر من شهرين. هذول أسهل رجعة وأرخصها. رصيد واتساب ركاز صفر، اشحنوه أول.`, '#/sales?tab=clients']);
    D.push(['إنستقرام', 'yes', T >= 3 ? 'نعم: ٣ منشورات بالأسبوع + ستوري يومي' : 'نعم: منشورين بالأسبوع + ستوري يومي',
      `٦٢٪ من زوار صفحة الحجز جايين من إنستقرام. هذي قناتكم الأولى، وكل منشور لازم ينتهي برابط الحجز.`, '#/marketing?t=writer']);
    D.push(['قوقل ماب', 'yes', 'نعم: صور حقيقية + اطلبوا التقييم بعد كل زيارة',
      `عندكم ${(rv.n || 0).toLocaleString('en')} تقييم بمتوسط ${rv.avg || '—'} في ركاز، بس قوقل هو اللي يشوفه اللي يدور «صالون قريب». حوّلوا الراضيات لقوقل.`, '#/site']);
    D.push(['تيك توك', g === 'new' && T >= 3 ? 'cond' : 'no', g === 'new' && T >= 3 ? 'بشرط: مقطع واحد بالأسبوع، نفس ريلز إنستقرام' : 'لا الحين',
      g === 'new' && T >= 3 ? 'يجيب عميلات جدد، بس يحتاج انتظام. لا تسوون له محتوى خاص، أعيدوا نشر الريلز.' : 'وقتكم للمحتوى محدود، فركزوه في إنستقرام اللي يجيب الحجوزات فعلًا.', '#/marketing?t=content']);
    D.push(['إعلانات ممولة', B >= 1000 ? 'cond' : 'no', B >= 1000 ? `بشرط: ${B >= 3000 ? 'سناب وإنستقرام' : 'إنستقرام بس'}، داخل الأحساء، على عرض واحد` : 'لا الحين',
      B >= 1000 ? 'الإعلان بدون عرض واضح يضيع الفلوس. إعلان واحد بهدف واحد، وقيسوه بالحجوزات بعد أسبوعين.' : 'بدون ميزانية، الأولوية للقنوات المجانية اللي فوق.', '#/marketing?t=campaigns']);
    D.push(['مشاهير', B >= 9000 && g !== 'back' ? 'cond' : 'no', B >= 9000 && g !== 'back' ? 'بشرط: مشهورة من الأحساء، جمهورها نساء، وعرض بكود' : 'لا الحين',
      B >= 9000 && g !== 'back' ? 'اطلبوا إحصائيات جمهورها (المدينة والجنس) قبل الدفع، وحطوا كود خاص عشان تقيسون.' : 'تكلفتها عالية والنتيجة صعبة القياس. لما تكبر الميزانية نرجع لها.', '']);
    D.push(['صفحة الحجز', wu >= 15 ? 'yes' : 'ok', wu >= 15 ? 'نعم: فعّلوا الدفع الإلكتروني' : 'تمام، كملوا', 
      `${ws}٪ من طلبات آخر شهر جات من الموقع${wu ? `، و${wu}٪ من طلبات الموقع ما كملت الدفع` : ''}. كل تحسين هنا يرجع فلوس مباشرة.`, '#/sales']);
    const steps = [];
    if (g === 'back') steps.push(['رسالة «وحشتينا» لأول ٣٠ عميلة غايبة', '#/sales?tab=clients']);
    if (g === 'quiet') steps.push([`عرض خاص ليوم ${dayAr}، ورسالة واتساب عنه`, '#/site?t=offers']);
    if (g === 'season' && ns) steps.push([`حملة ${ns.name} (بعد ${ns.in} يوم) بمراحلها`, '#/marketing?t=campaigns']);
    if (g === 'new') steps.push(['٣ منشورات إنستقرام هالأسبوع من الكاتب الذكي', '#/marketing?t=writer']);
    steps.push(['بعد كل زيارة: رابط تقييم قوقل للعميلة الراضية', '#/site']);
    if ((F.posts_30 || 0) < 8) steps.push([`خططوا محتوى الأسبوعين الجاية (آخر ٣٠ يوم: ${F.posts_30 || 0} منشور)`, '#/marketing?t=content']);
    return { D, steps: steps.slice(0, 3) };
  }
  async function mktAdvisor(view, alive, head) {
    const F = await q(sb.rpc('advisor_facts'));
    if (!alive()) return;
    const a = { goal: 'new', budget: '0', shoot: 'phone', time: '3', ...((F.saved && F.saved.answers) || {}) };
    const draw = (fresh) => {
      const { D, steps } = advDecide(a, F);
      const ST = { yes: ['نعم', 'ok'], cond: ['بشرط', 'warn'], no: ['لا الحين', ''], ok: ['تمام', 'ok'] };
      $('#adv-out', view).innerHTML = `
        <div class="section-title"><h2>قرار المستشار</h2>${F.saved?.at && !fresh ? `<span class="muted small">آخر مراجعة ${new Date(F.saved.at).toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'long' })}</span>` : ''}</div>
        <div class="adv-list">${D.map(([ch, st, what, why, go]) => `<div class="adv-r ${ST[st][1]}"><div class="adv-ch"><b>${ch}</b><span class="adv-st">${ST[st][0]}</span></div>
          <div class="adv-w"><div>${esc(what)}</div><details><summary>من أين؟</summary><p>${esc(why)}</p></details></div>${go ? `<a class="btn sm" href="${go}">افتح ←</a>` : ''}</div>`).join('')}</div>
        <div class="section-title"><h2>هالأسبوع: ٣ خطوات بس</h2></div>
        <div class="lz-todo">${steps.map(([t, h]) => `<a href="${h}">${esc(t)}<i>←</i></a>`).join('')}</div>`;
    };
    view.innerHTML = `${head}
      <div class="card adv-q"><h2>المستشار</h2><p class="muted">أربع أسئلة، وبعدها يقرر معكم قناة قناة، وكل قرار معه السبب من أرقامكم.</p>
        ${ADV_Q.map(([k, l, opts]) => `<div class="field"><label>${l}</label><div class="chips wrap">${opts.map(([v, t]) => `<button type="button" class="chip ${String(a[k]) === v ? 'on' : ''}" data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div></div>`).join('')}
      </div>
      <div id="adv-out"></div>`;
    let tm = null;
    $$('[data-k]', view).forEach((b) => b.onclick = () => {
      a[b.dataset.k] = b.dataset.v; $$(`[data-k="${b.dataset.k}"]`, view).forEach((x) => x.classList.toggle('on', x === b));
      const o = $('#adv-out', view); o.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 300 }); draw(true);
      clearTimeout(tm); tm = setTimeout(() => sb.from('mkt_advisor').update({ answers: a, decided_at: new Date().toISOString(), decided_by: S.profile?.id || null }).eq('id', 1).then(() => {}), 800);
    });
    draw(false);
  }

  async function mktSeasons(view, alive, head) {
    const rows = await q(sb.from('mkt_seasons').select('*').order('starts_on'));
    if (!alive()) return;
    const tk = todayR();
    const up = rows.filter((s) => (s.ends_on || s.starts_on) >= tk);
    const past = rows.filter((s) => (s.ends_on || s.starts_on) < tk).reverse();
    const state = (s) => { const u = until(s.starts_on); if (u <= 0) return ['live', 'شغال الحين']; if (u <= s.prep_days) return ['prep', 'وقت التجهيز']; return ['later', '']; };
    const nx = up[0];
    const ideas = (s) => (s.ideas || '').split('\n').filter(Boolean);
    const hero = nx ? (() => { const u = until(nx.starts_on); const [st] = state(nx); return `
      <div class="season-hero ${st}">
        <div class="sh-emoji">${esc(nx.emoji || '✦')}</div>
        <div class="grow"><span class="sh-eyebrow">${st === 'live' ? 'الموسم الحالي' : 'الموسم الجاي'}</span><h2>${esc(nx.name)}</h2>
          <div class="sh-date">${dShort(nx.starts_on)}${nx.ends_on ? ` – ${dShort(nx.ends_on)}` : ''}${nx.approx ? ' · <span class="approx">تاريخ تقريبي</span>' : ''}</div></div>
        <div class="sh-count">${u > 0 ? `<b class="num">${u}</b><span>${u === 1 ? 'يوم' : u <= 10 ? 'أيام' : 'يوم'}</span>` : '<b>الحين</b>'}</div>
        ${st !== 'later' ? `<div class="sh-msg">${st === 'live' ? 'الموسم شغال. تابعوا الحجوزات والمخزون كل يوم.' : `باقي ${daysTxt(u)}، يعني دخلتوا وقت التجهيز. ابدؤوا الحملة والمحتوى من الحين.`}</div>` : `<div class="sh-msg">يبدأ التجهيز له بعد ${daysTxt(u - nx.prep_days)}.</div>`}
        ${ideas(nx).length ? `<ul class="sh-ideas">${ideas(nx).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        ${isManager() ? `<div class="sh-acts"><button class="btn on-oud" data-cmp="${nx.id}">${I.plus} حملة لهالموسم</button></div>` : ''}
      </div>`; })() : '';
    let lastM = '';
    const tl = up.slice(1).map((s) => {
      const m = MONTHS_AR[D(s.starts_on).getMonth()] + ' ' + D(s.starts_on).getFullYear();
      const mh = m !== lastM ? `<div class="tl-month">${m}</div>` : ''; lastM = m;
      const [st, lab] = state(s); const u = until(s.starts_on);
      return `${mh}<details class="tl-item ${st}"><summary><span class="tl-dot">${esc(s.emoji || '✦')}</span><div class="grow"><b>${esc(s.name)}</b><span>${dShort(s.starts_on)}${s.ends_on ? ` – ${dShort(s.ends_on)}` : ''}${s.approx ? ' · تقريبي' : ''}</span></div><span class="tl-u">${lab ? `<em>${lab}</em>` : ''}بعد ${daysTxt(u)}</span></summary>
        <div class="tl-body">${ideas(s).length ? `<ul>${ideas(s).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted small">ما فيه أفكار مكتوبة</p>'}
        ${isManager() ? `<div class="actions"><button class="btn sm" data-cmp="${s.id}">${I.plus} حملة</button><button class="btn sm" data-sea="${s.id}">تعديل</button></div>` : ''}</div></details>`;
    }).join('');
    view.innerHTML = `${head}${hero}
      <div class="section-title"><h2>تقويم السنة</h2>${isManager() ? '<button class="btn sm" id="sea-new">' + I.plus + ' موسم</button>' : ''}</div>
      <div class="timeline">${tl || '<div class="empty">ما فيه مواسم قادمة</div>'}</div>
      ${past.length ? `<p class="muted small mt">المواعيد الهجرية تقريبية. عدّلوها لما يُعلن رسميًا.</p>` : '<p class="muted small mt">المواعيد الهجرية تقريبية. عدّلوها لما يُعلن رسميًا.</p>'}`;
    $$('[data-cmp]', view).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); const s = rows.find((x) => x.id === Number(b.dataset.cmp)); campaignForm(null, rows, () => { location.hash = '#/marketing?t=campaigns'; }, s); }));
    $$('[data-sea]', view).forEach((b) => b.addEventListener('click', () => seasonForm(rows.find((x) => x.id === Number(b.dataset.sea)))));
    $('#sea-new')?.addEventListener('click', () => seasonForm(null));
  }

  function seasonForm(s) {
    modal(`
      <h3>${s ? 'تعديل موسم' : 'موسم جديد'}</h3>
      <div class="grid2"><div class="field"><label>الاسم</label><input class="input" id="s-name" maxlength="60" value="${esc(s?.name || '')}"></div>
      <div class="field"><label>رمز</label><input class="input" id="s-emo" maxlength="4" value="${esc(s?.emoji || '')}" placeholder="✨"></div></div>
      <div class="grid2"><div class="field"><label>يبدأ</label><input class="input" type="date" id="s-from" value="${s?.starts_on || ''}"></div>
      <div class="field"><label>ينتهي <span class="muted small">(اختياري)</span></label><input class="input" type="date" id="s-to" value="${s?.ends_on || ''}"></div></div>
      <div class="field"><label>نبدأ التجهيز قبله بـ (يوم)</label><input class="input num" type="number" id="s-prep" min="0" max="120" value="${s?.prep_days ?? 21}"></div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="s-apx" ${s?.approx ? 'checked' : ''}> التاريخ تقريبي (هجري)</label>
      <div class="field"><label>أفكار <span class="muted small">(كل فكرة في سطر)</span></label><textarea class="input" id="s-ideas" rows="4" maxlength="1500">${esc(s?.ideas || '')}</textarea></div>
      <div class="actions end">${s ? '<button class="btn danger" id="s-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="s-save">حفظ</button></div>`, (el, close) => {
      $('#s-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#s-name', el).value.trim(), emoji: $('#s-emo', el).value.trim() || null, starts_on: $('#s-from', el).value, ends_on: $('#s-to', el).value || null, prep_days: Number($('#s-prep', el).value) || 0, approx: $('#s-apx', el).checked, ideas: $('#s-ideas', el).value.trim() || null };
        if (!row.name || !row.starts_on) return toast('اكتبوا الاسم والتاريخ', true);
        try { if (s) await q(sb.from('mkt_seasons').update(row).eq('id', s.id)); else await q(sb.from('mkt_seasons').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#s-del', el)?.addEventListener('click', async () => { close(); if (await confirmBox('حذف الموسم', 'ينحذف من التقويم.', 'حذف', true)) { try { await q(sb.from('mkt_seasons').delete().eq('id', s.id)); route(); } catch (err) { toast(errMsg(err), true); } } });
    });
  }

  async function mktCampaigns(view, alive, head) {
    const [rows, seasons] = await Promise.all([q(sb.from('mkt_campaigns').select('*').order('starts_on', { ascending: false })), q(sb.from('mkt_seasons').select('id,name,emoji,starts_on').order('starts_on'))]);
    if (!alive()) return;
    const sum = (k) => rows.filter((c) => c.status !== 'planned').reduce((a, c) => a + Number(c[k] || 0), 0);
    const spent = sum('spent'), rev = sum('revenue'), nc = sum('new_clients');
    view.innerHTML = `${head}
      <div class="seg-tiles">
        <div class="seg-tile"><b class="num">${sar(spent)}</b><span>صرفنا على الحملات</span></div>
        <div class="seg-tile ok"><b class="num">${sar(rev)}</b><span>رجّعت مبيعات</span></div>
        <div class="seg-tile gold"><b class="num">${spent ? xTimes(rev / spent) : '—'}</b><span>كل ريال رجّع</span></div>
        <div class="seg-tile"><b class="num">${nc && spent ? sar(spent / nc) : '—'}</b><span>تكلفة العميلة الجديدة</span></div>
      </div>
      <div class="actions" style="margin:14px 0"><button class="btn primary" id="cmp-new">${I.plus} حملة جديدة</button></div>
      <div class="cmp-list">${rows.length ? rows.map((c) => {
        const se = seasons.find((s) => s.id === c.season_id);
        const roas = c.spent > 0 && c.revenue != null ? Number(c.revenue) / Number(c.spent) : null;
        const gp = c.goal_clients ? Math.min(100, ((c.new_clients || 0) / c.goal_clients) * 100) : null;
        return `<button class="cmp" data-c="${c.id}">
          <div class="cmp-top"><span class="badge ${CMP_ST[c.status][1]}">${CMP_ST[c.status][0]}</span>${se ? `<span class="muted small">${esc(se.emoji || '')} ${esc(se.name)}</span>` : ''}<span class="muted small" style="margin-inline-start:auto">${dShort(c.starts_on)}${c.ends_on ? ' – ' + dShort(c.ends_on) : ''}</span></div>
          <h3>${esc(c.name)}</h3>${c.offer ? `<p class="cmp-offer">${esc(c.offer)}</p>` : ''}
          <div class="cmp-ch">${(c.channels || []).map((k) => `<span>${CH[k] || k}</span>`).join('')}</div>
          <div class="cmp-nums"><div><span>الصرف</span><b class="num">${c.spent != null ? sar(c.spent) : '—'}${c.budget ? `<small> / ${sar(c.budget)}</small>` : ''}</b></div><div><span>عميلات جدد</span><b class="num">${c.new_clients ?? '—'}${c.goal_clients ? `<small> / ${c.goal_clients}</small>` : ''}</b></div><div><span>المبيعات</span><b class="num">${c.revenue != null ? sar(c.revenue) : '—'}</b></div><div><span>العائد</span><b class="num ${roas != null && roas < 1 ? 'neg' : ''}">${roas != null ? xTimes(roas) : '—'}</b></div></div>
          ${gp != null ? `<div class="fbar-track" style="margin-top:10px"><i style="width:${gp}%"></i></div>` : ''}
          ${c.learnings ? `<p class="cmp-learn">💡 ${esc(c.learnings)}</p>` : ''}
        </button>`; }).join('') : '<div class="list"><div class="empty">ما فيه حملات بعد. ابدؤوا من موسم في التقويم، أو أضيفوا حملة جديدة.</div></div>'}</div>`;
    $('#cmp-new').onclick = () => campaignForm(null, seasons, () => route());
    $$('[data-c]', view).forEach((b) => b.onclick = () => campaignForm(rows.find((x) => x.id === Number(b.dataset.c)), seasons, () => route()));
  }

  function campaignForm(c, seasons, done, fromSeason) {
    const chs = new Set(c?.channels || ['instagram']); let st = c?.status || 'planned';
    const sid = c?.season_id || fromSeason?.id || '';
    const defStart = fromSeason ? dk(new Date(Math.max(D(todayR()), D(fromSeason.starts_on) - fromSeason.prep_days * 86400000))) : todayR();
    const n = (k) => (c?.[k] != null ? Number(c[k]) : '');
    modal(`
      <h3>${c ? 'الحملة' : 'حملة جديدة'}</h3>
      <div class="field"><label>اسم الحملة</label><input class="input" id="c-name" maxlength="80" value="${esc(c?.name || (fromSeason ? 'حملة ' + fromSeason.name : ''))}"></div>
      <div class="field"><label>الموسم</label><select class="input" id="c-sea"><option value="">—</option>${seasons.map((s) => `<option value="${s.id}" ${String(s.id) === String(sid) ? 'selected' : ''}>${esc((s.emoji || '') + ' ' + s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>العرض</label><input class="input" id="c-offer" maxlength="300" value="${esc(c?.offer || '')}" placeholder="مثلًا: باقة العيد ٢٩٩ بدل ٣٨٠"></div>
      <div class="field"><label>القنوات</label><div class="chips wrap" id="c-ch">${Object.entries(CH).map(([k, l]) => `<button type="button" class="chip ${chs.has(k) ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>من</label><input class="input" type="date" id="c-from" value="${c?.starts_on || defStart}"></div><div class="field"><label>إلى</label><input class="input" type="date" id="c-to" value="${c?.ends_on || fromSeason?.ends_on || fromSeason?.starts_on || ''}"></div></div>
      <div class="grid2"><div class="field"><label>الميزانية</label><input class="input num" type="number" min="0" id="c-bud" value="${n('budget')}"></div><div class="field"><label>هدف العميلات الجدد</label><input class="input num" type="number" min="0" id="c-goal" value="${n('goal_clients')}"></div></div>
      <div class="field"><label>الحالة</label><div class="chips" id="c-st">${Object.entries(CMP_ST).map(([k, [l]]) => `<button type="button" class="chip ${k === st ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="cmp-results ${st === 'planned' ? 'dim' : ''}"><div class="close-h">النتائج</div>
        <div class="grid2"><div class="field"><label>المصروف فعليًا</label><input class="input num" type="number" min="0" id="c-spent" value="${n('spent')}"></div><div class="field"><label>عميلات جدد</label><input class="input num" type="number" min="0" id="c-nc" value="${n('new_clients')}"></div></div>
        <div class="grid2"><div class="field"><label>حجوزات</label><input class="input num" type="number" min="0" id="c-bk" value="${n('bookings')}"></div><div class="field"><label>مبيعات منها</label><input class="input num" type="number" min="0" id="c-rev" value="${n('revenue')}"></div></div>
        <div class="field"><label>وش تعلّمنا</label><textarea class="input" id="c-learn" rows="2" maxlength="1000" placeholder="مثلًا: الريلز جابت أكثر من الإعلان المدفوع">${esc(c?.learnings || '')}</textarea></div></div>
      <div class="actions end">${c ? '<button class="btn danger" id="c-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="c-save">حفظ</button></div>`, (el, close) => {
      $$('#c-ch .chip', el).forEach((b) => b.onclick = () => { const k = b.dataset.k; chs.has(k) ? chs.delete(k) : chs.add(k); b.classList.toggle('on'); });
      $$('#c-st .chip', el).forEach((b) => b.onclick = () => { st = b.dataset.k; $$('#c-st .chip', el).forEach((x) => x.classList.toggle('on', x === b)); $('.cmp-results', el).classList.toggle('dim', st === 'planned'); });
      const num = (id) => { const v = $(id, el).value; return v === '' ? null : Number(v); };
      $('#c-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#c-name', el).value.trim(), season_id: $('#c-sea', el).value ? Number($('#c-sea', el).value) : null, offer: $('#c-offer', el).value.trim() || null, channels: [...chs], starts_on: $('#c-from', el).value || todayR(), ends_on: $('#c-to', el).value || null, budget: num('#c-bud'), goal_clients: num('#c-goal'), status: st, spent: num('#c-spent'), new_clients: num('#c-nc'), bookings: num('#c-bk'), revenue: num('#c-rev'), learnings: $('#c-learn', el).value.trim() || null };
        if (row.name.length < 2) return toast('اكتبوا اسم الحملة', true);
        try { if (c) await q(sb.from('mkt_campaigns').update(row).eq('id', c.id)); else await q(sb.from('mkt_campaigns').insert(row)); toast('تم الحفظ'); close(); done && done(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#c-del', el)?.addEventListener('click', async () => { close(); if (await confirmBox('حذف الحملة', 'تنحذف الحملة ونتائجها.', 'حذف', true)) { try { await q(sb.from('mkt_campaigns').delete().eq('id', c.id)); route(); } catch (err) { toast(errMsg(err), true); } } });
    });
  }

  async function mktContent(view, params, alive, head) {
    const off = Number(params.get('w') || 0);
    const [ws, we] = lensRange('w', lensShift('w', D(todayR()), off));
    const posts = await q(sb.from('mkt_posts').select('*').order('publish_on', { nullsFirst: false }).order('id', { ascending: false }).limit(400));
    if (!alive()) return;
    const tk = todayR();
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return dk(d); });
    const weekPosts = posts.filter((p) => p.publish_on >= dk(ws) && p.publish_on <= dk(we));
    const card = (p) => `<button class="pcard ${p.publish_on && p.publish_on < tk && p.status !== 'posted' ? 'late' : ''}" data-p="${p.id}">
        <div class="pc-tags"><span class="ptag k-${p.kind}">${POST_KIND[p.kind]}</span>${p.pillar ? `<span class="ptag">${PILLAR[p.pillar]}</span>` : ''}</div>
        <b>${esc(p.title)}</b>${p.publish_on ? `<span class="pc-date">${dShort(p.publish_on)}</span>` : ''}
        ${p.status !== 'posted' ? `<span class="pc-next" data-next="${p.id}" title="المرحلة الجاية">←</span>` : ''}</button>`;
    view.innerHTML = `${head}
      <div class="week-head"><a class="icon-btn" href="#/marketing?t=content&w=${off - 1}">›</a><b>${lensTitle('w', ws, we)}</b><a class="icon-btn" href="#/marketing?t=content&w=${off + 1}">‹</a></div>
      <div class="week-strip">${days.map((d) => { const ps = weekPosts.filter((p) => p.publish_on === d); return `<div class="wd ${d === tk ? 'today' : ''}"><span>${['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'][D(d).getDay()]}</span><b class="num">${D(d).getDate()}</b><div class="wd-dots">${ps.map((p) => `<i class="k-${p.kind} ${p.status}" title="${esc(p.title)}"></i>`).join('')}</div></div>`; }).join('')}</div>
      <p class="muted small" style="margin:8px 2px 14px">${weekPosts.length ? `${weekPosts.length} منشور مجدول هالأسبوع، المنشور منها ${weekPosts.filter((p) => p.status === 'posted').length}` : 'ما فيه شي مجدول هالأسبوع'}. القاعدة الذهبية: ٣ ريلز وستوري يومي.</p>
      <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="p-new">${I.plus} فكرة</button><button class="btn" id="p-spark">✦ ما عندي فكرة</button></div>
      <div class="kanban">${POST_ST.map(([k, l]) => { const ps = posts.filter((p) => p.status === k && (k !== 'posted' || (p.publish_on || p.created_at.slice(0, 10)) >= dk(lensShift('d', D(tk), -30)))); return `<div class="kcol"><div class="kcol-h"><b>${l}</b><span class="num">${ps.length}</span></div>${ps.map(card).join('') || '<div class="kempty">—</div>'}</div>`; }).join('')}</div>`;
    $('#p-new').onclick = () => postForm(null);
    $('#p-spark').onclick = () => { const [pl, kd, t] = IDEAS[Math.floor(Math.random() * IDEAS.length)]; postForm({ title: t, kind: kd, pillar: pl, status: 'idea', _new: true }); };
    $$('[data-p]', view).forEach((b) => b.addEventListener('click', (e) => {
      const nx = e.target.closest('[data-next]');
      const p = posts.find((x) => x.id === Number(b.dataset.p));
      if (nx) { const i = POST_ST.findIndex((s) => s[0] === p.status); busy(null, async () => { try { await q(sb.from('mkt_posts').update({ status: POST_ST[i + 1][0], updated_at: new Date().toISOString() }).eq('id', p.id)); toast(`انتقل إلى «${POST_ST[i + 1][1]}»`); route(); } catch (err) { toast(errMsg(err), true); } }); return; }
      postForm(p);
    }));
  }

  function postForm(p) {
    const isNew = !p || p._new; let kind = p?.kind || 'reel', pillar = p?.pillar || '', st = p?.status || 'idea';
    modal(`
      <h3>${isNew ? 'فكرة محتوى' : 'المحتوى'}</h3>
      <div class="field"><label>الفكرة</label><input class="input" id="p-title" maxlength="120" value="${esc(p?.title || '')}"></div>
      <div class="field"><label>النوع</label><div class="chips wrap" id="p-k">${Object.entries(POST_KIND).map(([k, l]) => `<button type="button" class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>المحور</label><div class="chips wrap" id="p-pl">${Object.entries(PILLAR).map(([k, l]) => `<button type="button" class="chip ${k === pillar ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>موعد النشر</label><input class="input" type="date" id="p-day" value="${p?.publish_on || ''}"></div>
      <div class="field"><label>المرحلة</label><select class="input" id="p-st">${POST_ST.map(([k, l]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>ملاحظات التصوير</label><textarea class="input" id="p-notes" rows="2" maxlength="1000" placeholder="الإضاءة، العميلة، الصوت…">${esc(p?.notes || '')}</textarea></div>
      <div class="field"><label>الرابط بعد النشر</label><input class="input" id="p-link" dir="ltr" maxlength="500" value="${esc(p?.link || '')}" placeholder="https://instagram.com/…"></div>
      <div class="actions end">${!isNew && isManager() ? '<button class="btn danger" id="p-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="p-save">حفظ</button></div>`, (el, close) => {
      const pick = (sel, set, toggle) => $$(sel + ' .chip', el).forEach((b) => b.onclick = () => { const was = b.classList.contains('on'); $$(sel + ' .chip', el).forEach((x) => x.classList.remove('on')); if (!(toggle && was)) b.classList.add('on'); set(toggle && was ? '' : b.dataset.k); });
      pick('#p-k', (v) => { kind = v; }); pick('#p-pl', (v) => { pillar = v; }, true);
      $('#p-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { title: $('#p-title', el).value.trim(), kind, pillar: pillar || null, publish_on: $('#p-day', el).value || null, status: $('#p-st', el).value, notes: $('#p-notes', el).value.trim() || null, link: $('#p-link', el).value.trim() || null, updated_at: new Date().toISOString() };
        if (row.title.length < 2) return toast('اكتبوا الفكرة', true);
        try { if (!isNew) await q(sb.from('mkt_posts').update(row).eq('id', p.id)); else await q(sb.from('mkt_posts').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#p-del', el)?.addEventListener('click', async () => { try { await q(sb.from('mkt_posts').delete().eq('id', p.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
    });
  }

  /* ======================= team ======================= */
  const TROLE = { nails: 'أخصائية أظافر', hair: 'أخصائية شعر', makeup: 'خبيرة مكياج', lashes: 'رموش وحواجب', reception: 'استقبال', manager: 'مديرة الصالون', cleaner: 'خدمات ونظافة', other: 'أخرى' };
  const LKIND = { annual: 'سنوية', sick: 'مرضية', emergency: 'اضطرارية', unpaid: 'بدون راتب', other: 'أخرى' };
  const LST = { pending: ['بانتظار الاعتماد', 'warn'], approved: ['معتمدة', 'ok'], rejected: ['مرفوضة', 'danger'] };
  const DOCS = [['iqama_expiry', 'الإقامة'], ['health_card_expiry', 'الشهادة الصحية'], ['passport_expiry', 'الجواز'], ['contract_end', 'العقد']];
  const TCOLORS = ['#5A2A22', '#B88A68', '#8E6A3A', '#7A5D51', '#C77B5A', '#4A2620', '#A0705A', '#6B4A3A'];
  const WEEK = [6, 0, 1, 2, 3, 4, 5];
  const hm = (t) => (t ? t.slice(0, 5) : '');
  const h12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); const hh = h % 12 || 12; return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'ص' : 'م'}`; };
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const onLeave = (leaves, mid, day) => leaves.find((l) => l.member_id === mid && l.status === 'approved' && l.from_day <= day && l.to_day >= day);
  function docState(p) {
    if (!p) return [];
    return DOCS.map(([k, l]) => { if (!p[k]) return null; const u = until(p[k]); return u <= 45 ? { k, l, u, cls: u < 0 ? 'danger' : u <= 14 ? 'danger' : 'warn' } : null; }).filter(Boolean);
  }
  const docTxt = (d) => (d.u < 0 ? `${d.l} منتهية` : d.u === 0 ? `${d.l} تنتهي اليوم` : `${d.l} بعد ${daysTxt(d.u)}`);

  async function teamData() {
    const [members, shifts, leaves, priv] = await Promise.all([
      q(sb.from('team_members').select('*').order('active', { ascending: false }).order('name')),
      q(sb.from('team_shifts').select('*')),
      q(sb.from('team_leaves').select('*').order('from_day', { ascending: false }).limit(300)),
      isManager() ? q(sb.from('team_private').select('*')) : [],
    ]);
    return { members, shifts, leaves, priv: new Map(priv.map((p) => [p.member_id, p])) };
  }

  async function pageTeam(view, _a, params, alive) {
    const tab = params.get('t') || 'today';
    const T = await teamData();
    if (!alive()) return;
    const tabs = [['today', 'اليوم'], ['shifts', 'المناوبات'], ['leaves', 'الإجازات'], ...(isManager() ? [['pay', 'الرواتب']] : [])];
    const pend = T.leaves.filter((l) => l.status === 'pending').length;
    const head = `<div class="lens" style="margin-bottom:16px">${tabs.map(([k, l]) => `<a href="#/team?t=${k}" class="${k === tab ? 'on' : ''}">${l}${k === 'leaves' && pend && isManager() ? ` <i class="dotn">${pend}</i>` : ''}</a>`).join('')}</div>`;
    if (tab === 'shifts') return teamShifts(view, T, head);
    if (tab === 'leaves') return teamLeaves(view, T, head);
    if (tab === 'pay' && isManager()) return teamPay(view, T, head, params, alive);
    const tk = todayR(), wd = D(tk).getDay();
    const act = T.members.filter((m) => m.active);
    const today = act.map((m) => ({ m, s: T.shifts.find((s) => s.member_id === m.id && s.weekday === wd), l: onLeave(T.leaves, m.id, tk) }));
    const working = today.filter((x) => x.s && !x.l);
    const nowM = (() => { const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }); return mins(t); })();
    const H0 = Math.min(10 * 60, ...working.map((x) => mins(x.s.starts))), H1 = Math.max(22 * 60, ...working.map((x) => { const e = mins(x.s.ends); return e <= mins(x.s.starts) ? e + 1440 : e; }));
    const pos = (v) => ((v - H0) / (H1 - H0)) * 100;
    const hours = []; for (let h = Math.ceil(H0 / 60); h <= Math.floor(H1 / 60); h += 2) hours.push(h);
    const docsAll = isManager() ? act.flatMap((m) => docState(T.priv.get(m.id)).map((d) => ({ m, d }))) : [];
    view.innerHTML = `${head}
      <div class="today-card">
        <div class="tc-top"><div><span>اليوم في بيوتفريش</span><b>${WDAYS[wd]} ${D(tk).getDate()} ${MONTHS_AR[D(tk).getMonth()]}</b></div><div class="tc-n"><b class="num">${working.length}</b><span>على رأس العمل</span></div></div>
        ${working.length ? `<div class="gantt">
          <div class="g-hours">${hours.map((h) => `<span style="inset-inline-start:${pos(h * 60)}%">${h12(String(h % 24).padStart(2, '0') + ':00')}</span>`).join('')}</div>
          ${working.map(({ m, s }) => { const a = mins(s.starts); let b = mins(s.ends); if (b <= a) b += 1440; const on = nowM >= a && nowM < b; return `<a class="g-row" href="#/member/${m.id}"><span class="g-name">${esc(firstName(m.name))}</span><div class="g-track"><i class="${on ? 'on' : ''}" style="inset-inline-start:${pos(a)}%;width:${pos(b) - pos(a)}%;--c:${m.color}">${h12(s.starts)}–${h12(s.ends)}</i></div></a>`; }).join('')}
          ${nowM >= H0 && nowM <= H1 ? `<div class="g-now" style="inset-inline-start:calc(72px + (100% - 72px) * ${pos(nowM) / 100})"></div>` : ''}
        </div>` : '<p class="tc-empty">ما فيه مناوبات مسجلة لليوم. رتّبوها من «المناوبات».</p>'}
        ${today.filter((x) => x.l).length ? `<div class="tc-off">إجازة اليوم: ${today.filter((x) => x.l).map((x) => esc(firstName(x.m.name))).join('، ')}</div>` : ''}
      </div>
      ${docsAll.length ? `<div class="section-title"><h2>وثائق تحتاج تجديد</h2></div><div class="alerts">${docsAll.map(({ m, d }) => `<a class="alert ${d.cls}" href="#/member/${m.id}"><span class="al-ic">${I.key}</span><div><b>${docTxt(d)}</b><span>${esc(m.name)}</span></div></a>`).join('')}</div>` : ''}
      <div class="section-title"><h2>الفريق</h2>${isManager() ? `<button class="btn sm" id="tm-new">${I.plus} موظفة</button>` : ''}</div>
      <div class="team-grid">${T.members.length ? T.members.map((m) => { const x = today.find((t) => t.m.id === m.id); const ds = isManager() ? docState(T.priv.get(m.id)) : []; return `
        <a class="tm-card ${m.active ? '' : 'off'}" href="#/member/${m.id}" style="--c:${m.color}">
          <span class="tm-av">${esc(initial(m.name))}</span>
          <b>${esc(m.name)}</b><span class="tm-role">${TROLE[m.role_title]}</span>
          <span class="tm-today">${!m.active ? 'موقوفة' : x?.l ? 'إجازة اليوم' : x?.s ? `اليوم ${h12(x.s.starts)}–${h12(x.s.ends)}` : 'ما عندها دوام اليوم'}</span>
          ${ds.length ? `<span class="tm-doc ${ds[0].cls}">${docTxt(ds[0])}</span>` : ''}
        </a>`; }).join('') : `<div class="empty" style="grid-column:1/-1">${isManager() ? 'أضيفوا الفريق عشان تبدأ المناوبات والإجازات.' : 'ما فيه فريق مسجل'}</div>`}</div>`;
    $('#tm-new')?.addEventListener('click', () => memberForm(null, null, (id) => { location.hash = `#/member/${id}`; }));
  }

  function teamShifts(view, T, head) {
    const act = T.members.filter((m) => m.active);
    const tk = todayR(), wd = D(tk).getDay();
    const hrs = (m) => T.shifts.filter((s) => s.member_id === m.id).reduce((a, s) => { let d = mins(s.ends) - mins(s.starts); if (d <= 0) d += 1440; return a + d; }, 0) / 60;
    view.innerHTML = `${head}
      <div class="shift-wrap"><table class="shift">
        <thead><tr><th></th>${WEEK.map((d) => `<th class="${d === wd ? 'today' : ''}">${['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'][d]}</th>`).join('')}<th>ساعات</th></tr></thead>
        <tbody>${act.map((m) => `<tr><th><span class="sw-dot" style="background:${m.color}"></span>${esc(firstName(m.name))}</th>${WEEK.map((d) => { const s = T.shifts.find((x) => x.member_id === m.id && x.weekday === d); return `<td><button class="sc ${s ? 'has' : ''}" ${isManager() ? '' : 'disabled'} data-m="${m.id}" data-d="${d}" style="--c:${m.color}">${s ? `${h12(s.starts)}<br>${h12(s.ends)}` : '—'}</button></td>`; }).join('')}<td class="num hrs">${hrs(m) ? Math.round(hrs(m)) : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">أضيفوا الفريق أول</td></tr>'}
        <tr class="cover"><th>العدد</th>${WEEK.map((d) => { const n = act.filter((m) => T.shifts.some((x) => x.member_id === m.id && x.weekday === d)).length; return `<td><span class="${n === 0 ? 'zero' : ''}">${n}</span></td>`; }).join('')}<td></td></tr></tbody>
      </table></div>
      ${isManager() ? '<p class="muted small mt">اضغطوا على أي خانة عشان تحددون الدوام. المناوبة تتكرر كل أسبوع، والإجازات المعتمدة تنخصم منها تلقائيًا.</p>' : ''}`;
    $$('.sc[data-m]', view).forEach((b) => b.addEventListener('click', () => {
      const m = T.members.find((x) => x.id === Number(b.dataset.m)); const d = Number(b.dataset.d);
      const s = T.shifts.find((x) => x.member_id === m.id && x.weekday === d);
      const last = T.shifts.find((x) => x.member_id === m.id);
      modal(`
        <h3>${esc(firstName(m.name))} · ${WDAYS[d]}</h3>
        <div class="chips wrap" style="margin-bottom:12px">${[['10:00', '18:00', 'صباحي'], ['14:00', '22:00', 'مسائي'], ['12:00', '22:00', 'كامل']].map(([a, z, l]) => `<button type="button" class="chip" data-a="${a}" data-z="${z}">${l} ${h12(a)}–${h12(z)}</button>`).join('')}</div>
        <div class="grid2"><div class="field"><label>من</label><input class="input" type="time" id="h-a" value="${hm(s?.starts || last?.starts || '14:00')}"></div><div class="field"><label>إلى</label><input class="input" type="time" id="h-z" value="${hm(s?.ends || last?.ends || '22:00')}"></div></div>
        <label class="check" style="margin-bottom:12px"><input type="checkbox" id="h-all"> طبّق نفس الوقت على كل أيام دوامها</label>
        <div class="actions end">${s ? '<button class="btn danger" id="h-off">إجازة أسبوعية</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="h-save">حفظ</button></div>`, (el, close) => {
        $$('[data-a]', el).forEach((c) => c.onclick = () => { $('#h-a', el).value = c.dataset.a; $('#h-z', el).value = c.dataset.z; });
        $('#h-save', el).onclick = (e) => busy(e.currentTarget, async () => {
          const a = $('#h-a', el).value, z = $('#h-z', el).value; if (!a || !z || a === z) return toast('حددوا الوقت', true);
          const days = $('#h-all', el).checked ? [...new Set([d, ...T.shifts.filter((x) => x.member_id === m.id).map((x) => x.weekday)])] : [d];
          try { await q(sb.from('team_shifts').upsert(days.map((w) => ({ member_id: m.id, weekday: w, starts: a, ends: z })), { onConflict: 'member_id,weekday' })); close(); route(); } catch (err) { toast(errMsg(err), true); }
        });
        $('#h-off', el)?.addEventListener('click', (e) => busy(e.currentTarget, async () => { try { await q(sb.from('team_shifts').delete().eq('id', s.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } }));
      });
    }));
  }

  function teamLeaves(view, T, head) {
    const name = (id) => T.members.find((m) => m.id === id)?.name || '—';
    const days = (l) => Math.round((D(l.to_day) - D(l.from_day)) / 86400000) + 1;
    const tk = todayR();
    const groups = [['pending', T.leaves.filter((l) => l.status === 'pending')], ['now', T.leaves.filter((l) => l.status === 'approved' && l.to_day >= tk)], ['past', T.leaves.filter((l) => l.status !== 'pending' && !(l.status === 'approved' && l.to_day >= tk)).slice(0, 40)]];
    const GT = { pending: 'بانتظار الاعتماد', now: 'الحالية والقادمة', past: 'السابقة' };
    view.innerHTML = `${head}
      <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="lv-new">${I.plus} طلب إجازة</button></div>
      ${groups.map(([k, ls]) => ls.length ? `<div class="section-title"><h2>${GT[k]}</h2></div><div class="list">${ls.map((l) => {
        const m = T.members.find((x) => x.id === l.member_id);
        return `<div class="row"><span class="cav" style="background:${m?.color || '#5A2A22'};color:#F3EBDF">${esc(initial(name(l.member_id)))}</span>
          <div class="grow"><div class="title">${esc(name(l.member_id))} <span class="muted small">· ${LKIND[l.kind]}</span></div><div class="meta">${dShort(l.from_day)}${l.to_day !== l.from_day ? ` – ${dShort(l.to_day)}` : ''} · ${daysTxt(days(l))}${l.note ? ' · ' + esc(l.note) : ''}</div></div>
          <div class="end">${l.status === 'pending' && isManager() ? `<button class="btn sm primary" data-ok="${l.id}">اعتماد</button> <button class="btn sm" data-no="${l.id}">رفض</button>` : `<span class="badge ${LST[l.status][1]}">${LST[l.status][0]}</span>`}</div></div>`;
      }).join('')}</div>` : '').join('') || '<div class="list"><div class="empty">ما فيه إجازات</div></div>'}`;
    $('#lv-new').onclick = () => leaveForm(T);
    const decide = (id, status) => busy(null, async () => { try { await q(sb.from('team_leaves').update({ status, decided_by: S.profile.id }).eq('id', id)); toast(status === 'approved' ? 'تم الاعتماد' : 'تم الرفض'); route(); } catch (err) { toast(errMsg(err), true); } });
    $$('[data-ok]', view).forEach((b) => b.onclick = () => decide(Number(b.dataset.ok), 'approved'));
    $$('[data-no]', view).forEach((b) => b.onclick = () => decide(Number(b.dataset.no), 'rejected'));
  }

  function leaveForm(T, memberId) {
    const mine = T.members.find((m) => m.profile_id === S.profile.id);
    const sel = memberId || mine?.id || '';
    let kind = 'annual';
    modal(`
      <h3>طلب إجازة</h3>
      <div class="field"><label>الموظفة</label><select class="input" id="l-m" ${!isManager() && mine ? 'disabled' : ''}>${T.members.filter((m) => m.active).map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>النوع</label><div class="chips wrap" id="l-k">${Object.entries(LKIND).map(([k, l]) => `<button type="button" class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>من</label><input class="input" type="date" id="l-a" value="${todayR()}"></div><div class="field"><label>إلى</label><input class="input" type="date" id="l-z" value="${todayR()}"></div></div>
      <div class="field"><label>ملاحظة</label><input class="input" id="l-n" maxlength="300"></div>
      ${isManager() ? '<label class="check" style="margin-bottom:12px"><input type="checkbox" id="l-ok" checked> اعتمدها مباشرة</label>' : ''}
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="l-save">إرسال</button></div>`, (el, close) => {
      $$('#l-k .chip', el).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$('#l-k .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#l-a', el).onchange = () => { if ($('#l-z', el).value < $('#l-a', el).value) $('#l-z', el).value = $('#l-a', el).value; };
      $('#l-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { member_id: Number($('#l-m', el).value), kind, from_day: $('#l-a', el).value, to_day: $('#l-z', el).value, note: $('#l-n', el).value.trim() || null };
        if (!row.member_id) return toast('اختاروا الموظفة', true);
        if (row.to_day < row.from_day) return toast('تاريخ النهاية قبل البداية', true);
        try {
          const ins = await q(sb.from('team_leaves').insert(row).select('id').single());
          if ($('#l-ok', el)?.checked) await q(sb.from('team_leaves').update({ status: 'approved', decided_by: S.profile.id }).eq('id', ins.id));
          toast(isManager() ? 'تم الحفظ' : 'انرسل الطلب للإدارة'); close(); route();
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  async function teamPay(view, T, head, params, alive) {
    const m0 = params.get('m') ? D(params.get('m')) : D(monthKey(D(todayR())));
    const mk = monthKey(m0);
    const sales = await q(sb.from('team_sales').select('*').eq('month', mk));
    if (!alive()) return;
    const act = T.members.filter((m) => m.active);
    const row = (m) => { const p = T.priv.get(m.id) || {}; const s = sales.find((x) => x.member_id === m.id) || {}; const sal = Number(p.salary || 0), pct = Number(p.commission_pct || 0), sv = Number(s.sales || 0), bn = Number(s.bonus || 0); return { m, sal, pct, sv, bn, com: (sv * pct) / 100 }; };
    const rows = act.map(row);
    const tot = rows.reduce((a, r) => ({ sal: a.sal + r.sal, com: a.com + r.com, bn: a.bn + r.bn, sv: a.sv + r.sv }), { sal: 0, com: 0, bn: 0, sv: 0 });
    const prev = monthKey(new Date(m0.getFullYear(), m0.getMonth() - 1, 1, 12)), next = monthKey(new Date(m0.getFullYear(), m0.getMonth() + 1, 1, 12));
    view.innerHTML = `${head}
      <div class="fin-head"><a class="icon-btn" href="#/team?t=pay&m=${prev}">›</a><h2>${MONTHS_AR[m0.getMonth()]} ${m0.getFullYear()}</h2><a class="icon-btn" href="#/team?t=pay&m=${next}">‹</a></div>
      <div class="seg-tiles">
        <div class="seg-tile"><b class="num">${sar(tot.sal)}</b><span>الرواتب</span></div>
        <div class="seg-tile gold"><b class="num">${sar(tot.com + tot.bn)}</b><span>العمولات والمكافآت</span></div>
        <div class="seg-tile ok"><b class="num">${sar(tot.sv)}</b><span>مبيعات الفريق</span></div>
        <div class="seg-tile on"><b class="num">${sar(tot.sal + tot.com + tot.bn)}</b><span>الإجمالي</span></div>
      </div>
      <div class="pay-list">${rows.map((r) => `
        <div class="pay" data-m="${r.m.id}" style="--c:${r.m.color}">
          <div class="pay-h"><span class="tm-av sm">${esc(initial(r.m.name))}</span><div class="grow"><b>${esc(r.m.name)}</b><span>${TROLE[r.m.role_title]} · راتب ${sar(r.sal)} · عمولة ${r.pct}٪</span></div><b class="num pay-t">${sar(r.sal + r.com + r.bn)}</b></div>
          <div class="pay-in"><label class="mfield"><span>مبيعاتها هالشهر</span><input class="input num" type="number" min="0" data-k="sales" value="${r.sv || ''}" placeholder="0"></label>
            <label class="mfield"><span>مكافأة</span><input class="input num" type="number" min="0" data-k="bonus" value="${r.bn || ''}" placeholder="0"></label>
            <div class="mfield"><span>العمولة</span><b class="num pay-c">${sar(r.com)}</b></div></div>
        </div>`).join('') || '<div class="list"><div class="empty">أضيفوا الفريق وحددوا رواتبهم من ملف كل موظفة.</div></div>'}</div>
      ${rows.length ? `<div class="actions mt"><button class="btn" id="pay-exp">سجّلها في مصروفات ${MONTHS_AR[m0.getMonth()]}</button></div><p class="muted small">تنضاف سطرين للمصروفات: الرواتب، والعمولات والمكافآت. الأفضل تسجلونها مرة وحدة آخر الشهر.</p>` : ''}`;
    $$('.pay', view).forEach((card) => {
      const mid = Number(card.dataset.m); let t;
      card.addEventListener('input', () => {
        const r = rows.find((x) => x.m.id === mid); const sv = Number($('[data-k=sales]', card).value) || 0, bn = Number($('[data-k=bonus]', card).value) || 0;
        $('.pay-c', card).textContent = sar((sv * r.pct) / 100); $('.pay-t', card).textContent = sar(r.sal + (sv * r.pct) / 100 + bn);
        clearTimeout(t); t = setTimeout(async () => { try { await q(sb.from('team_sales').upsert({ member_id: mid, month: mk, sales: sv, bonus: bn })); } catch (err) { toast(errMsg(err), true); } }, 600);
      });
    });
    $('#pay-exp')?.addEventListener('click', async (e) => {
      const fresh = await q(sb.from('team_sales').select('*').eq('month', mk));
      const com = act.reduce((a, m) => { const p = T.priv.get(m.id) || {}; const s = fresh.find((x) => x.member_id === m.id) || {}; return a + (Number(s.sales || 0) * Number(p.commission_pct || 0)) / 100 + Number(s.bonus || 0); }, 0);
      if (!(await confirmBox('تسجيل في المصروفات', `رواتب ${sar(tot.sal)} ر.س، وعمولات ومكافآت ${sar(com)} ر.س.`, 'سجّل'))) return;
      const day = dk(new Date(m0.getFullYear(), m0.getMonth() + 1, 0, 12));
      const ins = [tot.sal > 0 && { day, category: 'salaries', amount: tot.sal, note: `رواتب ${MONTHS_AR[m0.getMonth()]}` }, com > 0 && { day, category: 'commissions', amount: Math.round(com * 100) / 100, note: `عمولات ومكافآت ${MONTHS_AR[m0.getMonth()]}` }].filter(Boolean);
      busy(e.target, async () => { try { if (ins.length) await q(sb.from('fin_expenses').insert(ins)); toast('انضافت للمصروفات'); } catch (err) { toast(errMsg(err), true); } });
    });
  }

  async function pageMember(view, args, _p, alive) {
    const id = Number(args[0]);
    const T = await teamData();
    if (!alive()) return;
    const m = T.members.find((x) => x.id === id);
    if (!m) { view.innerHTML = '<div class="notice danger">ما لقينا الموظفة</div>'; return; }
    setTitle(m.name);
    const p = T.priv.get(id);
    const tk = todayR();
    const ls = T.leaves.filter((l) => l.member_id === id);
    const usedYear = ls.filter((l) => l.status === 'approved' && l.kind === 'annual' && l.from_day.slice(0, 4) === tk.slice(0, 4)).reduce((a, l) => a + Math.round((D(l.to_day) - D(l.from_day)) / 86400000) + 1, 0);
    const tenure = m.start_date ? Math.floor((D(tk) - D(m.start_date)) / (86400000 * 30.44)) : null;
    const prof = m.profile_id ? S.profiles.get(m.profile_id) : null;
    view.innerHTML = `
      <div class="cl-hero" style="--c:${m.color}">
        <span class="tm-av big">${esc(initial(m.name))}</span>
        <div class="grow"><h2>${esc(m.name)}</h2><div class="cl-sub"><span>${TROLE[m.role_title]}</span>${m.phone ? `<span class="num" dir="ltr">${esc(m.phone)}</span>` : ''}${!m.active ? '<span class="badge">موقوفة</span>' : ''}${prof ? `<span class="badge accent">لها حساب في النظام</span>` : ''}</div></div>
        <div class="cl-acts">${m.phone ? `<a class="icon-btn" href="https://wa.me/${waNum(m.phone)}" target="_blank" rel="noopener">${I.wa}</a>` : ''}${isManager() ? `<button class="icon-btn" id="m-edit">${I.edit}</button>` : ''}</div>
      </div>
      <div class="cl-stats">
        <div><b class="num">${tenure != null ? (tenure >= 12 ? `${Math.floor(tenure / 12)}س ${tenure % 12}ش` : `${tenure} ش`) : '—'}</b><span>معنا من</span></div>
        <div><b class="num">${T.shifts.filter((s) => s.member_id === id).length}</b><span>أيام دوام</span></div>
        <div><b class="num">${usedYear}</b><span>إجازة سنوية هالسنة</span></div>
        <div><b class="num">${ls.filter((l) => l.status === 'pending').length}</b><span>طلب معلق</span></div>
      </div>
      <div class="section-title"><h2>دوامها الأسبوعي</h2></div>
      <div class="week7">${WEEK.map((d) => { const s = T.shifts.find((x) => x.member_id === id && x.weekday === d); return `<div class="${s ? 'on' : ''} ${d === D(tk).getDay() ? 'today' : ''}"><span>${['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'][d]}</span><b>${s ? `${h12(s.starts)}<br>${h12(s.ends)}` : 'إجازة'}</b></div>`; }).join('')}</div>
      ${m.skills ? `<div class="section-title"><h2>تتقن</h2></div><div class="chips wrap">${m.skills.split(/[،,]/).map((x) => x.trim()).filter(Boolean).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      ${isManager() ? `<div class="section-title"><h2>الوثائق والعقد</h2></div>
        <div class="docs">${DOCS.map(([k, l]) => { const v = p?.[k]; const u = v ? until(v) : null; const cls = u == null ? 'none' : u < 0 ? 'danger' : u <= 14 ? 'danger' : u <= 45 ? 'warn' : 'ok'; return `<div class="doc ${cls}"><span>${l}</span><b>${v ? dShort(v) + ' ' + D(v).getFullYear() : 'غير مسجل'}</b><em>${u == null ? '' : u < 0 ? `منتهية من ${daysTxt(-u)}` : `باقي ${daysTxt(u)}`}</em></div>`; }).join('')}</div>
        <div class="cl-stats" style="grid-template-columns:repeat(2,1fr)"><div><b class="num">${p?.salary != null ? sar(p.salary) : '—'}</b><span>الراتب</span></div><div><b class="num">${p?.commission_pct != null ? Number(p.commission_pct) + '٪' : '—'}</b><span>العمولة من مبيعاتها</span></div></div>
        ${p?.notes ? `<div class="card note-card">${esc(p.notes)}</div>` : ''}` : ''}
      <div class="section-title"><h2>الإجازات</h2><button class="btn sm" id="m-leave">${I.plus} طلب إجازة</button></div>
      <div class="list">${ls.length ? ls.slice(0, 20).map((l) => `<div class="row"><div class="grow"><div class="title">${LKIND[l.kind]}</div><div class="meta">${dShort(l.from_day)}${l.to_day !== l.from_day ? ` – ${dShort(l.to_day)}` : ''} ${D(l.from_day).getFullYear()}${l.note ? ' · ' + esc(l.note) : ''}</div></div><span class="badge ${LST[l.status][1]}">${LST[l.status][0]}</span></div>`).join('') : '<div class="empty">ما فيه إجازات</div>'}</div>`;
    $('#m-edit')?.addEventListener('click', () => memberForm(m, p, () => route()));
    $('#m-leave').onclick = () => leaveForm(T, id);
  }

  function memberForm(m, p, done) {
    let role = m?.role_title || 'nails', color = m?.color || TCOLORS[Math.floor(Math.random() * TCOLORS.length)], active = m ? m.active : true;
    const profs = [...S.profiles.values()].filter((x) => x.is_active);
    modal(`
      <h3>${m ? 'تعديل بيانات الموظفة' : 'موظفة جديدة'}</h3>
      <div class="field"><label>الاسم</label><input class="input" id="t-name" maxlength="60" value="${esc(m?.name || '')}"></div>
      <div class="field"><label>التخصص</label><div class="chips wrap" id="t-role">${Object.entries(TROLE).map(([k, l]) => `<button type="button" class="chip ${k === role ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>الجوال</label><input class="input num" id="t-phone" dir="ltr" inputmode="tel" value="${esc(m?.phone || '')}" placeholder="05xxxxxxxx"></div>
      <div class="field"><label>بداية العمل</label><input class="input" type="date" id="t-start" value="${m?.start_date || ''}"></div></div>
      <div class="field"><label>لونها في الجداول</label><div class="colors" id="t-col">${TCOLORS.map((c) => `<button type="button" class="${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="field"><label>تتقن <span class="muted small">(افصلوا بفاصلة)</span></label><input class="input" id="t-skills" maxlength="300" value="${esc(m?.skills || '')}" placeholder="جيل، أكريليك، رسم أظافر"></div>
      <div class="field"><label>حسابها في النظام <span class="muted small">(اختياري)</span></label><select class="input" id="t-prof"><option value="">—</option>${profs.map((x) => `<option value="${x.id}" ${x.id === m?.profile_id ? 'selected' : ''}>${esc(x.full_name || x.login)}</option>`).join('')}</select></div>
      <div class="close-h" style="margin-top:6px">للإدارة فقط</div>
      <div class="grid2"><div class="field"><label>الراتب</label><input class="input num" type="number" min="0" id="t-sal" value="${p?.salary ?? ''}"></div><div class="field"><label>العمولة ٪</label><input class="input num" type="number" min="0" max="100" step="0.5" id="t-pct" value="${p?.commission_pct ?? ''}"></div></div>
      <div class="grid2">${DOCS.map(([k, l]) => `<div class="field"><label>انتهاء ${l}</label><input class="input" type="date" id="t-${k}" value="${p?.[k] || ''}"></div>`).join('')}</div>
      <p class="muted small" style="margin-top:-4px">نحفظ تواريخ الانتهاء بس، بدون أرقام الهويات.</p>
      <div class="field"><label>ملاحظات</label><textarea class="input" id="t-notes" rows="2" maxlength="1000">${esc(p?.notes || '')}</textarea></div>
      ${m ? `<label class="toggle-row"><span><b>على رأس العمل</b><small>الموقوفة ما تطلع في المناوبات</small></span><button type="button" class="sw ${active ? 'on' : ''}" id="t-act"></button></label>` : ''}
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="t-save">حفظ</button></div>`, (el, close) => {
      $$('#t-role .chip', el).forEach((b) => b.onclick = () => { role = b.dataset.k; $$('#t-role .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $$('#t-col button', el).forEach((b) => b.onclick = () => { color = b.dataset.c; $$('#t-col button', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#t-act', el)?.addEventListener('click', (e) => { active = !active; e.currentTarget.classList.toggle('on', active); });
      $('#t-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const phone = normPhone($('#t-phone', el).value);
        if ($('#t-name', el).value.trim().length < 2) return toast('اكتبوا الاسم', true);
        if (phone && !/^05\d{8}$/.test(phone)) return toast('رقم الجوال غير صحيح', true);
        const row = { name: $('#t-name', el).value.trim(), role_title: role, phone: phone || null, start_date: $('#t-start', el).value || null, color, skills: $('#t-skills', el).value.trim() || null, profile_id: $('#t-prof', el).value || null, active };
        const num = (id) => { const v = $(id, el).value; return v === '' ? null : Number(v); };
        const pr = { salary: num('#t-sal'), commission_pct: num('#t-pct'), notes: $('#t-notes', el).value.trim() || null };
        DOCS.forEach(([k]) => { pr[k] = $(`#t-${k}`, el).value || null; });
        try {
          let id = m?.id;
          if (m) await q(sb.from('team_members').update(row).eq('id', m.id));
          else id = (await q(sb.from('team_members').insert(row).select('id').single())).id;
          await q(sb.from('team_private').upsert({ member_id: id, ...pr }));
          toast('تم الحفظ'); close(); done && done(id);
        } catch (err) { toast(err.code === '23505' ? 'هذا الحساب مربوط بموظفة ثانية' : errMsg(err), true); }
      });
    });
  }

  /* ======================= operations ======================= */
  const SOP_CAT = { service: 'خدمة العميلة', hygiene: 'النظافة والتعقيم', cashier: 'الكاشير', complaints: 'الشكاوى', emergency: 'الطوارئ', team: 'الفريق', other: 'أخرى' };
  const SVC_CAT2 = { nails: 'أظافر', hair: 'شعر', makeup: 'مكياج', lashes: 'رموش وحواجب', skin: 'بشرة', package: 'باقات', other: 'أخرى' };
  const steps = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const weekStart = (d) => dk(lensRange('w', d)[0]);
  const ring = (pct, inner) => `<div class="pring" style="--p:${pct}"><span>${inner}</span></div>`;

  async function pageOps(view, _a, params, alive) {
    const tab = params.get('t') || 'today';
    const tabs = [['today', 'القوائم'], ['services', 'الخدمات'], ['manual', 'الأدلة والإجراءات']];
    const head = `<div class="lens" style="margin-bottom:16px">${tabs.map(([k, l]) => `<a href="#/ops?t=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    if (tab === 'services') return opsServices(view, alive, head);
    if (tab === 'manual') return opsManual(view, alive, head);
    if (tab === 'rules') { location.hash = '#/rules?t=docs'; return; }
    return opsToday(view, alive, head);
  }

  async function opsToday(view, alive, head) {
    const tk = todayR(), ws = weekStart(D(tk));
    const from7 = dk(lensShift('d', D(tk), -6));
    const [lists, items, runs] = await Promise.all([
      q(sb.from('ops_lists').select('*').order('sort')),
      q(sb.from('ops_list_items').select('*').order('sort')),
      q(sb.from('ops_runs').select('*').gte('day', dk(lensShift('d', D(tk), -14)))),
    ]);
    const audits = isManager() ? await q(sb.from('ops_audits').select('*').gte('day', dk(lensShift('d', D(tk), -45)))).catch(() => []) : [];
    if (!alive()) return;
    const dayOf = (l) => (l.kind === 'weekly' ? ws : tk);
    const runOf = (l) => runs.find((r) => r.list_id === l.id && r.day === dayOf(l))?.done || {};
    const hr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }) * 1;
    const order = [...lists].sort((a, b) => (hr >= 17 ? (a.kind === 'close' ? -1 : b.kind === 'close' ? 1 : 0) : 0) || a.sort - b.sort);
    const last7 = Array.from({ length: 7 }, (_, i) => dk(lensShift('d', D(from7), i)));
    const card = (l) => {
      const its = items.filter((i) => i.list_id === l.id); const done = runOf(l);
      const n = its.filter((i) => done[i.id]).length; const pct = its.length ? (n / its.length) * 100 : 0;
      const crit = its.filter((i) => i.critical && !done[i.id]).length;
      return `<div class="ck ${pct === 100 ? 'full' : ''}" data-l="${l.id}">
        <div class="ck-h">${ring(pct, `<b class="num">${n}</b>/${its.length}`)}<div class="grow"><h3>${esc(l.name)}</h3><span>${pct === 100 ? 'خلصت كلها، يعطيكم العافية 🤍' : crit ? `باقي ${crit} ${crit === 1 ? 'بند أساسي' : 'بنود أساسية'}` : l.kind === 'weekly' ? 'هالأسبوع' : 'اليوم'}</span></div>
          ${l.kind !== 'weekly' ? `<div class="ck-hist">${last7.map((d) => { const r = runs.find((x) => x.list_id === l.id && x.day === d); const c = r ? Object.keys(r.done).length : 0; const p = its.length ? c / its.length : 0; return `<i class="${p === 1 ? 'f' : p > 0 ? 'p' : ''} ${d === tk ? 't' : ''}" title="${d}"></i>`; }).join('')}</div>` : ''}</div>
        <div class="ck-items">${its.map((i) => { const d = done[i.id]; return `<button class="ck-i ${d ? 'on' : ''} ${i.critical ? 'crit' : ''}" data-i="${i.id}"><span class="ck-box">${d ? '✓' : ''}</span><span class="grow"><span class="ck-t">${esc(i.body)}</span>${d ? `<em>${esc(firstName(personName(d.by)))} · ${h12(new Date(d.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }))}</em>` : ''}</span></button>`; }).join('')}</div>
        ${isManager() ? `<button class="ck-edit" data-edit="${l.id}">تعديل البنود</button>` : ''}
      </div>`;
    };
    let auditHtml = '';
    if (isManager()) {
      const daily = lists.filter((l) => l.kind !== 'weekly');
      const pct = (l, from, to) => { let a = 0, n = 0; const its = items.filter((i) => i.list_id === l.id).length; for (let i = from; i < to; i++) { const d = dk(lensShift('d', D(tk), -i)); const r = runs.find((x) => x.list_id === l.id && x.day === d); n += its; a += r ? Object.keys(r.done).length : 0; } return n ? Math.round((a / n) * 100) : 0; };
      const now7 = daily.map((l) => [l, pct(l, 1, 8), pct(l, 8, 15)]);
      const avg = now7.length ? Math.round(now7.reduce((a, x) => a + x[1], 0) / now7.length) : 0, avgP = now7.length ? Math.round(now7.reduce((a, x) => a + x[2], 0) / now7.length) : 0;
      const ticked = []; daily.forEach((l) => { const r = runs.find((x) => x.list_id === l.id && x.day === tk); if (r) Object.keys(r.done).forEach((k) => { const it = items.find((i) => i.id === Number(k)); if (it) ticked.push([l, it]); }); });
      let seed = Number(tk.replace(/-/g, '')); const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const pick = ticked.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).slice(0, 3).map((x) => x[1]);
      const honest = audits.length ? Math.round((audits.filter((a) => a.match).length / audits.length) * 100) : null;
      auditHtml = `<div class="audit">
        <div class="au-top"><div><span class="sh-eyebrow">هل يُطبَّق؟</span><h3>القوائم تُطبَّق في ${avg}٪ من البنود</h3><span class="muted small">آخر ٧ أيام · الأسبوع اللي قبله ${avgP}٪ ${avg > avgP ? '▲' : avg < avgP ? '▼' : ''}</span></div>${honest != null ? `<div class="au-h">${ring(honest, `<b class="num">${honest}</b><small>٪</small>`)}<span>صدق التأشير</span></div>` : ''}</div>
        <div class="au-lists">${now7.map(([l, a]) => `<div><span>${esc(l.name)}</span><div class="fbar-track"><i style="width:${Math.max(2, a)}%"></i></div><b class="num">${a}٪</b></div>`).join('')}</div>
        <div class="au-pick"><b>تفقّد اليوم</b><span class="muted small">ثلاث بنود أشّرها الفريق، اختارها النظام عشوائيًا. شوفوها بعينكم.</span>
          ${pick.length ? pick.map(([l, it]) => { const a = audits.find((x) => x.day === tk && x.item_id === it.id); return `<div class="au-i"><div class="grow"><div>${esc(it.body)}</div><span class="muted small">${esc(l.name)} · أشّرها ${esc(firstName(personName(runs.find((x) => x.list_id === l.id && x.day === tk).done[it.id]?.by)))}</span></div>${a ? `<span class="badge ${a.match ? 'ok' : 'danger'}">${a.match ? 'يطابق' : 'ما يطابق'}</span>` : `<button class="btn sm" data-au="${l.id}:${it.id}:1">يطابق</button><button class="btn sm" data-au="${l.id}:${it.id}:0">ما يطابق</button>`}</div>`; }).join('') : '<p class="muted small" style="margin:8px 0 0">لما يأشّر الفريق على قوائم اليوم، تطلع هنا البنود للتفقّد.</p>'}
        </div></div>`;
    }
    view.innerHTML = `${head}${auditHtml}<div class="ck-grid">${order.map(card).join('')}</div>
      <p class="muted small mt">البنود اللي عليها نقطة أساسية. كل تأشيرة تنحفظ باسم اللي سوّتها ووقتها.</p>`;
    $$('[data-au]', view).forEach((b) => b.onclick = () => busy(b, async () => { const [l, i, m] = b.dataset.au.split(':').map(Number); try { await q(sb.from('ops_audits').upsert({ day: tk, list_id: l, item_id: i, match: m === 1 }, { onConflict: 'day,item_id' })); toast(m ? 'تمام 🤍' : 'انسجّل. تكلموا مع الفريق عنه'); route(); } catch (err) { toast(errMsg(err), true); } }));
    const bind = (root) => {
      $$('.ck-i', root).forEach((b) => b.addEventListener('click', async () => {
        const ck = b.closest('.ck'); const lid = Number(ck.dataset.l); const l = lists.find((x) => x.id === lid); const on = !b.classList.contains('on');
        b.classList.toggle('on', on); $('.ck-box', b).textContent = on ? '✓' : '';
        try {
          const done = await q(sb.rpc('ops_tick', { p_list: lid, p_day: dayOf(l), p_item: Number(b.dataset.i), p_on: on }));
          const r = runs.find((x) => x.list_id === lid && x.day === dayOf(l)); if (r) r.done = done; else runs.push({ list_id: lid, day: dayOf(l), done });
          const tmp = document.createElement('div'); tmp.innerHTML = card(l); const fresh = tmp.firstElementChild; ck.replaceWith(fresh); bind(fresh);
          if (on && items.filter((i) => i.list_id === lid).every((i) => done[i.id])) toast(`${l.name}: خلصت كلها 🤍`);
        } catch (err) { b.classList.toggle('on', !on); $('.ck-box', b).textContent = on ? '' : '✓'; toast(errMsg(err), true); }
      }));
      $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => listEditForm(lists.find((l) => l.id === Number(b.dataset.edit)), items.filter((i) => i.list_id === Number(b.dataset.edit)))));
    };
    bind(view);
  }

  function listEditForm(l, its) {
    const text = its.map((i) => (i.critical ? '! ' : '') + i.body).join('\n');
    modal(`
      <h3>${esc(l.name)}</h3>
      <p class="muted small" style="margin-top:-6px">كل بند في سطر. حطوا «!» في بداية السطر للبند الأساسي.</p>
      <div class="field"><textarea class="input" id="le-t" rows="12">${esc(text)}</textarea></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="le-s">حفظ</button></div>`, (el, close) => {
      $('#le-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const lines = $('#le-t', el).value.split('\n').map((x) => x.trim()).filter((x) => x.replace(/^!\s*/, '').length >= 2);
        const keep = lines.map((x, i) => ({ body: x.replace(/^!\s*/, '').slice(0, 160), critical: x.startsWith('!'), sort: i + 1 }));
        try {
          for (let i = 0; i < keep.length; i++) { if (its[i]) await q(sb.from('ops_list_items').update(keep[i]).eq('id', its[i].id)); else await q(sb.from('ops_list_items').insert({ ...keep[i], list_id: l.id })); }
          const extra = its.slice(keep.length).map((x) => x.id); if (extra.length) await q(sb.from('ops_list_items').delete().in('id', extra));
          toast('تم الحفظ'); close(); route();
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  async function svcData() {
    const [svcs, links, costs] = await Promise.all([
      q(sb.from('ops_services').select('*').order('sort').order('name')),
      q(sb.from('ops_service_items').select('*')),
      q(sb.from('item_costs').select('item_id,avg_cost,last_cost')).catch(() => []),
    ]);
    const cost = new Map(costs.map((c) => [c.item_id, Number(c.avg_cost ?? c.last_cost ?? 0)]));
    const calc = (s) => { const ls = links.filter((x) => x.service_id === s.id); const mat = ls.reduce((a, x) => a + Number(x.qty) * (cost.get(x.item_id) || 0), 0); const price = Number(s.price || 0); const profit = price - mat; return { ls, mat, price, profit, margin: price ? (profit / price) * 100 : null, perHour: s.duration_min ? (profit / s.duration_min) * 60 : 0 }; };
    return { svcs, links, cost, calc };
  }

  async function opsServices(view, alive, head) {
    const Sd = await svcData();
    if (!alive()) return;
    const act = Sd.svcs.filter((s) => s.active);
    const priced = act.filter((s) => s.price > 0).map((s) => ({ s, c: Sd.calc(s) })).sort((a, b) => b.c.perHour - a.c.perHour);
    const maxH = Math.max(1, ...priced.map((x) => x.c.perHour));
    const tag = (c) => (!c.price ? '' : c.margin >= 75 ? '<span class="badge ok">ربحها عالي</span>' : c.margin >= 50 ? '' : '<span class="badge warn">راجعوا سعرها</span>');
    view.innerHTML = `${head}
      ${priced.length >= 2 ? `<div class="card svc-rank"><div class="close-h">كم تربح كل خدمة بالساعة</div>${priced.slice(0, 8).map(({ s, c }) => `<a class="fbar" href="#/svc/${s.id}"><div class="fbar-top"><span>${esc(s.name)}</span><b class="num">${sar(c.perHour)} ر.س/ساعة</b></div><div class="fbar-track"><i style="width:${Math.max(2, (c.perHour / maxH) * 100)}%"></i></div></a>`).join('')}
        <p class="muted small" style="margin:10px 0 0">الربح = السعر ناقص تكلفة المنتجات المستخدمة من المخزون، مقسوم على مدة الخدمة. الكرسي والوقت هم رأس مالكم.</p></div>` : ''}
      <div class="section-title"><h2>الخدمات</h2>${isManager() ? `<button class="btn sm" id="sv-new">${I.plus} خدمة</button>` : ''}</div>
      ${Object.entries(SVC_CAT2).filter(([k]) => Sd.svcs.some((s) => s.category === k)).map(([k, l]) => `<div class="svc-cat-h">${l}</div>
        <div class="list">${Sd.svcs.filter((s) => s.category === k).map((s) => { const c = Sd.calc(s); return `<a class="row ${s.active ? '' : 'dim'}" href="#/svc/${s.id}"><div class="grow"><div class="title">${esc(s.name)} ${tag(c)}</div><div class="meta">${durTxt(s.duration_min)} · ${steps(s.steps).length} خطوات · ${c.ls.length} منتجات${isManager() && c.price ? ` · تكلفة ${sar(c.mat)}` : ''}</div></div><div class="end">${c.price ? `<b class="num">${sar(c.price)}</b> <span class="muted small">ر.س</span>${isManager() ? `<div class="meta">ربح ${Math.round(c.margin)}٪</div>` : ''}` : '<span class="muted small">بدون سعر</span>'}</div></a>`; }).join('')}</div>`).join('') || '<div class="list"><div class="empty">أضيفوا خدمات الصالون، ولكل خدمة خطواتها والمنتجات اللي تستهلكها. تصير مرجع للفريق، وتعرفون منها ربح كل خدمة.</div></div>'}`;
    $('#sv-new')?.addEventListener('click', () => serviceForm(null, (id) => { location.hash = `#/svc/${id}`; }));
  }

  async function pageSvc(view, args, _p, alive) {
    const id = Number(args[0]);
    const Sd = await svcData();
    if (!alive()) return;
    const s = Sd.svcs.find((x) => x.id === id);
    if (!s) { view.innerHTML = '<div class="notice danger">ما لقينا الخدمة</div>'; return; }
    setTitle(s.name);
    const c = Sd.calc(s);
    const itemName = (iid) => S.items.find((i) => i.id === iid);
    view.innerHTML = `
      <div class="svc-hero">
        <span class="sh-eyebrow">${SVC_CAT2[s.category]}${s.active ? '' : ' · موقوفة'}</span><h2>${esc(s.name)}</h2>
        <div class="svc-nums"><div><b class="num">${c.price ? sar(c.price) : '—'}</b><span>السعر</span></div><div><b>${durTxt(s.duration_min)}</b><span>المدة</span></div>
          ${isManager() ? `<div><b class="num">${sar(c.mat)}</b><span>تكلفة المنتجات</span></div><div><b class="num">${c.price ? sar(c.perHour) : '—'}</b><span>ربح الساعة</span></div>` : ''}</div>
        ${isManager() && c.price ? `<div class="svc-split"><i style="width:${Math.max(0, Math.min(100, 100 - c.margin))}%"></i></div><div class="svc-leg"><span>منتجات ${Math.round(100 - c.margin)}٪</span><span>ربح ${Math.round(c.margin)}٪</span></div>` : ''}
        ${isManager() ? `<button class="btn on-oud sm" id="sv-edit" style="margin-top:12px">${I.edit} تعديل</button>` : ''}
      </div>
      <div class="fin-grid">
        <div><div class="section-title"><h2>الخطوات</h2></div>
          ${steps(s.steps).length ? `<ol class="steps">${steps(s.steps).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<div class="muted small">ما فيه خطوات مكتوبة</div>'}
          ${s.tips ? `<div class="tip-box">💡 ${esc(s.tips)}</div>` : ''}</div>
        <div><div class="section-title"><h2>المنتجات المستخدمة</h2></div>
          <div class="list">${c.ls.map((x) => { const it = itemName(x.item_id); const cc = Number(x.qty) * (Sd.cost.get(x.item_id) || 0); return `<div class="row"><div class="grow"><div class="title">${esc(it?.name || 'صنف محذوف')}</div><div class="meta">${num(x.qty)} ${esc(it?.unit || '')} لكل عميلة</div></div>${isManager() ? `<div class="end num">${cc ? cc.toFixed(2) : '—'} <span class="muted small">ر.س</span></div><button class="x-btn" data-rm="${x.item_id}">×</button>` : ''}</div>`; }).join('') || '<div class="empty">ما فيه منتجات مربوطة</div>'}</div>
          ${isManager() ? `<div class="add-line"><select class="input" id="sv-item"><option value="">+ منتج من المخزون</option>${S.items.filter((i) => i.is_active && !c.ls.some((x) => x.item_id === i.id)).map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select><input class="input num" id="sv-qty" type="number" min="0" step="0.01" placeholder="الكمية"><button class="btn primary" id="sv-add">${I.plus}</button></div>` : ''}
        </div>
      </div>`;
    $('#sv-edit')?.addEventListener('click', () => serviceForm(s, () => route()));
    $('#sv-add')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const iid = Number($('#sv-item').value), qty = Number($('#sv-qty').value); if (!iid || !(qty > 0)) return toast('اختاروا المنتج والكمية', true);
      try { await q(sb.from('ops_service_items').upsert({ service_id: s.id, item_id: iid, qty })); route(); } catch (err) { toast(errMsg(err), true); }
    }));
    $$('[data-rm]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await q(sb.from('ops_service_items').delete().eq('service_id', s.id).eq('item_id', Number(b.dataset.rm))); route(); } catch (err) { toast(errMsg(err), true); } }));
  }

  function serviceForm(s, done) {
    let cat = s?.category || 'nails', act = s ? s.active : true;
    modal(`
      <h3>${s ? 'تعديل الخدمة' : 'خدمة جديدة'}</h3>
      <div class="field"><label>الاسم</label><input class="input" id="sf-n" maxlength="80" value="${esc(s?.name || '')}"></div>
      <div class="field"><label>القسم</label><div class="chips wrap" id="sf-c">${Object.entries(SVC_CAT2).map(([k, l]) => `<button type="button" class="chip ${k === cat ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>السعر (ر.س)</label><input class="input num" type="number" min="0" id="sf-p" value="${s?.price ?? ''}"></div><div class="field"><label>المدة (دقيقة)</label><input class="input num" type="number" min="5" max="600" id="sf-d" value="${s?.duration_min ?? 60}"></div></div>
      <div class="field"><label>الخطوات <span class="muted small">(كل خطوة في سطر)</span></label><textarea class="input" id="sf-s" rows="6" maxlength="3000" placeholder="تعقيم يد العميلة\nتشكيل الأظافر\n…">${esc(s?.steps || '')}</textarea></div>
      <div class="field"><label>نصيحة للأخصائية</label><input class="input" id="sf-t" maxlength="1000" value="${esc(s?.tips || '')}"></div>
      ${s ? `<label class="toggle-row"><span><b>الخدمة متاحة</b></span><button type="button" class="sw ${act ? 'on' : ''}" id="sf-a"></button></label>` : ''}
      <div class="actions end">${s ? '<button class="btn danger" id="sf-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="sf-save">حفظ</button></div>`, (el, close) => {
      $$('#sf-c .chip', el).forEach((b) => b.onclick = () => { cat = b.dataset.k; $$('#sf-c .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#sf-a', el)?.addEventListener('click', (e) => { act = !act; e.currentTarget.classList.toggle('on', act); });
      $('#sf-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#sf-n', el).value.trim(), category: cat, price: $('#sf-p', el).value === '' ? null : Number($('#sf-p', el).value), duration_min: Number($('#sf-d', el).value) || 60, steps: $('#sf-s', el).value.trim() || null, tips: $('#sf-t', el).value.trim() || null, active: act };
        if (row.name.length < 2) return toast('اكتبوا اسم الخدمة', true);
        try { let id = s?.id; if (s) await q(sb.from('ops_services').update(row).eq('id', s.id)); else id = (await q(sb.from('ops_services').insert(row).select('id').single())).id; toast('تم الحفظ'); close(); done && done(id); } catch (err) { toast(errMsg(err), true); }
      });
      $('#sf-del', el)?.addEventListener('click', async () => { close(); if (await confirmBox('حذف الخدمة', 'تنحذف البطاقة ومنتجاتها.', 'حذف', true)) { try { await q(sb.from('ops_services').delete().eq('id', s.id)); location.hash = '#/ops?t=services'; } catch (err) { toast(errMsg(err), true); } } });
    });
  }

  async function opsManual(view, alive, head) {
    const [rows, guides, reads] = await Promise.all([q(sb.from('ops_sops').select('*').order('sort').order('id')), q(sb.from('guides').select('*').order('sort').order('id')), q(sb.from('guide_reads').select('*'))]);
    if (!alive()) return;
    const team = [...S.profiles.values()].filter((p) => p.is_active);
    const signedBy = (g) => team.filter((p) => reads.some((r) => r.guide_id === g.id && r.profile_id === p.id && r.version === g.version));
    const mineOk = (g) => reads.some((r) => r.guide_id === g.id && r.profile_id === S.profile.id && r.version === g.version);
    const unsigned = guides.filter((g) => !mineOk(g)).length;
    view.innerHTML = `${head}
      <div class="section-title"><h2>أدلة بيوتفريش</h2>${isManager() ? `<button class="btn sm" id="g-new">${I.plus} دليل</button>` : ''}</div>
      ${unsigned ? `<div class="notice info">${unsigned === 1 ? 'دليل بانتظار توقيعك' : unsigned + ' أدلة بانتظار توقيعك'}. التوقيع في آخر كل دليل.</div>` : ''}
      <div class="gshelf">${guides.map((g, i) => { const sb_ = signedBy(g); return `<button class="gcover" data-g="${g.id}" style="--d:${i * 70}ms"><span class="gc-n num">${AR_NUM(i + 1)}</span><img src="../home/assets/rosette-${(i % 4) + 1}.svg" alt=""><b>${esc(g.title)}</b><span class="gc-aud">${esc(g.audience || '')}</span>
        <span class="gc-meta">${parseGuide(g.body).filter((c) => c.title).length} فصول · الإصدار ${AR_NUM(g.version)}</span>
        <span class="gc-sign ${mineOk(g) ? 'ok' : ''}">${mineOk(g) ? '✓ موقّع' : 'بانتظار توقيعك'}${isManager() ? ` · ${sb_.length}/${team.length} من الفريق` : ''}</span></button>`; }).join('') || '<div class="empty">ما فيه أدلة</div>'}</div>
      <div class="section-title"><h2>الإجراءات السريعة</h2></div>
      ${isManager() ? `<div class="actions" style="margin-bottom:14px"><button class="btn primary" id="sop-new">${I.plus} إجراء</button></div>` : ''}
      <div class="sop-grid">${rows.map((r, i) => `<button class="sop" data-s="${r.id}" style="--d:${i * 50}ms"><span class="sop-n num">${String(i + 1).padStart(2, '0')}</span><span class="sop-cat">${SOP_CAT[r.category]}</span><b>${esc(r.title)}</b><span class="sop-c">${steps(r.steps).length} خطوات</span></button>`).join('') || '<div class="empty">ما فيه إجراءات</div>'}</div>`;
    $('#sop-new')?.addEventListener('click', () => sopForm(null));
    $('#g-new')?.addEventListener('click', () => guideForm(null));
    $$('[data-g]', view).forEach((b) => b.onclick = () => openGuide(guides.find((x) => x.id === Number(b.dataset.g)), reads, () => route()));
    $$('[data-s]', view).forEach((b) => b.onclick = () => {
      const r = rows.find((x) => x.id === Number(b.dataset.s));
      modal(`<span class="sop-cat">${SOP_CAT[r.category]}</span><h3 style="margin-top:6px">${esc(r.title)}</h3><ol class="steps">${steps(r.steps).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <div class="actions end">${isManager() ? '<button class="btn" id="sop-ed">تعديل</button>' : ''}<button class="btn primary" data-close>تمام</button></div>`, (el, close) => { $('#sop-ed', el)?.addEventListener('click', () => { close(); sopForm(r); }); });
    });
  }

  function sopForm(r) {
    modal(`
      <h3>${r ? 'تعديل الإجراء' : 'إجراء جديد'}</h3>
      <div class="field"><label>العنوان</label><input class="input" id="so-t" maxlength="100" value="${esc(r?.title || '')}"></div>
      <div class="field"><label>التصنيف</label><select class="input" id="so-c">${Object.entries(SOP_CAT).map(([k, l]) => `<option value="${k}" ${k === r?.category ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>الخطوات <span class="muted small">(كل خطوة في سطر)</span></label><textarea class="input" id="so-s" rows="8" maxlength="4000">${esc(r?.steps || '')}</textarea></div>
      <div class="actions end">${r ? '<button class="btn danger" id="so-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="so-save">حفظ</button></div>`, (el, close) => {
      $('#so-save', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { title: $('#so-t', el).value.trim(), category: $('#so-c', el).value, steps: $('#so-s', el).value.trim(), updated_at: new Date().toISOString() };
        if (row.title.length < 2 || !row.steps) return toast('اكتبوا العنوان والخطوات', true);
        try { if (r) await q(sb.from('ops_sops').update(row).eq('id', r.id)); else await q(sb.from('ops_sops').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#so-del', el)?.addEventListener('click', async () => { try { await q(sb.from('ops_sops').delete().eq('id', r.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
    });
  }

  function ruleState(r) {
    const due = r.kind === 'expiry' ? r.due_on : r.last_done && r.every_days ? dk(lensShift('d', D(r.last_done), r.every_days)) : null;
    if (!due) return { st: 'unknown', due: null, u: null };
    const u = until(due); const warnAt = r.kind === 'expiry' ? 45 : Math.max(1, Math.round((r.every_days || 30) * 0.15));
    return { st: u < 0 ? 'bad' : u <= warnAt ? 'warn' : 'ok', due, u };
  }

  async function opsRules(view, alive, head) {
    const [rules, tpv, tms] = await Promise.all([
      q(sb.from('ops_rules').select('*').order('sort').order('id')),
      isManager() ? q(sb.from('team_private').select('member_id,health_card_expiry')).catch(() => []) : [],
      q(sb.from('team_members').select('id,name,active')).catch(() => []),
    ]);
    if (!alive()) return;
    const st = rules.map((r) => ({ r, s: ruleState(r) }));
    const hc = isManager() ? tms.filter((m) => m.active).map((m) => { const p = tpv.find((x) => x.member_id === m.id); const u = p?.health_card_expiry ? until(p.health_card_expiry) : null; return { m, u, st: u == null ? 'unknown' : u < 0 ? 'bad' : u <= 30 ? 'warn' : 'ok' }; }) : [];
    const all = [...st.map((x) => x.s.st), ...hc.map((x) => x.st)];
    const score = all.length ? Math.round((all.reduce((a, s) => a + (s === 'ok' ? 1 : s === 'warn' ? 0.6 : 0), 0) / all.length) * 100) : 0;
    const cnt = (k) => all.filter((s) => s === k).length;
    const SL = { ok: 'سليم', warn: 'قرب موعده', bad: 'متأخر', unknown: 'ما انسجّل' };
    view.innerHTML = `${head}
      <div class="rules-hero">${ring(score, `<b class="num">${score}</b><small>٪</small>`)}<div><span class="sh-eyebrow">التراخيص والفحوصات</span><h2>${score >= 90 ? 'كل شي تمام' : score >= 70 ? 'أموركم طيبة، فيه شي يحتاج متابعة' : 'فيه أشياء تحتاج تتحدّث'}</h2>
        <div class="rh-c"><span class="ok">${cnt('ok')} سليم</span><span class="warn">${cnt('warn')} قرب</span><span class="bad">${cnt('bad')} متأخر</span>${cnt('unknown') ? `<span>${cnt('unknown')} ما انسجّل</span>` : ''}</div></div></div>
      <div class="section-title"><h2>التراخيص والوثائق</h2></div>
      <div class="list">${st.filter((x) => x.r.kind === 'expiry').map(ruleRow).join('')}</div>
      <div class="section-title"><h2>الفحوصات الدورية</h2></div>
      <div class="list">${st.filter((x) => x.r.kind === 'check').map(ruleRow).join('')}</div>
      ${hc.length ? `<div class="section-title"><h2>الشهادات الصحية للفريق</h2></div><div class="list">${hc.map((x) => `<a class="row rule ${x.st}" href="#/member/${x.m.id}"><span class="rdot"></span><div class="grow"><div class="title">${esc(x.m.name)}</div><div class="meta">${x.u == null ? 'ما انسجّل تاريخ الانتهاء' : x.u < 0 ? `منتهية من ${daysTxt(-x.u)}` : `باقي ${daysTxt(x.u)}`}</div></div><span class="badge ${{ ok: 'ok', warn: 'warn', bad: 'danger', unknown: '' }[x.st]}">${SL[x.st]}</span></a>`).join('')}</div>` : ''}
      ${isManager() ? `<div class="actions mt"><button class="btn" id="ru-new">${I.plus} قاعدة جديدة</button></div>` : ''}`;
    function ruleRow({ r, s }) {
      return `<div class="row rule ${s.st}"><span class="rdot"></span><div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${s.due ? (r.kind === 'expiry' ? `ينتهي ${dShort(s.due)} ${D(s.due).getFullYear()}` : `آخر مرة ${dShort(r.last_done)} · الجاية ${dShort(s.due)}`) : r.kind === 'expiry' ? 'سجّلوا تاريخ الانتهاء' : `كل ${daysTxt(r.every_days)} · ما انسجّل`}${s.u != null ? ` · ${s.u < 0 ? `متأخر ${daysTxt(-s.u)}` : `باقي ${daysTxt(s.u)}`}` : ''}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
        <div class="end">${r.kind === 'check' ? `<button class="btn sm ${s.st === 'ok' ? '' : 'primary'}" data-did="${r.id}">تم اليوم</button>` : ''}${isManager() ? ` <button class="x-btn" data-ru="${r.id}" style="font-size:13px">${I.edit.replace('<svg', '<svg width="13" height="13"')}</button>` : ''}</div></div>`;
    }
    $$('[data-did]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await q(sb.from('ops_rules').update({ last_done: todayR() }).eq('id', Number(b.dataset.did))); toast('تم التسجيل'); route(); } catch (err) { toast(errMsg(err), true); } }));
    $$('[data-ru]', view).forEach((b) => b.onclick = () => ruleForm(rules.find((x) => x.id === Number(b.dataset.ru))));
    $('#ru-new')?.addEventListener('click', () => ruleForm(null));
  }

  function ruleForm(r) {
    let kind = r?.kind || 'expiry';
    modal(`
      <h3>${r ? esc(r.name) : 'قاعدة جديدة'}</h3>
      <div class="field"><label>الاسم</label><input class="input" id="ru-n" maxlength="80" value="${esc(r?.name || '')}"></div>
      <div class="field"><label>النوع</label><div class="chips" id="ru-k"><button type="button" class="chip ${kind === 'expiry' ? 'on' : ''}" data-k="expiry">له تاريخ انتهاء</button><button type="button" class="chip ${kind === 'check' ? 'on' : ''}" data-k="check">فحص يتكرر</button></div></div>
      <div class="grid2"><div class="field ru-e"><label>تاريخ الانتهاء</label><input class="input" type="date" id="ru-d" value="${r?.due_on || ''}"></div>
        <div class="field ru-c"><label>يتكرر كل (يوم)</label><input class="input num" type="number" min="1" id="ru-ev" value="${r?.every_days || 30}"></div>
        <div class="field ru-c"><label>آخر مرة</label><input class="input" type="date" id="ru-l" value="${r?.last_done || ''}"></div></div>
      <div class="field"><label>ملاحظة</label><input class="input" id="ru-no" maxlength="300" value="${esc(r?.note || '')}"></div>
      <div class="actions end">${r ? '<button class="btn danger" id="ru-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="ru-s">حفظ</button></div>`, (el, close) => {
      const vis = () => { $$('.ru-e', el).forEach((x) => { x.style.display = kind === 'expiry' ? '' : 'none'; }); $$('.ru-c', el).forEach((x) => { x.style.display = kind === 'check' ? '' : 'none'; }); };
      $$('#ru-k .chip', el).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$('#ru-k .chip', el).forEach((x) => x.classList.toggle('on', x === b)); vis(); }); vis();
      $('#ru-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#ru-n', el).value.trim(), kind, due_on: kind === 'expiry' ? $('#ru-d', el).value || null : null, every_days: kind === 'check' ? Number($('#ru-ev', el).value) || 30 : null, last_done: kind === 'check' ? $('#ru-l', el).value || null : null, note: $('#ru-no', el).value.trim() || null };
        if (row.name.length < 2) return toast('اكتبوا الاسم', true);
        try { if (r) await q(sb.from('ops_rules').update(row).eq('id', r.id)); else await q(sb.from('ops_rules').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#ru-del', el)?.addEventListener('click', async () => { try { await q(sb.from('ops_rules').delete().eq('id', r.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
    });
  }

  /* ======================= قواعد بيوتفريش ======================= */
  const RDOM = { law: 'النظام والتراخيص', safe: 'السلامة والصحة', ops: 'التشغيل', fin: 'المالية والمبيعات', cli: 'العميلات', mkt: 'التسويق', team: 'الفريق ونظام العمل', inv: 'المخزون' };
  const BASIS = { law: 'نظام', reg: 'اشتراط رقابي', sci: 'مرجع علمي', prac: 'ممارسة مجربة' };
  const RST = { risk: ['خطر', 'danger'], need: ['تحتاجكم', 'warn'], ok: ['سليم', 'ok'], na: ['ما ينطبق', ''] };
  const R = (st, msg, link) => ({ st, msg, link });
  const findRule = (c, word) => c.orules.find((r) => r.name.includes(word));
  const ruleCheck = (c, word, label, link = '#/rules?t=docs') => {
    const r = findRule(c, word); if (!r) return R('na', `ما فيه بند «${label}» في التراخيص والفحوصات.`);
    const s = ruleState(r);
    if (s.st === 'unknown') return R('need', `ما انسجّل ${r.kind === 'expiry' ? 'تاريخ انتهاء' : 'آخر موعد'} ${r.name}.`, link);
    if (s.st === 'bad') return R('risk', `${r.name}: ${r.kind === 'expiry' ? 'منتهي' : 'فات موعده'} من ${daysTxt(-s.u)}.`, link);
    if (s.st === 'warn') return R('need', `${r.name}: باقي ${daysTxt(s.u)}.`, link);
    return R('ok', `${r.name}: الموعد الجاي ${dShort(s.due)}.`);
  };
  const RULES = [
    // النظام والتراخيص
    { code: 'LAW-01', dom: 'law', basis: 'law', title: 'لا ترخيص ولا وثيقة منتهية', why: 'السجل التجاري، ورخصة البلدية، وشهادة السلامة من الدفاع المدني لازم تكون سارية طول الوقت. الانتهاء يعرّض الصالون لمخالفة أو إغلاق، ويوقف تجديد الأشياء المرتبطة فيه.',
      ev: (c) => { const ex = c.orules.filter((r) => r.kind === 'expiry'); if (!ex.length) return R('need', 'ما انسجّلت أي وثيقة.', '#/rules?t=docs'); const bad = ex.filter((r) => ruleState(r).st === 'bad'); const unk = ex.filter((r) => ruleState(r).st === 'unknown'); const warn = ex.filter((r) => ruleState(r).st === 'warn'); if (bad.length) return R('risk', `منتهية: ${bad.map((r) => r.name).join('، ')}.`, '#/rules?t=docs'); if (unk.length) return R('need', `ما انسجّل تاريخ: ${unk.map((r) => r.name).join('، ')}.`, '#/rules?t=docs'); if (warn.length) return R('need', `قرب انتهاؤها: ${warn.map((r) => r.name).join('، ')}.`, '#/rules?t=docs'); return R('ok', `${ex.length} وثائق كلها سارية.`); } },
    { code: 'LAW-02', dom: 'law', basis: 'reg', title: 'شهادة صحية سارية لكل عاملة', why: 'اشتراطات البلدية للصالونات تطلب شهادة صحية سارية لكل من تتعامل مع العميلات. التفتيش يسأل عنها أول شي.',
      ev: (c) => { const m = c.members.filter((x) => x.active); if (!m.length) return R('na', 'ما فيه فريق مسجل.'); const miss = m.filter((x) => !c.tpriv.get(x.id)?.health_card_expiry); const bad = m.filter((x) => { const d = c.tpriv.get(x.id)?.health_card_expiry; return d && until(d) < 0; }); const soon = m.filter((x) => { const d = c.tpriv.get(x.id)?.health_card_expiry; return d && until(d) >= 0 && until(d) <= 30; }); if (bad.length) return R('risk', `منتهية: ${bad.map((x) => firstName(x.name)).join('، ')}.`, '#/team'); if (miss.length) return R('need', `ما انسجّلت لـ: ${miss.map((x) => firstName(x.name)).join('، ')}.`, '#/team'); if (soon.length) return R('need', `تنتهي خلال شهر: ${soon.map((x) => firstName(x.name)).join('، ')}.`, '#/team'); return R('ok', 'شهادات الفريق كلها سارية.'); } },
    { code: 'LAW-03', dom: 'law', basis: 'law', title: 'إقامات الفريق سارية', why: 'تشغيل عاملة إقامتها منتهية مخالفة على المنشأة. التجديد يبدأ قبل الانتهاء بوقت كافي.',
      ev: (c) => { const m = c.members.filter((x) => x.active && c.tpriv.get(x.id)?.iqama_expiry); if (!m.length) return R('na', 'ما انسجّلت تواريخ إقامات.'); const bad = m.filter((x) => until(c.tpriv.get(x.id).iqama_expiry) < 0); const soon = m.filter((x) => { const u = until(c.tpriv.get(x.id).iqama_expiry); return u >= 0 && u <= 45; }); if (bad.length) return R('risk', `منتهية: ${bad.map((x) => firstName(x.name)).join('، ')}.`, '#/team'); if (soon.length) return R('need', `قرب انتهاؤها: ${soon.map((x) => firstName(x.name)).join('، ')}.`, '#/team'); return R('ok', 'الإقامات كلها سارية.'); } },
    { code: 'LAW-04', dom: 'law', basis: 'law', title: 'السعر المعلن شامل الضريبة', why: 'إذا كانت المنشأة مسجلة في ضريبة القيمة المضافة، فالسعر اللي تشوفه العميلة في المنيو والإعلان لازم يكون شامل الضريبة، ما تنضاف عليه عند الدفع.',
      ask: { q: 'هل الصالون مسجل في ضريبة القيمة المضافة؟', opts: [['yes', 'مسجل'], ['no', 'غير مسجل']] },
      ev: (c, a) => (a === 'no' ? R('na', 'الصالون غير مسجل في الضريبة.') : a === 'yes' ? R('ok', 'تأكدوا إن المنيو وموقع الحجز يعرضون السعر شامل الضريبة.') : R('need', 'جاوبوا على السؤال عشان نضبط القاعدة.')) },
    { code: 'LAW-05', dom: 'law', basis: 'law', title: 'لا تخفيض بلا ترخيص', why: 'إعلان التخفيض يحتاج ترخيص مسبق من وزارة التجارة، ويُكتب السعر قبل التخفيض وبعده. الخصم بدون ترخيص مخالفة حتى لو كان صادق.',
      ev: (c) => { const d = c.campaigns.filter((x) => x.status !== 'done' && /خصم|٪|%|تخفيض|بدل/.test(x.offer || '')); return d.length ? R('need', `${d.length === 1 ? 'حملة فيها' : d.length + ' حملات فيها'} خصم: ${d.map((x) => x.name).join('، ')}. تأكدوا من ترخيص التخفيض.`, '#/marketing?t=campaigns') : R('na', 'ما فيه حملات خصم قادمة.'); } },
    { code: 'LAW-06', dom: 'law', basis: 'law', title: 'المسابقة بترخيص وبلا شرط شراء', why: 'المسابقات والسحوبات الترويجية تحتاج ترخيص، وما يصير تشترطون فيها شراء خدمة.',
      ev: (c) => { const d = c.campaigns.filter((x) => x.status !== 'done' && /مسابقة|سحب|قرعة/.test((x.offer || '') + x.name)); return d.length ? R('need', `حملة فيها مسابقة: ${d.map((x) => x.name).join('، ')}. تأكدوا من الترخيص.`, '#/marketing?t=campaigns') : R('na', 'ما فيه مسابقات قادمة.'); } },
    { code: 'LAW-07', dom: 'law', basis: 'law', title: 'المؤثرة المأجورة معها رخصة «موثوق»', why: 'اللي تعلن عن الصالون في حسابها مقابل أجر، لازم تكون حاملة رخصة «موثوق». اطلبوا رقم الرخصة قبل التعاقد.',
      ev: (c) => { const d = c.campaigns.filter((x) => x.status !== 'done' && (x.channels || []).includes('influencer')); return d.length ? R('need', `حملة مع مؤثرة: ${d.map((x) => x.name).join('، ')}. تأكدوا من رقم رخصة «موثوق».`, '#/marketing?t=campaigns') : R('na', 'ما فيه حملات مع مؤثرات.'); } },
    { code: 'LAW-08', dom: 'law', basis: 'law', title: 'رسائل العروض بموافقة العميلة', why: 'نظام حماية البيانات الشخصية يمنع إرسال رسائل تسويقية بدون موافقة. رسالة التذكير بموعدها غير، أما العروض فتحتاج موافقتها.',
      ask: { q: 'هل تاخذون موافقة العميلة قبل ترسلون لها عروض؟', opts: [['yes', 'إيه نسأل'], ['no', 'لا']] },
      ev: (c, a) => (a === 'yes' ? R('ok', 'تاخذون الموافقة قبل العروض.') : a === 'no' ? R('risk', 'رسائل العروض بدون موافقة مخالفة. أضيفوا سؤال الموافقة في الاستقبال.') : R('need', 'جاوبوا على السؤال.')) },
    { code: 'LAW-09', dom: 'law', basis: 'law', title: 'تأكيد بيانات السجل التجاري كل سنة', why: 'نظام السجل التجاري يطلب تأكيد البيانات سنويًا، وإهماله يعرّض السجل للشطب.',
      ev: (c) => ruleCheck(c, 'السجل', 'السجل التجاري') },
    // السلامة والصحة
    { code: 'SAF-01', dom: 'safe', basis: 'reg', title: 'طفايات الحريق مصونة في موعدها', why: 'الطفاية تنفحص بالعين كل شهر، وتنصان سنويًا عند جهة معتمدة. عقد الصيانة شرط لتجديد شهادة السلامة.', ev: (c) => ruleCheck(c, 'طفايات', 'صيانة طفايات الحريق') },
    { code: 'SAF-02', dom: 'safe', basis: 'reg', title: 'الكاميرات تسجّل وتحفظ', why: 'الكاميرا اللي ما تسجّل كأنها مو موجودة. التسجيل يحمي العميلة والموظفة والصالون، والتأكد منه دوري.', ev: (c) => ruleCheck(c, 'الكاميرات', 'الكاميرات') },
    { code: 'SAF-03', dom: 'safe', basis: 'reg', title: 'مكافحة الحشرات دورية بشهادة', why: 'المكافحة الدورية من شركة معتمدة مع شهادة، من اشتراطات النظافة في المحلات اللي تخدم الناس.', ev: (c) => ruleCheck(c, 'الحشرات', 'مكافحة الحشرات') },
    { code: 'SAF-04', dom: 'safe', basis: 'prac', title: 'صندوق الإسعافات كامل وصالح', why: 'الحروق البسيطة والجروح واردة في الصالون. الصندوق الناقص يكتشفونه وقت الحاجة.', ev: (c) => ruleCheck(c, 'الإسعاف', 'صندوق الإسعافات') },
    { code: 'SAF-05', dom: 'safe', basis: 'sci', title: 'اختبار حساسية قبل الصبغة', why: 'شركات الصبغات تطلب اختبار حساسية قبل الصبغة بـ٤٨ ساعة، حتى للعميلة اللي صبغت قبل. الحساسية ممكن تظهر فجأة.',
      ev: (c) => { const h = c.services.filter((s) => s.active && s.category === 'hair' && /صبغ|لون/.test(s.name)); if (!h.length) return R('na', 'ما فيه بطاقة خدمة صبغة.'); const miss = h.filter((s) => !/حساسي/.test(s.steps || '')); return miss.length ? R('need', `أضيفوا خطوة اختبار الحساسية في: ${miss.map((s) => s.name).join('، ')}.`, `#/svc/${miss[0].id}`) : R('ok', 'خطوة الحساسية مكتوبة في بطاقات الصبغة.'); } },
    { code: 'SAF-06', dom: 'safe', basis: 'reg', title: 'التعقيم بند أساسي في الإقفال', why: 'الأداة اللي ما تعقّمت آخر اليوم، تُستعمل الصبح على أول عميلة.',
      ev: (c) => { const l = c.lists.find((x) => x.kind === 'close'); if (!l) return R('na', ''); const it = c.litems.find((i) => i.list_id === l.id && /تعقيم/.test(i.body)); return !it ? R('risk', 'قائمة الإقفال ما فيها بند تعقيم.', '#/ops') : it.critical ? R('ok', 'التعقيم بند أساسي في الإقفال.') : R('need', 'التعقيم موجود بس مو أساسي. خلّوه أساسي.', '#/ops'); } },
    // التشغيل
    { code: 'OPS-01', dom: 'ops', basis: 'prac', title: 'قائمة الفتح والإقفال كل يوم', why: 'القائمة تضمن إن الصالون يفتح ويقفل بنفس المستوى مهما تغيّرت الموظفة. اللي ما ينكتب، يُنسى.',
      ev: (c) => { const days = Array.from({ length: 7 }, (_, i) => dk(lensShift('d', D(todayR()), -i - 1))).filter((d) => !c.closedWd.includes(D(d).getDay())); const cnt = (kind) => { const l = c.lists.find((x) => x.kind === kind); return l ? days.filter((d) => c.runs.some((r) => r.list_id === l.id && r.day === d && Object.keys(r.done).length)).length : 0; }; const o = cnt('open'), z = cnt('close'), n = days.length; const m = Math.min(o, z); return m >= n - 1 ? R('ok', `الفتح ${o} من ${n}، والإقفال ${z} من ${n} أيام.`) : m >= Math.ceil(n / 2) ? R('need', `الفتح ${o} من ${n}، والإقفال ${z} من ${n} أيام.`, '#/ops') : R('risk', `القوائم ما تنشغل: الفتح ${o} والإقفال ${z} من آخر ${n} أيام.`, '#/ops'); } },
    { code: 'OPS-02', dom: 'ops', basis: 'prac', title: 'إجراءات مكتوبة، مو في الرأس', why: 'لكل موقف متكرر إجراء مكتوب: الاستقبال، والشكوى، والكاشير، والطوارئ. الموظفة الجديدة تتعلم منه، والقديمة ترجع له.',
      ev: (c) => (c.sops >= 6 ? R('ok', `في الدليل ${c.sops} إجراءات.`) : c.sops ? R('need', `في الدليل ${c.sops} إجراءات بس.`, '#/ops?t=manual') : R('risk', 'ما فيه إجراءات مكتوبة.', '#/ops?t=manual')) },
    { code: 'OPS-03', dom: 'ops', basis: 'prac', title: 'كل موظفة وقّعت على أدلتها', why: 'الدليل اللي ما انقرأ ما ينطبق. التوقيع يثبت إنها قرأت آخر إصدار، وكل تعديل يطلب توقيع جديد.',
      ev: (c) => { const ppl = c.members.filter((m) => m.active && m.profile_id); if (!c.guides.length) return R('need', 'ما فيه أدلة.', '#/ops?t=manual'); if (!ppl.length) return R('need', 'اربطوا حسابات الموظفات بملفاتهم في «الفريق» عشان يوقّعون.', '#/team'); const tot = ppl.length * c.guides.length; const ok = ppl.reduce((a, m) => a + c.guides.filter((g) => c.reads.some((r) => r.guide_id === g.id && r.profile_id === m.profile_id && r.version === g.version)).length, 0); const p = Math.round((ok / tot) * 100); return p === 100 ? R('ok', 'كل الفريق وقّع على آخر إصدار.') : R(p >= 60 ? 'need' : 'risk', `التوقيعات ${p}٪ من المطلوب.`, '#/ops?t=manual'); } },
    { code: 'OPS-04', dom: 'ops', basis: 'prac', title: 'تفقّد بعينك مرة بالأسبوع', why: 'التأشير على القائمة شي، والتطبيق شي ثاني. التفقّد العشوائي يخلي التأشير صادق.',
      ev: (c) => { const n = c.audits.filter((a) => a.day >= dk(lensShift('d', D(todayR()), -7))).length; return n ? R('ok', `${n} تفقّد هالأسبوع.`) : R('need', 'ما فيه تفقّد هالأسبوع.', '#/ops'); } },
    { code: 'OPS-05', dom: 'ops', basis: 'prac', title: 'صدق التأشير فوق ٩٠٪', why: 'إذا اللي تشوفونه بعينكم ما يطابق اللي انأشّر، القوائم صارت شكل بس.',
      ev: (c) => { if (c.audits.length < 5) return R('na', 'يحتاج ٥ تفقّدات على الأقل.'); const p = Math.round((c.audits.filter((a) => a.match).length / c.audits.length) * 100); return p >= 90 ? R('ok', `صدق التأشير ${p}٪.`) : R(p >= 75 ? 'need' : 'risk', `صدق التأشير ${p}٪ بآخر ٤٥ يوم.`, '#/ops'); } },
    { code: 'OPS-06', dom: 'ops', basis: 'prac', title: 'لكل خدمة بطاقة بخطواتها', why: 'الخدمة تطلع بنفس الجودة من أي أخصائية لما تكون خطواتها مكتوبة.',
      ev: (c) => { const a = c.services.filter((s) => s.active); if (!a.length) return R('need', 'ما فيه بطاقات خدمات.', '#/ops?t=services'); const m = a.filter((s) => steps(s.steps).length < 3); return m.length ? R('need', `${m.length} خدمات خطواتها ناقصة.`, '#/ops?t=services') : R('ok', `${a.length} خدمات كلها مكتوبة.`); } },
    // المالية والمبيعات
    { code: 'FIN-01', dom: 'fin', basis: 'prac', title: 'رقم مبيعات كل يوم', why: 'الرقم اللي ينكتب نفس اليوم دقيق. اللي ينكتب بعد أيام تخمين.',
      ev: (c) => { let gap = 0; for (let i = 1; i <= 10; i++) { const d = dk(lensShift('d', D(todayR()), -i)); if (c.closedWd.includes(D(d).getDay())) continue; if (c.fdays.includes(d)) break; gap++; } return gap === 0 ? R('ok', 'آخر يوم دوام مقفل.') : gap <= 2 ? R('need', `${daysTxt(gap)} بدون إقفال.`, '#/closing') : R('risk', `${gap >= 10 ? 'أكثر من ١٠ أيام' : daysTxt(gap)} بدون إقفال.`, '#/closing'); } },
    { code: 'FIN-02', dom: 'fin', basis: 'prac', title: 'هدف مبيعات لكل شهر', why: 'بدون هدف ما تعرفون الشهر زين ولا لا. الهدف يحوّل الرقم لقرار.', ev: (c) => (c.target ? R('ok', `هدف الشهر ${sar(c.target)} ر.س.`) : R('need', 'ما فيه هدف لهالشهر.', '#/finance?l=m')) },
    { code: 'FIN-03', dom: 'fin', basis: 'prac', title: 'تكلفة كل خدمة معروفة', why: 'لما تعرفون كم تكلف الخدمة من منتجات، تعرفون كم تربحون منها، وتسعّرون صح.',
      ev: (c) => { const a = c.services.filter((s) => s.active && s.price > 0); if (!a.length) return R('na', 'ما فيه خدمات مسعّرة.'); const m = a.filter((s) => !c.slinks.some((l) => l.service_id === s.id)); return m.length ? R('need', `${m.length} من ${a.length} خدمات بدون منتجات مربوطة.`, '#/ops?t=services') : R('ok', 'كل الخدمات تكلفتها محسوبة.'); } },
    { code: 'FIN-04', dom: 'fin', basis: 'prac', title: 'ربح كل خدمة فوق النص', why: 'الخدمة اللي منتجاتها تاكل أكثر من نص سعرها، تشغل الكرسي وما ترجع.',
      ev: (c) => { const low = c.services.filter((s) => s.active && s.price > 0 && c.slinks.some((l) => l.service_id === s.id)).filter((s) => c.svcMargin(s) < 50); return c.services.some((s) => s.price > 0 && c.slinks.some((l) => l.service_id === s.id)) ? (low.length ? R('need', `راجعوا سعر: ${low.map((s) => s.name).join('، ')}.`, `#/svc/${low[0].id}`) : R('ok', 'كل الخدمات ربحها فوق النص.')) : R('na', 'اربطوا منتجات الخدمات أول.'); } },
    { code: 'FIN-05', dom: 'fin', basis: 'prac', title: 'المصروفات مسجلة أول بأول', why: 'صافي الربح ما يكون حقيقي إذا الإيجار والرواتب والفواتير ما انسجلت.',
      ev: (c) => (D(todayR()).getDate() < 10 ? R('na', 'بداية الشهر.') : c.expCount ? R('ok', `${c.expCount} مصروفات مسجلة هالشهر.`) : R('need', 'ما انسجلت أي مصروفات هالشهر.', '#/expenses')) },
    { code: 'FIN-06', dom: 'fin', basis: 'law', title: 'الرواتب عبر البنك وفي موعدها', why: 'نظام حماية الأجور يتطلب صرف الرواتب عن طريق البنك ورفعها في منصة مدد، والتأخير يوقف خدمات المنشأة.',
      ask: { q: 'هل الرواتب تنصرف عن طريق البنك وتنرفع في مدد؟', opts: [['yes', 'إيه'], ['no', 'لا']] },
      ev: (c, a) => (a === 'yes' ? R('ok', 'الرواتب عبر البنك ومدد.') : a === 'no' ? R('risk', 'الرواتب لازم تنصرف عبر البنك وتنرفع في مدد.') : R('need', 'جاوبوا على السؤال.')) },
    // العميلات
    { code: 'CLI-01', dom: 'cli', basis: 'prac', title: 'الشكوى تنحل خلال يومين', why: 'العميلة اللي انحلت شكواها بسرعة غالبًا ترجع، واللي انتركت تحكي لغيرها.',
      ev: (c) => { const o = c.fb.filter((f) => f.kind === 'complaint' && f.status === 'open'); const old = o.filter((f) => until(f.day) < -2); return old.length ? R('risk', `${old.length === 1 ? 'شكوى مفتوحة' : old.length + ' شكاوى مفتوحة'} من أكثر من يومين.`, '#/feedback?t=open') : o.length ? R('need', `${o.length === 1 ? 'شكوى حديثة' : o.length + ' شكاوى حديثة'} بانتظار الحل.`, '#/feedback?t=open') : R('ok', 'ما فيه شكاوى مفتوحة.'); } },
    { code: 'CLI-02', dom: 'cli', basis: 'prac', title: 'ملف لكل عميلة برقمها', why: 'رقم الجوال هو اللي يربط زياراتها وولاءها ورسائلها. الملف بدون رقم ما يفيد.',
      ev: (c) => { if (!c.clients.length) return R('need', 'ما فيه عميلات مسجلات.', '#/clients'); const p = Math.round((c.clients.filter((x) => x.phone).length / c.clients.length) * 100); return p >= 90 ? R('ok', `${p}٪ من الملفات فيها رقم.`) : R('need', `${p}٪ بس من الملفات فيها رقم.`, '#/clients'); } },
    { code: 'CLI-03', dom: 'cli', basis: 'prac', title: 'اللي غابت، نسأل عنها', why: 'إرجاع عميلة قديمة أرخص بكثير من جلب عميلة جديدة. رسالة وحدة تكفي.',
      ev: (c) => { const a = c.clients.filter((x) => x.segment === 'away').length; return a ? R('need', `${a} عميلات غابوا أكثر من ٤٥ يوم.`, '#/clients?s=away') : R('ok', 'ما فيه عميلات غايبات.'); } },
    { code: 'CLI-04', dom: 'cli', basis: 'prac', title: 'بطاقة الولاء ومكافأتها واضحة', why: 'المكافأة الغامضة ما تحمّس أحد. «مانيكير هدية» أقوى من «خدمة هدية».',
      ev: (c) => (!c.loyalty?.active ? R('na', 'البطاقة موقفة.') : /اختيارك|خدمة هدية$/.test(c.loyalty.reward) ? R('need', `المكافأة الحالية «${c.loyalty.reward}». حدّدوها.`, '#/clients') : R('ok', `المكافأة: ${c.loyalty.reward}.`)) },
    { code: 'CLI-05', dom: 'cli', basis: 'prac', title: 'ردّوا على تقييمات قوقل', why: 'أغلب العميلات الجدد يقرون التقييمات قبل ما يحجزون. الرد على كل تقييم، حتى السلبي، يبيّن إن الصالون يهتم.',
      ask: { q: 'عندكم صفحة في خرائط قوقل وتردون على التقييمات؟', opts: [['yes', 'إيه'], ['no', 'لا']] },
      ev: (c, a) => (a === 'yes' ? R('ok', 'تردون على التقييمات.') : a === 'no' ? R('need', 'سجّلوا الصالون في خرائط قوقل وردّوا على كل تقييم.') : R('need', 'جاوبوا على السؤال.')) },
    // التسويق
    { code: 'MKT-01', dom: 'mkt', basis: 'prac', title: 'استعدوا للموسم قبل وقته', why: 'الحجوزات تبدأ قبل الموسم. اللي يبدأ حملته وقت الموسم يلقى العميلات حجزوا عند غيره.',
      ev: (c) => { const p = c.seasons.filter((s) => { const u = until(s.starts_on); return u > 0 && u <= s.prep_days; }); const no = p.filter((s) => !c.campaigns.some((x) => x.season_id === s.id)); return no.length ? R('need', `دخلتوا وقت تجهيز ${no.map((s) => s.name).join('، ')} بدون حملة.`, '#/marketing') : p.length ? R('ok', `حملة ${p.map((s) => s.name).join('، ')} جاهزة.`) : R('ok', 'ما فيه موسم في وقت التجهيز.'); } },
    { code: 'MKT-02', dom: 'mkt', basis: 'prac', title: 'ثلاث منشورات بالأسبوع على الأقل', why: 'الحساب اللي يسكت يختفي. الانتظام أهم من الكثرة.',
      ev: (c) => { const [ws, we] = lensRange('w', D(todayR())); const n = c.posts.filter((p) => p.publish_on >= dk(ws) && p.publish_on <= dk(we)).length; return n >= 3 ? R('ok', `${n} منشورات هالأسبوع.`) : R('need', `${n} ${n === 1 ? 'منشور' : 'منشورات'} بس هالأسبوع.`, '#/marketing?t=content'); } },
    { code: 'MKT-03', dom: 'mkt', basis: 'prac', title: 'لا منشور يتأخر بلا قرار', why: 'المنشور المتأخر إما ينشر أو ينأجل أو يُلغى. تركه معلّق يخرب الخطة.',
      ev: (c) => { const l = c.posts.filter((p) => p.publish_on && p.publish_on < todayR() && p.status !== 'posted'); return l.length ? R('need', `${l.length} منشورات فات موعدها.`, '#/marketing?t=content') : R('ok', 'ما فيه منشورات متأخرة.'); } },
    { code: 'MKT-04', dom: 'mkt', basis: 'prac', title: 'كل حملة خلصت لها نتيجة', why: 'الحملة بدون نتيجة مكتوبة ما تعلّمكم شي للحملة الجاية.',
      ev: (c) => { const d = c.campaigns.filter((x) => x.status === 'done'); if (!d.length) return R('na', 'ما فيه حملات منتهية.'); const m = d.filter((x) => x.revenue == null && x.new_clients == null); return m.length ? R('need', `${m.length} حملات بدون نتائج.`, '#/marketing?t=campaigns') : R('ok', 'كل الحملات نتائجها مكتوبة.'); } },
    // الفريق
    { code: 'TEAM-01', dom: 'team', basis: 'law', title: 'لا أكثر من ٤٨ ساعة بالأسبوع', why: 'نظام العمل يحدد ساعات العمل بثمان ساعات يوميًا و٤٨ ساعة أسبوعيًا، وما زاد عليها يكون عمل إضافي بأجر إضافي.',
      ev: (c) => { if (!c.shifts.length) return R('na', 'ما فيه مناوبات.'); const over = c.members.filter((m) => m.active).map((m) => [m, c.shifts.filter((s) => s.member_id === m.id).reduce((a, s) => { let d = mins(s.ends) - mins(s.starts); if (d <= 0) d += 1440; return a + d; }, 0) / 60]).filter((x) => x[1] > 48); return over.length ? R('risk', `فوق ٤٨ ساعة: ${over.map(([m, h]) => `${firstName(m.name)} ${Math.round(h)}س`).join('، ')}.`, '#/team?t=shifts') : R('ok', 'كل المناوبات ضمن الحد.'); } },
    { code: 'TEAM-02', dom: 'team', basis: 'law', title: 'راحة نص ساعة في الوردية الطويلة', why: 'نظام العمل ما يسمح بأكثر من خمس ساعات متتالية بدون راحة لا تقل عن نص ساعة.',
      ask: { q: 'هل أوقات الراحة محددة في الورديات الطويلة؟', opts: [['yes', 'محددة'], ['no', 'لا']] },
      ev: (c, a) => { const long = c.shifts.some((s) => { let d = mins(s.ends) - mins(s.starts); if (d <= 0) d += 1440; return d > 300; }); if (!long) return R('na', 'ما فيه ورديات أطول من ٥ ساعات.'); return a === 'yes' ? R('ok', 'أوقات الراحة محددة.') : R('need', 'فيه ورديات أطول من ٥ ساعات. حددوا فيها راحة نص ساعة.', '#/team?t=shifts'); } },
    { code: 'TEAM-03', dom: 'team', basis: 'law', title: 'يوم راحة أسبوعي لكل عاملة', why: 'نظام العمل يعطي العامل يوم راحة أسبوعي على الأقل.',
      ev: (c) => { if (!c.shifts.length) return R('na', 'ما فيه مناوبات.'); const full = c.members.filter((m) => m.active && c.shifts.filter((s) => s.member_id === m.id).length >= 7); return full.length ? R('risk', `بدون يوم راحة: ${full.map((m) => firstName(m.name)).join('، ')}.`, '#/team?t=shifts') : R('ok', 'كل الفريق عنده يوم راحة.'); } },
    { code: 'TEAM-04', dom: 'team', basis: 'prac', title: 'الرد على طلب الإجازة خلال ٣ أيام', why: 'الموظفة تخطط حياتها على الإجازة. التأخير بالرد يضايقها أكثر من الرفض.',
      ev: (c) => { const p = c.leaves.filter((l) => l.status === 'pending'); const old = p.filter((l) => (Date.now() - new Date(l.created_at)) / 86400000 > 3); return old.length ? R('risk', `${old.length} طلبات من أكثر من ٣ أيام.`, '#/team?t=leaves') : p.length ? R('need', `${p.length} طلبات حديثة بانتظاركم.`, '#/team?t=leaves') : R('ok', 'ما فيه طلبات معلقة.'); } },
    { code: 'TEAM-05', dom: 'team', basis: 'prac', title: 'كل يوم دوام فيه فريق', why: 'يوم بدون مناوبة يعني حجوزات بدون أحد يخدمها.',
      ev: (c) => { if (!c.shifts.length) return R('need', 'ما انرتبت المناوبات.', '#/team?t=shifts'); const empty = [0, 1, 2, 3, 4, 5, 6].filter((d) => !c.closedWd.includes(d) && !c.shifts.some((s) => s.weekday === d)); return empty.length ? R('need', `ما فيه أحد يوم: ${empty.map((d) => WDAYS[d]).join('، ')}.`, '#/team?t=shifts') : R('ok', 'كل أيام الدوام مغطاة.'); } },
    { code: 'OPS-07', dom: 'ops', basis: 'prac', title: 'لا عطل مفتوح أكثر من ٣ أيام', why: 'العطل المتروك يتكرر ويكبر، والعميلة تلاحظ الكرسي اللي ما يرتفع قبل ما تلاحظ أي شي ثاني.',
      ev: (c) => { const o = c.issues.filter((i) => i.status === 'open'); const old = o.filter((i) => (Date.now() - new Date(i.created_at)) / 86400000 > 3); return old.length ? R('risk', `${old.length} أعطال مفتوحة من أكثر من ٣ أيام: ${old.slice(0, 2).map((i) => i.title).join('، ')}.`, '#/assets?t=maint') : o.length ? R('need', `${o.length} أعطال حديثة مفتوحة.`, '#/assets?t=maint') : R('ok', 'ما فيه أعطال متروكة.'); } },
    { code: 'OPS-08', dom: 'ops', basis: 'prac', title: 'الصيانة الوقائية في موعدها', why: 'تنظيف فلتر المكيف أو تشحيم الكرسي في وقته أرخص بكثير من إصلاحه بعد ما يخرب، وأهون من إيقاف محطة يوم زحمة.',
      ev: (c) => { if (!c.plans.length) return R('need', 'ما فيه جدول صيانة. سجّلوا الأصول.', '#/assets'); const late = c.plans.filter((p) => planSt(p) === 'bad'); return late.length ? R(late.length > 2 ? 'risk' : 'need', `${late.length} مهام فات موعدها: ${late.slice(0, 2).map((p) => p.task).join('، ')}.`, '#/assets?t=maint') : R('ok', 'الصيانة كلها في موعدها.'); } },
    { code: 'FIN-07', dom: 'fin', basis: 'prac', title: 'الاشتراكات تنراجع كل ٣ أشهر', why: 'الاشتراك اللي ما يُراجع يصير مصروف ثابت ما أحد ينتبه له. المراجعة تسأل: نستخدمه؟ فيه أرخص؟',
      ev: (c) => { const a = c.subs.filter((s) => s.active); if (!a.length) return R('na', 'ما فيه اشتراكات مسجلة.'); const st = a.filter((s) => !s.last_review || until(s.last_review) < -90); const low = a.filter((s) => s.usage === 'low'); return st.length || low.length ? R('need', [st.length ? `${st.length} ما انراجعت` : '', low.length ? `${low.length} استخدامها قليل` : ''].filter(Boolean).join(' · ') + '.', '#/assets?t=subs') : R('ok', 'الاشتراكات كلها مراجعة.'); } },
    // المخزون
    { code: 'INV-01', dom: 'inv', basis: 'prac', title: 'لا صنف أساسي ناقص', why: 'العميلة ما يهمها ليش، يهمها إن لونها مو موجود اليوم.',
      ev: (c) => { const l = S.items.filter((i) => i.is_active && isLow(i)); const out = l.filter((i) => Number(i.qty_on_hand) <= 0); return out.length ? R('risk', `نفد: ${out.slice(0, 3).map((i) => i.name).join('، ')}${out.length > 3 ? '…' : ''}.`, '#/shopping') : l.length ? R('need', `${l.length} أصناف تحت الحد الأدنى.`, '#/shopping') : R('ok', 'كل الأصناف فوق حدها.'); } },
    { code: 'INV-02', dom: 'inv', basis: 'reg', title: 'لا منتج منتهي على الرف', why: 'استعمال منتج منتهي على العميلة مخالفة وخطر على بشرتها وشعرها.',
      ev: (c) => { const ex = c.expiring.filter((x) => until(x.expiry_date) < 0); return ex.length ? R('risk', `منتهية: ${ex.slice(0, 3).map((x) => x.item_name).join('، ')}.`, '#/home') : c.expiring.length ? R('need', `${c.expiring.length} منتجات تقرب صلاحيتها.`, '#/home') : R('ok', 'ما فيه منتجات منتهية.'); } },
  ];

  async function rulesCtx() {
    const tk = todayR(); const ago = (n) => dk(lensShift('d', D(tk), -n));
    const sel = (t, s = '*') => q(sb.from(t).select(s)).catch(() => []);
    const [orules, members, tpv, shifts, leaves, lists, litems, runs, sops, services, slinks, costs, fdays, target, expCount, fb, clients, seasons, campaigns, posts, guides, reads, audits, states, expiring, L, hs] = await Promise.all([
      sel('ops_rules'), sel('team_members'), isManager() ? sel('team_private') : [], sel('team_shifts'), sel('team_leaves'),
      sel('ops_lists'), sel('ops_list_items'), q(sb.from('ops_runs').select('*').gte('day', ago(10))).catch(() => []),
      sb.from('ops_sops').select('id', { count: 'exact', head: true }).then((x) => x.count || 0, () => 0),
      sel('ops_services'), sel('ops_service_items'), sel('item_costs', 'item_id,avg_cost,last_cost'),
      q(sb.from('fin_daily').select('day').gte('day', ago(12))).then((r) => r.map((x) => x.day), () => []),
      q(sb.from('fin_targets').select('revenue').eq('month', monthKey(D(tk))).maybeSingle()).then((r) => r?.revenue, () => null),
      sb.from('fin_expenses').select('id', { count: 'exact', head: true }).gte('day', monthKey(D(tk))).then((x) => x.count || 0, () => 0),
      q(sb.from('client_feedback').select('kind,status,day')).catch(() => []), q(sb.from('clients_overview').select('id,phone,segment').limit(5000)).catch(() => []),
      sel('mkt_seasons'), sel('mkt_campaigns'), q(sb.from('mkt_posts').select('publish_on,status').gte('publish_on', ago(30))).catch(() => []),
      sel('guides', 'id,version'), sel('guide_reads'), isManager() ? q(sb.from('ops_audits').select('*').gte('day', ago(45))).catch(() => []) : [],
      sel('rules_state'), q(sb.rpc('get_expiring', { p_days: CFG.expiryWarningDays })).catch(() => []), loyalty().catch(() => null),
      q(sb.from('home_settings').select('closed_weekdays').eq('id', 1).maybeSingle()).catch(() => null),
    ]);
    const [issues, plans, subs] = await Promise.all([sel('maint_issues', 'status,created_at,title'), sel('maint_plans'), isManager() ? sel('subscriptions') : []]);
    const cost = new Map(costs.map((c) => [c.item_id, Number(c.avg_cost ?? c.last_cost ?? 0)]));
    const svcMargin = (s) => { const mat = slinks.filter((l) => l.service_id === s.id).reduce((a, l) => a + Number(l.qty) * (cost.get(l.item_id) || 0), 0); return s.price ? ((s.price - mat) / s.price) * 100 : 0; };
    return { orules, members, tpriv: new Map(tpv.map((p) => [p.member_id, p])), shifts, leaves, lists, litems, runs, sops, services, slinks, svcMargin, fdays, target, expCount, fb, clients, seasons, campaigns, posts, guides, reads, audits, states: new Map(states.map((s) => [s.code, s])), expiring, loyalty: L, closedWd: hs?.closed_weekdays || [], issues, plans, subs };
  }

  function evalRules(c) {
    return RULES.map((r) => {
      const s = c.states.get(r.code) || {};
      if (s.adopted === false) return { r, s, res: null, off: 'removed' };
      if (s.dismissed_reason) return { r, s, res: null, off: 'dismissed' };
      let res; try { res = r.ev(c, s.answer); } catch (e) { res = R('na', ''); }
      return { r, s, res };
    });
  }
  const rulesScore = (E) => { const live = E.filter((x) => x.res && x.res.st !== 'na'); return live.length ? Math.round((live.reduce((a, x) => a + (x.res.st === 'ok' ? 1 : x.res.st === 'need' ? 0.5 : 0), 0) / live.length) * 100) : 0; };

  async function pageRules(view, _a, params, alive) {
    const tab = params.get('t') || 'now';
    const head = `<div class="rules-intro"><span class="sh-eyebrow">القرار لكم، واحنا نوضّح الطريق</span><h1>قواعد بيوتفريش</h1><p>قواعد مكتوبة لصالون نسائي في السعودية، تنفحص لحالها على بيانات الصالون وتقول: هذا سليم، وهذا يحتاجكم، وهذا خطر.</p></div>
      <div class="lens" style="margin-bottom:16px">${[['now', 'مؤشراتنا'], ['lib', 'مكتبة القواعد'], ['docs', 'التراخيص والفحوصات']].map(([k, l]) => `<a href="#/rules?t=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    if (tab === 'docs') return opsRules(view, alive, head);
    const c = await rulesCtx();
    if (!alive()) return;
    const E = evalRules(c);
    if (tab === 'lib') return rulesLib(view, E, head);
    const score = rulesScore(E);
    try { localStorage.setItem('bf-rules', JSON.stringify({ score, risk: E.filter((x) => x.res?.st === 'risk').length, at: Date.now() })); } catch {}
    const grp = (st) => E.filter((x) => x.res && x.res.st === st);
    const risk = grp('risk'), need = grp('need'), ok = grp('ok'), na = E.filter((x) => x.res && x.res.st === 'na'), dis = E.filter((x) => x.off === 'dismissed');
    const domScore = Object.keys(RDOM).map((d) => { const xs = E.filter((x) => x.r.dom === d && x.res && x.res.st !== 'na'); return [d, xs.length ? Math.round((xs.reduce((a, x) => a + (x.res.st === 'ok' ? 1 : x.res.st === 'need' ? 0.5 : 0), 0) / xs.length) * 100) : null, xs.filter((x) => x.res.st === 'risk').length]; }).filter((x) => x[1] != null);
    const rcard = (x) => `<div class="rcard ${x.res.st}" data-code="${x.r.code}">
        <div class="rc-top"><span class="badge ${RST[x.res.st][1]}">${RST[x.res.st][0]}</span><span class="rc-dom">${RDOM[x.r.dom]}</span><span class="rc-code">${x.r.code}</span></div>
        <h3>${esc(x.r.title)}</h3><p class="rc-msg">${esc(x.res.msg)}</p>
        ${x.r.ask && isManager() ? `<div class="rc-ask"><span>${esc(x.r.ask.q)}</span><div class="chips wrap">${x.r.ask.opts.map(([v, l]) => `<button class="chip ${x.s.answer === v ? 'on' : ''}" data-ans="${v}">${l}</button>`).join('')}</div></div>` : ''}
        <details class="rc-why"><summary>لماذا؟</summary><p>${esc(x.r.why)}</p><span class="rc-basis">الأساس: ${BASIS[x.r.basis]}</span></details>
        <div class="rc-acts">${x.res.link ? `<a class="btn sm ${x.res.st === 'ok' ? '' : 'primary'}" href="${x.res.link}">${x.res.st === 'ok' ? 'شوف' : 'صلّحها'} ←</a>` : ''}${isManager() && x.res.st !== 'ok' ? '<button class="rc-dis" data-dis>لي رأي آخر</button>' : ''}</div>
      </div>`;
    view.innerHTML = `${head}
      <div class="rules-hero">${ring(score, `<b class="num">${score}</b><small>٪</small>`)}<div class="grow"><span class="sh-eyebrow">صحة بيوتفريش</span><h2>${risk.length ? `ابدؤوا بالخطر: ${risk.length === 1 ? 'قاعدة وحدة' : risk.length + ' قواعد'}` : need.length ? `${need.length} قواعد تحتاجكم` : 'كل القواعد سليمة 🤍'}</h2>
        <div class="rh-c"><span class="bad">${risk.length} خطر</span><span class="warn">${need.length} تحتاجكم</span><span class="ok">${ok.length} سليم</span></div>
        <p class="muted small" style="margin:8px 0 0">تنفحص كل ما تغيّرت البيانات. اللي تتركونها بـ«لي رأي آخر» ما تنحسب.</p></div></div>
      <div class="dom-strip">${domScore.map(([d, p, rk]) => `<div class="dom ${rk ? 'r' : ''}"><i style="--p:${p}"></i><span>${RDOM[d]}</span><b class="num">${p}٪</b></div>`).join('')}</div>
      ${risk.length ? `<div class="section-title"><h2>خطر</h2></div><div class="rgrid">${risk.map(rcard).join('')}</div>` : ''}
      ${need.length ? `<div class="section-title"><h2>تحتاجكم</h2></div><div class="rgrid">${need.map(rcard).join('')}</div>` : ''}
      ${ok.length ? `<details class="rfold"><summary>سليم (${ok.length})</summary><div class="rgrid">${ok.map(rcard).join('')}</div></details>` : ''}
      ${na.length ? `<p class="muted small mt">ما تنطبق الحين: ${na.map((x) => esc(x.r.title)).join(' · ')}.</p>` : ''}
      ${dis.length ? `<details class="rfold"><summary>تركتوها (${dis.length})</summary><div class="list">${dis.map((x) => `<div class="row"><div class="grow"><div class="title">${esc(x.r.title)}</div><div class="meta">${esc(x.s.dismissed_reason)}</div></div>${isManager() ? `<button class="btn sm" data-back="${x.r.code}">رجّعها</button>` : ''}</div>`).join('')}</div></details>` : ''}`;
    const save = (code, patch) => q(sb.from('rules_state').upsert({ code, ...patch, updated_at: new Date().toISOString() }));
    $$('[data-ans]', view).forEach((b) => b.onclick = () => busy(null, async () => { try { await save(b.closest('.rcard').dataset.code, { answer: b.dataset.ans }); route(); } catch (err) { toast(errMsg(err), true); } }));
    $$('[data-back]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await save(b.dataset.back, { dismissed_reason: null }); route(); } catch (err) { toast(errMsg(err), true); } }));
    $$('[data-dis]', view).forEach((b) => b.onclick = () => {
      const code = b.closest('.rcard').dataset.code; const r = RULES.find((x) => x.code === code);
      modal(`<h3>لي رأي آخر</h3><p class="muted" style="margin-top:-6px">«${esc(r.title)}». اكتبوا السبب، والقاعدة ما تنحسب لين ترجعونها.</p>
        <div class="field"><textarea class="input" id="ds-r" rows="3" maxlength="300" placeholder="مثلًا: الصالون مغلق يوم الجمعة، فما نحتاجها"></textarea></div>
        <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="ds-s">حفظ</button></div>`, (el, close) => {
        $('#ds-s', el).onclick = (e) => busy(e.currentTarget, async () => { const v = $('#ds-r', el).value.trim(); if (v.length < 3) return toast('اكتبوا السبب', true); try { await save(code, { dismissed_reason: v }); close(); route(); } catch (err) { toast(errMsg(err), true); } });
      });
    });
  }

  function rulesLib(view, E, head) {
    const doms = Object.keys(RDOM);
    view.innerHTML = `${head}
      <p class="muted" style="margin-top:0">${RULES.length} قاعدة في ${doms.length} مجالات، معتمد منها ${E.filter((x) => x.off !== 'removed').length}. كل قاعدة تعرض أساسها: نظام، أو اشتراط رقابي، أو مرجع علمي، أو ممارسة مجربة.</p>
      <div class="chips wrap" style="margin-bottom:12px">${doms.map((d) => { const xs = E.filter((x) => x.r.dom === d); return `<a class="chip" href="#lib-${d}">${RDOM[d]} ${xs.filter((x) => x.off !== 'removed').length}/${xs.length}</a>`; }).join('')}</div>
      ${doms.map((d) => `<div class="section-title" id="lib-${d}"><h2>${RDOM[d]}</h2></div><div class="list">${E.filter((x) => x.r.dom === d).map((x) => `
        <div class="row lib ${x.off === 'removed' ? 'dim' : ''}"><div class="grow"><div class="lib-top"><span class="rc-code">${x.r.code}</span><span class="rc-basis">${BASIS[x.r.basis]}</span></div><div class="title" style="white-space:normal">${esc(x.r.title)}</div><div class="meta" style="white-space:normal">${esc(x.r.why)}</div></div>
          ${isManager() ? `<button class="btn sm ${x.off === 'removed' ? '' : 'on-ok'}" data-adopt="${x.r.code}" data-v="${x.off === 'removed' ? '1' : '0'}">${x.off === 'removed' ? 'اعتمدها' : 'معتمدة ✓'}</button>` : ''}</div>`).join('')}</div>`).join('')}`;
    $$('a.chip[href^="#lib-"]', view).forEach((a) => a.onclick = (e) => { e.preventDefault(); $(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $$('[data-adopt]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await q(sb.from('rules_state').upsert({ code: b.dataset.adopt, adopted: b.dataset.v === '1', updated_at: new Date().toISOString() })); route(); } catch (err) { toast(errMsg(err), true); } }));
  }

  /* ======================= أدلة بيوتفريش ======================= */
  const AR_NUM = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  function parseGuide(body) {
    const ch = []; let cur = null; let tbl = null;
    const flush = () => { tbl = null; };
    String(body || '').split('\n').forEach((raw) => {
      const ln = raw.trim(); if (!ln) { flush(); return; }
      if (ln.startsWith('# ')) { cur = { title: ln.slice(2).trim(), blocks: [] }; ch.push(cur); flush(); return; }
      if (!cur) { cur = { title: '', blocks: [] }; ch.push(cur); }
      if (ln.startsWith('|')) { const cells = ln.replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim()); if (!tbl) { tbl = { t: 'table', head: cells, rows: [] }; cur.blocks.push(tbl); } else tbl.rows.push(cells); return; }
      flush();
      if (ln.startsWith('- ')) { const last = cur.blocks[cur.blocks.length - 1]; if (last?.t === 'list') last.items.push(ln.slice(2)); else cur.blocks.push({ t: 'list', items: [ln.slice(2)] }); return; }
      if (ln.startsWith('! ')) { cur.blocks.push({ t: 'note', text: ln.slice(2) }); return; }
      if (ln.startsWith('> ')) { const last = cur.blocks[cur.blocks.length - 1]; if (last?.t === 'say') last.items.push(ln.slice(2)); else cur.blocks.push({ t: 'say', items: [ln.slice(2)] }); return; }
      cur.blocks.push({ t: 'p', text: ln });
    });
    return ch;
  }
  function guideHTML(g) {
    const ch = parseGuide(g.body);
    const blk = (b) => b.t === 'list' ? `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : b.t === 'note' ? `<div class="gb-note"><b>تنبيه</b>${esc(b.text)}</div>`
      : b.t === 'say' ? `<div class="gb-say"><span>ما يُقال للعميلة</span>${b.items.map((x) => `<p>«${esc(x)}»</p>`).join('')}</div>`
      : b.t === 'table' ? `<div class="gb-tw"><table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${b.head.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<p>${esc(b.text)}</p>`;
    const upd = new Date(g.updated_at || Date.now());
    return `<article class="gbook">
      <section class="gb-cover"><img class="gb-logo" src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><span class="gb-aud">${esc(g.audience || '')}</span><h1>${esc(g.title)}</h1>${g.tagline ? `<p class="gb-tag">${esc(g.tagline)}</p>` : ''}<span class="gb-ver">الإصدار ${AR_NUM(g.version)} · ${upd.getDate()} ${MONTHS_AR[upd.getMonth()]} ${upd.getFullYear()} · بيوتفريش</span><img class="gb-rose" src="../home/assets/rosette-3.svg" alt=""></section>
      <section class="gb-toc"><h2>المحتويات</h2><ol>${ch.filter((c) => c.title).map((c, i) => `<li><span class="num">${AR_NUM(i + 1)}</span>${esc(c.title)}</li>`).join('')}</ol></section>
      ${ch.map((c, i) => `<section class="gb-ch">${c.title ? `<div class="gb-chh"><span class="num">${AR_NUM(i + 1)}</span><h2>${esc(c.title)}</h2></div>` : ''}${c.blocks.map(blk).join('')}</section>`).join('')}
      <footer class="gb-end"><img src="../home/assets/rosette-1.svg" alt=""><span>بيوتفريش · The Fresh Version of You</span></footer>
    </article>`;
  }

  function openGuide(g, reads, done) {
    const mine = reads.find((r) => r.guide_id === g.id && r.profile_id === S.profile.id);
    const signed = mine && mine.version === g.version;
    const ov = document.createElement('div'); ov.className = 'greader';
    ov.innerHTML = `<div class="gr-bar"><button class="icon-btn" data-x aria-label="إغلاق">×</button><b>${esc(g.title)}</b><span style="flex:1"></span>
      ${isManager() ? `<button class="btn sm" data-ed>${I.edit} تعديل</button>` : ''}<button class="btn sm" data-pr>طباعة / PDF</button></div>
      <div class="gr-body">${guideHTML(g)}
        <div class="gr-sign">${signed ? `<div class="gs-done">✓ موقّع على الإصدار ${AR_NUM(g.version)}</div>` : `<button class="btn primary" data-sign>قرأت الدليل وألتزم فيه</button>${mine ? `<p class="muted small">الدليل انعدّل بعد توقيعك، والإصدار الجديد يحتاج توقيع.</p>` : ''}`}</div></div>`;
    document.body.appendChild(ov); document.body.classList.add('noscroll');
    const close = () => { ov.remove(); document.body.classList.remove('noscroll'); window.removeEventListener('hashchange', close); };
    window.addEventListener('hashchange', close);
    $('[data-x]', ov).onclick = close;
    $('[data-pr]', ov).onclick = () => { document.body.classList.add('printing-guide'); window.print(); setTimeout(() => document.body.classList.remove('printing-guide'), 500); };
    $('[data-ed]', ov)?.addEventListener('click', () => { close(); guideForm(g); });
    $('[data-sign]', ov)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try { await q(sb.from('guide_reads').upsert({ guide_id: g.id, profile_id: S.profile.id, version: g.version, read_at: new Date().toISOString() })); toast('تم التوقيع 🤍'); close(); done && done(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  function guideForm(g) {
    modal(`
      <h3>${g ? 'تعديل الدليل' : 'دليل جديد'}</h3>
      <div class="field"><label>العنوان</label><input class="input" id="g-t" maxlength="100" value="${esc(g?.title || '')}"></div>
      <div class="grid2"><div class="field"><label>لمن</label><input class="input" id="g-a" maxlength="100" value="${esc(g?.audience || '')}" placeholder="لكل من تخدم العميلة"></div>
      <div class="field"><label>جملة الغلاف</label><input class="input" id="g-g" maxlength="200" value="${esc(g?.tagline || '')}"></div></div>
      <div class="field"><label>المحتوى</label><textarea class="input gcode" id="g-b" rows="14" dir="rtl">${esc(g?.body || '# الفصل الأول\n- بند\n! تنبيه مهم\n> جملة تُقال للعميلة\n| العمود | العمود\n| قيمة | قيمة')}</textarea>
        <p class="muted small" style="margin:6px 0 0"># فصل · - بند · ! تنبيه · &gt; جملة للعميلة · | جدول | بأعمدة</p></div>
      ${g ? '<p class="muted small">أي تعديل على المحتوى يطلب من الفريق توقيع جديد.</p>' : ''}
      <div class="actions end">${g ? '<button class="btn danger" id="g-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn" id="g-pv">معاينة</button><button class="btn primary" id="g-s">حفظ</button></div>`, (el, close) => {
      const row = () => ({ title: $('#g-t', el).value.trim(), audience: $('#g-a', el).value.trim() || null, tagline: $('#g-g', el).value.trim() || null, body: $('#g-b', el).value });
      $('#g-pv', el).onclick = () => openGuide({ ...(g || { id: 0, version: 1 }), ...row(), updated_at: new Date().toISOString() }, []);
      $('#g-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const r = row(); if (r.title.length < 2 || !r.body.trim()) return toast('اكتبوا العنوان والمحتوى', true);
        try { if (g) await q(sb.from('guides').update(r).eq('id', g.id)); else await q(sb.from('guides').insert(r)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#g-del', el)?.addEventListener('click', async () => { close(); if (await confirmBox('حذف الدليل', 'ينحذف الدليل وتوقيعاته.', 'حذف', true)) { try { await q(sb.from('guides').delete().eq('id', g.id)); route(); } catch (err) { toast(errMsg(err), true); } } });
    });
  }

  /* ======================= الأصول والصيانة ======================= */
  const ACAT = { chair: ['كراسي ومحطات', '💺', 7], nails: ['أجهزة الأظافر', '💅', 4], hair: ['أدوات الشعر', '💇‍♀️', 3], dryer: ['استشوار ومكاوي', '🌬️', 2], ac: ['مكيفات', '❄️', 8], sterilizer: ['أجهزة التعقيم', '🧼', 5], furniture: ['أثاث وديكور', '🛋️', 8], electronics: ['أجهزة وإلكترونيات', '💻', 4], safety: ['السلامة', '🧯', 5], other: ['أخرى', '✦', 5] };
  const PLAN_TPL = { ac: [['تنظيف الفلاتر', 14], ['صيانة شاملة وغسيل', 90]], chair: [['فحص المضخة والتشحيم', 90], ['تنظيف وتعقيم الجلد', 7]], sterilizer: [['تنظيف الجهاز وفحص الحرارة', 30]], dryer: [['تنظيف فلتر الهواء وفحص السلك', 30]], nails: [['تنظيف وتعقيم الرؤوس وفحص المحرك', 30]], hair: [['تعقيم وفحص الحواف', 30]], safety: [['فحص بصري', 30]], electronics: [['فحص وتحديث', 90]] };
  const SUBCAT = { system: 'أنظمة وبرامج', marketing: 'تسويق وإعلانات', telecom: 'إنترنت واتصالات', design: 'تصميم ومحتوى', insurance: 'تأمين', other: 'أخرى' };
  const CYC = { monthly: ['شهري', 1], quarterly: ['كل ٣ أشهر', 3], yearly: ['سنوي', 12] };
  const planDue = (p) => (p.last_done ? dk(lensShift('d', D(p.last_done), p.every_days)) : null);
  const planSt = (p) => { const d = planDue(p); if (!d) return 'unknown'; const u = until(d); return u < 0 ? 'bad' : u <= Math.max(2, Math.round(p.every_days * 0.15)) ? 'warn' : 'ok'; };
  const bookValue = (a) => { if (!a.cost) return 0; if (!a.purchase_date || !a.life_years) return Number(a.cost) * (a.qty || 1); const yrs = (D(todayR()) - D(a.purchase_date)) / (365.25 * 86400000); return Math.max(0, Number(a.cost) * (a.qty || 1) * (1 - yrs / a.life_years)); };
  const monthlyOf = (s) => Number(s.amount) / CYC[s.cycle][1];

  async function assetsData() {
    const [assets, plans, issues, subs] = await Promise.all([
      q(sb.from('assets').select('*').order('category').order('name')), q(sb.from('maint_plans').select('*')),
      q(sb.from('maint_issues').select('*').order('created_at', { ascending: false }).limit(300)), isManager() ? q(sb.from('subscriptions').select('*').order('renews_on', { nullsFirst: false })) : [],
    ]);
    return { assets, plans, issues, subs };
  }

  async function pageAssets(view, _a, params, alive) {
    const tab = params.get('t') || (isManager() ? 'assets' : 'maint');
    const A = await assetsData();
    if (!alive()) return;
    const open = A.issues.filter((i) => i.status === 'open');
    const due = A.plans.filter((p) => ['bad', 'warn', 'unknown'].includes(planSt(p)));
    const tabs = [...(isManager() ? [['assets', 'الأصول']] : []), ['maint', `الصيانة${open.length + A.plans.filter((p) => planSt(p) === 'bad').length ? ` <i class="dotn">${open.length + A.plans.filter((p) => planSt(p) === 'bad').length}</i>` : ''}`], ...(isManager() ? [['subs', 'الاشتراكات']] : [])];
    const head = `<div class="lens" style="margin-bottom:16px">${tabs.map(([k, l]) => `<a href="#/assets?t=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    if (tab === 'subs' && isManager()) return assetsSubs(view, A, head);
    if (tab === 'maint' || !isManager()) return assetsMaint(view, A, head, open, due);
    const val = A.assets.reduce((s, a) => s + bookValue(a), 0), cost = A.assets.reduce((s, a) => s + Number(a.cost || 0) * (a.qty || 1), 0);
    const warr = A.assets.filter((a) => a.warranty_until && until(a.warranty_until) >= 0 && until(a.warranty_until) <= 60);
    view.innerHTML = `${head}
      <div class="seg-tiles">
        <div class="seg-tile on"><b class="num">${sar(val)}</b><span>قيمة الأصول اليوم</span></div>
        <div class="seg-tile"><b class="num">${sar(cost)}</b><span>تكلفة الشراء</span></div>
        <div class="seg-tile ${open.length ? 'warn' : 'ok'}"><b class="num">${A.assets.filter((a) => a.status !== 'ok').length}</b><span>فيها عطل</span></div>
        <div class="seg-tile"><b class="num">${A.assets.reduce((s, a) => s + (a.qty || 1), 0)}</b><span>قطعة مسجلة</span></div>
      </div>
      ${warr.length ? `<div class="notice info mt">ضمان ${warr.map((a) => esc(a.name)).join('، ')} ينتهي قريب. إذا فيه ملاحظة، استفيدوا منه قبل ما يخلص.</div>` : ''}
      <div class="actions" style="margin:14px 0"><button class="btn primary" id="as-new">${I.plus} أصل</button><button class="btn" id="is-new">${I.plus} بلّغ عن عطل</button></div>
      ${Object.entries(ACAT).filter(([k]) => A.assets.some((a) => a.category === k)).map(([k, [l, e]]) => `<div class="svc-cat-h">${e} ${l}</div><div class="asset-grid">${A.assets.filter((a) => a.category === k).map((a) => { const ps = A.plans.filter((p) => p.asset_id === a.id); const worst = ps.map(planSt).includes('bad') ? 'bad' : ps.map(planSt).includes('warn') ? 'warn' : ''; return `
        <a class="acard ${a.status}" href="#/asset/${a.id}"><div class="ac-top"><span class="ac-e">${e}</span>${a.status !== 'ok' ? `<span class="badge ${a.status === 'out' ? 'danger' : 'warn'}">${a.status === 'out' ? 'متوقف' : 'فيه عطل'}</span>` : worst ? `<span class="badge ${worst === 'bad' ? 'danger' : 'warn'}">${worst === 'bad' ? 'صيانة متأخرة' : 'صيانة قريبة'}</span>` : ''}</div>
          <b>${esc(a.name)}${a.qty > 1 ? ` <span class="muted small">×${a.qty}</span>` : ''}</b><span class="ac-m">${esc([a.model, a.location].filter(Boolean).join(' · '))}</span>
          ${a.cost ? `<span class="ac-v"><span class="num">${sar(bookValue(a))}</span> ر.س اليوم</span>` : ''}</a>`; }).join('')}</div>`).join('') || '<div class="list"><div class="empty">سجّلوا أجهزة الصالون وكراسيه ومكيفاته. كل أصل يجي معه جدول صيانة جاهز حسب نوعه.</div></div>'}`;
    $('#as-new').onclick = () => assetForm(null, (id) => { location.hash = `#/asset/${id}`; });
    $('#is-new').onclick = () => issueForm(A.assets, null);
  }

  function assetsMaint(view, A, head, open, due) {
    const name = (id) => A.assets.find((a) => a.id === id)?.name || '';
    const sorted = [...A.plans].sort((a, b) => (planDue(a) || '0000') < (planDue(b) || '0000') ? -1 : 1);
    const fixed = A.issues.filter((i) => i.status === 'fixed').slice(0, 15);
    const yearCost = A.issues.filter((i) => i.status === 'fixed' && i.fixed_at && i.fixed_at.slice(0, 4) === todayR().slice(0, 4)).reduce((s, i) => s + Number(i.cost || 0), 0);
    view.innerHTML = `${head}
      <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="is-new">${I.plus} بلّغ عن عطل</button></div>
      <div class="section-title"><h2>أعطال مفتوحة</h2><span class="muted small">${open.length}</span></div>
      <div class="list">${open.length ? open.map((i) => { const age = Math.floor((Date.now() - new Date(i.created_at)) / 86400000); return `<div class="row rule ${age > 3 ? 'bad' : 'warn'}"><span class="rdot"></span><div class="grow"><div class="title" style="white-space:normal">${esc(i.title)}</div><div class="meta">${esc(name(i.asset_id))}${i.asset_id ? ' · ' : ''}${age === 0 ? 'اليوم' : `من ${daysTxt(age)}`} · ${esc(firstName(personName(i.reported_by)))}</div></div>${isManager() ? `<button class="btn sm primary" data-fix="${i.id}">تصلّح</button>` : ''}</div>`; }).join('') : '<div class="empty">ما فيه أعطال مفتوحة 🤍</div>'}</div>
      <div class="section-title"><h2>الصيانة الوقائية</h2></div>
      <div class="list">${sorted.length ? sorted.map((p) => { const st = planSt(p), d = planDue(p), u = d ? until(d) : null; return `<div class="row rule ${st}"><span class="rdot"></span><div class="grow"><div class="title" style="white-space:normal">${esc(p.task)}</div><div class="meta">${esc(name(p.asset_id))} · كل ${daysTxt(p.every_days)}${d ? ` · ${u < 0 ? `متأخرة ${daysTxt(-u)}` : u === 0 ? 'اليوم' : `بعد ${daysTxt(u)}`}` : ' · ما انسجّلت آخر مرة'}${p.vendor ? ' · ' + esc(p.vendor) : ''}</div></div><button class="btn sm ${st === 'ok' ? '' : 'primary'}" data-pd="${p.id}">تمّت اليوم</button></div>`; }).join('') : '<div class="empty">الجدول يتكوّن لحاله لما تضيفون الأصول.</div>'}</div>
      ${fixed.length ? `<details class="rfold"><summary>أعطال تصلّحت (${fixed.length})${isManager() && yearCost ? ` · كلفت هالسنة ${sar(yearCost)} ر.س` : ''}</summary><div class="list">${fixed.map((i) => `<div class="row"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${esc(name(i.asset_id))} · ${i.fixed_at ? dShort(i.fixed_at.slice(0, 10)) : ''}${i.vendor ? ' · ' + esc(i.vendor) : ''}${i.note ? ' · ' + esc(i.note) : ''}</div></div>${i.cost ? `<b class="num">${sar(i.cost)}</b>` : ''}</div>`).join('')}</div></details>` : ''}`;
    $('#is-new').onclick = () => issueForm(A.assets, null);
    $$('[data-pd]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await q(sb.from('maint_plans').update({ last_done: todayR() }).eq('id', Number(b.dataset.pd))); toast('تم التسجيل'); route(); } catch (err) { toast(errMsg(err), true); } }));
    $$('[data-fix]', view).forEach((b) => b.onclick = () => fixForm(A.issues.find((i) => i.id === Number(b.dataset.fix))));
  }

  function assetsSubs(view, A, head) {
    const act = A.subs.filter((s) => s.active);
    const mon = act.reduce((a, s) => a + monthlyOf(s), 0);
    const stale = act.filter((s) => !s.last_review || until(s.last_review) < -90);
    view.innerHTML = `${head}
      <div class="seg-tiles">
        <div class="seg-tile on"><b class="num">${sar(mon)}</b><span>بالشهر</span></div>
        <div class="seg-tile"><b class="num">${sar(mon * 12)}</b><span>بالسنة</span></div>
        <div class="seg-tile ${stale.length ? 'warn' : 'ok'}"><b class="num">${stale.length}</b><span>تحتاج مراجعة</span></div>
        <div class="seg-tile ${act.filter((s) => s.usage === 'low').length ? 'warn' : ''}"><b class="num">${act.filter((s) => s.usage === 'low').length}</b><span>استخدامها قليل</span></div>
      </div>
      <p class="muted small" style="margin:10px 2px">كل ٣ أشهر راجعوا الاشتراكات: نستخدمه فعلًا؟ فيه أرخص؟ الاشتراك اللي ما يُراجع يصير مصروف ثابت ما أحد ينتبه له.</p>
      <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="sb-new">${I.plus} اشتراك</button></div>
      <div class="list">${A.subs.map((s) => { const u = s.renews_on ? until(s.renews_on) : null; const rv = !s.last_review || until(s.last_review) < -90; return `<button class="row ${s.active ? '' : 'dim'}" data-sb="${s.id}"><div class="grow"><div class="title">${esc(s.name)} ${s.usage === 'low' ? '<span class="badge warn">استخدامه قليل</span>' : ''}${rv && s.active ? '<span class="badge">يحتاج مراجعة</span>' : ''}</div><div class="meta">${SUBCAT[s.category]} · ${CYC[s.cycle][0]}${u != null ? ` · يتجدد ${u < 0 ? 'فات موعده' : u === 0 ? 'اليوم' : `بعد ${daysTxt(u)}`}` : ''}</div></div><div class="end"><b class="num">${sar(s.amount)}</b> <span class="muted small">ر.س</span>${s.cycle !== 'monthly' ? `<div class="meta">${sar(monthlyOf(s))} بالشهر</div>` : ''}</div></button>`; }).join('') || '<div class="empty">سجّلوا اشتراكات الصالون: ركاز، الإنترنت، الإعلانات، برامج التصميم…</div>'}</div>`;
    $('#sb-new').onclick = () => subForm(null);
    $$('[data-sb]', view).forEach((b) => b.onclick = () => subForm(A.subs.find((s) => s.id === Number(b.dataset.sb))));
  }

  async function pageAsset(view, args, _p, alive) {
    const id = Number(args[0]);
    const A = await assetsData();
    if (!alive()) return;
    const a = A.assets.find((x) => x.id === id);
    if (!a) { view.innerHTML = '<div class="notice danger">ما لقينا الأصل</div>'; return; }
    setTitle(a.name);
    const ps = A.plans.filter((p) => p.asset_id === id), is = A.issues.filter((i) => i.asset_id === id);
    const fixCost = is.reduce((s, i) => s + Number(i.cost || 0), 0);
    const age = a.purchase_date ? (D(todayR()) - D(a.purchase_date)) / (365.25 * 86400000) : null;
    view.innerHTML = `
      <div class="svc-hero"><span class="sh-eyebrow">${ACAT[a.category][1]} ${ACAT[a.category][0]}${a.location ? ' · ' + esc(a.location) : ''}</span><h2>${esc(a.name)}${a.qty > 1 ? ` ×${a.qty}` : ''}</h2>
        <div class="svc-nums"><div><b class="num">${a.cost ? sar(bookValue(a)) : '—'}</b><span>قيمته اليوم</span></div><div><b class="num">${a.cost ? sar(Number(a.cost) * a.qty) : '—'}</b><span>تكلفة الشراء</span></div><div><b>${age != null ? (age < 1 ? `${Math.round(age * 12)} شهر` : `${age.toFixed(1)} سنة`) : '—'}</b><span>عمره</span></div><div><b class="num">${sar(fixCost)}</b><span>كلفة الإصلاحات</span></div></div>
        ${a.cost && fixCost > Number(a.cost) * 0.5 ? '<div class="sh-msg" style="background:var(--warn-soft);color:var(--warn)">الإصلاحات تعدّت نص سعره. فكروا بالاستبدال.</div>' : ''}
        ${a.warranty_until ? `<div class="sh-msg">الضمان ${until(a.warranty_until) < 0 ? 'انتهى' : `ساري لين ${dShort(a.warranty_until)} ${D(a.warranty_until).getFullYear()}`}</div>` : ''}
        <div class="actions" style="margin-top:12px">${isManager() ? `<button class="btn on-oud sm" id="a-ed">${I.edit} تعديل</button>` : ''}<button class="btn on-oud ghost sm" id="a-is">بلّغ عن عطل</button></div></div>
      ${a.model || a.notes ? `<div class="card note-card mt">${esc([a.model, a.notes].filter(Boolean).join('\n'))}</div>` : ''}
      <div class="section-title"><h2>جدول الصيانة</h2>${isManager() ? `<button class="btn sm" id="pl-new">${I.plus} مهمة</button>` : ''}</div>
      <div class="list">${ps.map((p) => { const st = planSt(p), d = planDue(p); return `<div class="row rule ${st}"><span class="rdot"></span><div class="grow"><div class="title">${esc(p.task)}</div><div class="meta">كل ${daysTxt(p.every_days)}${p.last_done ? ` · آخر مرة ${dShort(p.last_done)}` : ''}${d ? ` · الجاية ${dShort(d)}` : ''}</div></div><button class="btn sm ${st === 'ok' ? '' : 'primary'}" data-pd="${p.id}">تمّت اليوم</button>${isManager() ? `<button class="x-btn" data-pdel="${p.id}">×</button>` : ''}</div>`; }).join('') || '<div class="empty">ما فيه مهام صيانة</div>'}</div>
      <div class="section-title"><h2>سجل الأعطال</h2></div>
      <div class="list">${is.map((i) => `<div class="row"><div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${dShort(i.created_at.slice(0, 10))}${i.vendor ? ' · ' + esc(i.vendor) : ''}${i.note ? ' · ' + esc(i.note) : ''}</div></div><span class="badge ${i.status === 'open' ? 'warn' : 'ok'}">${i.status === 'open' ? 'مفتوح' : 'تصلّح'}</span>${i.cost ? ` <b class="num">${sar(i.cost)}</b>` : ''}</div>`).join('') || '<div class="empty">ما فيه أعطال</div>'}</div>`;
    $('#a-ed')?.addEventListener('click', () => assetForm(a, () => route()));
    $('#a-is').onclick = () => issueForm(A.assets, a.id);
    $('#pl-new')?.addEventListener('click', () => modal(`<h3>مهمة صيانة</h3><div class="field"><label>المهمة</label><input class="input" id="pl-t" maxlength="120"></div><div class="grid2"><div class="field"><label>كل (يوم)</label><input class="input num" type="number" id="pl-e" min="1" value="30"></div><div class="field"><label>الجهة</label><input class="input" id="pl-v" maxlength="80"></div></div><div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="pl-s">حفظ</button></div>`, (el, close) => {
      $('#pl-s', el).onclick = (e) => busy(e.currentTarget, async () => { try { await q(sb.from('maint_plans').insert({ asset_id: a.id, task: $('#pl-t', el).value.trim(), every_days: Number($('#pl-e', el).value) || 30, vendor: $('#pl-v', el).value.trim() || null })); close(); route(); } catch (err) { toast(errMsg(err), true); } });
    }));
    $$('[data-pd]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await q(sb.from('maint_plans').update({ last_done: todayR() }).eq('id', Number(b.dataset.pd))); toast('تم التسجيل'); route(); } catch (err) { toast(errMsg(err), true); } }));
    $$('[data-pdel]', view).forEach((b) => b.onclick = () => busy(b, async () => { try { await q(sb.from('maint_plans').delete().eq('id', Number(b.dataset.pdel))); route(); } catch (err) { toast(errMsg(err), true); } }));
  }

  function assetForm(a, done) {
    let cat = a?.category || 'chair';
    modal(`
      <h3>${a ? 'تعديل الأصل' : 'أصل جديد'}</h3>
      <div class="field"><label>النوع</label><div class="chips wrap" id="af-c">${Object.entries(ACAT).map(([k, [l, e]]) => `<button type="button" class="chip ${k === cat ? 'on' : ''}" data-k="${k}">${e} ${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>الاسم</label><input class="input" id="af-n" maxlength="80" value="${esc(a?.name || '')}" placeholder="مثلًا: كرسي غسيل"></div><div class="field"><label>العدد</label><input class="input num" type="number" min="1" id="af-q" value="${a?.qty || 1}"></div></div>
      <div class="grid2"><div class="field"><label>الماركة والموديل</label><input class="input" id="af-m" maxlength="80" value="${esc(a?.model || '')}"></div><div class="field"><label>المكان</label><input class="input" id="af-l" maxlength="60" value="${esc(a?.location || '')}" placeholder="محطة ١، غرفة العرايس…"></div></div>
      <div class="grid2"><div class="field"><label>تاريخ الشراء</label><input class="input" type="date" id="af-d" value="${a?.purchase_date || ''}"></div><div class="field"><label>سعر القطعة</label><input class="input num" type="number" min="0" id="af-p" value="${a?.cost ?? ''}"></div></div>
      <div class="grid2"><div class="field"><label>عمره المتوقع (سنة)</label><input class="input num" type="number" min="0.5" step="0.5" id="af-y" value="${a?.life_years ?? ACAT[cat][2]}"></div><div class="field"><label>الضمان لين</label><input class="input" type="date" id="af-w" value="${a?.warranty_until || ''}"></div></div>
      <div class="field"><label>ملاحظات</label><input class="input" id="af-no" maxlength="500" value="${esc(a?.notes || '')}"></div>
      ${!a ? '<label class="check" style="margin-bottom:12px"><input type="checkbox" id="af-pl" checked> أضف جدول الصيانة الجاهز لهالنوع</label>' : ''}
      <div class="actions end">${a ? '<button class="btn danger" id="af-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="af-s">حفظ</button></div>`, (el, close) => {
      $$('#af-c .chip', el).forEach((b) => b.onclick = () => { cat = b.dataset.k; $$('#af-c .chip', el).forEach((x) => x.classList.toggle('on', x === b)); if (!a) $('#af-y', el).value = ACAT[cat][2]; });
      $('#af-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const v = (id) => $(id, el).value; const row = { name: v('#af-n').trim(), category: cat, qty: Number(v('#af-q')) || 1, model: v('#af-m').trim() || null, location: v('#af-l').trim() || null, purchase_date: v('#af-d') || null, cost: v('#af-p') === '' ? null : Number(v('#af-p')), life_years: v('#af-y') === '' ? null : Number(v('#af-y')), warranty_until: v('#af-w') || null, notes: v('#af-no').trim() || null };
        if (row.name.length < 2) return toast('اكتبوا اسم الأصل', true);
        try {
          let id = a?.id;
          if (a) await q(sb.from('assets').update(row).eq('id', a.id));
          else { id = (await q(sb.from('assets').insert(row).select('id').single())).id; if ($('#af-pl', el)?.checked && PLAN_TPL[cat]) await q(sb.from('maint_plans').insert(PLAN_TPL[cat].map(([task, every_days]) => ({ asset_id: id, task, every_days, last_done: todayR() })))); }
          toast('تم الحفظ'); close(); done && done(id);
        } catch (err) { toast(errMsg(err), true); }
      });
      $('#af-del', el)?.addEventListener('click', async () => { close(); if (await confirmBox('حذف الأصل', 'ينحذف مع جدول صيانته وسجل أعطاله.', 'حذف', true)) { try { await q(sb.from('assets').delete().eq('id', a.id)); location.hash = '#/assets'; } catch (err) { toast(errMsg(err), true); } } });
    });
  }

  function issueForm(assets, assetId) {
    modal(`
      <h3>بلّغ عن عطل</h3>
      <div class="field"><label>وش الجهاز؟</label><select class="input" id="if-a"><option value="">— شي ثاني —</option>${assets.map((a) => `<option value="${a.id}" ${a.id === assetId ? 'selected' : ''}>${ACAT[a.category][1]} ${esc(a.name)}${a.location ? ' · ' + esc(a.location) : ''}</option>`).join('')}</select></div>
      <div class="field"><label>وش المشكلة؟</label><textarea class="input" id="if-t" rows="3" maxlength="160" placeholder="مثلًا: الكرسي ما يرتفع، المكيف يسرّب ماي"></textarea></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="if-s">إرسال</button></div>`, (el, close) => {
      $('#if-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const t = $('#if-t', el).value.trim(); if (t.length < 2) return toast('اكتبوا المشكلة', true);
        try { await q(sb.from('maint_issues').insert({ asset_id: $('#if-a', el).value ? Number($('#if-a', el).value) : null, title: t })); toast('وصل البلاغ للإدارة'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  function fixForm(i) {
    modal(`
      <h3>تصلّح العطل</h3><p class="muted" style="margin-top:-6px">${esc(i.title)}</p>
      <div class="grid2"><div class="field"><label>التكلفة</label><input class="input num" type="number" min="0" id="fx-c"></div><div class="field"><label>مين صلّحه</label><input class="input" id="fx-v" maxlength="80"></div></div>
      <div class="field"><label>ملاحظة</label><input class="input" id="fx-n" maxlength="300"></div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="fx-e" checked> سجّل التكلفة في المصروفات (صيانة)</label>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="fx-s">حفظ</button></div>`, (el, close) => {
      $('#fx-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const c = $('#fx-c', el).value === '' ? null : Number($('#fx-c', el).value);
        try {
          await q(sb.from('maint_issues').update({ status: 'fixed', fixed_at: new Date().toISOString(), cost: c, vendor: $('#fx-v', el).value.trim() || null, note: $('#fx-n', el).value.trim() || null }).eq('id', i.id));
          if (c > 0 && $('#fx-e', el).checked) await q(sb.from('fin_expenses').insert({ day: todayR(), category: 'maintenance', amount: c, vendor: $('#fx-v', el).value.trim() || null, note: i.title.slice(0, 300) }));
          toast('تم 🤍'); close(); route();
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  function subForm(s) {
    let cat = s?.category || 'system', cyc = s?.cycle || 'monthly', usage = s?.usage || 'high';
    const ch = (id, obj, cur) => `<div class="chips wrap" id="${id}">${Object.entries(obj).map(([k, l]) => `<button type="button" class="chip ${k === cur ? 'on' : ''}" data-k="${k}">${Array.isArray(l) ? l[0] : l}</button>`).join('')}</div>`;
    modal(`
      <h3>${s ? esc(s.name) : 'اشتراك جديد'}</h3>
      <div class="grid2"><div class="field"><label>الاسم</label><input class="input" id="sf2-n" maxlength="80" value="${esc(s?.name || '')}" placeholder="ركاز، الإنترنت…"></div><div class="field"><label>المبلغ</label><input class="input num" type="number" min="0" id="sf2-a" value="${s?.amount ?? ''}"></div></div>
      <div class="field"><label>التصنيف</label>${ch('sf2-c', SUBCAT, cat)}</div>
      <div class="field"><label>الدفع</label>${ch('sf2-y', CYC, cyc)}</div>
      <div class="grid2"><div class="field"><label>يتجدد في</label><input class="input" type="date" id="sf2-r" value="${s?.renews_on || ''}"></div><div class="field"><label>استخدامنا له</label>${ch('sf2-u', { high: 'نستخدمه', low: 'قليل' }, usage)}</div></div>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="sf2-rv" ${s ? '' : 'checked'}> راجعناه اليوم</label>
      ${s ? `<label class="check" style="margin-bottom:12px"><input type="checkbox" id="sf2-act" ${s.active ? 'checked' : ''}> الاشتراك شغال</label>` : ''}
      <div class="actions end">${s ? '<button class="btn danger" id="sf2-del">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="sf2-s">حفظ</button></div>`, (el, close) => {
      const pick = (id, set) => $$(`#${id} .chip`, el).forEach((b) => b.onclick = () => { set(b.dataset.k); $$(`#${id} .chip`, el).forEach((x) => x.classList.toggle('on', x === b)); });
      pick('sf2-c', (v) => { cat = v; }); pick('sf2-y', (v) => { cyc = v; }); pick('sf2-u', (v) => { usage = v; });
      $('#sf2-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { name: $('#sf2-n', el).value.trim(), amount: Number($('#sf2-a', el).value) || 0, category: cat, cycle: cyc, usage, renews_on: $('#sf2-r', el).value || null, active: s ? $('#sf2-act', el).checked : true };
        if ($('#sf2-rv', el).checked) row.last_review = todayR();
        if (row.name.length < 2) return toast('اكتبوا الاسم', true);
        try { if (s) await q(sb.from('subscriptions').update(row).eq('id', s.id)); else await q(sb.from('subscriptions').insert(row)); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#sf2-del', el)?.addEventListener('click', async () => { try { await q(sb.from('subscriptions').delete().eq('id', s.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
    });
  }

  /* ======================= عُدّة بيوتفريش ======================= */
  const KF = [
    ['الهوية', [['brand', 'الاسم التجاري'], ['brand_en', 'الاسم بالإنجليزي'], ['legal_name', 'اسم المنشأة في السجل'], ['tagline', 'الشعار النصي']]],
    ['النظامية', [['cr', 'رقم السجل التجاري'], ['vat', 'الرقم الضريبي'], ['national_address', 'العنوان الوطني'], ['short_address', 'الرمز المختصر'], ['city', 'المدينة']]],
    ['التواصل', [['phone', 'الجوال'], ['whatsapp', 'واتساب'], ['instagram', 'انستقرام'], ['tiktok', 'تيك توك'], ['snap', 'سناب'], ['hours', 'أوقات الدوام']]],
    ['الروابط', [['site', 'الموقع'], ['booking', 'رابط الحجز (ركاز)'], ['home_booking', 'حجز الخدمات المنزلية'], ['maps', 'الموقع على الخريطة'], ['review', 'رابط تقييم قوقل']]],
    ['البنك', [['bank_name', 'البنك'], ['beneficiary', 'اسم المستفيد'], ['iban', 'الآيبان']]],
  ];
  const MCAT = { booking: 'الحجز', visit: 'بعد الزيارة', service: 'العناية', issues: 'المواقف الصعبة', seasons: 'المناسبات', team: 'الفريق' };
  let KIT = null;
  async function kitProfile(force) { if (!KIT || force) KIT = (await q(sb.from('kit_profile').select('data').eq('id', 1).maybeSingle()))?.data || {}; return KIT; }
  let qrReady = null;
  const loadQR = () => qrReady || (qrReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = '../vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
  function qrSVG(text, color = '#5A2A22') {
    const qr = window.qrcode(0, 'M'); qr.addData(unescape(encodeURIComponent(text))); qr.make();
    const n = qr.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff" rx="2"/><path d="${d}" fill="${color}"/></svg>`;
  }
  const waLinkOf = (num, text) => `https://wa.me/${waNum(num)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  const igLink = (h) => (h ? `https://instagram.com/${String(h).replace(/^@/, '')}` : '');
  function copyTxt(t, label) { navigator.clipboard?.writeText(t).then(() => toast(`انسخ${label ? ': ' + label : ''}`), () => toast('ما قدرنا ننسخ', true)); }
  function paper(title, html, opts = {}) {
    const ov = document.createElement('div'); ov.className = 'greader';
    ov.innerHTML = `<div class="gr-bar"><button class="icon-btn" data-x>×</button><b>${esc(title)}</b><span style="flex:1"></span>${opts.extra || ''}<button class="btn sm primary" data-pr>طباعة / PDF</button></div><div class="gr-body">${html}</div>`;
    document.body.appendChild(ov); document.body.classList.add('noscroll');
    const close = () => { ov.remove(); document.body.classList.remove('noscroll'); window.removeEventListener('hashchange', close); };
    window.addEventListener('hashchange', close);
    $('[data-x]', ov).onclick = close;
    $('[data-pr]', ov).onclick = () => { document.body.classList.add('printing-guide'); window.print(); setTimeout(() => document.body.classList.remove('printing-guide'), 500); };
    opts.mount && opts.mount(ov, close);
    return close;
  }

  /* ======================= الموقع العام: محتوى يتحكم فيه الصالون ======================= */
  async function siteImg(file, folder) {
    const blob = await new Promise((res) => {
      const img = new Image(); img.onload = () => {
        const m = 1600, k = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => res(b || file), 'image/jpeg', 0.85); URL.revokeObjectURL(img.src);
      }; img.onerror = () => res(file); img.src = URL.createObjectURL(file);
    });
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    const { error } = await sb.storage.from('site').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return sb.storage.from('site').getPublicUrl(path).data.publicUrl;
  }
  const SITE_URL = 'https://beautfresh.com/';
  const SITE_SECS = [['offers', 'العروض'], ['reviews', 'آراء العميلات'], ['team', 'الفريق'], ['gallery', 'المعرض']];

  async function pageSite(view, _a, params, alive) {
    const tab = params.get('t') || 'offers';
    const T = [['offers', 'العروض'], ['reviews', 'الآراء'], ['team', 'الفريق'], ['gallery', 'المعرض'], ['visit', 'الزيارة والأقسام']];
    const [pub, svcs] = await Promise.all([q(sb.rpc('site_public')), q(sb.from('salon_services').select('id,name').eq('is_active', true).order('name'))]);
    if (!alive()) return;
    const svcOpts = (sel) => `<option value="">— بدون —</option>${svcs.map((s) => `<option value="${s.id}" ${String(sel) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    const head = `
      <div class="site-hero card">
        <div><h2>الموقع اللي تشوفه العميلة</h2><p class="muted">كل شي هنا يطلع في <b>beautfresh.com</b> مباشرة، بدون برمجة.</p></div>
        <div class="site-stats"><div><b class="num">${pub.stats ? Number(pub.stats.avg).toFixed(1) : '—'}</b><span>متوسط التقييم</span></div><div><b class="num">${pub.offers.length}</b><span>عرض شغّال</span></div><div><b class="num">${pub.team.length}</b><span>أخصائية ظاهرة</span></div><div><b class="num">${pub.gallery.length}</b><span>صورة</span></div></div>
        <a class="btn" href="${SITE_URL}" target="_blank" rel="noopener">شوفي الموقع ←</a>
      </div>
      <div class="chips" style="margin:14px 0">${T.map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/site?t=${k}">${l}</a>`).join('')}</div>`;

    if (tab === 'offers') {
      const rows = await q(sb.from('site_offers').select('*').order('sort').order('id', { ascending: false }));
      if (!alive()) return;
      const today = todayR();
      const st = (o) => !o.active ? ['موقوف', ''] : o.ends_on && o.ends_on < today ? ['انتهى', ''] : o.starts_on && o.starts_on > today ? ['يبدأ ' + o.starts_on, 'warn'] : ['ظاهر الحين', 'ok'];
      view.innerHTML = head + `
        <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="of-new">${I.plus} عرض جديد</button></div>
        ${rows.length ? `<div class="list">${rows.map((o) => { const [l, c] = st(o); return `<button class="row" data-id="${o.id}" style="text-align:start">
          ${o.image_url ? `<img src="${esc(o.image_url)}" alt="" style="width:54px;height:54px;border-radius:14px;object-fit:cover;flex:none">` : ''}
          <div class="grow"><div class="title">${esc(o.title)}</div><div class="meta">${esc(o.price_text || '')}${o.was_text ? ` بدل ${esc(o.was_text)}` : ''}${o.ends_on ? ` · لين ${o.ends_on}` : ''}</div></div>
          <span class="chip-d ${c}">${l}</span></button>`; }).join('')}</div>`
          : `<div class="empty card"><b>ما فيه عروض للحين</b><p class="muted">العرض يطلع أول شي في الموقع، ومعه عدّاد «باقي كم يوم»، وزر يفتح الحجز والخدمة جاهزة.</p></div>`}`;
      const form = (o = {}) => modal(`<h3>${o.id ? 'تعديل العرض' : 'عرض جديد'}</h3>
        <div class="field"><label>عنوان العرض</label><input class="input" id="o-t" maxlength="60" value="${esc(o.title || '')}" placeholder="باقة العروس"></div>
        <div class="field"><label>وصف قصير</label><input class="input" id="o-s" maxlength="160" value="${esc(o.subtitle || '')}" placeholder="استشوار + مكياج + أظافر، في زيارة وحدة"></div>
        <div class="grid2"><div class="field"><label>السعر</label><input class="input" id="o-p" maxlength="40" value="${esc(o.price_text || '')}" placeholder="٣٩٩ ريال"></div><div class="field"><label>بدل (اختياري)</label><input class="input" id="o-w" maxlength="40" value="${esc(o.was_text || '')}" placeholder="٥٢٠ ريال"></div></div>
        <div class="field"><label>الخدمة اللي يفتحها زر الحجز</label><select class="input" id="o-v">${svcOpts((o.service_ids || [])[0])}</select></div>
        <div class="grid2"><div class="field"><label>يبدأ</label><input class="input" type="date" id="o-a" value="${o.starts_on || ''}"></div><div class="field"><label>ينتهي</label><input class="input" type="date" id="o-e" value="${o.ends_on || ''}"></div></div>
        <div class="field"><label>صورة (اختياري)</label><input type="file" accept="image/*" id="o-i" class="input">${o.image_url ? `<img src="${esc(o.image_url)}" alt="" style="margin-top:8px;max-height:120px;border-radius:12px">` : ''}</div>
        <label class="check"><input type="checkbox" id="o-on" ${o.active === false ? '' : 'checked'}> ظاهر في الموقع</label>
        <div class="actions end mt">${o.id ? '<button class="btn danger" id="o-del">حذف</button>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="o-save">حفظ</button></div>`, (el, close) => {
        $('#o-save', el).onclick = (e) => busy(e.currentTarget, async () => {
          const row = { title: $('#o-t', el).value.trim(), subtitle: $('#o-s', el).value.trim() || null, price_text: $('#o-p', el).value.trim() || null, was_text: $('#o-w', el).value.trim() || null,
            service_ids: $('#o-v', el).value ? [Number($('#o-v', el).value)] : [], starts_on: $('#o-a', el).value || null, ends_on: $('#o-e', el).value || null, active: $('#o-on', el).checked };
          if (row.title.length < 2) return toast('اكتبوا عنوان العرض', true);
          if (row.starts_on && row.ends_on && row.ends_on < row.starts_on) return toast('تاريخ النهاية قبل البداية', true);
          try { const f = $('#o-i', el).files[0]; if (f) row.image_url = await siteImg(f, 'offers');
            if (o.id) await q(sb.from('site_offers').update(row).eq('id', o.id)); else await q(sb.from('site_offers').insert(row));
            close(); toast('انحفظ العرض، وبيطلع في الموقع'); route(); } catch (err) { toast(errMsg(err), true); }
        });
        $('#o-del', el)?.addEventListener('click', async () => { if (!(await confirmBox('حذف العرض', 'يختفي من الموقع ومن هنا.', 'حذف', true))) return; try { await q(sb.from('site_offers').delete().eq('id', o.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
      });
      $('#of-new', view).onclick = () => form();
      $$('[data-id]', view).forEach((b) => b.onclick = () => form(rows.find((x) => String(x.id) === b.dataset.id)));
      return;
    }

    if (tab === 'reviews') {
      const all = await q(sb.rpc('site_reviews_admin'));
      if (!alive()) return;
      let f = params.get('f') || 'shown', qs = '';
      view.innerHTML = head + `
        <div class="notice">الموقع يعرض تلقائيًا آخر الآراء المكتوبة بأربع نجوم وفوق. ثبّتي اللي تبينها تطلع أول، وأخفي أي رأي ما يناسب.</div>
        <div class="actions" style="margin:12px 0;gap:8px;flex-wrap:wrap">${[['shown', 'اللي تطلع في الموقع'], ['pin', 'المثبتة'], ['hide', 'المخفية'], ['low', 'أقل من ٤ نجوم'], ['all', 'الكل']].map(([k, l]) => `<button class="chip ${k === f ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
          <input class="input" id="rv-q" placeholder="ابحثي بالخدمة أو الأخصائية أو الكلام" style="flex:1;min-width:200px"></div>
        <div id="rv-list"></div>`;
      const shown = (r) => r.state !== 'hide' && (r.state === 'pin' || (r.rating >= 4 && (r.text || '').trim().length > 15));
      const draw = () => {
        const L = all.filter((r) => f === 'all' ? true : f === 'pin' ? r.state === 'pin' : f === 'hide' ? r.state === 'hide' : f === 'low' ? r.rating < 4 : shown(r))
          .filter((r) => !qs || [r.text, r.service, r.by, r.name].join(' ').includes(qs)).slice(0, 120);
        $('#rv-list', view).innerHTML = L.length ? `<div class="list">${L.map((r) => `<div class="row" style="align-items:flex-start">
          <div class="grow"><div class="meta"><span style="color:#C9A46A">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> · ${esc(r.name)} · ${esc(r.service || '')}${r.by ? ` · ${esc(r.by)}` : ''} · ${r.at}</div><div style="margin-top:6px;line-height:1.8">${esc(r.text)}</div></div>
          <div class="actions" style="flex:none;gap:6px">${r.state === 'pin' ? `<button class="btn sm" data-m="${esc(r.id)}" data-s="">إلغاء التثبيت</button>` : `<button class="btn sm" data-m="${esc(r.id)}" data-s="pin">تثبيت</button>`}${r.state === 'hide' ? `<button class="btn sm" data-m="${esc(r.id)}" data-s="">إظهار</button>` : `<button class="btn sm" data-m="${esc(r.id)}" data-s="hide">إخفاء</button>`}</div></div>`).join('')}</div>` : '<div class="empty card">ما فيه آراء هنا</div>';
        $$('[data-m]', view).forEach((b) => b.onclick = () => busy(b, async () => {
          const id = b.dataset.m, s = b.dataset.s;
          try { if (s) await q(sb.from('site_review_mod').upsert({ review_id: id, state: s })); else await q(sb.from('site_review_mod').delete().eq('review_id', id));
            const r = all.find((x) => x.id === id); r.state = s || null; toast(s === 'pin' ? 'تثبّت، بيطلع أول' : s === 'hide' ? 'اختفى من الموقع' : 'رجع طبيعي'); draw(); } catch (err) { toast(errMsg(err), true); }
        }));
      };
      $$('[data-f]', view).forEach((b) => b.onclick = () => { f = b.dataset.f; $$('[data-f]', view).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
      $('#rv-q', view).addEventListener('input', (e) => { qs = e.target.value.trim(); draw(); });
      draw(); return;
    }

    if (tab === 'team') {
      const [provs, over] = await Promise.all([q(sb.rpc('site_team_admin')), q(sb.from('site_team').select('*'))]);
      if (!alive()) return;
      const O = new Map(over.map((x) => [x.provider_id, x]));
      view.innerHTML = head + `
        <div class="notice">الأخصائيات من ركاز. اللي عندها ٥ آراء وفوق تطلع تلقائيًا، وتقدرين تظهرين أو تخفين أي وحدة، وتضيفين صورتها ووصفها. زر «احجزي معها» في الموقع يعرض أوقاتها هي بس.</div>
        <div class="list" style="margin-top:12px">${provs.map((p) => { const o = O.get(p.id) || {}; const vis = o.visible == null ? (p.n >= 5) : o.visible; return `<button class="row" data-p="${esc(p.id)}" style="text-align:start">
          <div class="avatar" style="${o.photo_url ? `background:url('${esc(o.photo_url)}') center/cover` : ''}">${o.photo_url ? '' : esc((o.display_name || p.name).charAt(0))}</div>
          <div class="grow"><div class="title">${esc(o.display_name || p.name)}</div><div class="meta">${esc(o.title || (p.top ? 'أكثر ما تسويه: ' + p.top : ''))}${p.n ? ` · ★ ${p.avg} من ${p.n} رأي` : ' · ما عندها آراء'}</div></div>
          <span class="chip-d ${vis ? 'ok' : ''}">${vis ? 'ظاهرة' : 'مخفية'}${o.visible == null ? ' (تلقائي)' : ''}</span></button>`; }).join('')}</div>`;
      $$('[data-p]', view).forEach((b) => b.onclick = () => {
        const p = provs.find((x) => x.id === b.dataset.p), o = O.get(p.id) || {};
        modal(`<h3>${esc(p.name)} في الموقع</h3>
          <div class="grid2"><div class="field"><label>الاسم الظاهر</label><input class="input" id="t-n" maxlength="40" value="${esc(o.display_name || '')}" placeholder="${esc(p.name)}"></div><div class="field"><label>الترتيب</label><input class="input" id="t-o" type="number" value="${o.sort || 0}"></div></div>
          <div class="field"><label>وصف قصير</label><input class="input" id="t-t" maxlength="60" value="${esc(o.title || '')}" placeholder="خبيرة صبغات وبلياج"></div>
          <div class="field"><label>صورتها (اختياري)</label><input type="file" accept="image/*" id="t-i" class="input"></div>
          <div class="field"><label>الظهور</label><select class="input" id="t-v"><option value="" ${o.visible == null ? 'selected' : ''}>تلقائي (تظهر لو عندها ٥ آراء وفوق)</option><option value="1" ${o.visible === true ? 'selected' : ''}>ظاهرة دايم</option><option value="0" ${o.visible === false ? 'selected' : ''}>مخفية</option></select></div>
          <div class="actions end mt"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="t-s">حفظ</button></div>`, (el, close) => {
          $('#t-s', el).onclick = (e) => busy(e.currentTarget, async () => {
            const v = $('#t-v', el).value;
            const row = { provider_id: p.id, display_name: $('#t-n', el).value.trim() || null, title: $('#t-t', el).value.trim() || null, sort: Number($('#t-o', el).value) || 0, visible: v === '' ? null : v === '1', photo_url: o.photo_url || null };
            try { const f = $('#t-i', el).files[0]; if (f) row.photo_url = await siteImg(f, 'team'); await q(sb.from('site_team').upsert(row)); close(); toast('انحفظ'); route(); } catch (err) { toast(errMsg(err), true); }
          });
        });
      });
      return;
    }

    if (tab === 'gallery') {
      const rows = await q(sb.from('site_gallery').select('*').order('sort').order('id', { ascending: false }));
      if (!alive()) return;
      const sv = new Map(svcs.map((s) => [s.id, s.name]));
      view.innerHTML = head + `
        <div class="notice">صور شغلكم الحقيقي. اربطي كل صورة بخدمتها، والضغط عليها في الموقع يفتح الحجز والخدمة جاهزة. الصور تتصغّر تلقائيًا عشان الموقع يبقى سريع.</div>
        <label class="btn primary" style="margin:12px 0;display:inline-flex">${I.plus} أضيفي صور<input type="file" accept="image/*" multiple id="g-up" hidden></label>
        ${rows.length ? `<div class="site-gl">${rows.map((g) => `<button class="site-gi ${g.active ? '' : 'off'}" data-g="${g.id}"><img src="${esc(g.image_url)}" alt="" loading="lazy"><span>${esc(g.caption || sv.get(g.service_id) || 'بدون خدمة')}</span></button>`).join('')}</div>` : '<div class="empty card"><b>المعرض فاضي</b><p class="muted">أول ما ترفعين صور، يطلع قسم «من شغلنا» في الموقع لحاله.</p></div>'}`;
      $('#g-up', view).onchange = async (e) => {
        const files = [...e.target.files].slice(0, 20); if (!files.length) return;
        toast(`نرفع ${files.length} صورة…`);
        try { for (const f of files) { const url = await siteImg(f, 'gallery'); await q(sb.from('site_gallery').insert({ image_url: url })); } toast('انرفعت، اربطيها بخدماتها'); route(); } catch (err) { toast(errMsg(err), true); }
      };
      $$('[data-g]', view).forEach((b) => b.onclick = () => {
        const g = rows.find((x) => String(x.id) === b.dataset.g);
        modal(`<h3>صورة في المعرض</h3><img src="${esc(g.image_url)}" alt="" style="width:100%;max-height:260px;object-fit:cover;border-radius:14px;margin-bottom:10px">
          <div class="field"><label>الخدمة</label><select class="input" id="g-s">${svcOpts(g.service_id)}</select></div>
          <div class="grid2"><div class="field"><label>تعليق (اختياري)</label><input class="input" id="g-c" maxlength="120" value="${esc(g.caption || '')}" placeholder="بلياج عسلي"></div><div class="field"><label>الترتيب</label><input class="input" type="number" id="g-o" value="${g.sort || 0}"></div></div>
          <label class="check"><input type="checkbox" id="g-on" ${g.active ? 'checked' : ''}> ظاهرة في الموقع</label>
          <div class="actions end mt"><button class="btn danger" id="g-del">حذف</button><button class="btn" data-close>إلغاء</button><button class="btn primary" id="g-sv">حفظ</button></div>`, (el, close) => {
          $('#g-sv', el).onclick = (e) => busy(e.currentTarget, async () => { try { await q(sb.from('site_gallery').update({ service_id: $('#g-s', el).value ? Number($('#g-s', el).value) : null, caption: $('#g-c', el).value.trim() || null, sort: Number($('#g-o', el).value) || 0, active: $('#g-on', el).checked }).eq('id', g.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
          $('#g-del', el).onclick = async () => { if (!(await confirmBox('حذف الصورة', 'تنحذف من الموقع.', 'حذف', true))) return; try { await q(sb.from('site_gallery').delete().eq('id', g.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } };
        });
      });
      return;
    }

    // الزيارة والأقسام
    const c = await q(sb.from('site_conf').select('*').eq('id', 1).single());
    if (!alive()) return;
    let secs = Array.isArray(c.sections) ? c.sections.slice() : SITE_SECS.map(([k]) => k);
    const drawSecs = () => SITE_SECS.slice().sort((a, b) => { const ia = secs.indexOf(a[0]), ib = secs.indexOf(b[0]); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); })
      .map(([k, l]) => `<label class="check" style="justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--line)"><span><input type="checkbox" data-sec="${k}" ${secs.includes(k) ? 'checked' : ''}> ${l}</span></label>`).join('');
    view.innerHTML = head + `
      <div class="card"><div class="field"><label>أوقات العمل</label><input class="input" id="c-h" maxlength="120" value="${esc(c.hours || '')}"></div>
        <div class="field"><label>المدينة أو الحي</label><input class="input" id="c-a" maxlength="80" value="${esc(c.address || '')}"></div>
        <div class="field"><label>رابط الموقع على خرائط Google <span class="muted small">(الصقي أي رابط، ونرتبه ونطلع الإحداثيات للخريطة)</span></label><input class="input" id="c-m" dir="ltr" value="${esc(c.map_url || '')}" placeholder="https://maps.app.goo.gl/…"></div></div>
      <div class="section-title"><h2>أقسام تطلع في الموقع</h2><span class="muted small">القسم الفاضي ما يطلع حتى لو مفعّل</span></div>
      <div class="card" id="c-secs">${drawSecs()}</div>
      <div class="actions end mt"><button class="btn primary" id="c-s">حفظ</button></div>`;
    $('#c-s', view).onclick = (e) => busy(e.currentTarget, async () => {
      secs = $$('[data-sec]', view).filter((x) => x.checked).map((x) => x.dataset.sec);
      const m = $('#c-m', view).value.trim(); if (m && !/^https:\/\//.test(m)) return toast('رابط الخريطة لازم يبدأ بـ https', true);
      let lat = c.lat, lng = c.lng, clean = m;
      if (m) { const a = m.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || m.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if (a) { lat = +a[1]; lng = +a[2]; } const cid = m.match(/0x[0-9a-f]+:0x([0-9a-f]+)/i); if (cid) clean = `https://maps.google.com/?cid=${BigInt('0x' + cid[1]).toString()}`; }
      try { await q(sb.from('site_conf').update({ hours: $('#c-h', view).value.trim() || null, address: $('#c-a', view).value.trim() || null, map_url: clean || null, lat: lat || null, lng: lng || null, sections: secs, updated_at: new Date().toISOString() }).eq('id', 1)); toast('انحفظ، والموقع تحدّث'); } catch (err) { toast(errMsg(err), true); }
    });
  }

  async function pageKit(view, _a, params, alive) {
    const tab = params.get('t') || 'card';
    const tabs = [['card', 'بطاقة المنشأة'], ['msgs', 'رسائل جاهزة'], ['forms', 'النماذج'], ['gifts', 'قسائم الهدايا']];
    const head = `<div class="kit-intro"><span class="sh-eyebrow">كل ما تحتاجونه، في مكان واحد</span><h1>عُدّة بيوتفريش</h1></div>
      <div class="lens" style="margin-bottom:16px">${tabs.map(([k, l]) => `<a href="#/kit?t=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    const [K] = await Promise.all([kitProfile(true), loadQR().catch(() => null)]);
    if (!alive()) return;
    if (tab === 'msgs') return kitMsgs(view, K, head, params, alive);
    if (tab === 'forms') return kitForms(view, K, head);
    if (tab === 'gifts') return kitGifts(view, K, head, alive);
    const qrT = [['booking', 'الحجز', K.booking], ['review', 'تقييم قوقل', K.review], ['maps', 'الموقع', K.maps], ['whatsapp', 'واتساب', K.whatsapp ? waLinkOf(K.whatsapp) : ''], ['instagram', 'انستقرام', igLink(K.instagram)], ['home', 'الخدمات المنزلية', K.home_booking]].filter((x) => x[2]);
    const sel = params.get('qr') && qrT.find((x) => x[0] === params.get('qr')) ? params.get('qr') : qrT[0]?.[0];
    const cur = qrT.find((x) => x[0] === sel);
    view.innerHTML = `${head}
      <div class="kit-top">
        <div class="bcard"><div class="bc-front"><img src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><span>${esc(K.tagline || 'The Fresh Version of You')}</span><i></i></div>
          <div class="bc-back"><b>${esc(K.legal_name || K.brand || 'بيوتفريش')}</b>${K.phone ? `<span dir="ltr">${esc(K.phone)}</span>` : ''}${K.instagram ? `<span dir="ltr">@${esc(String(K.instagram).replace(/^@/, ''))}</span>` : ''}${K.site ? `<span dir="ltr">${esc(K.site.replace(/^https?:\/\//, ''))}</span>` : ''}${K.hours ? `<span>${esc(K.hours)}</span>` : ''}</div></div>
        ${cur && window.qrcode ? `<div class="qr-panel"><div class="chips wrap">${qrT.map(([k, l]) => `<a class="chip ${k === sel ? 'on' : ''}" href="#/kit?qr=${k}">${l}</a>`).join('')}</div>
          <div class="qr-box">${qrSVG(cur[2])}<div><b>${cur[1]}</b><span dir="ltr">${esc(cur[2].replace(/^https?:\/\//, '').slice(0, 44))}</span><div class="actions" style="margin-top:10px"><button class="btn sm" id="qr-png">تحميل PNG</button><button class="btn sm" id="qr-copy">نسخ الرابط</button></div></div></div></div>` : ''}
      </div>
      <div class="kf-grid">${KF.map(([g, fs]) => `<div class="kf"><div class="kf-h"><b>${g}</b>${isManager() ? `<button class="tgt-edit" data-kg="${g}" style="color:var(--muted)">${I.edit}</button>` : ''}</div>${fs.map(([k, l]) => `<div class="kf-r ${K[k] ? '' : 'empty'}"><span>${l}</span><b ${/^(phone|whatsapp|iban|cr|vat|site|booking|home_booking|maps|review|instagram|tiktok|snap|short_address)$/.test(k) ? 'dir="ltr"' : ''}>${K[k] ? esc(K[k]) : '—'}</b>${K[k] ? `<button class="cp" data-cp="${k}" aria-label="نسخ">⧉</button>` : ''}</div>`).join('')}</div>`).join('')}</div>
      ${isManager() ? `<p class="muted small mt">هذي البيانات تتعبّى لحالها في الرسائل والنماذج والقسائم.</p>` : ''}`;
    $$('[data-cp]', view).forEach((b) => b.onclick = () => copyTxt(K[b.dataset.cp], KF.flatMap((x) => x[1]).find((x) => x[0] === b.dataset.cp)[1]));
    $$('[data-kg]', view).forEach((b) => b.onclick = () => kitEdit(KF.find((x) => x[0] === b.dataset.kg)));
    $('#qr-copy')?.addEventListener('click', () => copyTxt(cur[2], cur[1]));
    $('#qr-png')?.addEventListener('click', () => {
      const svg = $('.qr-box .qr', view).outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"');
      const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d').drawImage(img, 0, 0); const a = document.createElement('a'); a.download = `beautfresh-qr-${sel}.png`; a.href = c.toDataURL('image/png'); a.click(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function kitEdit([g, fs]) {
    const K = KIT || {};
    modal(`<h3>${g}</h3>${fs.map(([k, l]) => `<div class="field"><label>${l}</label><input class="input" data-k="${k}" value="${esc(K[k] || '')}" ${/^(phone|whatsapp|iban|cr|vat|site|booking|home_booking|maps|review|instagram|tiktok|snap|short_address)$/.test(k) ? 'dir="ltr"' : ''} maxlength="200"></div>`).join('')}
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="ke-s">حفظ</button></div>`, (el, close) => {
      $('#ke-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const data = { ...K }; $$('[data-k]', el).forEach((i) => { const v = i.value.trim(); if (v) data[i.dataset.k] = v; else delete data[i.dataset.k]; });
        try { await q(sb.from('kit_profile').upsert({ id: 1, data, updated_at: new Date().toISOString() })); KIT = data; toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  function fillMsg(body, vals) { return body.replace(/\{([^}]+)\}/g, (m, k) => (vals[k] != null && vals[k] !== '' ? vals[k] : m)); }
  async function kitMsgs(view, K, head, params, alive) {
    const cat = params.get('c') || 'all';
    const rows = await q(sb.from('kit_messages').select('*').order('cat').order('sort'));
    if (!alive()) return;
    const shown = cat === 'all' ? rows : rows.filter((m) => m.cat === cat);
    view.innerHTML = `${head}
      <div class="chips wrap" style="margin-bottom:12px"><a class="chip ${cat === 'all' ? 'on' : ''}" href="#/kit?t=msgs">الكل</a>${Object.entries(MCAT).map(([k, l]) => `<a class="chip ${k === cat ? 'on' : ''}" href="#/kit?t=msgs&c=${k}">${l}</a>`).join('')}</div>
      ${isManager() ? `<div class="actions" style="margin-bottom:12px"><button class="btn sm" id="km-new">${I.plus} رسالة</button></div>` : ''}
      <div class="msg-grid">${shown.map((m, i) => `<button class="mcard" data-m="${m.id}" style="--d:${i * 40}ms"><span class="mc-cat">${MCAT[m.cat]}</span><b>${esc(m.title)}</b><p>${esc(m.body.slice(0, 120))}${m.body.length > 120 ? '…' : ''}</p></button>`).join('')}</div>
      <p class="muted small mt">الكلمات بين { } تتعبّى لحالها من بيانات المنشأة، أو تكتبونها وقت الإرسال.</p>`;
    $('#km-new')?.addEventListener('click', () => msgEdit(null));
    $$('[data-m]', view).forEach((b) => b.onclick = () => composeMsg(rows.find((m) => m.id === Number(b.dataset.m)), K));
  }

  function composeMsg(m, K, preset = {}) {
    const auto = { 'الموقع': K.maps || '', 'رابط_الحجز': K.booking || '', 'رابط_التقييم': K.review || '', 'الدوام': K.hours || '', ...preset };
    const keys = [...new Set([...m.body.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]))];
    let phone = preset._phone || '';
    modal(`
      <span class="mc-cat">${MCAT[m.cat]}</span><h3 style="margin-top:6px">${esc(m.title)}</h3>
      <div class="field"><label>العميلة</label><div class="cl-pick"><input class="input" id="cm-q" placeholder="ابحث بالاسم أو الجوال" autocomplete="off"><div class="cl-res" id="cm-r"></div></div></div>
      ${keys.length ? `<div class="grid2">${keys.map((k) => `<div class="field"><label>${k.replace(/_/g, ' ')}</label><input class="input" data-ph="${k}" value="${esc(auto[k] || '')}"></div>`).join('')}</div>` : ''}
      <div class="wa-prev"><div class="wa-bub" id="cm-p"></div></div>
      <div class="actions end">${isManager() ? '<button class="btn" id="cm-ed">تعديل النص</button><span style="flex:1"></span>' : ''}<button class="btn" id="cm-cp">نسخ</button><a class="btn primary" id="cm-wa" target="_blank" rel="noopener">${I.wa} واتساب</a></div>`, (el, close) => {
      const vals = () => { const v = { ...auto }; $$('[data-ph]', el).forEach((i) => { v[i.dataset.ph] = i.value.trim(); }); return v; };
      const upd = () => { const t = fillMsg(m.body, vals()); $('#cm-p', el).innerHTML = esc(t).replace(/\{([^}]+)\}/g, '<mark>{$1}</mark>').replace(/\n/g, '<br>'); $('#cm-wa', el).href = phone ? waLinkOf(phone, t) : `https://wa.me/?text=${encodeURIComponent(t)}`; };
      el.addEventListener('input', upd); upd();
      let pool = null, tmr;
      $('#cm-q', el).addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(async () => {
        const t = e.target.value.trim(); const box = $('#cm-r', el); if (t.length < 2) { box.innerHTML = ''; return; }
        if (!pool) pool = await q(sb.from('clients').select('id,name,phone').limit(3000)).catch(() => []);
        const res = pool.filter((c) => c.name.includes(t) || (c.phone || '').includes(t)).slice(0, 6);
        box.innerHTML = res.map((c) => `<button type="button" data-c="${c.id}">${esc(c.name)} <span dir="ltr">${esc(c.phone || '')}</span></button>`).join('') || '<span class="muted small">ما فيه نتائج</span>';
        $$('[data-c]', box).forEach((b) => b.onclick = () => { const c = pool.find((x) => x.id === Number(b.dataset.c)); phone = c.phone || ''; $('#cm-q', el).value = c.name; box.innerHTML = ''; const n = $('[data-ph="الاسم"]', el); if (n) n.value = firstName(c.name); upd(); });
      }, 200); });
      if (preset['الاسم']) $('#cm-q', el).value = preset['الاسم'];
      $('#cm-cp', el).onclick = () => copyTxt(fillMsg(m.body, vals()), 'الرسالة');
      $('#cm-ed', el)?.addEventListener('click', () => { close(); msgEdit(m); });
    });
  }

  function msgEdit(m) {
    modal(`<h3>${m ? 'تعديل الرسالة' : 'رسالة جديدة'}</h3>
      <div class="grid2"><div class="field"><label>العنوان</label><input class="input" id="me-t" maxlength="80" value="${esc(m?.title || '')}"></div><div class="field"><label>التصنيف</label><select class="input" id="me-c">${Object.entries(MCAT).map(([k, l]) => `<option value="${k}" ${k === m?.cat ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>النص</label><textarea class="input" id="me-b" rows="8" maxlength="1500">${esc(m?.body || 'هلا {الاسم} 🤍\n')}</textarea><p class="muted small" style="margin:6px 0 0">جاهزة تتعبّى لحالها: {الاسم} {الموقع} {رابط_الحجز} {رابط_التقييم} {الدوام}. وأي كلمة ثانية بين { } تنكتب وقت الإرسال.</p></div>
      <div class="actions end">${m ? '<button class="btn danger" id="me-d">حذف</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="me-s">حفظ</button></div>`, (el, close) => {
      $('#me-s', el).onclick = (e) => busy(e.currentTarget, async () => { const row = { title: $('#me-t', el).value.trim(), cat: $('#me-c', el).value, body: $('#me-b', el).value.trim() }; if (row.title.length < 2 || row.body.length < 2) return toast('اكتبوا العنوان والنص', true); try { if (m) await q(sb.from('kit_messages').update(row).eq('id', m.id)); else await q(sb.from('kit_messages').insert(row)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
      $('#me-d', el)?.addEventListener('click', async () => { try { await q(sb.from('kit_messages').delete().eq('id', m.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
    });
  }

  const FORMS = [
    ['consult', 'استمارة العميلة والموافقة', 'الحساسية، والتفضيلات، وموافقة التصوير والرسائل', '📝'],
    ['steril', 'سجل التعقيم الأسبوعي', 'يتعلّق جنب جهاز التعقيم، وتوقّع عليه الأخصائية', '🧼'],
    ['counter', 'بطاقة طاولة الاستقبال', 'باركود الحجز والتقييم، بهوية الصالون', '🔳'],
    ['custody', 'نموذج استلام عهدة', 'الأدوات والأجهزة اللي تستلمها الموظفة', '🧰'],
    ['privacy', 'تعهد الخصوصية والسرية', 'خصوصية العميلات وصورهن وبياناتهن', '🤍'],
  ];
  function kitForms(view, K, head) {
    view.innerHTML = `${head}<div class="form-grid">${FORMS.map(([k, t, d, e], i) => `<button class="fcard" data-f="${k}" style="--d:${i * 50}ms"><div class="fc-paper"><span>${e}</span><i></i><i></i><i></i></div><b>${t}</b><span>${d}</span></button>`).join('')}</div>
      <p class="muted small mt">النماذج تتعبّى ببيانات المنشأة وتنطبع على A4. قوالب للاستئناس، وراجعوا أي صيغة نظامية مع مختص.</p>`;
    $$('[data-f]', view).forEach((b) => b.onclick = () => openForm(b.dataset.f, K));
  }
  function formHead(K, title, sub) {
    return `<header class="pp-h"><img src="../home/assets/Beautfresh-brown.svg" alt=""><div><h1>${esc(title)}</h1>${sub ? `<span>${esc(sub)}</span>` : ''}</div><div class="pp-meta">${esc(K.legal_name || K.brand || 'بيوتفريش')}${K.cr ? `<br>س.ت ${esc(K.cr)}` : ''}${K.phone ? `<br><span dir="ltr">${esc(K.phone)}</span>` : ''}</div></header>`;
  }
  const lines = (n) => Array.from({ length: n }, () => '<div class="pp-line"></div>').join('');
  function openForm(k, K) {
    const ft = FORMS.find((f) => f[0] === k)[1];
    let html = '';
    if (k === 'consult') html = `<div class="pp">${formHead(K, ft, 'تُعبّى في أول زيارة، وتُحدّث إذا تغيّر شي')}
      <div class="pp-2"><div><label>الاسم</label>${lines(1)}</div><div><label>الجوال</label>${lines(1)}</div></div>
      <div class="pp-2"><div><label>تاريخ الميلاد (اختياري)</label>${lines(1)}</div><div><label>كيف عرفتينا؟</label><div class="pp-opts">${['انستقرام', 'تيك توك', 'سناب', 'صديقة', 'مرّيت', 'غير'].map((x) => `<span>▢ ${x}</span>`).join('')}</div></div></div>
      <h2>الصحة والحساسية</h2><div class="pp-q">${['عندك حساسية من أي منتج أو مادة؟', 'سبق صار عندك تهيّج من صبغة أو جيل أو أكريليك؟', 'حامل أو مرضعة؟', 'تستخدمين أدوية أو كريمات للبشرة حاليًا؟', 'عندك جرح أو التهاب في المنطقة اللي بنشتغل عليها؟'].map((x) => `<div><span>${x}</span><span class="pp-yn">▢ لا &nbsp; ▢ نعم</span></div>`).join('')}</div>
      <label>تفاصيل</label>${lines(2)}
      <h2>اختبار الحساسية للصبغة</h2><div class="pp-2"><div><label>تاريخ الاختبار</label>${lines(1)}</div><div><label>النتيجة</label><div class="pp-opts"><span>▢ سليم</span><span>▢ ظهر تهيّج</span></div></div></div>
      <h2>تفضيلاتك</h2>${lines(2)}
      <h2>موافقاتك</h2><div class="pp-q">${['أوافق على تصوير النتيجة ونشرها بدون إظهار وجهي', 'أوافق على تصوير النتيجة ونشرها مع وجهي', 'أوافق إن بيوتفريش ترسل لي عروض ومناسبات على الواتساب'].map((x) => `<div><span>${x}</span><span class="pp-yn">▢ نعم &nbsp; ▢ لا</span></div>`).join('')}</div>
      <p class="pp-small">أقرّ إن المعلومات صحيحة، وأبلّغ الصالون بأي تغيير. بياناتك تُستخدم لخدمتك فقط وما تُشارك مع أحد.</p>
      <div class="pp-sign"><div><label>توقيع العميلة</label>${lines(1)}</div><div><label>التاريخ</label>${lines(1)}</div><div><label>الأخصائية</label>${lines(1)}</div></div></div>`;
    else if (k === 'steril') html = `<div class="pp land">${formHead(K, ft, 'الأسبوع: ____ / ____ / ________')}
      <table class="pp-t"><thead><tr><th>اليوم</th><th>تجهيز المحلول</th><th>دورة الجهاز ١</th><th>دورة الجهاز ٢</th><th>دورة الجهاز ٣</th><th>تعقيم آخر اليوم</th><th>الأدوات أحادية الاستعمال انرمت</th><th>التوقيع</th></tr></thead>
      <tbody>${['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map((d) => `<tr><td>${d}</td>${'<td></td>'.repeat(7)}</tr>`).join('')}</tbody></table>
      <p class="pp-small">كل دورة تُكتب بوقتها (مثلًا ١١:٢٠) وتوقّع عليها اللي شغّلتها. أي خلل في الجهاز يُبلّغ عنه من التطبيق فورًا.</p>
      <div class="pp-sign"><div><label>مراجعة المديرة</label>${lines(1)}</div><div><label>التاريخ</label>${lines(1)}</div></div></div>`;
    else if (k === 'counter') {
      const qa = K.booking && window.qrcode ? qrSVG(K.booking) : '', qb = K.review && window.qrcode ? qrSVG(K.review) : '';
      html = `<div class="pp tent"><div class="tent-in"><img class="tent-logo" src="../home/assets/Beautfresh-brown.svg" alt=""><span class="tent-tag">${esc(K.tagline || 'The Fresh Version of You')}</span>
        <div class="tent-q">${qa ? `<div>${qa}<b>احجزي موعدك الجاي</b></div>` : ''}${qb ? `<div>${qb}<b>قيّمي تجربتك</b><span>رأيك يفرق معنا 🤍</span></div>` : ''}</div>
        ${!qa && !qb ? '<p class="pp-small">أضيفوا رابط الحجز ورابط تقييم قوقل في بطاقة المنشأة عشان تطلع الباركودات.</p>' : ''}
        <span class="tent-ig">${K.instagram ? `@${esc(String(K.instagram).replace(/^@/, ''))}` : ''}</span></div></div>`;
    } else if (k === 'custody') html = `<div class="pp">${formHead(K, ft)}
      <div class="pp-2"><div><label>اسم الموظفة</label>${lines(1)}</div><div><label>تاريخ الاستلام</label>${lines(1)}</div></div>
      <table class="pp-t"><thead><tr><th>#</th><th>الأداة أو الجهاز</th><th>العدد</th><th>الحالة عند الاستلام</th><th>ملاحظات</th></tr></thead><tbody>${Array.from({ length: 10 }, (_, i) => `<tr><td>${AR_NUM(i + 1)}</td><td></td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>
      <p class="pp-small">أقرّ باستلام ما سبق بحالة سليمة، وأتعهد بالمحافظة عليه واستخدامه للعمل فقط، وتسليمه عند طلبه أو عند انتهاء العمل.</p>
      <div class="pp-sign"><div><label>توقيع الموظفة</label>${lines(1)}</div><div><label>توقيع الإدارة</label>${lines(1)}</div></div></div>`;
    else html = `<div class="pp">${formHead(K, ft)}
      <p class="pp-body">أنا الموظفة: ______________________ أعمل في ${esc(K.legal_name || K.brand || 'بيوتفريش')}، وأتعهد بالآتي:</p>
      <ol class="pp-ol">${['ما أصوّر أي عميلة أو جزء منها إلا بموافقتها، وبجوال الصالون فقط.', 'ما أنشر أي صورة أو معلومة عن عميلة في حساباتي الشخصية.', 'ما أشارك أرقام العميلات أو بياناتهن مع أي أحد داخل الصالون أو خارجه.', 'ما أتكلم عن عميلة قدام عميلة ثانية، ولا أنقل كلام دار في الصالون.', 'أحافظ على سرية أسعار الموردين وبيانات الصالون الداخلية.', 'يستمر هذا التعهد بعد انتهاء عملي في الصالون.'].map((x) => `<li>${x}</li>`).join('')}</ol>
      <p class="pp-small">أعرف إن مخالفة هذا التعهد تعرّضني للمساءلة حسب لائحة العمل والأنظمة.</p>
      <div class="pp-sign"><div><label>الاسم</label>${lines(1)}</div><div><label>التوقيع</label>${lines(1)}</div><div><label>التاريخ</label>${lines(1)}</div></div></div>`;
    paper(ft, `<div class="pp-wrap">${html}</div>`);
  }

  const genCode = () => 'BF-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const vState = (v) => (v.status === 'pending' ? ['pend', 'طلب جديد', 'warn'] : v.status === 'cancelled' ? ['can', 'ملغي', ''] : v.status === 'used' || v.redeemed_on ? ['used', 'استُخدمت', ''] : v.expires_on && until(v.expires_on) < 0 ? ['exp', 'انتهت', 'danger'] : ['ok', 'سارية', 'ok']);
  const giftLink = (v) => `https://beautfresh.com/gift/open/?t=${v.token}`;
  function voucherHTML(v, K) {
    return `<div class="voucher"><div class="vc-l"><img class="vc-logo" src="../home/assets/gift-logo.svg" alt="بيوتفريش للإهداء"><span class="vc-eb">قسيمة هدية</span><h2>${esc(v.value_text)}</h2>
      ${v.to_name ? `<span class="vc-to">إلى: <b>${esc(v.to_name)}</b></span>` : ''}${v.from_name ? `<span class="vc-to">من: <b>${esc(v.from_name)}</b></span>` : ''}${v.message ? `<p class="vc-msg">«${esc(v.message)}»</p>` : ''}
      <span class="vc-exp">${v.expires_on ? `صالحة لين ${D(v.expires_on).getDate()} ${MONTHS_AR[D(v.expires_on).getMonth()]} ${D(v.expires_on).getFullYear()}` : ''}</span></div>
      <div class="vc-r">${window.qrcode ? qrSVG(v.code, '#3F1D17') : ''}<b dir="ltr">${v.code}</b><span>${K.booking ? 'احجزي من الرابط بالبايو' : ''}</span></div><img class="vc-rose" src="../home/assets/rosette-2.svg" alt=""></div>`;
  }
  async function kitGifts(view, K, head, alive) {
    const rows = await q(sb.from('gift_vouchers').select('*').order('created_at', { ascending: false }).limit(300));
    if (!alive()) return;
    const live = rows.filter((v) => vState(v)[0] === 'ok');
    const out = live.filter((v) => v.paid).reduce((s, v) => s + Number(v.balance ?? v.amount ?? 0), 0);
    const pend = rows.filter((v) => v.status === 'pending');
    view.innerHTML = `${head}
      <div class="seg-tiles"><div class="seg-tile on"><b class="num">${live.length}</b><span>قسائم سارية</span></div><div class="seg-tile gold"><b class="num">${sar(out)}</b><span>قيمتها (التزام علينا)</span></div><div class="seg-tile ${pend.length ? 'warn' : ''}"><b class="num">${pend.length}</b><span>طلبات من الموقع</span></div><div class="seg-tile"><b class="num">${rows.filter((v) => vState(v)[0] === 'exp').length}</b><span>انتهت</span></div></div>
      <div class="cl-bar mt"><input class="input" id="gv-q" placeholder="ابحث برقم القسيمة أو الاسم" dir="auto"><button class="btn primary" id="gv-new">${I.plus} قسيمة</button></div>
      <div class="list" id="gv-l"></div>`;
    const draw = () => { const t = $('#gv-q').value.trim().toUpperCase(); const r = (t ? rows.filter((v) => v.code.includes(t) || (v.to_name || '').includes(t) || (v.from_name || '').includes(t)) : rows).slice().sort((a, b) => (b.status === 'pending') - (a.status === 'pending'));
      $('#gv-l').innerHTML = r.map((v) => { const [st, l, c] = vState(v); return `<button class="row" data-v="${v.id}"><span class="gv-ic">🎁</span><div class="grow"><div class="title">${esc(v.value_text)} ${v.to_name ? `<span class="muted small">· ${esc(v.to_name)}</span>` : ''}</div><div class="meta"><span dir="ltr">${v.code}</span> · ${dShort(v.issued_on)}${v.status === 'pending' ? ` · طلب #${v.id} من الموقع` : v.balance != null && v.amount != null && Number(v.balance) < Number(v.amount) ? ` · الرصيد ${sar(v.balance)}` : ''}${v.redeemed_on ? ` · استُخدمت ${dShort(v.redeemed_on)}` : ''}</div></div><span class="badge ${c}">${l}</span></button>`; }).join('') || '<div class="empty">قسيمة الهدية أحلى هدية تنعطى، وأحلى إعلان للصالون. سوّوا أول وحدة.</div>';
      $$('[data-v]', view).forEach((b) => b.onclick = () => voucherView(rows.find((x) => x.id === Number(b.dataset.v)), K)); };
    $('#gv-q').addEventListener('input', draw); draw();
    $('#gv-new').onclick = () => voucherForm(K);
  }
  function voucherForm(K) {
    const exp = dk(lensShift('m', D(todayR()), 6));
    modal(`<h3>قسيمة هدية</h3>
      <div class="chips wrap" style="margin-bottom:10px">${['مانيكير وبديكير', 'جلسة استشوار', 'باقة دلّعي نفسك', '٢٠٠ ريال', '٥٠٠ ريال'].map((x) => `<button type="button" class="chip" data-s="${x}">${x}</button>`).join('')}</div>
      <div class="grid2"><div class="field"><label>الهدية</label><input class="input" id="gf-v" maxlength="80" placeholder="مانيكير وبديكير"></div><div class="field"><label>قيمتها (ر.س)</label><input class="input num" type="number" min="0" id="gf-a"></div></div>
      <div class="grid2"><div class="field"><label>إلى</label><input class="input" id="gf-t" maxlength="60"></div><div class="field"><label>من</label><input class="input" id="gf-f" maxlength="60"></div></div>
      <div class="field"><label>جوالها (نرسل لها رابط البطاقة)</label><input class="input" id="gf-ph" inputmode="tel" dir="ltr" maxlength="14" placeholder="05xxxxxxxx"></div>
      <div class="field"><label>كلمة على القسيمة</label><input class="input" id="gf-m" maxlength="200" placeholder="كل عام وأنتِ بخير يا أحلى أخت"></div>
      <div class="grid2"><div class="field"><label>صالحة لين</label><input class="input" type="date" id="gf-e" value="${exp}"></div><label class="check" style="align-self:end;margin-bottom:14px"><input type="checkbox" id="gf-p" checked> مدفوعة</label></div>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="gf-s">إصدار</button></div>`, (el, close) => {
      $$('[data-s]', el).forEach((b) => b.onclick = () => { $('#gf-v', el).value = b.dataset.s; const n = b.dataset.s.match(/[٠-٩\d]+/); if (n) $('#gf-a', el).value = n[0].replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
      $('#gf-s', el).onclick = (e) => busy(e.currentTarget, async () => {
        const row = { code: genCode(), value_text: $('#gf-v', el).value.trim(), amount: $('#gf-a', el).value === '' ? null : Number($('#gf-a', el).value), to_name: $('#gf-t', el).value.trim() || null, from_name: $('#gf-f', el).value.trim() || null, message: $('#gf-m', el).value.trim() || null, expires_on: $('#gf-e', el).value || null, paid: $('#gf-p', el).checked };
        row.balance = row.amount; { const ph = $('#gf-ph', el).value.replace(/\D/g, ''); if (ph) { if (!/^05\d{8}$/.test(ph)) return toast('رقم الجوال غير صحيح', true); row.to_phone = ph; } }
        if (row.value_text.length < 2) return toast('اكتبوا الهدية', true);
        try { const v = await q(sb.from('gift_vouchers').insert(row).select('*').single()); close(); voucherView(v, K, true); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }
  function voucherView(v, K, fresh) {
    const [st] = vState(v);
    const link = giftLink(v);
    const text = `هلا ${v.to_name ? firstName(v.to_name) : ''} 🤍\nوصلتك هدية${v.from_name ? ` من ${v.from_name}` : ''} من بيوتفريش 🎁\nافتحيها من هنا:\n${link}`;
    const to = v.to_phone ? `https://wa.me/${waNum(v.to_phone)}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    paper('قسيمة هدية', `<div class="pp-wrap">${voucherHTML(v, K)}${v.status === 'pending' ? `<div class="notice warn" style="margin-top:14px">طلب من الموقع بانتظار الدفع${v.from_phone ? ` · جوال المرسلة <span dir="ltr">${esc(v.from_phone)}</span>` : ''}${v.deliver_on ? ` · توصيل يوم ${esc(v.deliver_on)}` : ''}. بعد ما يتأكد الدفع فعّلوها وأرسلوها.</div>` : ''}${v.balance != null && st === 'ok' ? `<div class="notice info" style="margin-top:14px">الرصيد الحالي ${sar(v.balance)} من ${sar(v.amount)}${v.opened_at ? ' · فتحت البطاقة ✓' : ''}</div>` : ''}</div>`, {
      extra: `${st === 'pend' ? '<button class="btn sm primary" data-act>تفعيل (تم الدفع)</button>' : `<a class="btn sm" target="_blank" rel="noopener" href="${to}">${I.wa} أرسليها لها</a><button class="btn sm" data-copy>نسخ الرابط</button><a class="btn sm" target="_blank" rel="noopener" href="${link}">معاينة</a>`}${st === 'ok' ? '<button class="btn sm" data-red>استخدام من الرصيد</button>' : ''}${isManager() ? '<button class="btn sm" data-del>حذف</button>' : ''}`,
      mount: (ov, close) => {
        if (fresh) toast('القسيمة جاهزة 🎁');
        $('[data-copy]', ov)?.addEventListener('click', () => copyTxt(link, 'رابط البطاقة'));
        $('[data-act]', ov)?.addEventListener('click', (e) => busy(e.currentTarget, async () => { try { const nv = await q(sb.rpc('gift_activate', { p_id: v.id })); toast('تفعّلت البطاقة 🎁'); close(); voucherView(nv, K); } catch (err) { toast(errMsg(err), true); } }));
        $('[data-red]', ov)?.addEventListener('click', () => {
          const bal = v.balance != null ? Number(v.balance) : null;
          modal(`<h3>استخدام من البطاقة</h3><p class="muted small" style="margin-top:-4px">${bal != null ? `الرصيد ${sar(bal)} ر.س` : 'قسيمة خدمة (بدون رصيد)'}</p>${bal != null ? `<div class="field"><label>قيمة الخدمة اللي انقدمت (ر.س)</label><input class="input num" id="rd-a" type="number" min="1" max="${bal}" value="${bal}"></div>` : ''}<div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="rd-s">تسجيل</button></div>`, (el, c2) => {
            $('#rd-s', el).onclick = (ev) => busy(ev.currentTarget, async () => {
              const a = bal != null ? Number($('#rd-a', el).value) : null;
              if (bal != null && !(a > 0 && a <= bal)) return toast('المبلغ لازم يكون أقل من الرصيد أو يساويه', true);
              try { const nv = await q(sb.rpc('gift_redeem', { p_id: v.id, p_amount: a })); toast(nv.status === 'used' ? 'خلص رصيد البطاقة' : `تم، باقي ${sar(nv.balance)} ر.س`); c2(); close(); route(); } catch (err) { toast(errMsg(err), true); }
            });
          });
        });
        $('[data-del]', ov)?.addEventListener('click', async () => { try { await q(sb.from('gift_vouchers').delete().eq('id', v.id)); close(); route(); } catch (err) { toast(errMsg(err), true); } });
        $('[data-x]', ov).addEventListener('click', () => { if (fresh) route(); });
      },
    });
  }


  /* ======================= تصدير البيانات ======================= */
  let xlsxReady = null;
  const loadXLSX = () => xlsxReady || (xlsxReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = '../vendor/xlsx.mini.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
  function exportForm() {
    const tk = todayR(), y = D(tk).getFullYear();
    const P = [['m', 'هذا الشهر', monthKey(D(tk)), tk], ['pm', 'الشهر الماضي', monthKey(lensShift('m', D(tk), -1)), dk(new Date(D(tk).getFullYear(), D(tk).getMonth(), 0, 12))], ['y', `سنة ${y}`, `${y}-01-01`, tk], ['all', 'كل البيانات', '2000-01-01', '2100-01-01']];
    let sel = 'm';
    modal(`<h3>تصدير البيانات</h3><p class="muted" style="margin-top:-6px">ملف Excel واحد، كل قسم في ورقة، جاهز للمحاسب أو للأرشيف.</p>
      <div class="field"><label>الفترة</label><div class="chips wrap" id="ex-p">${P.map(([k, l]) => `<button type="button" class="chip ${k === sel ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <p class="muted small">يشمل: الإقفال اليومي، المصروفات، الحجوزات المنزلية، العميلات وزياراتهن، فواتير الشراء، حركات المخزون، الأصناف، قسائم الهدايا.</p>
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="ex-go">تنزيل الملف</button></div>`, (el, close) => {
      $$('#ex-p .chip', el).forEach((b) => b.onclick = () => { sel = b.dataset.k; $$('#ex-p .chip', el).forEach((x) => x.classList.toggle('on', x === b)); });
      $('#ex-go', el).onclick = (e) => busy(e.currentTarget, async () => {
        const [, label, from, to] = P.find((x) => x[0] === sel);
        try {
          await loadXLSX();
          const rng = (qy, col) => qy.gte(col, from).lte(col, to);
          const tsTo = to + 'T23:59:59+03:00', tsFrom = from + 'T00:00:00+03:00';
          const [daily, exps, bks, cls, vis, invs, moves, gifts] = await Promise.all([
            q(rng(sb.from('fin_daily').select('*'), 'day').order('day')),
            q(rng(sb.from('fin_expenses').select('*'), 'day').order('day')),
            q(sb.from('home_bookings').select('code,customer_name,phone,district_name,starts_at,status,payment_status,total').gte('starts_at', tsFrom).lte('starts_at', tsTo).order('starts_at')),
            q(sb.from('clients_overview').select('name,phone,birthday,source,segment,visits,spend,first_visit,last_visit,stamps').limit(10000)),
            q(rng(sb.from('client_visits').select('day,channel,services,amount,clients(name,phone)'), 'day').order('day').limit(20000)),
            q(rng(sb.from('purchase_invoices').select('*'), 'invoice_date').order('invoice_date')).catch(() => []),
            q(sb.from('stock_movements').select('item_id,movement_type,qty,reason,created_at').gte('created_at', tsFrom).lte('created_at', tsTo).order('created_at').limit(20000)).catch(() => []),
            q(sb.from('gift_vouchers').select('code,value_text,amount,to_name,from_name,issued_on,expires_on,redeemed_on,paid')).catch(() => []),
          ]);
          const itemName = (id) => S.items.find((i) => i.id === id)?.name || id;
          const sheets = [
            ['الإقفال اليومي', daily.map((d) => ({ 'اليوم': d.day, 'كاش': +d.cash, 'شبكة': +d.card, 'تحويل': +d.transfer, 'رابط دفع': +d.online, 'تابي وتمارا': +d.bnpl, 'أخرى': +d.other, 'الإجمالي': +d.total, 'عدد العميلات': d.clients, 'أظافر': d.nails, 'شعر': d.hair, 'مكياج': d.makeup, 'رموش وحواجب': d.lashes, 'منتجات': d.products, 'ملاحظة': d.note }))],
            ['المصروفات', exps.map((x) => ({ 'اليوم': x.day, 'التصنيف': EXP_CAT[x.category] || x.category, 'المبلغ': +x.amount, 'الجهة': x.vendor, 'طريقة الدفع': x.method, 'ملاحظة': x.note }))],
            ['الحجوزات المنزلية', bks.map((b) => ({ 'الرقم': b.code, 'العميلة': b.customer_name, 'الجوال': b.phone, 'الحي': b.district_name, 'الموعد': new Date(b.starts_at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }), 'الحالة': BK_STATUS[b.status], 'الدفع': b.payment_status === 'paid' ? 'مدفوع' : b.payment_status === 'refunded' ? 'مسترجع' : 'غير مدفوع', 'الإجمالي': b.total != null ? +b.total : null }))],
            ['العميلات', cls.map((c) => ({ 'الاسم': c.name, 'الجوال': c.phone, 'الميلاد': c.birthday, 'عرفتنا من': SRC[c.source], 'الشريحة': SEG[c.segment]?.[0], 'الزيارات': c.visits, 'الصرف': +c.spend, 'أول زيارة': c.first_visit, 'آخر زيارة': c.last_visit, 'الأختام': c.stamps }))],
            ['الزيارات', vis.map((v) => ({ 'اليوم': v.day, 'العميلة': v.clients?.name, 'الجوال': v.clients?.phone, 'المكان': v.channel === 'home' ? 'هوم' : 'الصالون', 'الخدمات': v.services, 'المبلغ': v.amount != null ? +v.amount : null }))],
            ['فواتير الشراء', invs.map((i) => ({ 'رقم الفاتورة': i.invoice_no || i.id, 'التاريخ': i.invoice_date, 'المورد': supName(i.supplier_id), 'الإجمالي': i.total_amount != null ? +i.total_amount : null, 'الحالة': i.status === 'approved' ? 'معتمدة' : 'مسودة' }))],
            ['حركات المخزون', moves.map((m) => ({ 'الوقت': new Date(m.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }), 'الصنف': itemName(m.item_id), 'النوع': m.movement_type, 'الكمية': +m.qty, 'السبب': m.reason }))],
            ['الأصناف', S.items.map((i) => ({ 'الصنف': i.name, 'الوحدة': i.unit, 'الرصيد': +i.qty_on_hand, 'الحد الأدنى': +i.min_qty, 'نشط': i.is_active ? 'نعم' : 'لا' }))],
            ['قسائم الهدايا', gifts.map((g) => ({ 'الرقم': g.code, 'الهدية': g.value_text, 'القيمة': g.amount != null ? +g.amount : null, 'إلى': g.to_name, 'من': g.from_name, 'الإصدار': g.issued_on, 'الانتهاء': g.expires_on, 'استُخدمت': g.redeemed_on, 'مدفوعة': g.paid ? 'نعم' : 'لا' }))],
          ];
          const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
          sheets.forEach(([n, rows]) => { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'ما فيه بيانات في هالفترة' }]); const keys = Object.keys(rows[0] || { '': '' }); ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 4, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 2))) })); XLSX.utils.book_append_sheet(wb, ws, n); });
          XLSX.writeFile(wb, `بيوتفريش - ${label} - ${tk}.xlsx`);
          toast('نزل الملف'); close();
        } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  /* ======================= تقرير الشهر ======================= */
  async function monthReport(mStart) {
    const s0 = D(mStart), e0 = new Date(s0.getFullYear(), s0.getMonth() + 1, 0, 12);
    const from = dk(s0), to = dk(e0);
    const [r, tgt, vis, newC, fb, cmps, K] = await Promise.all([
      q(sb.rpc('fin_range', { p_from: from, p_to: to })),
      q(sb.from('fin_targets').select('revenue').eq('month', from).maybeSingle()).catch(() => null),
      q(sb.from('client_visits').select('client_id,amount,clients(name)').gte('day', from).lte('day', to).limit(20000)).catch(() => []),
      sb.from('clients').select('id', { count: 'exact', head: true }).gte('created_at', from + 'T00:00:00+03:00').lte('created_at', to + 'T23:59:59+03:00').then((x) => x.count || 0, () => 0),
      q(sb.from('client_feedback').select('kind,rating,status').gte('day', from).lte('day', to)).catch(() => []),
      q(sb.from('mkt_campaigns').select('*').lte('starts_on', to).or(`ends_on.gte.${from},ends_on.is.null`)).catch(() => []),
      kitProfile().catch(() => ({})),
    ]);
    const mName = `${MONTHS_AR[s0.getMonth()]} ${s0.getFullYear()}`;
    const delta = r.prev_revenue > 0 ? Math.round(((r.revenue - r.prev_revenue) / r.prev_revenue) * 100) : null;
    const margin = r.revenue ? Math.round((r.net / r.revenue) * 100) : 0;
    const top = Object.values(vis.reduce((a, v) => { const k = v.client_id; a[k] = a[k] || { name: v.clients?.name || '—', n: 0, s: 0 }; a[k].n++; a[k].s += Number(v.amount || 0); return a; }, {})).sort((a, b) => b.s - a.s).slice(0, 5);
    const rated = fb.filter((f) => f.rating); const avgR = rated.length ? (rated.reduce((a, f) => a + f.rating, 0) / rated.length).toFixed(1) : null;
    const maxD = Math.max(1, ...r.days.map((d) => Number(d.salon) + Number(d.home)));
    const W = 680, H = 150, bw = W / r.days.length;
    const chart = `<svg viewBox="0 0 ${W} ${H + 18}" class="rp-chart">${r.days.map((d, i) => { const hs = (Number(d.salon) / maxD) * H, hh = (Number(d.home) / maxD) * H; const x = W - (i + 1) * bw + bw * 0.18; return `<rect x="${x}" y="${H - hs - hh}" width="${bw * 0.64}" height="${hh}" fill="#B88A68" rx="1.5"/><rect x="${x}" y="${H - hs}" width="${bw * 0.64}" height="${hs}" fill="#5A2A22" rx="1.5"/>${(i + 1) % 5 === 0 || i === 0 ? `<text x="${x + bw * 0.32}" y="${H + 14}" font-size="9" text-anchor="middle" fill="#7A5D51">${i + 1}</text>` : ''}`; }).join('')}<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#DCCFBD"/></svg>`;
    const kv = (rows) => `<table class="rp-kv">${rows.filter(Boolean).map(([k, v]) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('')}</table>`;
    const pm = PAY_KEYS.map(([k, l]) => [l, Number(r.methods[k] || 0)]).filter((x) => x[1] > 0);
    const ex = Object.entries(r.exp_cats).map(([k, v]) => [EXP_CAT[k] || k, Number(v)]).sort((a, b) => b[1] - a[1]);
    const html = `<div class="pp-wrap"><div class="pp rp">
      <section class="rp-cover"><img src="../home/assets/Beautfresh-brown.svg" alt=""><span class="rp-eb">تقرير الشهر</span><h1>${mName}</h1><p>${esc(K.legal_name || 'بيوتفريش')}</p><img class="rp-rose" src="../home/assets/rosette-3.svg" alt=""></section>
      <section class="rp-hero"><div><span>صافي الربح</span><b class="num">${sar(r.net)} <small>ر.س</small></b><em>هامش ${margin}٪</em></div><div><span>المبيعات</span><b class="num">${sar(r.revenue)}</b>${delta != null ? `<em>${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}٪ عن الشهر الماضي</em>` : ''}</div>${tgt ? `<div><span>الهدف</span><b class="num">${sar(tgt.revenue)}</b><em>تحقق ${Math.round((r.revenue / tgt.revenue) * 100)}٪</em></div>` : ''}</section>
      <h2>المبيعات يومًا بيوم</h2>${chart}<p class="pp-small"><span style="color:#5A2A22">■</span> الصالون ${sar(r.salon)} ر.س &nbsp; <span style="color:#B88A68">■</span> الخدمات المنزلية ${sar(r.home)} ر.س &nbsp;·&nbsp; ${r.closed_days ?? 0} يوم مقفل</p>
      <div class="rp-2"><div><h2>الأرقام</h2>${kv([['المبيعات', sar(r.revenue)], ['المشتريات (فواتير معتمدة)', sar(r.purchases)], ['المصروفات', sar(r.expenses)], ['صافي الربح', `<b>${sar(r.net)}</b>`], r.methods.clients && ['متوسط الفاتورة', sar(r.salon / r.methods.clients)], r.closed_days && ['متوسط اليوم', sar(r.salon / r.closed_days)]])}</div>
        <div><h2>طرق الدفع</h2>${pm.length ? kv(pm.map(([l, v]) => [l, `${sar(v)} <small>(${Math.round((v / (r.salon || 1)) * 100)}٪)</small>`])) : '<p class="pp-small">ما فيه إقفالات</p>'}</div></div>
      <div class="rp-2"><div><h2>المصروفات</h2>${ex.length ? kv(ex.map(([l, v]) => [l, sar(v)])) : '<p class="pp-small">ما فيه مصروفات مسجلة</p>'}</div>
        <div><h2>العميلات</h2>${kv([['عميلات جدد', newC], ['زيارات مسجلة', vis.length], ['مديح', fb.filter((f) => f.kind === 'praise').length], ['شكاوى', `${fb.filter((f) => f.kind === 'complaint').length}${fb.some((f) => f.kind === 'complaint' && f.status === 'open') ? ' (فيه مفتوحة)' : ''}`], avgR && ['متوسط التقييم', `${avgR} / ٥`]])}
          ${top.length ? `<h3>أعلى العميلات صرفًا</h3><ol class="rp-top">${top.map((t) => `<li><span>${esc(t.name)}</span><span class="num">${sar(t.s)} ر.س · ${t.n} زيارة</span></li>`).join('')}</ol>` : ''}</div></div>
      ${cmps.length ? `<h2>الحملات</h2><table class="pp-t"><thead><tr><th>الحملة</th><th>الصرف</th><th>عميلات جدد</th><th>المبيعات</th><th>العائد</th></tr></thead><tbody>${cmps.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.spent != null ? sar(c.spent) : '—'}</td><td class="num">${c.new_clients ?? '—'}</td><td class="num">${c.revenue != null ? sar(c.revenue) : '—'}</td><td class="num">${c.spent > 0 && c.revenue != null ? (c.revenue / c.spent).toFixed(1) + '×' : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
      <h2>ملاحظات وقرارات الشهر الجاي</h2><div class="rp-notes" contenteditable="true">اكتبوا هنا قبل الطباعة…</div>
      <div class="pp-sign"><div><label>اعتماد الإدارة</label><div class="pp-line"></div></div><div><label>التاريخ</label><div class="pp-line"></div></div></div>
      <p class="pp-small" style="text-align:center;margin-top:28px">صدر من نظام بيوتفريش · مبيعات الصالون من ركاز تلقائيًا والحجوزات المنزلية المدفوعة، والمشتريات من فواتير الشراء المعتمدة.</p>
    </div></div>`;
    paper(`تقرير ${mName}`, html, { mount: (ov) => { const n = $('.rp-notes', ov); n.addEventListener('focus', () => { if (n.textContent.startsWith('اكتبوا هنا')) n.textContent = ''; }, { once: true }); } });
  }
  /* ======================= جولة المميزات ======================= */
  const TOUR = [
    { ch: 'البداية', cover: true },
    { ch: 'اليوم', img: 'home', go: '#/home', eb: 'الرئيسية', t: 'لوحة الصباح', d: 'أول شاشة تفتحونها كل يوم. تختصر لكم وضع الصالون في نظرة وحدة، وتقول وش يحتاج انتباهكم.', b: ['عدسة اليوم والأسبوع والشهر: المبيعات وصافي الربح ودائرة هدف الشهر', '«يحتاج انتباهك»: يوم ما انقفل، شكوى مفتوحة، عيد ميلاد، عطل، وثيقة تقرب تنتهي', '«ورديتي» لكل موظفة: دوامها اليوم وقوائمها وحجوزاتها والأدلة اللي تنتظر توقيعها'] },
    { ch: 'اليوم', img: 'quick', go: '#/home', eb: 'الإجراء السريع', t: 'زر «+» في كل مكان', d: 'الزر اللي بالنص في الجوال يفتح أكثر الأشياء اللي تنسوى كل يوم، بضغطتين.', b: ['ختم زيارة عميلة، صرف من المخزون، فاتورة شراء', 'إقفال اليوم ومصروف (للإدارة)', 'بلّغ عن عطل، رأي عميلة، طلب إجازة', 'كل واحد يشوف بس اللي يخصه حسب صلاحيته'] },
    { ch: 'اليوم', img: 'booking', go: '#/bookings', eb: 'الحجوزات المنزلية', t: 'الصالون يوصل لين بابها', d: 'موقع حجز خاص بالخدمات المنزلية بهوية بيوتفريش، والحجوزات توصل للوحة مباشرة.', b: ['العميلة تحجز بأربع خطوات: الخدمة، الحي، الوقت، بياناتها', 'الأوقات المتاحة تنحسب لحالها حسب عدد الفرق ووقت التنقل والإجازات', 'تأكيد الحجز وتعيين الأخصائية وتسجيل الدفع ورسائل واتساب جاهزة', 'إشعار فوري على جوالاتكم مع كل حجز جديد'] },
    { ch: 'المال', img: 'finance', go: '#/finance', eb: 'المالية', t: 'أرقام الصالون بوضوح', d: 'تعرفون كم دخل، وكم صرفتوا، وكم صافي الربح، بأي فترة تبونها.', b: ['إقفال يومي حسب طريقة الدفع والأقسام، ويطابق التفصيل مع الإجمالي', 'المصروفات بـ ١٣ تصنيف تناسب الصالون', 'عدسة يوم وأسبوع وشهر وربع وسنة، ومقارنة بالفترة اللي قبلها', 'هدف شهري يقول لكم كم باقي باليوم عشان توصلون'] },
    { ch: 'المال', img: 'report', go: '#/finance?l=m', eb: 'تقرير الشهر', t: 'تقرير جاهز للطباعة', d: 'آخر كل شهر بضغطة وحدة: تقرير بهوية الصالون، يطبع أو ينحفظ PDF.', b: ['صافي الربح والهامش والهدف ومقارنة بالشهر الماضي', 'رسم المبيعات يوم بيوم، وطرق الدفع والمصروفات', 'أعلى العميلات صرفًا، والآراء والحملات', 'خانة لقرارات الشهر الجاي واعتماد الإدارة'] },
    { ch: 'العميلات', img: 'clients', go: '#/clients', eb: 'دفتر العميلات', t: 'كل عميلة، بملفها', d: 'ملف لكل عميلة، وتنقسم لحالها حسب زياراتها عشان تعرفون مين تحتاج اهتمام.', b: ['دائمة، VIP، جديدة، و«غابوا عنّا» اللي ما جوا من ٤٥ يوم', 'أعياد الميلاد هالشهر، واللي وصلوا لمكافأة الولاء', 'كل حجز منزلي يكتمل ينضاف لملفها تلقائيًا'] },
    { ch: 'العميلات', img: 'client', go: '#/clients', eb: 'ملف العميلة', t: 'تعرفونها قبل ما تتكلم', d: 'زياراتها وصرفها وتفضيلاتها وإيقاع زيارتها، وبطاقة ولاء بأختام بنقشة بيوتفريش.', b: ['تفضيلاتها: لونها، شكل الأظافر، أي حساسية', 'النظام يحسب كل كم يوم تزوركم، ويقول متى زيارتها الجاية أو كم تأخرت', 'بطاقة ولاء: كل زيارة ختم، ومكافأتها لما تكتمل', 'خمس رسائل واتساب جاهزة باسمها'] },
    { ch: 'العميلات', img: 'card', go: '#/clients', eb: 'بطاقتها الرقمية', t: 'بطاقة الولاء في جوالها', d: 'لكل عميلة رابط خاص تشوف فيه أختامها وكم باقي لمكافأتها وآخر زياراتها، وتحجز منه.', b: ['ترسلونه من ملفها بضغطة «رابط بطاقتها»', 'الرابط خاص فيها، ما ينخمّن، ويعرض اسمها الأول بس'] },
    { ch: 'العميلات', img: 'feedback', go: '#/feedback', eb: 'الآراء والملاحظات', t: 'نسمعها، ونحلّها', d: 'كل مديح وشكوى واقتراح، من الصالون أو الواتساب أو قوقل، في مكان واحد.', b: ['تقييم بالنجوم، ومتوسط تقييم الصالون', 'الشكوى تبقى مفتوحة لين تسجّلون كيف انحلت', 'الشكاوى المفتوحة تطلع في الرئيسية لين تنحل'] },
    { ch: 'النمو', img: 'marketing', go: '#/marketing', eb: 'التسويق', t: 'تقويم مواسم الصالون', d: 'عشرة مواسم جاهزة بأفكارها، والنظام ينبهكم لما تدخلون وقت التجهيز.', b: ['الجمعة البيضاء، رمضان، ليالي العيد، التخرج، الأعراس، اليوم الوطني…', 'عدّاد للموسم الجاي، وتنبيه «دخلتوا وقت التجهيز»', 'زر يفتح حملة مربوطة بالموسم مباشرة'] },
    { ch: 'النمو', img: 'content', go: '#/marketing?t=content', eb: 'المحتوى والحملات', t: 'خطة نشر، وحملات بأرقامها', d: 'لوحة محتوى بمراحل، وحملات تعرفون منها وش يرجع لكم فعلًا.', b: ['أسبوع النشر، ولوحة: فكرة ← تصوير ← جاهز ← منشور', 'زر «ما عندي فكرة» بأفكار مخصصة للصالون', 'كل حملة: الميزانية والصرف والعميلات الجدد والمبيعات والعائد على كل ريال'] },
    { ch: 'الفريق', img: 'team', go: '#/team', eb: 'الفريق', t: 'مين موجود اليوم؟', d: 'مخطط زمني ملوّن لدوام اليوم، وخط يوضح الساعة الحين، وملف لكل موظفة.', b: ['ملف الموظفة: تخصصها ومهاراتها ودوامها وإجازاتها', 'تنبيه قبل انتهاء الإقامة والشهادة الصحية والعقد', 'الأرقام الحساسة للإدارة بس، وتواريخ الانتهاء بدون أرقام الهويات'] },
    { ch: 'الفريق', img: 'shifts', go: '#/team?t=shifts', eb: 'المناوبات والإجازات والرواتب', t: 'جدول الأسبوع بضغطة', d: 'مناوبات تتكرر كل أسبوع، وإجازات بطلب واعتماد، ورواتب وعمولات تنحسب لحالها.', b: ['صباحي، مسائي، كامل، أو وقت تحددونه، وعدد الفريق بكل يوم', 'الموظفة تطلب إجازة، والإدارة يوصلها إشعار وتعتمد', 'العمولة من مبيعات كل موظفة، وتنسجل في المصروفات بضغطة'] },
    { ch: 'التشغيل', img: 'ops', go: '#/ops', eb: 'التشغيل', t: 'قوائم الفتح والإقفال', d: 'الصالون يفتح ويقفل بنفس المستوى مهما تغيّرت الموظفة.', b: ['كل بند ينحفظ باسم اللي سوّته ووقتها', 'البنود الأساسية مميزة: التعقيم، الكاش، الأجهزة', '«هل يُطبَّق؟»: النظام يختار ٣ بنود عشوائية تتأكدون منها بعينكم، ويحسب «صدق التأشير»'] },
    { ch: 'التشغيل', img: 'svc', go: '#/ops?t=services', eb: 'بطاقات الخدمات', t: 'كل خدمة، بخطواتها وربحها', d: 'مرجع للأخصائيات، وحساب دقيق لتكلفة كل خدمة من المخزون.', b: ['خطوات مرقمة ونصيحة لكل خدمة', 'المنتجات المستخدمة وكمياتها، وتكلفتها من أسعار الشراء', 'ترتيب «كم تربح كل خدمة بالساعة»، وتنبيه للخدمة اللي سعرها يحتاج مراجعة'] },
    { ch: 'التشغيل', img: 'guide', go: '#/ops?t=manual', eb: 'أدلة بيوتفريش', t: 'كتيّبات الصالون', d: 'أربعة أدلة مكتوبة بهوية الصالون: التعقيم، السلامة، تجربة العميلة، يوم العروس.', b: ['غلاف وفهرس وفصول وجداول وتنبيهات، تطبع أو تنحفظ PDF', 'كل موظفة توقّع إنها قرأت الدليل', 'أي تعديل يرفع الإصدار ويطلب توقيع جديد'] },
    { ch: 'الجودة', img: 'rules', go: '#/rules', eb: 'قواعد بيوتفريش', t: 'صحة الصالون بنسبة', d: '٤٦ قاعدة مكتوبة لصالون نسائي في السعودية، تنفحص لحالها على بيانات الصالون.', b: ['كل قاعدة: خطر، أو تحتاجكم، أو سليم، ومعها «لماذا؟» وأساسها', 'زر «صلّحها» يوديكم للمكان اللي تصلحونها منه', '«لي رأي آخر» للقاعدة اللي ما تناسبكم، ومكتبة تختارون منها'] },
    { ch: 'الجودة', img: 'assets', go: '#/assets', eb: 'الأصول والصيانة', t: 'كل جهاز، بقيمته وصيانته', d: 'سجل لأجهزة الصالون وكراسيه ومكيفاته، وجدول صيانة يتكوّن لحاله.', b: ['قيمة الأصول اليوم بعد الاستهلاك، وتنبيه انتهاء الضمان', 'صيانة وقائية بمواعيد، وزر «تمّت اليوم»', 'أي موظفة تبلّغ عن عطل، وتكلفة الإصلاح تروح للمصروفات', 'الاشتراكات: كم تدفعون بالشهر، واللي يحتاج مراجعة'] },
    { ch: 'الجودة', img: 'items', go: '#/items', eb: 'المخزون', t: 'ما ينقص شي على العميلة', d: 'الأصناف والصرف وفواتير الشراء، والنظام يقول لكم وش تشترون.', b: ['صرف من المخزون من الجوال بثواني', 'فواتير شراء باعتماد، وتكلفة كل صنف', 'قائمة مشتريات تلقائية للناقص، وتنبيه قبل انتهاء الصلاحية', 'تقارير الاستهلاك والمشتريات'] },
    { ch: 'العُدّة', img: 'kit', go: '#/kit', eb: 'عُدّة بيوتفريش', t: 'كل ما تحتاجونه، في مكان واحد', d: 'بيانات المنشأة ورسائل ونماذج، تتعبّى لحالها ببيانات الصالون.', b: ['بطاقة المنشأة بأزرار نسخ، وباركود للحجز والتقييم والموقع', '١٦ رسالة جاهزة تتعبّى باسم العميلة وتنرسل بواتساب', 'نماذج للطباعة: استمارة العميلة، سجل التعقيم، بطاقة الاستقبال، العهدة، الخصوصية'] },
    { ch: 'العُدّة', img: 'voucher', go: '#/kit?t=gifts', eb: 'قسائم الهدايا', t: 'هدية باسمها', d: 'قسيمة فاخرة برقم خاص وباركود، تنطبع أو تنرسل، والاستقبال يسجّل استخدامها.', b: ['القيمة أو الخدمة، ومن مين لمين، وكلمة، وتاريخ انتهاء', 'كم قسيمة سارية وقيمتها، واللي استُخدمت', 'ومن الموقع: صفحة «أهديها بيوتفريش» للعميلات'] },
    { ch: 'العُدّة', img: 'gift', go: null, href: '../gift/', eb: 'الموقع العام', t: 'أهديها بيوتفريش', d: 'الخدمة الثالثة في الموقع: العميلة تصمم القسيمة وتشوفها تتغير قدامها وهي تكتب.', b: ['القيمة والمناسبة وتصميم القسيمة: عودي أو ذهبي أو رملي', 'اسمها وجوالها وكلمة الإهداء ووقت التوصيل', 'الدفع الإلكتروني «قريبًا»، ولين يتفعّل الطلب يوصلكم على واتساب'] },
    { ch: 'الختام', silent: true },
    { ch: 'الختام', end: true },
  ];
  const SILENT = [['🔔', 'إشعارات فورية', 'حجز جديد، عطل، طلب إجازة، توصل لجوالاتكم'], ['☀️', 'صباح بيوتفريش', '٩:١٥ الصبح: الميلاد والشكاوى والأعطال والوثائق وحجوزات اليوم'], ['🌙', 'تذكير الإقفال', '٩:٤٥ الليل إذا اليوم ما انقفل'], ['📈', 'أسبوع بيوتفريش', 'كل سبت: المبيعات ومقارنتها وأفضل يوم والعميلات الجدد'], ['📊', 'تصدير Excel', 'كل البيانات بملف واحد للمحاسب أو الأرشيف'], ['🔐', 'صلاحيات وأمان', 'الموظفة تشوف شغلها، والمالية والرواتب للإدارة بس'], ['📱', 'تطبيق على الجوال', 'يتثبت على الشاشة الرئيسية ويفتح بسرعة'], ['🖨️', 'كل شي يطبع', 'التقارير والأدلة والنماذج والقسائم بهوية الصالون']];
  const START = [['#/kit', 'عبّوا بطاقة المنشأة', 'الروابط وأوقات الدوام، عشان تتعبّى الرسائل والنماذج'], ['#/team', 'أضيفوا الفريق ورتبوا المناوبات', 'واربطوا حساب كل موظفة بملفها'], ['#/rules?t=docs', 'سجّلوا تواريخ التراخيص', 'وجاوبوا على أسئلة القواعد الخمسة'], ['#/ops?t=services', 'أضيفوا خدمات الصالون', 'بأسعارها ومنتجاتها'], ['#/finance', 'حطّوا هدف الشهر', 'وابدؤوا الإقفال اليومي من الليلة'], ['#/clients', 'غيّروا مكافأة الولاء', 'لشي محدد مثل «مانيكير هدية»']];

  function pageNaqla(view) {
    view.innerHTML = `<div class="naqla"><iframe src="naqla/index.html?v=2" title="نقلة بيوتفريش" allow="fullscreen"></iframe><a class="nq-x" href="#/home" aria-label="إغلاق">×</a></div>`;
  }

  function pageTour(view) {
    let i = 0;
    const real = TOUR.filter((s) => s.img).length;
    view.innerHTML = `<div class="tour" tabindex="-1">
      <div class="tr-bg"></div>
      <header class="tr-top"><img src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><div class="tr-ch" id="tr-ch"></div><a class="tr-x" href="#/home" aria-label="إغلاق">×</a></header>
      <main class="tr-stage" id="tr-stage"></main>
      <footer class="tr-foot"><div class="tr-prog" id="tr-prog">${TOUR.map((_, k) => `<i data-k="${k}"></i>`).join('')}</div>
        <div class="tr-nav"><button class="tr-btn" id="tr-prev" aria-label="السابق">→</button><span class="tr-n num" id="tr-n"></span><button class="tr-btn pri" id="tr-next">التالي ←</button></div></footer>
    </div>`;
    const stage = $('#tr-stage', view), root = $('.tour', view);
    const chs = [...new Set(TOUR.map((s) => s.ch))];
    const slideHTML = (s, k) => {
      if (s.cover) return `<div class="tr-cover"><img class="tr-logo" src="../home/assets/Beautfresh-brown.svg" alt=""><span class="tr-eb">جولة في نظام بيوتفريش</span><h1>كل الصالون،<br>في مكان واحد.</h1><p>${real} ميزة صُممت لصالون نسائي سعودي: من الحجز والعميلات، إلى المال والفريق والتشغيل والجودة. خذوا خمس دقايق وتعرفوا عليها وحدة وحدة.</p><button class="tr-go" data-next>ابدؤوا الجولة ←</button><div class="tr-roses">${[1, 2, 3, 4].map((r) => `<img src="../home/assets/rosette-${r}.svg" alt="">`).join('')}</div></div>`;
      if (s.silent) return `<div class="tr-text wide"><span class="tr-eb">يشتغل بصمت</span><h2>أشياء تصير لحالها</h2><p class="tr-d">ما تحتاج منكم شي، بس تعرفون إنها موجودة.</p><div class="tr-grid">${SILENT.map(([e, t, d], j) => `<div class="tr-cell" style="--d:${j * 60}ms"><span>${e}</span><b>${t}</b><small>${d}</small></div>`).join('')}</div></div>`;
      if (s.end) return `<div class="tr-text wide"><span class="tr-eb">ابدؤوا من هنا</span><h2>ست خطوات، ويصير النظام نظامكم</h2><p class="tr-d">كل خطوة تفتح المكان اللي تسوونها فيه.</p><div class="tr-start">${START.map(([h, t, d], j) => `<a href="${h}" style="--d:${j * 70}ms"><span class="num">${AR_NUM(j + 1)}</span><div><b>${t}</b><small>${d}</small></div><i>←</i></a>`).join('')}</div><a class="tr-go" href="#/home" style="margin-top:22px">يلا نبدأ 🤍</a></div>`;
      return `<div class="tr-slide"><div class="tr-text"><span class="tr-eb">${s.eb}</span><h2>${s.t}</h2><p class="tr-d">${s.d}</p><ul>${s.b.map((x, j) => `<li style="--d:${150 + j * 80}ms">${x}</li>`).join('')}</ul>
        ${s.go ? `<a class="tr-open" href="${s.go}">افتحوا القسم ←</a>` : s.href ? `<a class="tr-open" href="${s.href}" target="_blank" rel="noopener">افتحوا الصفحة ↗</a>` : ''}</div>
        <div class="tr-phone"><div class="tr-screen"><div class="tr-sb"><b class="num">9:41</b><span class="tr-isl"></span><span class="tr-ics"><i></i><i></i><i></i></span></div><img src="assets/tour/${s.img}.webp" alt="${esc(s.t)}" loading="eager"></div></div></div>`;
    };
    const show = (k, dir = 1) => {
      i = Math.max(0, Math.min(TOUR.length - 1, k));
      const s = TOUR[i];
      stage.innerHTML = `<div class="tr-wrap ${dir > 0 ? 'fwd' : 'back'}">${slideHTML(s, i)}</div>`;
      $('#tr-ch', view).innerHTML = chs.map((c) => `<button class="${c === s.ch ? 'on' : ''}" data-ch="${c}">${c}</button>`).join('');
      $$('#tr-prog i', view).forEach((e, k2) => { e.className = k2 < i ? 'done' : k2 === i ? 'on' : ''; });
      $('#tr-n', view).textContent = `${AR_NUM(i + 1)} / ${AR_NUM(TOUR.length)}`;
      $('#tr-prev', view).disabled = i === 0;
      $('#tr-next', view).style.visibility = i === TOUR.length - 1 ? 'hidden' : '';
      root.classList.toggle('is-cover', !!s.cover);
      $$('[data-next]', stage).forEach((b) => b.onclick = () => show(i + 1, 1));
      $$('[data-ch]', view).forEach((b) => b.onclick = () => show(TOUR.findIndex((x) => x.ch === b.dataset.ch), 1));
      const nx = TOUR[i + 1]; if (nx?.img) { const im = new Image(); im.src = `assets/tour/${nx.img}.webp`; }
      try { localStorage.setItem('bf-tour-seen', '1'); } catch {}
    };
    $('#tr-next', view).onclick = () => show(i + 1, 1);
    $('#tr-prev', view).onclick = () => show(i - 1, -1);
    $$('#tr-prog i', view).forEach((e) => e.onclick = () => show(Number(e.dataset.k), Number(e.dataset.k) > i ? 1 : -1));
    const onKey = (e) => { if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; } if (e.key === 'ArrowLeft') show(i + 1, 1); else if (e.key === 'ArrowRight') show(i - 1, -1); else if (e.key === 'Escape') location.hash = '#/home'; };
    document.addEventListener('keydown', onKey);
    let x0 = null;
    root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 60) show(i + (dx > 0 ? 1 : -1), dx > 0 ? 1 : -1); x0 = null; }, { passive: true });
    document.body.classList.add('noscroll');
    const clean = () => { if (!document.body.contains(root)) { document.body.classList.remove('noscroll'); window.removeEventListener('hashchange', clean); } };
    window.addEventListener('hashchange', () => setTimeout(clean, 0));
    show(0);
    root.focus();
  }


  /* ======================= الإجراءات السريعة ======================= */
  function pickClient(title, done) {
    modal(`<h3>${title}</h3><div class="field"><input class="input" id="pc-q" placeholder="بحث بالاسم أو الجوال" autocomplete="off"></div><div class="list" id="pc-r" style="max-height:50vh;overflow:auto"></div>
      <div class="actions end mt"><button class="btn" id="pc-new">${I.plus} عميلة جديدة</button></div>`, async (el, close) => {
      const pool = await q(sb.from('clients_overview').select('*').order('last_visit', { ascending: false, nullsFirst: false }).limit(3000)).catch(() => []);
      const draw = () => { const t = $('#pc-q', el).value.trim(); const r = (t ? pool.filter((c) => c.name.includes(t) || (c.phone || '').includes(t)) : pool).slice(0, 30);
        $('#pc-r', el).innerHTML = r.map((c) => `<button class="row" data-c="${c.id}"><span class="cav ${c.segment}">${esc(initial(c.name))}</span><div class="grow"><div class="title">${esc(c.name)}</div><div class="meta" dir="ltr" style="text-align:right">${esc(c.phone || '')}</div></div></button>`).join('') || '<div class="empty">ما فيه نتائج</div>';
        $$('[data-c]', el).forEach((b) => b.onclick = () => { close(); done(pool.find((c) => c.id === Number(b.dataset.c))); }); };
      $('#pc-q', el).addEventListener('input', draw); draw();
      $('#pc-new', el).onclick = () => { close(); clientForm(null, async (id) => { const c = await q(sb.from('clients_overview').select('*').eq('id', id).maybeSingle()); if (c) done(c); }); };
    });
  }
  function quickActions() {
    const M = isManager();
    const A = [
      ['visit', I.heart, 'ختم زيارة', 'لعميلة في الصالون', true],
      ['issue', I.out, 'صرف من المخزون', 'منتجات استخدمتوها', true],
      ['sales', I.chart, 'مبيعات اليوم', 'لحظة بلحظة من ركاز', M],
      ['expense', I.invoice, 'مصروف', 'فاتورة أو دفعة', M],
      ['purchase', I.cart, 'فاتورة شراء', 'بضاعة وصلت', true],
      ['fault', I.wrench, 'بلّغ عن عطل', 'جهاز أو كرسي', true],
      ['feedback', I.check, 'رأي عميلة', 'مديح أو شكوى', true],
      ['leave', I.cal, 'طلب إجازة', 'لك أو لموظفة', true],
    ].filter((x) => x[4]);
    const close = modal(`<div class="qa-h"><b>إجراء سريع</b><span>وش تبون تسجّلون؟</span></div><div class="qa-grid">${A.map(([k, ic, t, d], i) => `<button class="qa" data-qa="${k}" style="--d:${i * 35}ms"><span class="qa-ic">${ic}</span><b>${t}</b><small>${d}</small></button>`).join('')}</div>`, (el, c) => {
      el.closest('.modal-back')?.classList.add('sheet');
      $$('[data-qa]', el).forEach((b) => b.onclick = async () => {
        const k = b.dataset.qa; c();
        if (k === 'visit') pickClient('ختم زيارة لمين؟', (cl) => visitForm(cl, () => route()));
        else if (k === 'issue') location.hash = '#/issue';
        else if (k === 'sales') location.hash = '#/sales?l=d';
        else if (k === 'expense') expenseForm(null, () => route());
        else if (k === 'purchase') location.hash = '#/invoice/new';
        else if (k === 'fault') issueForm(await q(sb.from('assets').select('id,name,category,location').order('name')).catch(() => []), null);
        else if (k === 'feedback') pickClient('رأي من مين؟', (cl) => feedbackForm(null, cl, () => route()));
        else if (k === 'leave') leaveForm(await teamData());
      });
    });
    void close;
  }
  /* ======================= salon appointments ======================= */
  const AP_STATUS = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', arrived: 'وصلت', done: 'خلصت', no_show: 'ما حضرت', cancelled: 'ملغي' };
  const AP_BADGE = { pending: 'warn', confirmed: 'accent', arrived: 'gold', done: 'ok', no_show: 'danger', cancelled: '' };
  const AP_ROLES = [['hair', 'شعر'], ['nails', 'أظافر'], ['lashes', 'رموش'], ['face', 'وجه وحواجب'], ['makeup', 'مكياج']];
  const AP_PAY = ['ركاز · مدى', 'ركاز · كاش', 'ركاز · Apple Pay', 'تحويل', 'قسيمة هدية'];
  const BOOK_URL = 'https://beautfresh.com/book/';
  const apMin = (ts) => { const t = new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }); const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const apHM = (m) => { let h = Math.floor(m / 60), mm = m % 60; const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return `${AR_NUM(h)}:${AR_NUM(String(mm).padStart(2, '0'))} ${ap}`; };
  const apDayShift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const apTimeTxt = (ts) => apHM(apMin(ts));
  const apMsg = (b, kind) => {
    const when = `${rDayLabel(rDay(b.starts_at))} الساعة ${apTimeTxt(b.starts_at)}`;
    const svcs = (b.salon_booking_items || []).map((i) => i.name).join('، ');
    const link = `${BOOK_URL}?t=${b.access_token}`;
    if (kind === 'confirm') return `أهلًا ${b.customer_name} 🤍\nموعدك في بيوتفريش تأكد: ${when}\n${svcs}\n\nلو تبين تعدلين أو تلغين من هنا:\n${link}\n\nننتظرك ✨`;
    if (kind === 'remind') return `أهلًا ${b.customer_name}، نذكّرك بموعدك في بيوتفريش ${when} 🤍\n${svcs}\n\nتفاصيل الموعد:\n${link}`;
    if (kind === 'miss') return `أهلًا ${b.customer_name}، افتقدناك اليوم 🤍 إذا تبين نرتّب لك موعد ثاني احجزي من هنا:\n${BOOK_URL}`;
    return `أهلًا ${b.customer_name} 🤍`;
  };

  async function pageAppts(view, _a, params, alive) {
    const t = params.get('t') || 'day';
    const M = isManager();
    const tabs = [['day', 'جدول اليوم'], ['pending', 'بانتظار التأكيد'], ...(M ? [['svc', 'الخدمات والأسعار'], ['set', 'الإعدادات']] : [])];
    const head = `<div class="chips">${tabs.map(([k, l]) => `<a class="chip ${k === t ? 'on' : ''}" href="#/appts?t=${k}">${l}</a>`).join('')}<a class="chip" href="#/bookings">الحجوزات المنزلية ←</a></div>`;
    if (t === 'svc' && M) return apServices(view, head, alive);
    if (t === 'set' && M) return apSettings(view, head, alive);
    if (t === 'pending') return apPending(view, head, alive);
    return apDay(view, head, params.get('d') || rDay(Date.now()), alive);
  }

  async function apDay(view, head, day, alive) {
    const from = new Date(day + 'T00:00:00+03:00'), to = new Date(from.getTime() + 86400000);
    const [rows, staff, set, rk] = await Promise.all([
      q(sb.from('salon_bookings').select('id,code,access_token,customer_name,phone,starts_at,ends_at,total,status,payment_status,paid_amount,notes,source,salon_booking_items(id,name,role,member_id,starts_at,ends_at,price)').gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at')),
      q(sb.from('team_members').select('id,name,color,book_roles').eq('active', true).order('name')),
      q(sb.from('salon_settings').select('*').eq('id', 1).maybeSingle()),
      sb.from('rekaz_reservations').select('id,number,customer_name,phone,status,product_name,price_name,provider_names,start_at,end_at,total,remaining,custom_status,customer_note').gte('start_at', from.toISOString()).lt('start_at', to.toISOString()).order('start_at').then((x) => x.data || []),
    ]);
    if (!alive()) return;
    const rkLive = rk.filter((r) => !/cancel/i.test(r.status || ''));
    if (rkLive.length) return apDayRekaz(view, head, day, rows, rkLive, rk, set);
    const bookable = staff.filter((m) => (m.book_roles || []).length);
    const live = rows.filter((b) => b.status !== 'cancelled');
    const hm = (s, d) => { const [a, b] = String(s || d).split(':').map(Number); return a * 60 + (b || 0); };
    const open = hm(set?.open_time, '10:00'), close = hm(set?.close_time, '22:00') || 1440;
    const cols = bookable.length ? bookable.map((m) => ({ id: m.id, name: m.name.split(' ')[0], color: m.color })) : [{ id: null, name: 'الصالون', color: '#5A2A22' }];
    if (bookable.length && live.some((b) => b.salon_booking_items.some((i) => !i.member_id))) cols.push({ id: 0, name: 'بدون موظفة', color: '#8A6F66' });
    const PX = 1.3, H = Math.max(60, (close - open)) * PX;
    const blocks = (col) => {
      const its = live.flatMap((b) => b.salon_booking_items.filter((i) => (col.id === null) || (col.id === 0 ? !i.member_id : i.member_id === col.id)).map((i) => ({ b, i, s: +new Date(i.starts_at), e: +new Date(i.ends_at) }))).sort((x, y) => x.s - y.s);
      const ends = []; its.forEach((x) => { let l = ends.findIndex((e) => e <= x.s); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = x.e; x.l = l; });
      its.forEach((x) => { x.n = Math.max(...its.filter((y) => y.s < x.e && y.e > x.s).map((y) => y.l)) + 1; });
      return its.map(({ b, i, l, n }) => {
        const top = (apMin(i.starts_at) - open) * PX, h = Math.max(26, (new Date(i.ends_at) - new Date(i.starts_at)) / 60000 * PX - 3);
        return `<button class="ap-blk st-${b.status}" style="top:${top}px;height:${h}px;--c:${col.color};inset-inline-start:calc(${(l * 100) / n}% + 3px);width:calc(${100 / n}% - 6px)" data-b="${b.id}"><b>${esc(b.customer_name)}</b><span>${apTimeTxt(i.starts_at)} · ${esc(i.name)}</span></button>`;
      }).join('');
    };
    const hours = []; for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) hours.push(m);
    const isToday = day === rDay(Date.now());
    const nowM = apMin(Date.now());
    const pend = live.filter((b) => b.status === 'pending').length;
    const exp = live.filter((b) => b.status !== 'no_show').reduce((a, b) => a + Number(b.total || 0), 0);
    view.innerHTML = `${head}
      <div class="ap-nav"><a class="icon-btn" href="#/appts?d=${apDayShift(day, -1)}" aria-label="اليوم السابق">→</a>
        <label class="ap-date"><b>${esc(rDayLabel(day))}</b><input type="date" id="ap-d" value="${day}"></label>
        <a class="icon-btn" href="#/appts?d=${apDayShift(day, 1)}" aria-label="اليوم التالي">←</a>
        ${isToday ? '' : `<a class="chip" href="#/appts">اليوم</a>`}
        <button class="btn primary" id="ap-new" style="margin-inline-start:auto">${I.plus} موعد</button></div>
      <div class="ap-kpi"><div><b class="num">${AR_NUM(live.length)}</b><span>موعد</span></div><div><b class="num">${sar(exp)}</b><span>ريال متوقع</span></div><div class="${pend ? 'warn' : ''}"><b class="num">${AR_NUM(pend)}</b><span>بانتظار التأكيد</span></div><div><b class="num">${AR_NUM(live.filter((b) => b.status === 'done').length)}</b><span>خلصت</span></div></div>
      ${live.length ? '' : `<div class="notice" style="margin-bottom:12px">ما فيه مواعيد ${isToday ? 'اليوم' : 'في هاليوم'}. المواعيد اللي تنحجز من الموقع تطلع هنا تلقائيًا.</div>`}
      ${!bookable.length ? `<div class="notice small" style="margin-bottom:12px">المواعيد الحين تنحسب على ${AR_NUM(set?.seats || 2)} كراسي. لما تضيفون الموظفات ومناوباتهن من <a href="#/team">الفريق</a> وتحددون وش تسوي كل وحدة من <a href="#/appts?t=set">الإعدادات</a>، يصير لكل موظفة عمود ومواعيدها.</div>` : ''}
      <div class="ap-tl" style="--n:${cols.length}">
        <div class="ap-hcol"><div class="ap-hd"></div><div class="ap-body" style="height:${H}px">${hours.map((m) => `<span style="top:${(m - open) * PX}px">${apHM(m).replace(':٠٠', '')}</span>`).join('')}</div></div>
        ${cols.map((c) => `<div class="ap-col"><div class="ap-hd"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</div><div class="ap-body" style="height:${H}px">${hours.map((m) => `<i class="ap-line" style="top:${(m - open) * PX}px"></i>`).join('')}${isToday && nowM > open && nowM < close ? `<i class="ap-now" style="top:${(nowM - open) * PX}px"></i>` : ''}${blocks(c)}</div></div>`).join('')}
      </div>
      ${rows.some((b) => b.status === 'cancelled') ? `<div class="section-title"><h2>ملغية</h2></div><div class="list">${rows.filter((b) => b.status === 'cancelled').map((b) => `<button class="row" data-b="${b.id}"><div class="grow"><div class="title">${esc(b.customer_name)}</div><div class="meta">${apTimeTxt(b.starts_at)} · ${esc(b.salon_booking_items.map((i) => i.name).join('، '))}</div></div><span class="badge">ملغي</span></button>`).join('')}</div>` : ''}`;
    $('#ap-d', view).onchange = (e) => { if (e.target.value) location.hash = `#/appts?d=${e.target.value}`; };
    $('#ap-new', view).onclick = () => apForm(day);
    $$('[data-b]', view).forEach((el) => el.onclick = () => apSheet(rows.find((b) => b.id === el.dataset.b), staff));
    if (isToday && nowM > open) { const tl = $('.ap-tl', view); requestAnimationFrame(() => { const y = tl.getBoundingClientRect().top + window.scrollY + (nowM - open - 60) * PX; if (y > 300) window.scrollTo({ top: y - 120 }); }); }
  }


  const RK_ST = (s) => { s = String(s || '').toLowerCase(); if (/cancel/.test(s)) return ['ملغي', '']; if (/no.?show|absent/.test(s)) return ['ما حضرت', 'danger']; if (/complet|done|finish|attend|checked/.test(s)) return ['خلصت', 'ok']; if (/pend|unconfirm|draft/.test(s)) return ['غير مؤكد', 'warn']; if (/confirm/.test(s)) return ['مؤكد', 'accent']; return [s || '—', '']; };
  async function apDayRekaz(view, head, day, own, rk, rkAll, set) {
    const hm = (s, d) => { const [a, b] = String(s || d).split(':').map(Number); return a * 60 + (b || 0); };
    const PX = 1.3;
    let open = hm(set?.open_time, '10:00'), close = hm(set?.close_time, '22:00') || 1440;
    rk.forEach((r) => { open = Math.min(open, Math.floor(apMin(r.start_at) / 60) * 60); const e = apMin(r.end_at || r.start_at) || 0; close = Math.max(close, Math.ceil((e < apMin(r.start_at) ? 1440 : e) / 60) * 60); });
    const H = Math.max(60, close - open) * PX;
    const ownLive = own.filter((b) => b.status !== 'cancelled');
    const names = [...new Set(rk.map((r) => (r.provider_names || 'بدون أخصائية').split('، ')[0]))].sort();
    const COLORS = ['#5A2A22', '#9C7A57', '#3F6B5B', '#7A4E8C', '#B0603A', '#2F5D8A', '#8A6F66', '#A33F5E'];
    const cols = names.map((n, i) => ({ name: n, color: COLORS[i % COLORS.length] }));
    if (ownLive.length) cols.push({ name: 'من موقعنا', color: '#C9A46A', own: true });
    const lanes = (its) => { its.sort((x, y) => x.s - y.s); const ends = []; its.forEach((x) => { let l = ends.findIndex((e) => e <= x.s); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = x.e; x.l = l; }); its.forEach((x) => { x.n = Math.max(...its.filter((y) => y.s < x.e && y.e > x.s).map((y) => y.l)) + 1; }); return its; };
    const blk = (x, color, attr, title, sub, st) => { const top = (apMin(x.s) - open) * PX, h = Math.max(26, (x.e - x.s) / 60000 * PX - 3); return `<button class="ap-blk st-${st}" style="top:${top}px;height:${h}px;--c:${color};inset-inline-start:calc(${(x.l * 100) / x.n}% + 3px);width:calc(${100 / x.n}% - 6px)" ${attr}><b>${esc(title)}</b><span>${apTimeTxt(x.s)} · ${esc(sub)}</span></button>`; };
    const colHtml = (c) => {
      let its;
      if (c.own) its = lanes(ownLive.flatMap((b) => b.salon_booking_items.map((i) => ({ s: +new Date(i.starts_at), e: +new Date(i.ends_at), b, i }))));
      else its = lanes(rk.filter((r) => (r.provider_names || 'بدون أخصائية').split('، ')[0] === c.name).map((r) => ({ s: +new Date(r.start_at), e: +new Date(r.end_at || r.start_at) || +new Date(r.start_at) + 1800000, r })));
      return its.map((x) => c.own ? blk(x, c.color, `data-b="${x.b.id}"`, x.b.customer_name, x.i.name, x.b.status)
        : blk(x, c.color, `data-rk="${x.r.id}"`, x.r.customer_name || '—', [x.r.product_name, x.r.price_name].filter(Boolean).join(' · '), /pend|unconfirm/i.test(x.r.status) ? 'pending' : /complet|done/i.test(x.r.status) ? 'done' : 'confirmed')).join('');
    };
    const hours = []; for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) hours.push(m);
    const isToday = day === rDay(Date.now()), nowM = apMin(Date.now());
    const exp = rk.reduce((a, r) => a + Number(r.total || 0), 0) + ownLive.reduce((a, b) => a + Number(b.total || 0), 0);
    const unconf = rk.filter((r) => /pend|unconfirm/i.test(r.status || '')).length + ownLive.filter((b) => b.status === 'pending').length;
    const { data: log } = await sb.from('rekaz_sync_log').select('finished_at,ok').order('id', { ascending: false }).limit(1);
    view.innerHTML = `${head}
      <div class="ap-nav"><a class="icon-btn" href="#/appts?d=${apDayShift(day, -1)}" aria-label="اليوم السابق">→</a>
        <label class="ap-date"><b>${esc(rDayLabel(day))}</b><input type="date" id="ap-d" value="${day}"></label>
        <a class="icon-btn" href="#/appts?d=${apDayShift(day, 1)}" aria-label="اليوم التالي">←</a>
        ${isToday ? '' : '<a class="chip" href="#/appts">اليوم</a>'}
        <span class="muted small" style="margin-inline-start:auto">من ركاز${log && log[0] ? ` · آخر تحديث ${apTimeTxt(log[0].finished_at)}` : ''}</span></div>
      <div class="ap-kpi"><div><b class="num">${AR_NUM(rk.length + ownLive.length)}</b><span>موعد</span></div><div><b class="num">${sar(exp)}</b><span>ريال حسب ركاز</span></div><div class="${unconf ? 'warn' : ''}"><b class="num">${AR_NUM(unconf)}</b><span>غير مؤكد</span></div><div><b class="num">${AR_NUM(names.length)}</b><span>أخصائية</span></div></div>
      <div class="ap-tl" style="--n:${cols.length}">
        <div class="ap-hcol"><div class="ap-hd"></div><div class="ap-body" style="height:${H}px">${hours.map((m) => `<span style="top:${(m - open) * PX}px">${apHM(m).replace(':٠٠', '')}</span>`).join('')}</div></div>
        ${cols.map((c) => `<div class="ap-col"><div class="ap-hd"><i style="background:${c.color}"></i>${esc(c.name)}</div><div class="ap-body" style="height:${H}px">${hours.map((m) => `<i class="ap-line" style="top:${(m - open) * PX}px"></i>`).join('')}${isToday && nowM > open && nowM < close ? `<i class="ap-now" style="top:${(nowM - open) * PX}px"></i>` : ''}${colHtml(c)}</div></div>`).join('')}
      </div>
      ${rkAll.length > rk.length ? `<div class="section-title"><h2>ملغية</h2></div><div class="list">${rkAll.filter((r) => /cancel/i.test(r.status || '')).map((r) => `<div class="row"><div class="grow"><div class="title">${esc(r.customer_name || '—')}</div><div class="meta">${apTimeTxt(r.start_at)} · ${esc(r.product_name || '')}</div></div><span class="badge">ملغي</span></div>`).join('')}</div>` : ''}`;
    $('#ap-d', view).onchange = (e) => { if (e.target.value) location.hash = `#/appts?d=${e.target.value}`; };
    $$('[data-b]', view).forEach((el) => el.onclick = async () => { const staff = await q(sb.from('team_members').select('id,name')); apSheet(own.find((b) => b.id === el.dataset.b), staff); });
    $$('[data-rk]', view).forEach((el) => el.onclick = () => apRkSheet(rk.find((r) => r.id === el.dataset.rk)));
    if (isToday && nowM > open) { const tl = $('.ap-tl', view); requestAnimationFrame(() => { const y = tl.getBoundingClientRect().top + window.scrollY + (nowM - open - 60) * PX; if (y > 300) window.scrollTo({ top: y - 120 }); }); }
  }
  function apRkSheet(r) {
    const st = RK_ST(r.status);
    const when = `${rDayLabel(rDay(r.start_at))} الساعة ${apTimeTxt(r.start_at)}`;
    const svc = [r.product_name, r.price_name].filter(Boolean).join(' · ');
    const T = { confirm: `أهلًا ${r.customer_name || ''} 🤍\nموعدك في بيوتفريش ${when}\n${svc}${r.provider_names ? ' مع ' + r.provider_names : ''}\n\nننتظرك ✨`, remind: `أهلًا ${r.customer_name || ''}، نذكّرك بموعدك في بيوتفريش ${when} 🤍\n${svc}` };
    modal(`<div style="display:flex;justify-content:space-between;align-items:start;gap:10px"><div><h3 style="margin:0">${esc(r.customer_name || '—')}</h3><div class="muted small">حجز ركاز رقم ${AR_NUM(r.number || '')}</div></div><span class="badge ${st[1]}">${esc(st[0])}</span></div>
      <div class="ap-when">${esc(rDayLabel(rDay(r.start_at)))} · ${apTimeTxt(r.start_at)}${r.end_at ? ' – ' + apTimeTxt(r.end_at) : ''}</div>
      <div class="list" style="margin:10px 0"><div class="row"><div class="grow"><div class="title">${esc(svc || '—')}</div><div class="meta">${r.provider_names ? 'مع ' + esc(r.provider_names) : 'بدون أخصائية'}</div></div><div class="end num">${r.total != null ? sar(r.total) : ''}</div></div>
        ${Number(r.remaining) > 0 ? `<div class="row"><div class="grow title">المتبقي</div><div class="end num" style="font-weight:700">${sar(r.remaining)} ريال</div></div>` : ''}</div>
      ${r.customer_note ? `<div class="notice small">«${esc(r.customer_note)}»</div>` : ''}
      ${r.phone ? `<div class="chips wrap" style="margin-top:10px"><a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(r.phone)}?text=${encodeURIComponent(T.confirm)}">واتساب · تأكيد</a><a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(r.phone)}?text=${encodeURIComponent(T.remind)}">واتساب · تذكير</a><a class="chip" href="tel:${esc(r.phone)}">اتصال · <span dir="ltr">${esc(r.phone)}</span></a></div>` : ''}
      <p class="muted small" style="margin-top:12px">هذا الموعد من ركاز. التعديل والإلغاء والدفع يصير من ركاز، ويتحدّث هنا تلقائيًا.</p>`);
  }
  async function apPending(view, head, alive) {
    const [rows, staff] = await Promise.all([
      q(sb.from('salon_bookings').select('id,code,access_token,customer_name,phone,starts_at,ends_at,total,status,payment_status,paid_amount,notes,source,salon_booking_items(id,name,role,member_id,starts_at,ends_at,price)').eq('status', 'pending').gte('starts_at', new Date(Date.now() - 3600000).toISOString()).order('starts_at').limit(100)),
      q(sb.from('team_members').select('id,name,color,book_roles').eq('active', true)),
    ]);
    if (!alive()) return;
    view.innerHTML = `${head}
      <p class="muted small" style="margin-top:-4px">الحجوزات اللي جات من الموقع. أرسلوا لها التأكيد على الواتساب واضغطوا «تأكيد».</p>
      ${rows.length ? `<div class="list">${rows.map((b) => `<div class="row"><div style="width:70px;flex:none;text-align:center"><div style="font-weight:700" class="num">${apTimeTxt(b.starts_at)}</div><div class="meta">${esc(rDayLabel(rDay(b.starts_at)))}</div></div>
        <button class="grow" data-b="${b.id}" style="text-align:right;background:none;border:0;padding:0"><div class="title">${esc(b.customer_name)} <span class="muted small num" dir="ltr">${esc(b.phone)}</span></div><div class="meta">${esc(b.salon_booking_items.map((i) => i.name).join('، '))} · ${sar(b.total)} ريال</div></button>
        <div class="end" style="display:flex;gap:6px"><a class="icon-btn" target="_blank" rel="noopener" href="https://wa.me/${waNum(b.phone)}?text=${encodeURIComponent(apMsg(b, 'confirm'))}" aria-label="أرسل التأكيد">${I.wa}</a><button class="btn sm primary" data-ok="${b.id}">تأكيد</button></div></div>`).join('')}</div>`
        : '<div class="list"><div class="empty">ما فيه حجوزات تنتظر التأكيد 🤍</div></div>'}`;
    $$('[data-b]', view).forEach((el) => el.onclick = () => apSheet(rows.find((b) => b.id === el.dataset.b), staff));
    $$('[data-ok]', view).forEach((el) => el.onclick = () => busy(el, async () => { await q(sb.from('salon_bookings').update({ status: 'confirmed' }).eq('id', el.dataset.ok)); toast('تأكد الموعد'); route(); }));
  }

  function apSheet(b, staff) {
    const who = (id) => { const m = staff.find((x) => x.id === id); return m ? m.name.split(' ')[0] : ''; };
    const items = b.salon_booking_items.slice().sort((a, c) => new Date(a.starts_at) - new Date(c.starts_at));
    const act = {
      pending: [['confirmed', 'تأكيد الموعد', 'primary']],
      confirmed: [['arrived', 'وصلت', 'primary'], ['no_show', 'ما حضرت', '']],
      arrived: [['done', 'خلصت · سجّل الدفع', 'primary']],
    }[b.status] || [];
    modal(`
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px"><div><h3 style="margin:0">${esc(b.customer_name)}</h3><div class="muted small">${esc(b.code)} · ${b.source === 'web' ? 'من الموقع' : 'من الإدارة'}</div></div><span class="badge ${AP_BADGE[b.status]}">${AP_STATUS[b.status]}</span></div>
      <div class="ap-when">${esc(rDayLabel(rDay(b.starts_at)))} · ${apTimeTxt(b.starts_at)} – ${apTimeTxt(b.ends_at)}</div>
      <div class="list" style="margin:10px 0">${items.map((i) => `<div class="row"><div class="grow"><div class="title">${esc(i.name)}</div><div class="meta">${apTimeTxt(i.starts_at)}${i.member_id ? ` · مع ${esc(who(i.member_id))}` : ''}</div></div><div class="end num">${sar(i.price)}</div></div>`).join('')}
        <div class="row"><div class="grow title">الإجمالي</div><div class="end num" style="font-weight:700">${sar(b.total)} ريال</div></div></div>
      ${b.notes ? `<div class="notice small">«${esc(b.notes)}»</div>` : ''}
      <div class="chips wrap" style="margin-top:10px">
        <a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(b.phone)}?text=${encodeURIComponent(apMsg(b, 'confirm'))}">واتساب · رسالة التأكيد</a>
        <a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(b.phone)}?text=${encodeURIComponent(apMsg(b, 'remind'))}">واتساب · تذكير</a>
        ${b.status === 'no_show' ? `<a class="chip" target="_blank" rel="noopener" href="https://wa.me/${waNum(b.phone)}?text=${encodeURIComponent(apMsg(b, 'miss'))}">افتقدناك</a>` : ''}
        <a class="chip" href="tel:${esc(b.phone)}">اتصال · <span dir="ltr">${esc(b.phone)}</span></a>
      </div>
      <div class="actions" style="margin-top:14px">${act.map(([s, l, c]) => `<button class="btn ${c}" data-s="${s}">${l}</button>`).join('')}
        ${['pending', 'confirmed'].includes(b.status) ? '<button class="btn" data-s="cancelled" style="color:var(--danger)">إلغاء</button>' : ''}
        ${['no_show', 'cancelled'].includes(b.status) ? '<button class="btn" data-s="confirmed">رجّعه مؤكد</button>' : ''}</div>
      <div id="ap-pay"></div>`, (el, close) => {
      $$('[data-s]', el).forEach((btn) => btn.onclick = async () => {
        const s = btn.dataset.s;
        if (s === 'done') return apPay(el, b, close);
        if (s === 'cancelled' && !(await confirmBox('إلغاء الموعد؟', `${b.customer_name} · ${apTimeTxt(b.starts_at)}`, 'إلغاء الموعد', true))) return;
        await busy(btn, async () => {
          await q(sb.from('salon_bookings').update({ status: s, ...(s === 'cancelled' ? { cancel_reason: 'ألغته الإدارة' } : {}) }).eq('id', b.id));
          toast(AP_STATUS[s]); close(); route();
        });
      });
    });
  }
  function apPay(el, b, close) {
    $('#ap-pay', el).innerHTML = `<div class="card" style="margin-top:12px"><div class="grid2"><div class="field"><label>المبلغ المدفوع</label><input class="input num" id="pa" inputmode="decimal" value="${Number(b.total)}"></div>
      <div class="field"><label>طريقة الدفع</label><select class="input" id="pm">${AP_PAY.map((p) => `<option>${p}</option>`).join('')}</select></div></div>
      <div class="field"><label>رقم فاتورة ركاز <span class="muted small">(اختياري)</span></label><input class="input" id="pi" dir="ltr"></div>
      <button class="btn primary" id="pok" style="width:100%">تسجيل · تنضاف زيارة لملفها وختم بالبطاقة</button></div>`;
    $('#pok', el).onclick = (e) => busy(e.target, async () => {
      const amt = Number(String($('#pa', el).value).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
      await q(sb.from('salon_bookings').update({ status: 'done', payment_status: 'paid', paid_amount: isFinite(amt) ? amt : b.total, payment_method: $('#pm', el).value, rekaz_invoice: $('#pi', el).value.trim() || null }).eq('id', b.id));
      toast('خلصت الزيارة وانضافت لملفها'); close(); route();
    });
  }

  async function apForm(day) {
    const cat = await q(sb.rpc('sb_catalog'));
    const staff = await q(sb.from('team_members').select('id,name,book_roles').eq('active', true));
    const bookable = staff.filter((m) => (m.book_roles || []).length);
    const sel = [];
    modal(`<h3>موعد جديد</h3><p class="muted small" style="margin-top:-6px">للحجوزات اللي توصل بالواتساب أو الاتصال أو تجي مباشرة.</p>
      <div class="grid2"><div class="field"><label>الجوال</label><input class="input" id="f-ph" dir="ltr" inputmode="tel" placeholder="05xxxxxxxx"></div><div class="field"><label>الاسم</label><input class="input" id="f-nm"></div></div>
      <div class="field"><label>الخدمات</label><input class="input" id="f-q" type="search" placeholder="ابحث عن خدمة…"><div id="f-res" class="ap-res"></div><div id="f-sel" class="chips wrap" style="margin-top:6px"></div></div>
      <div class="grid2"><div class="field"><label>اليوم</label><input class="input" type="date" id="f-d" value="${day}"></div>
        <div class="field"><label>الموظفة</label><select class="input" id="f-m"><option value="">أي وحدة</option>${bookable.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div></div>
      <div class="field"><label>الوقت</label><div id="f-slots" class="chips wrap"><span class="muted small">اختاروا الخدمة أول</span></div></div>
      <div class="grid2"><div class="field"><label>المصدر</label><select class="input" id="f-src"><option value="phone">واتساب أو اتصال</option><option value="walkin">جت مباشرة</option></select></div><div class="field"><label>ملاحظة</label><input class="input" id="f-nt"></div></div>
      <div class="actions"><button class="btn primary" id="f-ok" disabled>احجز</button></div>`, (el, close) => {
      let slot = null;
      const res = $('#f-res', el), selBox = $('#f-sel', el);
      const items = () => sel.map((x) => ({ service_id: x.s.id, option_id: x.o ? x.o.id : null }));
      const drawSel = () => { selBox.innerHTML = sel.map((x, i) => `<span class="chip on">${esc(x.s.name)}${x.o ? ' · ' + esc(x.o.name) : ''} <button data-x="${i}" style="background:none;border:0;color:inherit">×</button></span>`).join(''); $$('[data-x]', selBox).forEach((b) => b.onclick = () => { sel.splice(+b.dataset.x, 1); drawSel(); loadSlots(); }); };
      const loadSlots = async () => {
        slot = null; $('#f-ok', el).disabled = true;
        const box = $('#f-slots', el);
        if (!sel.length) { box.innerHTML = '<span class="muted small">اختاروا الخدمة أول</span>'; return; }
        box.innerHTML = '<span class="muted small">نبحث…</span>';
        const rows = await q(sb.rpc('sb_slots', { p_day: $('#f-d', el).value, p_items: items(), p_member: +$('#f-m', el).value || null }));
        box.innerHTML = rows.length ? rows.map((r) => `<button class="chip" data-t="${r.slot}">${apHM(+r.slot.slice(0, 2) * 60 + +r.slot.slice(3))}</button>`).join('') : '<span class="muted small">ما فيه وقت فاضي بهاليوم</span>';
        $$('[data-t]', box).forEach((b) => b.onclick = () => { $$('[data-t]', box).forEach((x) => x.classList.toggle('on', x === b)); slot = b.dataset.t; $('#f-ok', el).disabled = false; });
      };
      $('#f-q', el).oninput = (e) => {
        const v = e.target.value.trim();
        res.innerHTML = v ? cat.services.filter((s) => s.name.includes(v)).slice(0, 8).map((s) => (s.opts && s.opts.length ? s.opts.map((o) => `<button data-s="${s.id}" data-o="${o.id}">${esc(s.name)} · ${esc(o.name)} <span class="muted small">${sar(o.price)} · ${durTxt(o.dur)}</span></button>`).join('') : `<button data-s="${s.id}">${esc(s.name)} <span class="muted small">${sar(s.price)} · ${durTxt(s.dur)}</span></button>`)).join('') : '';
        $$('button', res).forEach((b) => b.onclick = () => { const s = cat.services.find((x) => x.id === +b.dataset.s); const o = b.dataset.o ? s.opts.find((x) => x.id === +b.dataset.o) : null; sel.push({ s, o }); res.innerHTML = ''; e.target.value = ''; drawSel(); loadSlots(); });
      };
      $('#f-d', el).onchange = loadSlots; $('#f-m', el).onchange = loadSlots;
      $('#f-ph', el).onchange = async (e) => {
        const p = e.target.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '').replace(/^966/, '0').replace(/^5/, '05');
        e.target.value = p;
        if (/^05\d{8}$/.test(p) && !$('#f-nm', el).value) { const { data } = await sb.from('clients').select('name').eq('phone', p).maybeSingle(); if (data) $('#f-nm', el).value = data.name; }
      };
      $('#f-ok', el).onclick = (e) => busy(e.target, async () => {
        const r = await q(sb.rpc('sb_create', { p: { name: $('#f-nm', el).value.trim(), phone: $('#f-ph', el).value, items: items(), day: $('#f-d', el).value, time: slot, member_id: +$('#f-m', el).value || null, notes: $('#f-nt', el).value, source: $('#f-src', el).value } }));
        toast(`انحجز · ${r.code}`); close(); location.hash = `#/appts?d=${$('#f-d', el).value}`; route();
      });
    });
  }

  async function apServices(view, head, alive) {
    const [cats, svcs, opts] = await Promise.all([
      q(sb.from('salon_svc_cats').select('*').order('sort')),
      q(sb.from('salon_services').select('*').order('sort')),
      q(sb.from('salon_service_options').select('*').order('sort')),
    ]);
    if (!alive()) return;
    view.innerHTML = `${head}
      <p class="muted small" style="margin-top:-4px">${AR_NUM(svcs.length)} خدمة منقولة من ركاز. أي تعديل هنا يطلع في صفحة الحجز فورًا. <a href="${BOOK_URL}" target="_blank" rel="noopener">افتحوا صفحة الحجز ↗</a></p>
      ${cats.map((c) => `<div class="section-title"><h2>${esc(c.name)}</h2><span class="muted small">${AR_NUM(svcs.filter((s) => s.cat_id === c.id).length)}</span></div>
        <div class="list">${svcs.filter((s) => s.cat_id === c.id).map((s) => { const o = opts.filter((x) => x.service_id === s.id); return `<button class="row" data-s="${s.id}" style="${s.is_active ? '' : 'opacity:.5'}"><div class="grow"><div class="title">${s.popular ? '★ ' : ''}${esc(s.name)}</div><div class="meta">${o.length ? `${AR_NUM(o.length)} خيارات · ` : ''}${durTxt(s.duration_min)}${s.is_active ? '' : ' · مخفية'}</div></div><div class="end num">${o.length ? 'من ' + sar(Math.min(...o.map((x) => x.price))) : sar(s.price)}</div></button>`; }).join('')}</div>`).join('')}
      <div class="actions" style="margin-top:16px"><button class="btn primary" id="sv-new">${I.plus} خدمة جديدة</button></div>`;
    const edit = (s) => {
      const o = s ? opts.filter((x) => x.service_id === s.id) : [];
      modal(`<h3>${s ? 'تعديل خدمة' : 'خدمة جديدة'}</h3>
        <div class="field"><label>الاسم</label><input class="input" id="e-n" value="${esc(s?.name || '')}"></div>
        <div class="field"><label>القسم</label><select class="input" id="e-c">${cats.map((c) => `<option value="${c.id}" ${s?.cat_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>الوصف</label><textarea class="input" id="e-d" rows="2">${esc(s?.description || '')}</textarea></div>
        <div class="grid2"><div class="field"><label>السعر</label><input class="input num" id="e-p" inputmode="decimal" value="${s ? Number(s.price) : ''}"></div><div class="field"><label>المدة (دقيقة)</label><input class="input num" id="e-m" inputmode="numeric" value="${s?.duration_min || 45}"></div></div>
        <div class="field"><label>خيارات (مثل الطول) <span class="muted small">اسم · سعر · مدة</span></label><div id="e-o">${o.map((x) => `<div class="grid3 ap-opt" data-id="${x.id}"><input class="input" value="${esc(x.name)}"><input class="input num" value="${Number(x.price)}"><input class="input num" value="${x.duration_min}"></div>`).join('')}</div><button class="btn sm" id="e-add" type="button">${I.plus} خيار</button></div>
        <label class="check"><input type="checkbox" id="e-a" ${!s || s.is_active ? 'checked' : ''}> ظاهرة في صفحة الحجز</label>
        <label class="check"><input type="checkbox" id="e-pop" ${s?.popular ? 'checked' : ''}> من «الأكثر طلبًا»</label>
        <div class="actions"><button class="btn primary" id="e-ok">حفظ</button></div>`, (el, close) => {
        $('#e-add', el).onclick = () => $('#e-o', el).insertAdjacentHTML('beforeend', '<div class="grid3 ap-opt"><input class="input" placeholder="مثلًا: طويل"><input class="input num" placeholder="السعر"><input class="input num" placeholder="الدقايق"></div>');
        $('#e-ok', el).onclick = (e) => busy(e.target, async () => {
          const num = (v) => Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
          const row = { name: $('#e-n', el).value.trim(), cat_id: +$('#e-c', el).value, description: $('#e-d', el).value.trim() || null, price: num($('#e-p', el).value) || 0, duration_min: num($('#e-m', el).value) || 45, is_active: $('#e-a', el).checked, popular: $('#e-pop', el).checked };
          let id = s?.id;
          if (s) await q(sb.from('salon_services').update(row).eq('id', s.id));
          else id = (await q(sb.from('salon_services').insert(row).select('id').single())).id;
          const keep = [];
          for (const [k, r] of $$('.ap-opt', el).entries()) {
            const [n, p, m] = $$('input', r).map((i) => i.value.trim());
            if (!n) continue;
            const v = { service_id: id, name: n, price: num(p) || 0, duration_min: num(m) || row.duration_min, sort: k };
            if (r.dataset.id) { await q(sb.from('salon_service_options').update(v).eq('id', +r.dataset.id)); keep.push(+r.dataset.id); }
            else keep.push((await q(sb.from('salon_service_options').insert(v).select('id').single())).id);
          }
          const gone = o.filter((x) => !keep.includes(x.id)).map((x) => x.id);
          if (gone.length) await q(sb.from('salon_service_options').update({ is_active: false }).in('id', gone));
          toast('انحفظت'); close(); route();
        });
      });
    };
    $$('[data-s]', view).forEach((el) => el.onclick = () => edit(svcs.find((s) => s.id === +el.dataset.s)));
    $('#sv-new', view).onclick = () => edit(null);
  }

  async function apSettings(view, head, alive) {
    const [set, staff, shifts, blk] = await Promise.all([
      q(sb.from('salon_settings').select('*').eq('id', 1).maybeSingle()),
      q(sb.from('team_members').select('id,name,role_title,book_roles,color').eq('active', true).order('name')),
      q(sb.from('team_shifts').select('member_id')),
      q(sb.from('salon_blackouts').select('*').gte('day', rDay(Date.now())).order('day')),
    ]);
    if (!alive()) return;
    const s = set || {};
    const WDS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const { data: rlog } = await sb.from('rekaz_sync_log').select('*').order('id', { ascending: false }).limit(1);
    const { count: rkN } = await sb.from('rekaz_reservations').select('id', { count: 'exact', head: true });
    const L = rlog && rlog[0];
    view.innerHTML = `${head}
      <div class="card"><h3 style="margin-top:0">الربط مع ركاز</h3>
        ${L ? `<p class="small" style="margin:0 0 6px">${L.ok ? '✅ شغّال' : '⚠️ آخر محاولة فشلت'} · آخر تحديث ${esc(rDayLabel(rDay(L.finished_at)))} ${apTimeTxt(L.finished_at)}</p>
          <p class="muted small" style="margin:0 0 10px">${AR_NUM(rkN || 0)} حجز منسوخ من ركاز${L.counts ? ` · ${Object.entries(L.counts).filter(([, v]) => v > 0).map(([k, v]) => `${{ customers: 'عميلات', reservations: 'حجوزات', orders: 'طلبات', orders_paid: 'مدفوعات', transactions: 'عمليات دفع', reviews: 'تقييمات', products: 'خدمات', providers: 'أخصائيات' }[k] || k} ${AR_NUM(v)}`).join('، ')}` : ''}</p>
          ${!L.ok && L.error ? `<div class="notice small" dir="ltr" style="text-align:left">${esc(L.error.slice(0, 300))}</div>` : ''}
          <div class="actions"><button class="btn" id="rk-now">حدّث الحين</button></div>`
        : '<p class="muted small" style="margin:0">ما بدأ الربط للحين. يحتاج «تكامل» من إعدادات Platform API في ركاز بصلاحيات قراءة فقط، وتنحط بياناته في خزنة قاعدة البيانات. بعدها تتحدّث الحجوزات والعميلات والمبيعات كل ١٠ دقايق، بدون ما يتغيّر شي في ركاز.</p>'}
        <p class="muted small" style="margin:8px 0 0">المزامنة قراءة فقط: ما تعدّل ولا تحذف أي شي في ركاز.</p>
        ${L ? `<div style="border-top:1px dashed var(--line);margin-top:12px;padding-top:12px"><label class="check"><input type="checkbox" id="rk-book" ${s.rekaz_booking ? 'checked' : ''}> صفحة الحجز في موقعنا تحجز داخل تقويم ركاز</label>
          <p class="muted small" style="margin:4px 0 0">الأوقات من ركاز، والحجز ينزل في تقويمه، والدفع من رابط ركاز. رابط ركاز يبقى شغّال جنبه عادي.</p></div>` : ''}</div>
      <div class="card"><h3 style="margin-top:0">الحجز من الموقع</h3>
        <label class="check"><input type="checkbox" id="s-acc" ${s.accepting ? 'checked' : ''}> الحجز من الموقع مفتوح</label>
        <div class="grid2"><div class="field"><label>يفتح</label><input class="input" type="time" id="s-o" value="${(s.open_time || '10:00').slice(0, 5)}"></div><div class="field"><label>يقفل</label><input class="input" type="time" id="s-c" value="${(s.close_time || '22:00').slice(0, 5)}"></div></div>
        <div class="field"><label>أيام الإغلاق</label><div class="chips wrap" id="s-wd">${WDS.map((d, i) => `<button class="chip ${(s.closed_weekdays || []).includes(i) ? 'on' : ''}" data-w="${i}" type="button">${d}</button>`).join('')}</div></div>
        <div class="grid3"><div class="field"><label>كل كم دقيقة موعد</label><input class="input num" id="s-sl" value="${s.slot_minutes || 30}"></div><div class="field"><label>أقل وقت قبل الموعد (دقيقة)</label><input class="input num" id="s-ld" value="${s.lead_minutes ?? 60}"></div><div class="field"><label>كم يوم قدام</label><input class="input num" id="s-hz" value="${s.horizon_days || 21}"></div></div>
        <div class="grid3"><div class="field"><label>عدد الكراسي (لو ما فيه موظفات)</label><input class="input num" id="s-st" value="${s.seats || 2}"></div><div class="field"><label>حجوزات مفتوحة لكل رقم</label><input class="input num" id="s-mx" value="${s.max_open_per_phone || 2}"></div><div class="field"><label>الإلغاء من الرابط قبل (ساعة)</label><input class="input num" id="s-ch" value="${s.cancel_hours ?? 3}"></div></div>
        <div class="field"><label>واتساب الصالون</label><input class="input" id="s-wa" dir="ltr" value="${esc(s.whatsapp || '')}"></div>
        <div class="actions"><button class="btn primary" id="s-ok">حفظ الإعدادات</button></div></div>
      <div class="card"><h3 style="margin-top:0">مين تسوي وش</h3><p class="muted small">النظام يوزّع المواعيد على الموظفة اللي تسوي الخدمة وهي في دوامها. الدوام من صفحة <a href="#/team">الفريق</a>.</p>
        ${staff.length ? `<div class="list">${staff.map((m) => `<div class="row" style="flex-wrap:wrap"><div class="grow"><div class="title"><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(m.color)}"></i> ${esc(m.name)}</div><div class="meta">${shifts.some((x) => x.member_id === m.id) ? 'لها دوام مسجّل' : '⚠️ ما لها دوام مسجّل، ما تنحجز لها مواعيد'}</div></div>
          <div class="chips wrap" style="margin:0">${AP_ROLES.map(([k, l]) => `<button class="chip ${(m.book_roles || []).includes(k) ? 'on' : ''}" data-m="${m.id}" data-r="${k}" type="button">${l}</button>`).join('')}</div></div>`).join('')}</div>` : '<div class="notice small">ما فيه موظفات مسجّلات للحين. أضيفوهن من <a href="#/team">الفريق</a>.</div>'}</div>
      <div class="card"><h3 style="margin-top:0">أيام مقفلة</h3><p class="muted small">إجازة أو مناسبة، ما ينحجز فيها من الموقع.</p>
        <div class="grid2"><input class="input" type="date" id="b-d"><input class="input" id="b-n" placeholder="السبب (اختياري)"></div><div class="actions"><button class="btn" id="b-add">${I.plus} أضف</button></div>
        ${blk.length ? `<div class="list" style="margin-top:8px">${blk.map((b) => `<div class="row"><div class="grow title">${esc(rDayLabel(b.day))}${b.note ? ` · <span class="muted">${esc(b.note)}</span>` : ''}</div><button class="btn sm" data-del="${b.day}">حذف</button></div>`).join('')}</div>` : ''}</div>`;
    $('#rk-book', view)?.addEventListener('change', async (e) => { try { if (e.target.checked) await q(sb.rpc('sb_link_rekaz')); await q(sb.from('salon_settings').update({ rekaz_booking: e.target.checked }).eq('id', 1)); toast(e.target.checked ? 'صار الحجز من موقعنا ينزل في ركاز' : 'رجع الحجز لنظامنا الداخلي'); } catch (err) { e.target.checked = !e.target.checked; toast(errMsg(err), true); } });
    $('#rk-now', view)?.addEventListener('click', (e) => busy(e.target, async () => { await q(sb.rpc('rekaz_sync_now')); toast('بدأ التحديث، خلال دقيقة يكتمل'); setTimeout(() => route(), 45000); }));
    $$('#s-wd .chip', view).forEach((c) => c.onclick = () => c.classList.toggle('on'));
    const n = (id) => Number(String($(id, view).value).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    $('#s-ok', view).onclick = (e) => busy(e.target, async () => {
      await q(sb.from('salon_settings').update({ accepting: $('#s-acc', view).checked, open_time: $('#s-o', view).value, close_time: $('#s-c', view).value,
        closed_weekdays: $$('#s-wd .chip.on', view).map((c) => +c.dataset.w), slot_minutes: n('#s-sl'), lead_minutes: n('#s-ld'), horizon_days: n('#s-hz'),
        seats: n('#s-st'), max_open_per_phone: n('#s-mx'), cancel_hours: n('#s-ch'), whatsapp: $('#s-wa', view).value.replace(/\D/g, ''), updated_at: new Date().toISOString() }).eq('id', 1));
      toast('انحفظت الإعدادات');
    });
    $$('[data-m]', view).forEach((c) => c.onclick = async () => {
      const m = staff.find((x) => x.id === +c.dataset.m); const r = c.dataset.r;
      const roles = new Set(m.book_roles || []); roles.has(r) ? roles.delete(r) : roles.add(r);
      m.book_roles = [...roles]; c.classList.toggle('on');
      try { await q(sb.from('team_members').update({ book_roles: m.book_roles }).eq('id', m.id)); } catch (err) { toast(errMsg(err), true); }
    });
    $('#b-add', view).onclick = (e) => busy(e.target, async () => { const d = $('#b-d', view).value; if (!d) return toast('اختاروا اليوم', true); await q(sb.from('salon_blackouts').upsert({ day: d, note: $('#b-n', view).value.trim() || null })); route(); });
    $$('[data-del]', view).forEach((b) => b.onclick = () => busy(b, async () => { await q(sb.from('salon_blackouts').delete().eq('day', b.dataset.del)); route(); }));
  }

  /* ======================= finance ======================= */
  const EXP_CAT = { rent: 'إيجار', salaries: 'رواتب', commissions: 'عمولات', utilities: 'كهرباء وماء', telecom: 'إنترنت واتصالات', marketing: 'تسويق وإعلانات', maintenance: 'صيانة', government: 'رسوم حكومية وتراخيص', subscriptions: 'اشتراكات وأنظمة', hospitality: 'ضيافة', transport: 'مشاوير وتوصيل', supplies_other: 'مستلزمات خارج المخزون', other: 'أخرى' };
  const PAY_KEYS = [['cash', 'كاش'], ['card', 'شبكة'], ['transfer', 'تحويل'], ['online', 'رابط دفع'], ['bnpl', 'تابي وتمارا'], ['other', 'أخرى']];
  const SALE_CATS = [['nails', 'أظافر'], ['hair', 'شعر'], ['makeup', 'مكياج'], ['lashes', 'رموش وحواجب'], ['products', 'منتجات'], ['other_cat', 'أخرى']];
  const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const sar = (v) => { const n = Number(v || 0); const t = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); return n < 0 && t !== '0' ? `\u2066-${t}\u2069` : t; };
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const todayR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

  function bars(rows, max, labelFn) {
    return rows.map(([k, v]) => `<div class="fbar"><div class="fbar-top"><span>${esc(labelFn(k))}</span><b class="num">${sar(v)}</b></div><div class="fbar-track"><i style="width:${max ? Math.max(2, (v / max) * 100) : 0}%"></i></div></div>`).join('');
  }

  const LENSES = [['d', 'اليوم'], ['w', 'الأسبوع'], ['m', 'الشهر'], ['q', 'الربع'], ['y', 'السنة']];
  const QN = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
  const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const D = (s) => new Date(s + 'T12:00:00');
  function lensRange(lens, at) {
    const y = at.getFullYear(), mo = at.getMonth();
    if (lens === 'd') return [at, at];
    if (lens === 'w') { const s = new Date(at); s.setDate(at.getDate() - ((at.getDay() + 1) % 7)); const e = new Date(s); e.setDate(s.getDate() + 6); return [s, e]; }
    if (lens === 'q') { const q0 = Math.floor(mo / 3) * 3; return [new Date(y, q0, 1, 12), new Date(y, q0 + 3, 0, 12)]; }
    if (lens === 'y') return [new Date(y, 0, 1, 12), new Date(y, 11, 31, 12)];
    return [new Date(y, mo, 1, 12), new Date(y, mo + 1, 0, 12)];
  }
  function lensShift(lens, at, n) {
    const d = new Date(at);
    if (lens === 'd') d.setDate(d.getDate() + n);
    else if (lens === 'w') d.setDate(d.getDate() + 7 * n);
    else if (lens === 'm') d.setMonth(d.getMonth() + n, 1);
    else if (lens === 'q') d.setMonth(d.getMonth() + 3 * n, 1);
    else d.setFullYear(d.getFullYear() + n, 0, 1);
    return d;
  }
  function lensTitle(lens, s, e) {
    if (lens === 'd') return `${WDAYS[s.getDay()]} ${s.getDate()} ${MONTHS_AR[s.getMonth()]}`;
    if (lens === 'w') return s.getMonth() === e.getMonth() ? `${s.getDate()} – ${e.getDate()} ${MONTHS_AR[s.getMonth()]}` : `${s.getDate()} ${MONTHS_AR[s.getMonth()]} – ${e.getDate()} ${MONTHS_AR[e.getMonth()]}`;
    if (lens === 'q') return `الربع ${QN[Math.floor(s.getMonth() / 3)]} ${s.getFullYear()}`;
    if (lens === 'y') return `سنة ${s.getFullYear()}`;
    return `${MONTHS_AR[s.getMonth()]} ${s.getFullYear()}`;
  }
  const LENS_PREV = { d: 'أمس', w: 'الأسبوع الماضي', m: 'الشهر الماضي', q: 'الربع الماضي', y: 'السنة الماضية' };
  const LENS_THIS = { d: 'هذا اليوم', w: 'هذا الأسبوع', m: 'هذا الشهر', q: 'هذا الربع', y: 'هذي السنة' };

  /* ======================= لوحة المبيعات ======================= */
  const SD_LENSES = [['d', 'اليوم'], ['w', 'الأسبوع'], ['m', 'الشهر'], ['q', 'الربع'], ['y', 'السنة'], ['c', 'مخصص']];
  const SD_TABS = [['sales', 'المبيعات'], ['svc', 'الخدمات'], ['team', 'الأخصائيات'], ['clients', 'العميلات'], ['time', 'أوقات الذروة'], ['profit', 'الربح الصافي']];
  const SD_GRP = { hair: 'الشعر', nails: 'الأظافر', face: 'خدمات الوجه', lashes: 'الرموش والحواجب', makeup: 'المكياج', other: 'الباقات والعروض' };
  const SD_METH = { point_of_sales: 'شبكة (مدى وفيزا)', cash: 'كاش', bank_transfer: 'تحويل بنكي', buy_now_pay_later: 'تابي وتمارا', online: 'دفع إلكتروني', other: 'أخرى' };
  const SD_SRC = { internal: 'من الاستقبال', website: 'من الموقع (العميلة حجزت بنفسها)' };
  const SD_PREV = { d: 'أمس', w: 'الأسبوع الماضي', m: 'الشهر الماضي', q: 'الربع الماضي', y: 'السنة الماضية', c: 'الفترة اللي قبلها' };
  const sdPct = (a, b) => (Number(b) > 0 ? ((Number(a) - Number(b)) / Number(b)) * 100 : null);
  const sdRecon = (K, lens) => {
    const sales = Number(K.sales), col = Number(K.collected), diff = col - sales, prev = Number(K.prev_paid || 0), un = Number(K.unpaid || 0), ref = Number(K.refunds || 0);
    if (Math.abs(diff) < Math.max(50, sales * 0.01)) return '';
    const per = { d: 'اليوم', w: 'الأسبوع', m: 'الشهر', q: 'الربع', y: 'السنة' }[lens] || 'الفترة';
    const why = [];
    if (prev > 0) why.push(`<b>${sar(prev)} ر.س</b> دفعات وصلت ${per === 'اليوم' ? 'اليوم' : `في ${per}`} على ${sdN(K.prev_orders)} طلب انفتح قبل`);
    if (un > 0) why.push(`<b>${sar(un)} ر.س</b> من طلبات ${per} لسه ما انحصّلت`);
    if (ref > 0) why.push(`<b>${sar(ref)} ر.س</b> مسترجع`);
    if (!why.length) return '';
    return `<div class="sd-recon"><span class="ic">ⓘ</span><p>المحصّل ${diff > 0 ? 'أكثر' : 'أقل'} من المبيعات بـ<b>${sar(Math.abs(diff))} ر.س</b> لأن المبيعات تنحسب بيوم فتح الطلب والمحصّل بيوم دخول الفلوس: ${why.join('، و')}.</p></div>`;
  };
  const sdShare = (a, b) => (Number(b) > 0 ? Math.round((Number(a) / Number(b)) * 100) : 0);
  const sdN = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  function sdChip(cur, prev, { inv = false, tip = '' } = {}) {
    const p = sdPct(cur, prev); if (p == null || !isFinite(p)) return '';
    const flat = Math.abs(p) < 0.5, good = inv ? p < 0 : p > 0;
    return `<span class="sd-d ${flat ? '' : good ? 'up' : 'down'}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${flat ? '=' : p > 0 ? '▲' : '▼'} ${flat ? 'نفسه' : `${Math.abs(Math.round(p))}٪`}</span>`;
  }
  function sdTips(root) {
    let tip = document.getElementById('sd-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'sd-tip'; tip.hidden = true; document.body.appendChild(tip); addEventListener('scroll', () => { tip.hidden = true; }, { passive: true }); addEventListener('hashchange', () => { tip.hidden = true; }); }
    const place = (e) => { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, e.clientX - w / 2))}px`; tip.style.top = `${Math.max(8, e.clientY - h - 14)}px`; };
    root.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (!t || !root.contains(t)) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; place(e); });
    root.addEventListener('pointermove', (e) => { if (!tip.hidden) place(e); });
    root.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
  const sdAgo = (ts) => { if (!ts) return '—'; const m = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60000)); return m < 1 ? 'الحين' : m === 1 ? 'قبل دقيقة' : m === 2 ? 'قبل دقيقتين' : m < 11 ? `قبل ${m} دقائق` : m < 60 ? `قبل ${m} دقيقة` : `قبل ${Math.round(m / 60)} ساعة`; };
  const sdTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit' }).replace('AM', 'ص').replace('PM', 'م');
  const sdHour = (h) => { const x = h % 12 || 12; return `${x}${h < 12 ? 'ص' : 'م'}`; };

  /* أرقام تعدّ لين قيمتها */
  const SD_NUMS = new Map();
  const sdCu = (key, v, f) => `<span class="cu" data-cu="${key}" data-v="${Number(v) || 0}"${f ? ` data-f="${f}"` : ''}>${f === 'p' ? `${Math.round(Number(v) || 0)}٪` : sdN(v)}</span>`;
  function sdCount(root) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $$('[data-cu]', root).forEach((el) => {
      const key = el.dataset.cu, to = Number(el.dataset.v), from = SD_NUMS.has(key) ? SD_NUMS.get(key) : 0;
      SD_NUMS.set(key, to);
      const fmt = el.dataset.f === 'p' ? (x) => `${Math.round(x)}٪` : (x) => sdN(x);
      if (reduce || from === to) { el.textContent = fmt(to); return; }
      const t0 = performance.now(), dur = 900;
      el.textContent = fmt(from);
      const step = (t) => { const p = Math.min(1, (t - t0) / dur), k = 1 - Math.pow(1 - p, 4); el.textContent = fmt(from + (to - from) * k); if (p < 1 && el.isConnected) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  const sdStagger = (root) => { [...root.children].forEach((c, i) => { c.style.setProperty('--i', Math.min(i, 12)); c.classList.add('sd-up'); }); };
  function sdSlide(container) {
    const on = $('.on', container), ind = $('.sd-ind', container); if (!on || !ind) return;
    ind.style.width = `${on.offsetWidth}px`; ind.style.height = `${on.offsetHeight}px`; ind.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    container.classList.add('has-ind');
  }
  function sdPeriodName(lens, s, e, tk) {
    if (lens === 'd') { const t = D(tk); const diff = Math.round((s - t) / 86400000); return diff === 0 ? 'اليوم' : diff === -1 ? 'أمس' : diff === 1 ? 'بكرة' : `${WDAYS[s.getDay()]} ${s.getDate()} ${MONTHS_AR[s.getMonth()]}`; }
    if (lens === 'w') { const cur = lensRange('w', D(tk))[0]; const diff = Math.round((s - cur) / (7 * 86400000)); if (diff === 0) return 'هالأسبوع'; if (diff === -1) return 'الأسبوع الماضي'; if (diff === 1) return 'الأسبوع الجاي'; return lensTitle('w', s, e); }
    if (lens === 'q') return `الربع ${QN[Math.floor(s.getMonth() / 3)]}${s.getFullYear() !== D(tk).getFullYear() ? ` ${s.getFullYear()}` : ''}`;
    if (lens === 'y') return `${s.getFullYear()}`;
    return `${MONTHS_AR[s.getMonth()]}${s.getFullYear() !== D(tk).getFullYear() ? ` ${s.getFullYear()}` : ''}`;
  }

  async function pageSales(view, _a, params, alive) {
    const tk = todayR();
    const st = {
      lens: (() => { const l = params.get('l') || (() => { try { return localStorage.getItem('bf-sd-lens'); } catch { return null; } })() || 'm'; return SD_LENSES.some((x) => x[0] === l) ? l : 'm'; })(),
      at: params.get('at') ? D(params.get('at')) : D(tk),
      f: params.get('f'), t: params.get('t'),
      tab: SD_TABS.some((x) => x[0] === params.get('tab')) ? params.get('tab') : 'sales',
    };
    const cache = new Map();
    let P = null, R = null, seq = 0;
    const range = (o = st) => {
      if (o.lens === 'c') {
        let s = D(o.f || dk(lensShift('d', D(tk), -29))), e = D(o.t || tk);
        if (e < s) [s, e] = [e, s];
        if ((e - s) / 86400000 > 399) s = lensShift('d', e, -399);
        return [s, e];
      }
      return lensRange(o.lens, o.at);
    };
    const url = () => { const [s, e] = range(); const p = new URLSearchParams({ l: st.lens }); if (st.lens === 'c') { p.set('f', dk(s)); p.set('t', dk(e)); } else p.set('at', dk(st.at)); p.set('tab', st.tab); return `#/sales?${p}`; };
    const fetchDash = (s, e) => { const k = `${dk(s)}|${dk(e)}`; if (!cache.has(k)) cache.set(k, q(sb.rpc('sales_dash', { p_from: dk(s), p_to: dk(e) })).catch((err) => { cache.delete(k); throw err; })); return cache.get(k); };

    view.innerHTML = `
      <div class="sd">
        <div class="lens sd-lens" id="sd-lens"><i class="sd-ind"></i>${SD_LENSES.map(([k, l]) => `<a href="#" data-l="${k}" class="${k === st.lens ? 'on' : ''}">${l}</a>`).join('')}</div>
        <div id="sd-nav"></div>
        <div class="sd-live" id="sd-live"><i></i>مربوطة بركاز مباشرة<span id="sd-sync"></span><button class="link" id="sd-csv">${I.list} تصدير Excel</button></div>
        <div class="sd-progress" id="sd-prog"></div>
        <div id="sd-a">${sdSkeleton()}</div>
        <div id="sd-pulse"></div>
        <div id="sd-b"></div>
      </div>`;
    sdTips(view);
    const lensEl = $('#sd-lens', view);
    requestAnimationFrame(() => sdSlide(lensEl));
    document.fonts?.ready.then(() => { if (alive()) { sdSlide(lensEl); const tb = $('.sd-tabs', view); tb && sdSlide(tb); } });
    addEventListener('resize', () => { if (alive()) { sdSlide(lensEl); const tb = $('.sd-tabs', view); tb && sdSlide(tb); } });

    const drawNav = () => {
      const [s, e] = range(); const box = $('#sd-nav', view);
      if (st.lens === 'c') {
        box.innerHTML = `<form class="sd-custom" id="sd-cf"><label>من <input class="input" type="date" id="sd-f" value="${dk(s)}" max="${tk}"></label><label>إلى <input class="input" type="date" id="sd-t" value="${dk(e)}"></label><button class="btn primary">عرض</button></form>`;
        $('#sd-cf', box).addEventListener('submit', (ev) => { ev.preventDefault(); st.f = $('#sd-f', box).value; st.t = $('#sd-t', box).value; go(); });
        return;
      }
      const [ps, pe] = lensRange(st.lens, lensShift(st.lens, st.at, -1)), [ns, ne] = lensRange(st.lens, lensShift(st.lens, st.at, 1));
      const isCur = dk(s) <= tk && tk <= dk(e), canNext = dk(ns) <= tk;
      const sub = st.lens === 'd' ? `${WDAYS[s.getDay()]} ${s.getDate()} ${MONTHS_AR[s.getMonth()]} ${s.getFullYear()}` : st.lens === 'm' ? `${s.getFullYear()}` : st.lens === 'q' ? `${MONTHS_AR[s.getMonth()]} – ${MONTHS_AR[e.getMonth()]} ${s.getFullYear()}` : st.lens === 'y' ? '' : lensTitle(st.lens, s, e);
      box.innerHTML = `<div class="sd-nav">
        <button class="sd-step" data-step="-1"><span class="ar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span><span><small>السابق</small><b>${sdPeriodName(st.lens, ps, pe, tk)}</b></span></button>
        <div class="sd-now"><h2>${sdPeriodName(st.lens, s, e, tk)}</h2><small>${sub !== sdPeriodName(st.lens, s, e, tk) ? sub : ''}</small>${!isCur ? `<button class="sd-back" id="sd-today">ارجع لـ${{ d: 'اليوم', w: 'هالأسبوع', m: 'هالشهر', q: 'هالربع', y: 'هالسنة' }[st.lens]}</button>` : '<span class="sd-badge">الحالي</span>'}</div>
        <button class="sd-step" data-step="1" ${canNext ? '' : 'disabled'}><span><small>التالي</small><b>${sdPeriodName(st.lens, ns, ne, tk)}</b></span><span class="ar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></span></button>
      </div>`;
      $$('.sd-step', box).forEach((b) => b.addEventListener('click', () => { st.at = lensShift(st.lens, st.at, Number(b.dataset.step)); go(Number(b.dataset.step)); }));
      $('#sd-today', box)?.addEventListener('click', () => { st.at = D(tk); go(); });
    };

    $$('a[data-l]', lensEl).forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault(); const l = a.dataset.l; if (l === st.lens) return;
      if (l === 'c') { const [s, e] = range(); st.f = dk(s); st.t = dk(e) > tk ? tk : dk(e); } else if (st.lens === 'c') st.at = D(st.t || tk);
      st.lens = l; try { localStorage.setItem('bf-sd-lens', l); } catch {}
      $$('a[data-l]', lensEl).forEach((x) => x.classList.toggle('on', x === a)); sdSlide(lensEl);
      go();
    }));

    let retried = false;
    async function go(dir = 0) {
      const my = ++seq; const [s, e] = range();
      history.replaceState(null, '', url()); drawNav();
      const a = $('#sd-a', view), b = $('#sd-b', view), prog = $('#sd-prog', view);
      const hit = cache.has(`${dk(s)}|${dk(e)}`);
      if (!hit) { a.classList.add('sd-busy'); b.classList.add('sd-busy'); prog.classList.add('on'); }
      try {
        const [r, p] = await Promise.all([fetchDash(s, e), P ? Promise.resolve(P) : q(sb.rpc('sales_pulse'))]);
        if (!alive() || my !== seq) return;
        P = p; R = r; retried = false;
        render(r, s, e, dir);
        // نجهّز الفترة اللي قبل بالخلفية عشان تفتح فورًا
        if (['d', 'w', 'm'].includes(st.lens)) { const [ps, pe] = lensRange(st.lens, lensShift(st.lens, st.at, -1)); setTimeout(() => fetchDash(ps, pe).catch(() => {}), 600); }
      } catch (err) {
        if (my !== seq || !alive()) return;
        if (!retried) { retried = true; return go(dir); }
        a.innerHTML = `<div class="sd-err"><b>ما قدرنا نجيب الأرقام هالمرة</b><span>غالبًا النت أو الفترة كبيرة. جرّب مرة ثانية.</span><button class="btn primary" id="sd-retry">حاول مرة ثانية</button></div>`; b.innerHTML = '';
        $('#sd-retry', a).onclick = () => { retried = false; go(); };
      } finally {
        if (my === seq) { a.classList.remove('sd-busy'); b.classList.remove('sd-busy'); prog.classList.remove('on'); }
      }
    }

    function render(r, s, e, dir) {
      if (r.kp_ok === false && !r._fixed) { r.kp = {}; r.services.forEach((x) => { x.pv = 0; x.pn = 0; }); r.providers.forEach((x) => { x.pv = 0; }); r.groups.forEach((x) => { x.pv = 0; }); if (r.cmp_kind !== 'ly') r.cmp = []; r._fixed = true; }
      const lens = st.lens, K = r.k, KP = r.kp, KY = r.ky, monthly = r.unit === 'month';
      const isCurrent = dk(s) <= tk && tk <= dk(e);
      const cmpName = r.cmp_kind === 'ly' ? 'نفس الفترة السنة الماضية' : SD_PREV[lens];
      $('#sd-sync', view).textContent = ` · آخر تحديث ${sdAgo(r.synced_at)}`;

      const spark = (() => {
        const S = r.series.filter((x) => x.k <= tk); if (S.length < 2) return '';
        const mx = Math.max(1, ...S.map((x) => Number(x.s)));
        const pts = S.map((x, i) => [100 - (i / (S.length - 1)) * 100, 96 - (Number(x.s) / mx) * 86]);
        const line = pts.map((p) => p.join(',')).join(' ');
        return `<svg class="sd-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sdg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5A45" stop-opacity=".22"/><stop offset="1" stop-color="#8A5A45" stop-opacity="0"/></linearGradient></defs><polygon points="100,100 ${line} 0,100" fill="url(#sdg)"/><polyline points="${line}" fill="none" stroke="#5A2A22" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
      })();
      const tgtHtml = (() => {
        if (!(lens === 'm' && isCurrent)) return '';
        const T = Number(P.target || 0), mtd = Number(P.mtd.sales);
        const days = P.month_days; const hr = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false })) % 24;
        const elapsed = Math.max(0.5, P.day_of_month - 1 + Math.min(1, Math.max(0, (hr - 9) / 14)));
        const lmRate = Number(P.last_month.sales) / (new Date(s.getFullYear(), s.getMonth(), 0).getDate() || 30);
        const rate = elapsed >= 7 ? mtd / elapsed : (mtd / elapsed + lmRate) / 2;
        const fc = Math.round(mtd + rate * Math.max(0, days - elapsed));
        if (!T) return `<div class="sd-fc"><span>المتوقع لنهاية الشهر</span><b class="num">${sdCu('fc', fc)} ر.س</b>${Number(P.rest_month.v) ? `<em>ومحجوز لباقي الشهر ${sar(P.rest_month.v)} ر.س</em>` : ''}<button class="tgt-empty sm" id="tgt-set">${I.plus} حطّوا هدف للشهر</button></div>`;
        const pc = Math.min(100, (mtd / T) * 100), left = Math.max(0, T - mtd), dl = Math.max(1, days - P.day_of_month + 1);
        const msg = mtd >= T ? 'وصلتوا للهدف 🤍' : fc >= T ? `على هالمعدل بتوصلون الهدف وزيادة ${sar(fc - T)} ر.س` : `باقي ${sar(left)} ر.س، يعني ${sar(left / dl)} باليوم`;
        return `<div class="tgt"><div class="tgt-top"><span>هدف الشهر <b class="num">${sar(T)}</b></span><button class="tgt-edit" id="tgt-set" aria-label="تعديل الهدف">${I.edit}</button><b class="num">${sdCu('tgtp', pc, 'p')}</b></div>
          <div class="tgt-track"><i style="width:${pc}%"></i><s style="inset-inline-start:${Math.min(100, (fc / T) * 100)}%" data-tip="المتوقع لنهاية الشهر ${sar(fc)} ر.س"></s></div>
          <div class="tgt-msg">${msg} · المتوقع ${sar(fc)} ر.س</div></div>`;
      })();
      const insights = (() => {
        const L = [];
        const pc = sdPct(K.sales, KP.sales);
        if (pc != null && Math.abs(pc) >= 3) L.push(['📈', `المبيعات ${pc > 0 ? 'زادت' : 'نقصت'} <b>${Math.abs(Math.round(pc))}٪</b> عن ${r.partial ? 'نفس الوقت ' : ''}${SD_PREV[lens]} من ${sar(KP.sales)} إلى ${sar(K.sales)} ر.س`, pc > 0 ? 'good' : 'bad']);
        const sv = r.services.filter((x) => x.pv > 300 && x.v > 0).map((x) => ({ ...x, g: x.v - x.pv }));
        const up = [...sv].sort((a, b) => b.g - a.g)[0], dn = [...sv].sort((a, b) => a.g - b.g)[0];
        if (up && up.g > 0) L.push(['🚀', `<b>${esc(up.name)}</b> أكثر خدمة نمت: +${sar(up.g)} ر.س عن ${SD_PREV[lens]}`, 'good', 'svc']);
        if (dn && dn.g < -200) L.push(['🔻', `<b>${esc(dn.name)}</b> نزلت ${sar(-dn.g)} ر.س عن ${SD_PREV[lens]}، تستاهل عرض أو تذكير`, 'bad', 'svc']);
        const wd = Array(7).fill(0); r.heat.forEach((h) => { wd[h.d] += Number(h.v); });
        const wdN = Array(7).fill(0); if (!monthly) r.series.filter((x) => x.k <= tk).forEach((x) => { wdN[D(x.k).getDay()]++; });
        const avg = wd.map((v, i) => [i, wdN[i] ? v / wdN[i] : v]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
        if (avg.length >= 4) L.push(['🗓', `أقوى يوم <b>${WDAYS[avg[0][0]]}</b> وأضعفه <b>${WDAYS[avg[avg.length - 1][0]]}</b> (${sdShare(avg[avg.length - 1][1], avg[0][1])}٪ منه). عرض خاص لـ${WDAYS[avg[avg.length - 1][0]]} يرفع الأسبوع كله`, '', 'time']);
        const lost = Number(K.cancelled_value) + Number(K.noshow_value);
        if (lost > 0) L.push(['⏳', `ضاع <b>${sar(lost)} ر.س</b> بين إلغاء (${K.cancelled}) وما حضرت (${K.noshow}). عربون بسيط عند الحجز يقلّلها كثير`, 'bad', 'time']);
        if (P.at_risk.n) L.push(['💌', `<b>${sdN(P.at_risk.n)} عميلة</b> كانت تجي بانتظام وانقطعت، صرفوا عندكم قبل ${sar(P.at_risk.spend)} ر.س. رسالة وحشتينا ترجّع جزء منهم`, 'bad', 'clients']);
        const top = r.providers[0]; const tot = r.providers.reduce((a, x) => a + Number(x.v), 0);
        if (top && tot) L.push(['👑', `<b>${esc(top.name)}</b> الأعلى دخل: ${sar(top.v)} ر.س (${sdShare(top.v, tot)}٪ من دخل الأخصائيات)`, 'good', 'team']);
        const web = r.sources.find((x) => x.s === 'website'), allO = r.sources.reduce((a, x) => a + x.n, 0);
        if (allO) L.push(['🌐', `${web ? `<b>${sdShare(web.n, allO)}٪</b> من الطلبات جات من الموقع` : 'ولا طلب جا من الموقع'}. لما ننقل الحجز لموقعنا تزيد هالنسبة ويخف الضغط على الاستقبال`, '']);
        const ret = K.clients - K.new_clients; if (K.clients) L.push(['🤍', `<b>${sdShare(ret, K.clients)}٪</b> من العميلات رجعوا لكم من قبل، و<b>${sdN(K.new_clients)}</b> أول مرة يجون`, 'good', 'clients']);
        return L.slice(0, 6);
      })();
      const vsTxt = `${r.partial ? 'نفس الوقت ' : ''}${SD_PREV[lens]}`;

      const A = $('#sd-a', view);
      A.innerHTML = `
        <div class="fin-hero sd-hero ${dir ? (dir > 0 ? 'from-l' : 'from-r') : ''}">
          <div class="fin-hero-top"><span data-tip="قيمة الطلبات المؤكدة شامل الضريبة، نفس «إجمالي المبيعات» في ركاز">إجمالي المبيعات ⓘ</span>
            <span class="sd-chips">${sdChip(K.sales, KP.sales, { tip: `${r.partial ? 'لين نفس الوقت من ' : ''}${SD_PREV[lens]}: ${sar(KP.sales)} ر.س` }).replace('</span>', ` عن ${vsTxt}</span>`)}${KY ? sdChip(K.sales, KY.sales, { tip: `السنة الماضية: ${sar(KY.sales)} ر.س` }).replace('</span>', ' عن السنة الماضية</span>') : ''}</span></div>
          <div class="fin-net num">${sdCu('sales', K.sales)} <small>ر.س</small></div>
          <div class="sd-sub">${sdN(K.orders)} طلب مؤكد</div>
          ${spark}
          ${tgtHtml}
          <div class="fin-split sd-split">
            <div data-tip="المبيعات بدون ضريبة القيمة المضافة"><span>صافي المبيعات</span><b class="num">${sdCu('net', K.net_sales)}</b><em>الضريبة ${sar(K.tax)}</em></div>
            <div data-tip="المدفوعات اللي دخلت فعلًا في الفترة ناقص المسترجع، نفس «صافي المبالغ المدفوعة» في ركاز"><span>صافي المحصّل</span><b class="num">${sdCu('col', K.collected)}</b><em>${Number(K.prev_paid) > 0 ? `منها ${sar(K.prev_paid)} لطلبات سابقة` : `المسترجع ${sar(K.refunds)}`}</em></div>
            <div><span>الخصومات</span><b class="num">${sdCu('disc', K.discount)}</b><em>${Number(K.discount) > 0 ? `${sdShare(K.discount, Number(K.sales) + Number(K.discount))}٪ من قبل الخصم` : 'ما فيه خصومات'}</em></div>
            ${Number(K.home) ? `<div><span>الخدمات المنزلية</span><b class="num">${sdCu('home', K.home)}</b><em>من موقعنا</em></div>` : ''}
          </div>
          ${sdRecon(K, lens)}
        </div>`;

      const B = $('#sd-b', view);
      const kp = (a, b) => (b ? a / b : 0);
      B.innerHTML = `
        <div class="sd-kpis">
          ${[
            ['الحجوزات المؤكدة', sdCu('k1', K.bookings), sdChip(K.bookings, KP.bookings), `${sdN(K.visits)} زيارة`, 'كل خدمة محجوزة ومؤكدة في الفترة'],
            ['العميلات', sdCu('k2', K.clients), sdChip(K.clients, KP.clients), `منهم ${sdN(K.new_clients)} جدد`, 'عدد العميلات المختلفات اللي جوكم'],
            ['متوسط الزيارة', `${sdCu('k3', K.avg_ticket)} <small>ر.س</small>`, sdChip(K.avg_ticket, KP.avg_ticket), 'قيمة الخدمات ÷ الزيارات', 'كم تصرف العميلة بالمتوسط في الزيارة الوحدة'],
            ['قيمة الخدمات', `${sdCu('k4', K.svc)} <small>ر.س</small>`, sdChip(K.svc, KP.svc), 'حسب يوم الموعد', 'قيمة كل الخدمات اللي انقدمت في الفترة (حسب تاريخ الموعد مو تاريخ الدفع)'],
            ['نسبة الإلغاء', sdCu('k5', kp(K.cancelled, K.all) * 100, 'p'), sdChip(kp(K.cancelled, K.all), kp(KP.cancelled, KP.all), { inv: true }), `${sdN(K.cancelled)} حجز · ${sar(K.cancelled_value)} ر.س`, 'الحجوزات الملغية من كل الحجوزات'],
            ['ما حضرت', sdCu('k6', kp(K.noshow, K.all) * 100, 'p'), sdChip(kp(K.noshow, K.all), kp(KP.noshow, KP.all), { inv: true }), `${sdN(K.noshow)} حجز · ${sar(K.noshow_value)} ر.س`, 'حجز موعده فات وما انقفل ولا انلغى في ركاز'],
            ['ساعات الخدمة', sdCu('k7', K.hours), sdChip(K.hours, KP.hours), `دخل الساعة ${sar(K.hours ? K.svc / K.hours : 0)} ر.س`, 'مجموع مدة الخدمات المحجوزة'],
            ['عميلات جدد', sdCu('k8', K.new_clients), sdChip(K.new_clients, KP.new_clients), `${sdShare(K.new_clients, K.clients)}٪ من العميلات`, 'أول زيارة لهم عندكم كانت في هالفترة'],
          ].map(([l, v, c, sub, tip]) => `<div class="sd-kpi" data-tip="${esc(tip)}"><span>${l}</span><b class="num">${v}</b><em>${c}${sub}</em></div>`).join('')}
        </div>
        ${insights.length ? `<div class="section-title"><h2>لمحات ذكية</h2><span class="muted small">تطلع لحالها من أرقامكم</span></div>
        <div class="sd-ins">${insights.map(([ic, t, k, g]) => `<${g ? `a href="#" data-go="${g}"` : 'div'} class="sd-in ${k || ''}"><i>${ic}</i><p>${t}</p>${g ? '<span class="go">‹</span>' : ''}</${g ? 'a' : 'div'}>`).join('')}</div>` : ''}
        <div class="sd-tabs" role="tablist"><i class="sd-ind"></i>${SD_TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${k === st.tab ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div id="sd-body"></div>`;

      sdStagger($('.sd-kpis', B)); $('.sd-ins', B) && sdStagger($('.sd-ins', B));
      sdCount(A); sdCount(B);
      const tabsEl = $('.sd-tabs', B), body = $('#sd-body', B);
      const show = (t, animate) => {
        st.tab = t; history.replaceState(null, '', url());
        $$('button', tabsEl).forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
        sdSlide(tabsEl); { const o = $('.on', tabsEl); if (o) { const c = tabsEl.getBoundingClientRect(), b = o.getBoundingClientRect(); if (b.left < c.left) tabsEl.scrollBy({ left: b.left - c.left - 16, behavior: animate ? 'smooth' : 'auto' }); else if (b.right > c.right) tabsEl.scrollBy({ left: b.right - c.right + 16, behavior: animate ? 'smooth' : 'auto' }); } }
        const paint = () => {
          body.innerHTML = ({ sales: sdTabSales, svc: sdTabSvc, team: sdTabTeam, clients: sdTabClients, time: sdTabTime, profit: sdTabProfit })[t](r, P, { lens, cmpName, monthly, s, e });
          sdBind(body, r, P, t); sdCount(body);
          body.classList.remove('out'); body.classList.remove('in'); void body.offsetWidth; body.classList.add('in');
        };
        if (animate) { body.classList.add('out'); setTimeout(paint, 160); } else paint();
      };
      $$('button', tabsEl).forEach((x) => x.addEventListener('click', () => { if (x.dataset.tab !== st.tab) show(x.dataset.tab, true); }));
      $$('[data-go]', B).forEach((x) => x.addEventListener('click', (ev) => { ev.preventDefault(); show(x.dataset.go, true); tabsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
      show(st.tab, false);
      requestAnimationFrame(() => sdSlide(tabsEl));
      $('#tgt-set', A)?.addEventListener('click', () => targetForm(monthKey(s), P.target, P.last_month.sales));
      drawPulse(isCurrent);
    }

    /* ---------- النبض المباشر ---------- */
    let pulseOn = false, firstPulse = true;
    function drawPulse(show) {
      const box = $('#sd-pulse', view); if (!box) return;
      pulseOn = show;
      if (!show) { box.innerHTML = ''; return; }
      const k = P.k, kw = P.kw, H = P.hours;
      const nowH = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false })) % 24;
      const h0 = 9, h1 = 24, mx = Math.max(1, ...H.map((x) => Math.max(Number(x.t), Number(x.w))));
      const X = (h) => ((h + 1 - h0) / (h1 - h0)) * 100, XM = (h) => 100 - X(h), Y = (v) => 96 - (Number(v) / mx) * 88;
      const lineT = H.filter((x) => x.h >= h0 - 1 && x.h <= nowH).map((x) => `${XM(x.h)},${Y(x.t)}`).join(' ');
      const lineW = H.filter((x) => x.h >= h0 - 1).map((x) => `${XM(x.h)},${Y(x.w)}`).join(' ');
      const lastT = H.filter((x) => x.h >= h0 - 1 && x.h <= nowH).slice(-1)[0];
      box.innerHTML = `
        <div class="card sd-pulse ${firstPulse ? 'sd-up' : ''}">
          <div class="sd-pulse-h"><h3><i class="sd-dot"></i>اليوم لحظة بلحظة</h3><span class="muted small">يتحدث لحاله كل دقيقة</span></div>
          <div class="sd-pulse-g">
            <div data-tip="قيمة الطلبات المؤكدة اليوم شامل الضريبة"><span>مبيعات اليوم</span><b class="num">${sdCu('p1', k.sales)}</b><em>${sdChip(k.sales, kw.sales, { tip: `نفس الوقت ${WDAYS[new Date().getDay()]} الماضي: ${sar(kw.sales)} ر.س` })} عن نفس الوقت ${WDAYS[new Date().getDay()]} الماضي</em></div>
            <div><span>حجوزات اليوم</span><b class="num">${sdCu('p2', k.bookings)}</b><em>${sdN(k.clients)} عميلة${k.cancelled ? ` · ${k.cancelled} إلغاء` : ''}</em></div>
            <div><span>باقي اليوم</span><b class="num">${sdCu('p3', P.left_today.n)}</b><em>موعد بقيمة ${sar(P.left_today.v)} ر.س</em></div>
            <div data-tip="الحجوزات المؤكدة والمعلقة للسبعة أيام الجاية (يزيد كل ما حجزوا أكثر)"><span>محجوز للأسبوع الجاي</span><b class="num">${sdCu('p4', P.next7.v)}</b><em>${sdN(P.next7.n)} حجز</em></div>
          </div>
          <div class="sd-cum">
            <svg class="${firstPulse ? 'draw' : ''}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline class="w" points="${lineW}" vector-effect="non-scaling-stroke"/>
              <polyline class="t" points="${lineT}" vector-effect="non-scaling-stroke"/>
            </svg>
            ${lastT ? `<span class="sd-now-dot" style="inset-inline-start:${X(lastT.h)}%;top:${Y(lastT.t)}%"></span>` : ''}
            <div class="sd-cum-x">${[10, 13, 16, 19, 22].map((h) => `<span style="inset-inline-start:${X(h - 1)}%">${sdHour(h)}</span>`).join('')}</div>
            <div class="sd-cum-hit">${H.filter((x) => x.h >= h0).map((x) => `<i data-tip="${sdHour(x.h + 1 > 23 ? 0 : x.h + 1)}\nاليوم: ${x.h <= nowH ? sar(x.t) + ' ر.س' : '—'}\nالأسبوع الماضي: ${sar(x.w)} ر.س"></i>`).join('')}</div>
          </div>
          <div class="sd-legend"><span><i class="t"></i>المحصّل اليوم (تراكمي)</span><span><i class="w"></i>نفس اليوم الأسبوع الماضي</span></div>
          ${P.recent.length ? `<div class="sd-feed"><b>آخر المدفوعات</b>${P.recent.slice(0, 6).map((x) => `<div><span class="num">${sdTime(x.at)}</span><span>${esc(firstName(x.name) || 'عميلة')}</span><span class="muted">${SD_METH[x.m] || esc(x.m || '')}</span><b class="num ${x.type === 'refund' ? 'neg' : ''}">${x.type === 'refund' ? '−' : '+'}${sar(x.v)}</b></div>`).join('')}</div>` : ''}
        </div>`;
      sdCount(box); firstPulse = false;
    }
    const tick = async () => {
      if (!alive()) return;
      if (pulseOn && document.visibilityState === 'visible') { try { P = await q(sb.rpc('sales_pulse')); if (alive() && pulseOn) drawPulse(true); } catch {} }
      if (alive()) setTimeout(tick, 60000);
    };
    setTimeout(tick, 60000);

    $('#sd-csv', view).onclick = (ev) => busy(ev.currentTarget, async () => {
      const [s, e] = range();
      try {
        const rows = await q(sb.rpc('sales_export', { p_from: dk(s), p_to: dk(e) }));
        const ST = { confirmed: 'مؤكد', cancelled: 'ملغي', pending: 'معلّق' }, PS = { paid: 'مدفوع', pending: 'غير مدفوع', partially_paid: 'مدفوع جزئي' };
        const head = ['التاريخ', 'الوقت', 'رقم الحجز', 'العميلة', 'الجوال', 'الخدمة', 'الخيار', 'الأخصائية', 'الحالة', 'المبلغ', 'المتبقي', 'رقم الطلب', 'رقم الفاتورة', 'الدفع', 'المصدر'];
        const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        const csv = [head, ...rows.map((x) => [x.day, x.time, x.number, x.client, x.phone, x.service, x.option, x.provider, ST[x.status] || x.status, x.total, x.remaining, x.order, x.invoice, PS[x.pay] || x.pay, x.source === 'website' ? 'الموقع' : 'الاستقبال'])].map((r2) => r2.map(cell).join(',')).join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `مبيعات-بيوتفريش-${dk(s)}-${dk(e)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(`تم تصدير ${rows.length} حجز`);
      } catch (err) { toast(errMsg(err), true); }
    });

    await go();
  }
  function sdSkeleton() {
    return `<div class="sd-skel"><div class="sk hero"></div><div class="sk-row">${'<div class="sk kpi"></div>'.repeat(4)}</div><div class="sk-row">${'<div class="sk kpi"></div>'.repeat(4)}</div></div>`;
  }

  /* ---------- مخطط الأعمدة مع خط المقارنة ---------- */
  function sdChart(r, key, cmpName, monthly) {
    const S = r.series, C = (r.cmp || []).slice(0, S.length), tk = todayR();
    const v = (x) => Number(x?.[key] || 0), money = key !== 'n';
    const mx = Math.max(1, ...S.map(v), ...C.map(v)), n = S.length;
    const step = Math.ceil(n / (innerWidth < 600 ? 8 : 16));
    const lab = (x) => { const d = D(x.k); return monthly ? MONTHS_AR[d.getMonth()].slice(0, 3) : n <= 7 ? WDAYS[d.getDay()].replace(/^ال/, '') : d.getDate(); };
    const full = (x) => { const d = D(x.k); return monthly ? `${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}` : `${WDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`; };
    const fmt = (x) => (money ? `${sar(x)} ر.س` : `${sdN(x)} حجز`);
    const pts = C.map((x, i) => `${((n - i - 0.5) / n) * 100},${100 - (v(x) / mx) * 100}`).join(' ');
    return `<div class="sd-chart">
      <div class="sd-bars">${S.map((x, i) => `<div class="sd-col ${x.k > tk ? 'fut' : ''} ${x.k === tk ? 'today' : ''}" data-tip="${esc(`${full(x)}\n${fmt(v(x))}${C[i] ? `\n${cmpName}: ${fmt(v(C[i]))}` : ''}${x.cl ? `\n${sdN(x.cl)} عميلة` : ''}`)}"><i style="height:${(v(x) / mx) * 100}%"></i></div>`).join('')}
        ${C.length > 1 ? `<svg class="sd-cmp" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" vector-effect="non-scaling-stroke"/></svg>` : ''}</div>
      <div class="sd-xl">${S.map((x, i) => `<span>${i % step === 0 ? lab(x) : ''}</span>`).join('')}</div>
    </div>`;
  }
  const sdBars = (rows, opt = {}) => {
    const mx = Math.max(1, ...rows.map((x) => Number(x.v))), tot = rows.reduce((a, x) => a + Number(x.v), 0);
    return rows.map((x) => `<div class="fbar" ${x.tip ? `data-tip="${esc(x.tip)}"` : ''}><div class="fbar-top"><span>${x.l}</span><b class="num">${opt.count ? sdN(x.v) : sar(x.v)}${opt.share !== false && tot ? ` <small class="muted">${sdShare(x.v, tot)}٪</small>` : ''}${x.chip || ''}</b></div><div class="fbar-track"><i style="width:${Math.max(2, (Number(x.v) / mx) * 100)}%"></i></div>${x.sub ? `<div class="fbar-sub">${x.sub}</div>` : ''}</div>`).join('');
  };

  function sdTabSales(r, P, o) {
    const K = r.k, methods = r.methods.map((x) => ({ l: SD_METH[x.m] || esc(x.m), v: x.v, sub: `${sdN(x.n)} عملية` }));
    const src = r.sources.map((x) => ({ l: SD_SRC[x.s] || esc(x.s), v: x.v, sub: `${sdN(x.n)} طلب` }));
    const L = r.lead || {}, lead = [['نفس اليوم', L.same], ['قبلها بيوم أو يومين', L.d1_2], ['من 3 إلى 7 أيام', L.d3_7], ['قبل أكثر من أسبوع', L.d8]].map(([l, v]) => ({ l, v: Number(v || 0) }));
    const days = r.series.filter((x) => x.k <= todayR());
    const best = [...days].sort((a, b) => b.s - a.s)[0];
    const avgDay = days.length ? days.reduce((a, x) => a + Number(x.s), 0) / days.length : 0;
    return `
      <div class="section-title"><h2>${o.monthly ? 'شهر بشهر' : 'يوم بيوم'}</h2><div class="chips" id="sd-metric">${[['s', 'المبيعات'], ['c', 'المحصّل'], ['v', 'قيمة الخدمات'], ['n', 'الحجوزات']].map(([k, l], i) => `<button class="chip ${i ? '' : 'on'}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="card"><div id="sd-chart">${sdChart(r, 's', o.cmpName, o.monthly)}</div>
        <div class="sd-legend"><span><i class="b"></i>${o.lens === 'c' ? 'الفترة المختارة' : 'هذي الفترة'}</span>${r.cmp?.length > 1 ? `<span><i class="w"></i>${o.cmpName}</span>` : ''}</div>
        <div class="dinsights">
          ${best && Number(best.s) > 0 ? `<div><span>${o.monthly ? 'أفضل شهر' : 'أفضل يوم'}</span><b>${o.monthly ? MONTHS_AR[D(best.k).getMonth()] : `${WDAYS[D(best.k).getDay()]} ${D(best.k).getDate()} ${MONTHS_AR[D(best.k).getMonth()]}`} · ${sar(best.s)} ر.س</b></div>` : ''}
          ${avgDay ? `<div><span>${o.monthly ? 'متوسط الشهر' : 'متوسط اليوم'}</span><b class="num">${sar(avgDay)} ر.س</b></div>` : ''}
          <div><span>متوسط الطلب</span><b class="num">${sar(K.orders ? K.sales / K.orders : 0)} ر.س</b></div>
        </div>
      </div>
      <div class="fin-grid">
        <div><div class="section-title"><h2>طرق الدفع</h2></div><div class="card">${methods.length ? sdBars(methods) : '<div class="empty">ما فيه مدفوعات في هالفترة</div>'}</div></div>
        <div><div class="section-title"><h2>من وين جات الطلبات</h2></div><div class="card">${src.length ? sdBars(src) : '<div class="empty">ما فيه طلبات</div>'}</div></div>
        <div><div class="section-title"><h2>حجوزات الموقع: كم قبل يحجزون؟</h2></div><div class="card">${sdBars(lead, { count: true })}${L.avg != null ? `<p class="muted small" style="margin:10px 0 0">العميلة اللي تحجز من الموقع تحجز بالمتوسط قبل موعدها بـ ${Number(L.avg).toLocaleString('en-US', { maximumFractionDigits: 1 })} يوم</p>` : ''}</div></div>
        <div><div class="section-title"><h2>تفصيل الفلوس</h2></div><div class="card sd-money">
          ${[['صافي المبيعات (قبل الضريبة)', K.net_sales], ['− الخصومات', K.discount, 1], ['+ ضريبة القيمة المضافة', K.tax, 1], ['إجمالي المبيعات', K.sales, 0, 1], ['المدفوعات المستلمة', K.paid], ['− المسترجع', K.refunds, 1], ['صافي المحصّل', K.collected, 0, 1]].map(([l, v, m, b]) => `<div class="${b ? 'b' : ''} ${m ? 'm' : ''}"><span>${l}</span><b class="num">${sar(v)}</b></div>`).join('')}
          <p class="muted small">المبيعات تنحسب بتاريخ الطلب، والمحصّل بتاريخ الدفع، فطبيعي يختلفون شوي (نفس طريقة ركاز بالضبط).</p>
        </div></div>
      </div>`;
  }

  function sdTabSvc(r, P, o) {
    const G = r.groups.filter((x) => Number(x.v) > 0).map((x) => ({ l: SD_GRP[x.grp] || 'أخرى', v: x.v, sub: `${sdN(x.n)} حجز`, chip: sdChip(x.v, x.pv) }));
    const sv = r.services.filter((x) => x.pv > 300).map((x) => ({ ...x, g: Number(x.v) - Number(x.pv) }));
    const up = [...sv].sort((a, b) => b.g - a.g).slice(0, 3).filter((x) => x.g > 0), dn = [...sv].sort((a, b) => a.g - b.g).slice(0, 3).filter((x) => x.g < 0);
    return `
      <div class="fin-grid">
        <div><div class="section-title"><h2>الأقسام</h2></div><div class="card">${G.length ? sdBars(G) : '<div class="empty">ما فيه حجوزات</div>'}</div></div>
        <div><div class="section-title"><h2>صاعدة ونازلة</h2><span class="muted small">عن ${SD_PREV[o.lens]}</span></div><div class="card sd-movers">
          ${up.map((x) => `<div class="up"><span>${esc(x.name)}</span><b class="num">+${sar(x.g)}</b></div>`).join('') || ''}
          ${dn.map((x) => `<div class="down"><span>${esc(x.name)}</span><b class="num">−${sar(-x.g)}</b></div>`).join('') || ''}
          ${!up.length && !dn.length ? '<div class="empty">نحتاج فترة سابقة فيها بيانات للمقارنة</div>' : ''}
        </div></div>
      </div>
      <div class="section-title"><h2>كل الخدمات</h2><div class="sd-tools"><input class="input" type="search" id="sd-q" placeholder="ابحث عن خدمة…"><select class="input" id="sd-sort"><option value="v">الأعلى دخل</option><option value="n">الأكثر طلب</option><option value="g">الأكثر نمو</option><option value="avg">الأعلى سعر</option></select></div></div>
      <div class="card sd-table-wrap"><div id="sd-svc"></div></div>`;
  }
  function sdSvcRows(r, qtext, sort, all) {
    const tot = r.services.reduce((a, x) => a + Number(x.v), 0);
    let L = r.services.map((x) => ({ ...x, g: sdPct(x.v, x.pv) ?? -1e9, avg: x.n ? x.v / x.n : 0 }));
    if (qtext) L = L.filter((x) => (x.name || '').includes(qtext) || (x.cat || '').includes(qtext));
    L.sort((a, b) => Number(b[sort]) - Number(a[sort]));
    const mx = Math.max(1, ...L.map((x) => Number(x.v)));
    const shown = all ? L : L.slice(0, 15);
    return `<table class="sd-table"><thead><tr><th>#</th><th>الخدمة</th><th>الحجوزات</th><th>الدخل</th><th>متوسط السعر</th><th>عن قبل</th></tr></thead><tbody>
      ${shown.map((x, i) => `<tr><td class="muted num">${i + 1}</td><td><b>${esc(x.name)}</b><small>${esc(x.cat || '')} · ${sdN(x.cl)} عميلة</small><div class="sd-mini"><i style="width:${(Number(x.v) / mx) * 100}%"></i></div></td><td class="num">${sdN(x.n)}</td><td class="num"><b>${sar(x.v)}</b><small>${sdShare(x.v, tot)}٪</small></td><td class="num">${sar(x.avg)}</td><td>${sdChip(x.v, x.pv) || '<span class="muted small">جديدة</span>'}</td></tr>`).join('')}
    </tbody></table>${!all && L.length > 15 ? `<button class="btn block" id="sd-all" style="margin-top:10px">عرض كل الخدمات (${L.length})</button>` : ''}${!L.length ? '<div class="empty">ما فيه نتائج</div>' : ''}`;
  }

  function sdTabTeam(r, P, o) {
    const L = r.providers.filter((x) => x.all > 0), tot = L.reduce((a, x) => a + Number(x.v), 0);
    if (!L.length) return '<div class="card"><div class="empty">ما فيه حجوزات للأخصائيات في هالفترة</div></div>';
    const mx = Math.max(1, ...L.map((x) => Number(x.v)));
    return `
      <div class="sd-provs">${L.map((x, i) => {
        const lost = x.all ? Math.round(((x.cx + x.ns) / x.all) * 100) : 0;
        return `<div class="card sd-prov">
          <div class="sd-prov-h"><span class="avatar">${esc(initial(x.name))}</span><div><b>${esc(x.name)}</b><small>${i === 0 ? '👑 الأعلى دخل' : `المركز ${i + 1}`}</small></div><div class="sd-prov-v"><b class="num">${sar(x.v)}</b><small>ر.س ${sdChip(x.v, x.pv, { tip: `${SD_PREV[o.lens]}: ${sar(x.pv)} ر.س` })}</small></div></div>
          <div class="sd-mini big" data-tip="${sdShare(x.v, tot)}٪ من دخل الأخصائيات"><i style="width:${(Number(x.v) / mx) * 100}%"></i></div>
          <div class="sd-prov-g">
            <div data-tip="الحجوزات المؤكدة"><span>حجوزات</span><b class="num">${sdN(x.n)}</b></div>
            <div data-tip="عميلات مختلفات"><span>عميلات</span><b class="num">${sdN(x.cl)}</b></div>
            <div data-tip="مجموع مدة خدماتها"><span>ساعات</span><b class="num">${sdN(x.hrs)}</b></div>
            <div data-tip="دخلها ÷ ساعات خدماتها"><span>دخل الساعة</span><b class="num">${sar(x.hrs ? x.v / x.hrs : 0)}</b></div>
            <div data-tip="من عميلاتها في الفترة، كم وحدة جات لها قبل كذا (ولاء للأخصائية)"><span>رجعوا لها</span><b class="num">${sdShare(x.ret, x.cl)}٪</b></div>
            <div data-tip="إلغاء + ما حضرت من كل حجوزاتها" class="${lost >= 20 ? 'bad' : ''}"><span>إلغاء وغياب</span><b class="num">${lost}٪</b></div>
          </div>
          <div class="sd-prov-f">${x.rating ? `<span class="sd-stars" data-tip="${sdN(x.reviews)} تقييم">★ ${Number(x.rating).toFixed(1)}</span>` : ''}${(x.top || []).map((t) => `<span class="chip sm">${esc(t.name)} · ${sdN(t.n)}</span>`).join('')}</div>
        </div>`;
      }).join('')}</div>
      ${!r.team ? `<a class="sd-cta" href="#/team"><b>تبين تعرفين صافي ربح كل أخصائية؟</b><span>سجّلي الفريق ورواتبهم وعمولاتهم في «الفريق»، ونطلع لك كم تكلّف كل وحدة وكم تدخّل بالضبط، وحتى العمولة تنحسب لحالها ←</span></a>` : ''}`;
  }

  function sdTabClients(r, P, o) {
    const K = r.k, AR = P.at_risk, ret = K.clients - K.new_clients;
    const co = (P.cohorts || []).slice(-9);
    const rv = r.reviews || {};
    const waMsg = (x) => `هلا ${firstName(x.name)} 🤍 وحشتينا في بيوتفريش! صار لنا فترة ما شفناك، وحبينا نذكرك إن ${x.fav ? `«${x.fav}»` : 'موعدك'} ينتظرك. احجزي من هنا: https://beautfresh.com/book`;
    return `
      <div class="sd-kpis sm">
        <div class="sd-kpi" data-tip="جوكم مرة وحدة على الأقل آخر ٩٠ يوم"><span>عميلات نشطات</span><b class="num">${sdN(P.active_clients)}</b><em>آخر ٣ أشهر</em></div>
        <div class="sd-kpi"><span>كل العميلات في ركاز</span><b class="num">${sdN(P.clients_total)}</b><em>من أول ما بديتوا</em></div>
        <div class="sd-kpi"><span>جدد في الفترة</span><b class="num">${sdN(K.new_clients)}</b><em>${sdChip(K.new_clients, r.kp.new_clients)}</em></div>
        <div class="sd-kpi"><span>رجعوا في الفترة</span><b class="num">${sdN(ret)}</b><em>${sdShare(ret, K.clients)}٪ من العميلات</em></div>
      </div>

      <div class="section-title"><h2>عميلات غابوا عن عادتهن</h2><span class="muted small">${sdN(AR.n)} عميلة · صرفوا ${sar(AR.spend)} ر.س</span></div>
      <div class="card sd-risk">
        <p class="muted small" style="margin:0 0 10px">كانوا يجون ٣ مرات وأكثر، وتأخروا عن موعدهم المعتاد بكثير، وما عندهم حجز جاي. رسالة وحدة ممكن ترجّعهم.</p>
        ${AR.list.length ? AR.list.map((x, i) => `<div class="sd-risk-r ${i >= 8 ? 'more' : ''}" ${i >= 8 ? 'hidden' : ''}>
          <span class="avatar">${esc(initial(x.name || '؟'))}</span>
          <div class="grow"><b>${esc(x.name || 'عميلة')}</b><small>${esc(x.fav || '')} · ${sdN(x.visits)} زيارات · ${sar(x.spend)} ر.س</small><small class="warn">كانت تجي كل ${sdN(x.gap)} يوم تقريبًا، وصار لها ${sdN(x.since)} يوم</small></div>
          ${x.phone ? `<a class="btn sm wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(x.phone)}?text=${encodeURIComponent(waMsg(x))}">واتساب</a>` : ''}
        </div>`).join('') : '<div class="empty">ما فيه أحد غايب، ممتاز 🤍</div>'}
        ${AR.list.length > 8 ? `<button class="btn block" id="sd-risk-more" style="margin-top:8px">عرض الباقي (${AR.list.length - 8})</button>` : ''}
      </div>

      <div class="fin-grid">
        <div><div class="section-title"><h2>هل ترجع العميلة الجديدة؟</h2></div><div class="card">
          <p class="muted small" style="margin:0 0 10px">من العميلات الجدد كل شهر، كم وحدة رجعت خلال ٦٠ يوم من أول زيارة</p>
          ${co.map((c) => { const p60 = sdShare(c.r60, c.n); return `<div class="fbar" data-tip="${MONTHS_AR[D(c.m).getMonth()]}: ${sdN(c.n)} جديدة\nرجعت خلال ٦٠ يوم: ${sdN(c.r60)}\nرجعت أي وقت: ${sdN(c.r)}${c.ready ? '' : '\n(الشهر لسا ما اكتمل حسابه)'}"><div class="fbar-top"><span>${MONTHS_AR[D(c.m).getMonth()]} <small class="muted">${sdN(c.n)} جديدة</small></span><b class="num">${p60}٪${c.ready ? '' : ' <small class="muted">لسا</small>'}</b></div><div class="fbar-track"><i style="width:${Math.max(2, p60)}%;${c.ready ? '' : 'opacity:.45'}"></i></div></div>`; }).join('')}
        </div></div>
        <div><div class="section-title"><h2>التقييمات</h2>${rv.n ? `<span class="muted small">${sdN(rv.n)} تقييم</span>` : ''}</div><div class="card">
          ${rv.n ? `<div class="sd-rate"><b class="num">${Number(rv.avg).toFixed(1)}</b><span class="sd-stars">${'★'.repeat(Math.round(rv.avg))}${'☆'.repeat(5 - Math.round(rv.avg))}</span></div>
          ${[5, 4, 3, 2, 1].map((n) => `<div class="sd-rbar"><span>${n}★</span><div class="fbar-track"><i style="width:${sdShare(rv.dist[n], rv.n)}%"></i></div><b class="num">${sdN(rv.dist[n])}</b></div>`).join('')}
          ${(rv.low || []).length ? `<div class="sd-low"><b>تقييمات تحتاج متابعة</b>${rv.low.map((x) => `<div><span class="sd-stars">${'★'.repeat(x.rating)}</span> ${esc(x.svc || '')}${x.prov ? ` · ${esc(x.prov)}` : ''}<p>${esc(x.text || 'بدون تعليق')}</p></div>`).join('')}</div>` : ''}` : '<div class="empty">ما فيه تقييمات في هالفترة</div>'}
        </div></div>
      </div>

      <div class="section-title"><h2>أعلى العميلات صرفًا</h2></div>
      <div class="card sd-table-wrap"><table class="sd-table"><thead><tr><th>#</th><th>العميلة</th><th>زيارات</th><th>صرفت</th><th>آخر زيارة</th></tr></thead><tbody>
        ${r.top_clients.map((x, i) => `<tr><td class="muted num">${i + 1}</td><td><b>${esc(x.name || 'عميلة')}</b><small>${esc(x.fav || '')}</small></td><td class="num">${sdN(x.visits)}</td><td class="num"><b>${sar(x.v)}</b></td><td class="small">${ago(x.last)}</td></tr>`).join('')}
      </tbody></table>${!r.top_clients.length ? '<div class="empty">ما فيه زيارات</div>' : ''}</div>`;
  }

  function sdTabTime(r, P, o) {
    return `
      <div class="section-title"><h2>متى الزحمة؟</h2><div class="chips" id="sd-hm">${[['n', 'عدد الحجوزات'], ['v', 'الدخل'], ['x', 'الإلغاء والغياب']].map(([k, l], i) => `<button class="chip ${i ? '' : 'on'}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="card"><div id="sd-heat">${sdHeat(r, 'n')}</div></div>
      <div id="sd-heat-ins"></div>`;
  }
  function sdHeat(r, mode) {
    const src = mode === 'x' ? r.heat_cx : r.heat, key = mode === 'v' ? 'v' : 'n';
    const all = [...r.heat, ...r.heat_cx];
    if (!all.length) return '<div class="empty">ما فيه حجوزات في هالفترة</div>';
    let h0 = Math.max(7, Math.min(...all.map((x) => x.h))), h1 = Math.min(23, Math.max(...all.map((x) => x.h)));
    const M = {}; src.forEach((x) => { M[`${x.d}-${x.h}`] = Number(x[key]); });
    const mx = Math.max(1, ...Object.values(M));
    const order = [6, 0, 1, 2, 3, 4, 5];
    const hours = []; for (let h = h0; h <= h1; h++) hours.push(h);
    const fmt = (v) => (key === 'v' ? `${sar(v)} ر.س` : `${sdN(v)} ${mode === 'x' ? 'إلغاء/غياب' : 'حجز'}`);
    return `<div class="sd-heat" style="--cols:${hours.length}">
      <span></span>${hours.map((h) => `<span class="hx">${h % 2 === h0 % 2 ? sdHour(h) : ''}</span>`).join('')}
      ${order.map((d, di) => `<span class="hy">${WDAYS[d].replace(/^ال/, '')}</span>${hours.map((h, hi) => { const v = M[`${d}-${h}`] || 0; const a = v ? 0.08 + 0.92 * Math.pow(v / mx, 0.8) : 0; return `<i class="${mode === 'x' ? 'x' : ''}" style="--a:${a.toFixed(3)};--d:${di + hi}" data-tip="${WDAYS[d]} ${sdHour(h)}\n${fmt(v)}"></i>`; }).join('')}`).join('')}
    </div><div class="sd-heat-l"><span>أقل</span><i></i><span>أكثر</span></div>`;
  }
  function sdHeatIns(r) {
    const top = [...r.heat].sort((a, b) => b.n - a.n).slice(0, 3);
    const cx = [...r.heat_cx].sort((a, b) => b.n - a.n)[0];
    const wd = Array(7).fill(0); r.heat.forEach((h) => { wd[h.d] += h.n; });
    const hr = {}; r.heat.forEach((h) => { hr[h.h] = (hr[h.h] || 0) + h.n; });
    const hrs = Object.entries(hr).sort((a, b) => b[1] - a[1]);
    const quiet = Object.entries(hr).filter(([h]) => h >= 11 && h <= 21).sort((a, b) => a[1] - b[1])[0];
    if (!top.length) return '';
    return `<div class="sd-ins" style="margin-top:12px">
      <div class="sd-in"><i>🔥</i><p>أزحم الأوقات: ${top.map((x) => `<b>${WDAYS[x.d]} ${sdHour(x.h)}</b>`).join('، ')}. تأكدي إن الأخصائيات كلهم موجودين فيها</p></div>
      ${hrs.length ? `<div class="sd-in"><i>⏰</i><p>ساعة الذروة <b>${sdHour(Number(hrs[0][0]))}</b>${quiet ? `، وأهدأ ساعة <b>${sdHour(Number(quiet[0]))}</b>: مكان ممتاز لعرض «ساعة هادية» بخصم بسيط` : ''}</p></div>` : ''}
      ${cx ? `<div class="sd-in bad"><i>⚠️</i><p>أكثر وقت فيه إلغاء وغياب: <b>${WDAYS[cx.d]} ${sdHour(cx.h)}</b>. تذكير قبلها بساعتين يفرق</p></div>` : ''}
    </div>`;
  }

  function sdTabProfit(r, P, o) {
    const K = r.k, exp = Number(r.expenses?.total || 0), pur = Number(r.purchases || 0);
    const rev = Number(K.net_sales) - Number(K.discount) + Number(K.home), net = rev - exp - pur, margin = rev ? Math.round((net / rev) * 100) : 0;
    const cats = Object.entries(r.expenses?.cats || {}).map(([k, v]) => ({ l: EXP_CAT[k] || k, v })).sort((a, b) => b.v - a.v);
    const lost = Number(K.cancelled_value) + Number(K.noshow_value);
    const camps = r.campaigns || [];
    return `
      ${!exp && !pur ? `<div class="sd-cta static"><b>هنا تطلع لك الصورة الكاملة: كم دخل، كم صرفتوا، وكم صافي الربح الحقيقي</b><span>المبيعات جاهزة من ركاز. باقي بس تسجلين المصروفات (إيجار، رواتب، فواتير…) وفواتير المواد من المخزون، وكل شي ينحسب لحاله.</span><div class="actions"><button class="btn primary" id="sd-exp">${I.plus} سجّلي مصروف</button><a class="btn" href="#/invoices">فواتير المواد</a></div></div>` : ''}
      <div class="card sd-pl">
        <div><span data-tip="المبيعات بعد الخصم وبدون الضريبة (الضريبة مو لكم، تروح للزكاة والضريبة)">المبيعات بدون ضريبة وبعد الخصم</span><b class="num">${sar(rev)}</b></div>
        <div class="m"><span>− مشتريات المواد</span><b class="num">${sar(pur)}</b></div>
        <div class="m"><span>− المصروفات</span><b class="num">${sar(exp)}</b></div>
        <div class="b ${net < 0 ? 'neg' : ''}"><span>${exp || pur ? 'صافي الربح' : 'الربح قبل المصروفات'}</span><b class="num">${sar(net)} <small>ر.س</small></b></div>
        ${exp || pur ? `<div class="sd-margin"><span>هامش الربح</span><div class="fbar-track"><i style="width:${Math.max(0, Math.min(100, margin))}%"></i></div><b class="num">${margin}٪</b></div>` : ''}
        ${(exp || pur) && r.partners.length ? `<div class="sd-partners">${r.partners.map((p) => `<div><span>${esc(p.name)} (${Number(p.pct)}٪)</span><b class="num">${sar((net * Number(p.pct)) / 100)}</b></div>`).join('')}</div>` : ''}
      </div>
      <div class="fin-grid">
        <div><div class="section-title"><h2>وين تروح الفلوس</h2>${exp ? '<a class="small" href="#/expenses">كل المصروفات</a>' : ''}</div><div class="card">${cats.length ? sdBars(cats) : '<div class="empty">ما فيه مصروفات مسجلة في هالفترة</div>'}</div></div>
        <div><div class="section-title"><h2>فلوس ضاعت</h2></div><div class="card sd-money">
          <div><span>حجوزات ملغية (${sdN(K.cancelled)})</span><b class="num">${sar(K.cancelled_value)}</b></div>
          <div><span>ما حضرت (${sdN(K.noshow)})</span><b class="num">${sar(K.noshow_value)}</b></div>
          <div class="m"><span>الخصومات</span><b class="num">${sar(K.discount)}</b></div>
          <div class="b"><span>المجموع</span><b class="num">${sar(lost + Number(K.discount))}</b></div>
          <p class="muted small">لو رجع ربع الحجوزات الضايعة بس، يعني ${sar(lost / 4)} ر.س زيادة في هالفترة.</p>
        </div></div>
      </div>
      <div class="section-title"><h2>عائد الحملات التسويقية</h2><a class="small" href="#/marketing?t=campaigns">التسويق</a></div>
      ${camps.length ? `<div class="card sd-table-wrap"><table class="sd-table"><thead><tr><th>الحملة</th><th>الصرف</th><th>عميلات جدد</th><th>تكلفة العميلة</th><th>دخّلوا</th><th>العائد</th></tr></thead><tbody>
        ${camps.map((c) => { const roi = c.spent ? Math.round(((c.new_rev - c.spent) / c.spent) * 100) : null; return `<tr><td><b>${esc(c.name)}</b><small>${esc(c.from)}${c.to ? ` ← ${esc(c.to)}` : ''}</small></td><td class="num">${sar(c.spent)}</td><td class="num">${sdN(c.new_clients)}</td><td class="num">${c.new_clients ? sar(c.spent / c.new_clients) : '—'}</td><td class="num">${sar(c.new_rev)}</td><td>${roi == null ? '—' : `<span class="sd-d ${roi >= 0 ? 'up' : 'down'}">${roi >= 0 ? '▲' : '▼'} ${Math.abs(roi)}٪</span>`}</td></tr>`; }).join('')}
      </tbody></table><p class="muted small">العميلات الجدد = اللي أول زيارة لهم كانت خلال أيام الحملة، و«دخّلوا» = كل اللي صرفوه عندكم من وقتها.</p></div>`
      : `<a class="sd-cta" href="#/marketing?t=campaigns"><b>كل حملة تسويقية بتعرفين عائدها بالريال</b><span>سجّلي الحملة وكم صرفتي عليها في «التسويق»، ونربطها بالعميلات الجدد اللي جوا خلالها من ركاز ونطلع لك تكلفة العميلة والعائد ←</span></a>`}`;
  }

  function sdBind(body, r, P, t) {
    if (t === 'sales') $$('#sd-metric .chip', body).forEach((b) => b.addEventListener('click', () => {
      $$('#sd-metric .chip', body).forEach((x) => x.classList.toggle('on', x === b));
      const tmp = document.createElement('div'); tmp.innerHTML = sdChart(r, b.dataset.k, r.cmp_kind === 'ly' ? 'نفس الفترة السنة الماضية' : 'الفترة اللي قبلها', r.unit === 'month');
      const nc = $$('.sd-col', tmp), oc = $$('#sd-chart .sd-col', body);
      oc.forEach((c, i) => { if (!nc[i]) return; c.dataset.tip = nc[i].dataset.tip; c.firstElementChild.style.height = nc[i].firstElementChild.style.height; });
      const np = $('.sd-cmp polyline', tmp), op = $('#sd-chart .sd-cmp polyline', body); if (np && op) op.setAttribute('points', np.getAttribute('points'));
    }));
    if (t === 'svc') {
      let all = false; const draw = () => { $('#sd-svc', body).innerHTML = sdSvcRows(r, $('#sd-q', body).value.trim(), $('#sd-sort', body).value, all); $('#sd-all', body)?.addEventListener('click', () => { all = true; draw(); }); };
      $('#sd-q', body).addEventListener('input', draw); $('#sd-sort', body).addEventListener('change', draw); draw();
    }
    if (t === 'clients') $('#sd-risk-more', body)?.addEventListener('click', (ev) => { $$('.sd-risk-r.more', body).forEach((x) => { x.hidden = false; }); ev.currentTarget.remove(); });
    if (t === 'time') {
      $('#sd-heat-ins', body).innerHTML = sdHeatIns(r);
      $$('#sd-hm .chip', body).forEach((b) => b.addEventListener('click', () => { $$('#sd-hm .chip', body).forEach((x) => x.classList.toggle('on', x === b)); $('#sd-heat', body).innerHTML = sdHeat(r, b.dataset.k); }));
    }
    if (t === 'profit') $('#sd-exp', body)?.addEventListener('click', () => expenseForm(null, () => route()));
  }

  async function pageFinance(view, _a, params, alive) {
    let lens = params.get('l') || (() => { try { return localStorage.getItem('bf-lens'); } catch { return null; } })() || 'm';
    if (!LENSES.some((x) => x[0] === lens)) lens = 'm';
    try { localStorage.setItem('bf-lens', lens); } catch {}
    const todayKey = todayR();
    const at = params.get('at') ? D(params.get('at')) : params.get('m') ? D(params.get('m')) : D(todayKey);
    const [s, e] = lensRange(lens, at);
    const [r, tgt] = await Promise.all([q(sb.rpc('fin_range', { p_from: dk(s), p_to: dk(e) })), lens === 'm' ? q(sb.from('fin_targets').select('revenue').eq('month', monthKey(s)).maybeSingle()) : null]);
    if (!alive()) return;
    const link = (l, d) => `#/finance?l=${l}&at=${dk(d)}`;
    const isCurrent = dk(s) <= todayKey && todayKey <= dk(e);
    const delta = r.prev_revenue > 0 ? Math.round(((r.revenue - r.prev_revenue) / r.prev_revenue) * 100) : null;
    const monthly = r.unit === 'month';
    const maxDay = Math.max(1, ...r.days.map((d) => Number(d.salon) + Number(d.home)));
    const unclosed = monthly ? 0 : r.days.filter((d) => d.day < todayKey && !d.closed && Number(d.home) === 0).length;
    const best = [...r.days].sort((a, b) => (b.salon + b.home) - (a.salon + a.home))[0];
    const wk = Array(7).fill(0), wkN = Array(7).fill(0);
    if (!monthly) r.days.forEach((d) => { if (d.closed) { const w = D(d.day).getDay(); wk[w] += Number(d.salon); wkN[w]++; } });
    const valid = wk.map((v, i) => [i, wkN[i] ? v / wkN[i] : null]).filter((x) => x[1] != null);
    const weak = valid.length >= 4 ? [...valid].sort((a, b) => a[1] - b[1])[0] : null;
    const strong = valid.length >= 4 ? [...valid].sort((a, b) => b[1] - a[1])[0] : null;
    const methods = PAY_KEYS.map(([k, l]) => [l, Number(r.methods[k] || 0)]).filter((x) => x[1] > 0);
    const cats = SALE_CATS.map(([k, l]) => [l, Number(r.cats[k === 'other_cat' ? 'other' : k] || 0)]).filter((x) => x[1] > 0);
    const exps = Object.entries(r.exp_cats).map(([k, v]) => [EXP_CAT[k] || k, Number(v)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const ident = (x) => x;
    const colLabel = (d) => { const x = D(d.day); return monthly ? MONTHS_AR[x.getMonth()].slice(0, 3) : lens === 'w' ? ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'][x.getDay()] : x.getDate(); };
    const bestLabel = (d) => { const x = D(d.day); return monthly ? `${MONTHS_AR[x.getMonth()]}` : `${WDAYS[x.getDay()]} ${x.getDate()} ${MONTHS_AR[x.getMonth()]}`; };
    const chart = lens === 'd' ? '' : `
      <div class="section-title"><h2>${monthly ? 'المبيعات شهرًا بشهر' : 'المبيعات يومًا بيوم'}</h2><span class="muted small"><i class="lg s"></i> الصالون <i class="lg h"></i> المنزلية</span></div>
      <div class="card"><div class="dchart ${lens === 'w' ? 'wide' : ''}">${r.days.map((d) => { const t = Number(d.salon) + Number(d.home); const future = d.day > todayKey; return `<a class="dcol ${future ? 'fut' : ''} ${d.day === todayKey ? 'today' : ''}" ${monthly ? `href="${link('m', D(d.day))}"` : `href="${link('d', D(d.day))}"`} title="${d.day} · ${sar(t)} ر.س"><div class="dstack" style="height:${(t / maxDay) * 100}%"><i class="h" style="flex:${d.home}"></i><i class="s" style="flex:${d.salon}"></i></div><span>${colLabel(d)}</span>${!future && !d.closed ? '<em></em>' : ''}</a>`; }).join('')}</div>
        <div class="dinsights">
          ${best && (best.salon + best.home) > 0 ? `<div><span>${monthly ? 'أفضل شهر' : 'أفضل يوم'}</span><b>${bestLabel(best)} · ${sar(best.salon + best.home)} ر.س</b></div>` : ''}
          ${r.methods.clients ? `<div><span>متوسط الفاتورة</span><b class="num">${sar(r.salon / r.methods.clients)} ر.س</b></div>` : ''}
          ${!monthly && r.closed_days ? `<div><span>متوسط اليوم</span><b class="num">${sar(r.salon / r.closed_days)} ر.س</b></div>` : ''}
          ${weak && strong && weak[0] !== strong[0] ? `<div><span>ملاحظة</span><b>${WDAYS[weak[0]]} أضعف أيامك، مبيعاته ${Math.round((weak[1] / strong[1]) * 100)}٪ من ${WDAYS[strong[0]]}</b></div>` : ''}
        </div>
      </div>`;
    const dayCard = lens !== 'd' || dk(s) <= todayKey ? '' : (r.closed_days ? '' : `<a class="day-open" href="#/closing?d=${dk(s)}"><b>${dk(s) > todayKey ? 'هذا اليوم ما جا بعد' : 'هذا اليوم ما انقفل'}</b><span>${dk(s) > todayKey ? 'تقدرون تشوفونه بعد ما يخلص الدوام' : 'سجّلوا مبيعاته من إقفال اليوم ←'}</span></a>`);
    view.innerHTML = `
      <div class="lens" role="group" aria-label="العدسة">${LENSES.map(([k, l]) => `<a href="${link(k, at)}" class="${k === lens ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div class="fin-head">
        <a class="icon-btn" href="${link(lens, lensShift(lens, at, -1))}" aria-label="السابق">›</a>
        <div class="fin-title"><h2>${lensTitle(lens, s, e)}</h2>${!isCurrent ? `<a class="small" href="${link(lens, D(todayKey))}">ارجع للحالي</a>` : ''}</div>
        <a class="icon-btn ${dk(e) >= todayKey ? 'off' : ''}" href="${link(lens, lensShift(lens, at, 1))}" aria-label="التالي">‹</a>
      </div>
      <div class="fin-actions"><a class="btn primary" href="#/sales?l=${lens}&at=${dk(s)}">لوحة المبيعات</a><button class="btn" id="exp-new">${I.plus} مصروف</button><a class="btn" href="#/expenses?m=${monthKey(s)}">المصروفات</a>${lens === 'm' ? '<button class="btn" id="rp-go">📄 تقرير الشهر</button>' : ''}</div>
      ${unclosed && isCurrent && lens !== 'd' ? `<a class="notice warn" style="display:block" href="#/closing">فيه ${unclosed} ${unclosed === 1 ? 'يوم' : unclosed <= 10 ? 'أيام' : 'يوم'} ${LENS_THIS[lens]} بدون إقفال ←</a>` : ''}
      ${dayCard}
      <div class="fin-hero">
        <div class="fin-hero-top"><span>صافي الربح</span>${delta != null ? `<span class="chip-d ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}٪ مبيعات عن ${LENS_PREV[lens]}</span>` : ''}</div>
        <div class="fin-net num ${r.net < 0 ? 'neg' : ''}">${sar(r.net)} <small>ر.س</small></div>
        ${lens === 'm' ? targetBlock(r, tgt, s, e, todayKey) : ''}
        <div class="fin-split">
          <div><span>المبيعات</span><b class="num">${sar(r.revenue)}</b><em>الصالون ${sar(r.salon)} · المنزلية ${sar(r.home)}</em></div>
          <div><span>المشتريات</span><b class="num">${sar(r.purchases)}</b><em>فواتير معتمدة</em></div>
          <div><span>المصروفات</span><b class="num">${sar(r.expenses)}</b><em>${exps.length} تصنيف</em></div>
        </div>
      </div>
      ${chart}
      <div class="fin-grid">
        <div><div class="section-title"><h2>طرق الدفع</h2></div><div class="card">${methods.length ? bars(methods, Math.max(...methods.map((x) => x[1])), ident) : `<div class="empty">ما فيه إقفالات ${LENS_THIS[lens]}</div>`}</div></div>
        <div><div class="section-title"><h2>المبيعات حسب القسم</h2></div><div class="card">${cats.length ? bars(cats, Math.max(...cats.map((x) => x[1])), ident) : '<div class="empty">سجّلوا تفصيل الأقسام في الإقفال اليومي عشان يطلع هنا</div>'}</div></div>
      </div>
      <div class="section-title"><h2>المصروفات</h2><a class="small" href="#/expenses?m=${monthKey(s)}">كل المصروفات</a></div>
      <div class="card">${exps.length ? bars(exps, exps[0][1], ident) : `<div class="empty">ما فيه مصروفات ${LENS_THIS[lens]}</div>`}</div>`;
    $('#exp-new').onclick = () => expenseForm(null, () => route());
    $('#rp-go')?.addEventListener('click', (e) => busy(e.currentTarget, () => monthReport(monthKey(s)).catch((err) => toast(errMsg(err), true))));
    $('#tgt-set')?.addEventListener('click', () => targetForm(monthKey(s), tgt?.revenue, r.prev_revenue));
  }

  function targetBlock(r, tgt, s, e, todayKey) {
    if (!tgt) return `<button class="tgt-empty" id="tgt-set">${I.plus} حطّوا هدف مبيعات لهالشهر</button>`;
    const T = Number(tgt.revenue), pct = Math.min(100, (r.revenue / T) * 100);
    const total = e.getDate(), passed = todayKey > dk(e) ? total : todayKey < dk(s) ? 0 : D(todayKey).getDate();
    const left = Math.max(0, T - r.revenue), daysLeft = total - passed;
    const pace = passed ? (r.revenue / passed) * total : 0;
    let msg;
    if (r.revenue >= T) msg = 'وصلتوا للهدف 🤍';
    else if (!daysLeft) msg = `ناقص ${sar(left)} ر.س عن الهدف`;
    else msg = `باقي ${sar(left)} ر.س، يعني ${sar(left / daysLeft)} باليوم${passed > 3 ? ` · على هالمعدل بتختمون الشهر بـ ${sar(pace)}` : ''}`;
    return `<div class="tgt"><div class="tgt-top"><span>الهدف <b class="num">${sar(T)}</b></span><button class="tgt-edit" id="tgt-set" aria-label="تعديل الهدف">${I.edit}</button><b class="num">${Math.round(pct)}٪</b></div>
      <div class="tgt-track"><i style="width:${pct}%"></i>${passed && passed < total ? `<s style="inset-inline-start:${(passed / total) * 100}%" title="اليوم"></s>` : ''}</div><div class="tgt-msg">${msg}</div></div>`;
  }

  function targetForm(month, cur, prev) {
    const sug = prev ? Math.round((prev * 1.1) / 1000) * 1000 : null;
    modal(`
      <h3>هدف ${MONTHS_AR[D(month).getMonth()]}</h3>
      <div class="field"><label>هدف المبيعات (ر.س)</label><input class="input num" id="t-v" type="number" inputmode="numeric" min="1" value="${cur ? Number(cur) : ''}" placeholder="${sug || ''}"></div>
      ${sug ? `<p class="muted small" style="margin-top:-6px">مبيعات الشهر الماضي ${sar(prev)}، وزيادة ١٠٪ تكون <button type="button" class="link" id="t-sug">${sar(sug)}</button></p>` : ''}
      <div class="actions end"><button class="btn" data-close>إلغاء</button><button class="btn primary" id="t-save">حفظ</button></div>`, (el, close) => {
      $('#t-sug', el)?.addEventListener('click', () => { $('#t-v', el).value = sug; });
      $('#t-save', el).onclick = (ev) => busy(ev.currentTarget, async () => {
        const v = Number($('#t-v', el).value); if (!(v > 0)) return toast('اكتبوا الهدف', true);
        try { await q(sb.from('fin_targets').upsert({ month, revenue: v })); toast('تم الحفظ'); close(); route(); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  function expenseForm(e, done) {
    modal(`
      <h3>${e ? 'تعديل مصروف' : 'مصروف جديد'}</h3>
      <div class="grid2"><div class="field"><label>المبلغ (ر.س)</label><input class="input num" id="x-amt" type="number" inputmode="decimal" min="0" step="0.01" value="${e?.amount ?? ''}"></div>
      <div class="field"><label>التاريخ</label><input class="input" id="x-day" type="date" value="${e?.day || todayR()}"></div></div>
      <div class="field"><label>التصنيف</label><div class="chips wrap" id="x-cat">${Object.entries(EXP_CAT).map(([k, l]) => `<button type="button" class="chip ${(e?.category || 'other') === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div>
      <div class="grid2"><div class="field"><label>الجهة</label><input class="input" id="x-vendor" value="${esc(e?.vendor || '')}" placeholder="مثلًا: شركة الكهرباء"></div>
      <div class="field"><label>طريقة الدفع</label><select class="input" id="x-method">${['', 'تحويل', 'شبكة', 'كاش', 'سداد'].map((x) => `<option ${x === (e?.method || '') ? 'selected' : ''} value="${x}">${x || '—'}</option>`).join('')}</select></div></div>
      <div class="field"><label>ملاحظة</label><input class="input" id="x-note" value="${esc(e?.note || '')}"></div>
      <div class="actions end mt">${e ? '<button class="btn" id="x-del" style="color:var(--danger);margin-inline-end:auto">حذف</button>' : ''}<button class="btn" data-close>إلغاء</button><button class="btn primary" id="x-save">حفظ</button></div>`, (el, close) => {
      let cat = e?.category || 'other';
      $('#x-cat', el).onclick = (ev) => { const b = ev.target.closest('[data-k]'); if (!b) return; cat = b.dataset.k; $$('#x-cat .chip', el).forEach((c) => c.classList.toggle('on', c === b)); };
      $('#x-save', el).onclick = (ev) => busy(ev.currentTarget, async () => {
        const amount = Number($('#x-amt', el).value);
        if (!(amount > 0)) return toast('اكتب المبلغ', true);
        const row = { amount, day: $('#x-day', el).value, category: cat, vendor: $('#x-vendor', el).value.trim() || null, method: $('#x-method', el).value || null, note: $('#x-note', el).value.trim() || null };
        try { if (e) await q(sb.from('fin_expenses').update(row).eq('id', e.id)); else await q(sb.from('fin_expenses').insert(row)); toast('تم الحفظ'); close(); done && done(); } catch (err) { toast(errMsg(err), true); }
      });
      $('#x-del', el)?.addEventListener('click', async () => {
        if (!(await confirmBox('حذف المصروف', 'يُحذف المصروف نهائيًا من التقارير.', 'حذف', true))) return;
        try { await q(sb.from('fin_expenses').delete().eq('id', e.id)); toast('تم الحذف'); close(); done && done(); } catch (err) { toast(errMsg(err), true); }
      });
    });
  }

  async function pageExpenses(view, _a, params, alive) {
    const m = params.get('m') ? new Date(params.get('m') + 'T12:00:00') : new Date(todayR().slice(0, 8) + '01T12:00:00');
    const d0 = monthKey(m), d1 = monthKey(new Date(m.getFullYear(), m.getMonth() + 1, 1, 12));
    const rows = await q(sb.from('fin_expenses').select('*').gte('day', d0).lt('day', d1).order('day', { ascending: false }).order('id', { ascending: false }));
    if (!alive()) return;
    const total = rows.reduce((s, x) => s + Number(x.amount), 0);
    view.innerHTML = `
      <div class="fin-head"><a class="icon-btn" href="#/expenses?m=${monthKey(new Date(m.getFullYear(), m.getMonth() - 1, 1, 12))}">›</a><h2>مصروفات ${MONTHS_AR[m.getMonth()]}</h2><a class="icon-btn" href="#/expenses?m=${d1}">‹</a></div>
      <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="exp-new">${I.plus} مصروف جديد</button><a class="btn" href="#/finance?m=${d0}">التقرير المالي</a></div>
      <div class="list">${rows.length ? rows.map((x) => `<button class="row" data-id="${x.id}"><div class="grow"><div class="title">${esc(EXP_CAT[x.category])}${x.vendor ? ` · <span class="muted">${esc(x.vendor)}</span>` : ''}</div><div class="meta">${fmtDate(x.day)}${x.method ? ' · ' + esc(x.method) : ''}${x.note ? ' · ' + esc(x.note) : ''}</div></div><div class="end num" style="font-weight:700">${money(x.amount)}</div></button>`).join('') + `<div class="row"><div class="grow" style="font-weight:700">الإجمالي</div><div class="end num" style="font-weight:700">${money(total)}</div></div>` : '<div class="empty">ما فيه مصروفات في هذا الشهر</div>'}</div>`;
    $('#exp-new').onclick = () => expenseForm(null, () => route());
    $$('[data-id]', view).forEach((b) => b.onclick = () => expenseForm(rows.find((x) => x.id === Number(b.dataset.id)), () => route()));
  }

  async function pageClosing(view, _a, params, alive) {
    const day = params.get('d') || todayR();
    const ex = await q(sb.from('fin_daily').select('*').eq('day', day).maybeSingle());
    if (!alive()) return;
    const v = (k) => (ex && ex[k] != null && Number(ex[k]) !== 0 ? Number(ex[k]) : '');
    view.innerHTML = `
      <div class="card close-card">
        <div class="field"><label>اليوم</label><input class="input" type="date" id="c-day" value="${day}" max="${todayR()}"></div>
        ${ex ? '<div class="notice info">هذا اليوم مُقفل من قبل، أي تعديل يحدّث الإقفال.</div>' : ''}
        <h3 class="close-h">المبالغ حسب طريقة الدفع</h3>
        <div class="money-grid">${PAY_KEYS.map(([k, l]) => `<label class="mfield"><span>${l}</span><input class="input num" type="number" inputmode="decimal" min="0" step="0.01" data-pay="${k}" value="${v(k)}" placeholder="0"></label>`).join('')}</div>
        <div class="close-total"><span>إجمالي اليوم</span><b class="num" id="c-total">0</b></div>
        <div class="field"><label>عدد العميلات</label><input class="input num" type="number" inputmode="numeric" min="0" id="c-clients" value="${ex?.clients ?? ''}" placeholder="اختياري، ويطلع منه متوسط الفاتورة"></div>
        <details ${ex && SALE_CATS.some(([k]) => ex[k] != null) ? 'open' : ''}><summary class="close-h">تفصيل حسب القسم (اختياري)</summary>
          <div class="money-grid">${SALE_CATS.map(([k, l]) => `<label class="mfield"><span>${l}</span><input class="input num" type="number" inputmode="decimal" min="0" step="0.01" data-cat="${k}" value="${ex && ex[k] != null ? Number(ex[k]) : ''}" placeholder="0"></label>`).join('')}</div>
          <div class="muted small" id="c-catrem"></div>
        </details>
        <div class="field mt"><label>ملاحظة</label><input class="input" id="c-note" value="${esc(ex?.note || '')}"></div>
        <div class="actions end"><button class="btn primary" id="c-save">${ex ? 'تحديث الإقفال' : 'إقفال اليوم'}</button></div>
      </div>`;
    const sumOf = (sel) => $$(sel, view).reduce((s, i) => s + (Number(i.value) || 0), 0);
    const upd = () => {
      const t = sumOf('[data-pay]'); const c = sumOf('[data-cat]');
      $('#c-total').textContent = money(t);
      $('#c-catrem').textContent = c ? (Math.abs(t - c) < 0.01 ? 'التفصيل مطابق للإجمالي ✓' : `الفرق عن الإجمالي: ${money(t - c)}`) : '';
    };
    view.addEventListener('input', upd); upd();
    $('#c-day').onchange = (e) => { location.hash = `#/closing?d=${e.target.value}`; };
    $('#c-save').onclick = (e) => busy(e.currentTarget, async () => {
      const row = { day: $('#c-day').value, clients: $('#c-clients').value === '' ? null : Number($('#c-clients').value), note: $('#c-note').value.trim() || null, updated_at: new Date().toISOString(), entered_by: S.profile.id };
      PAY_KEYS.forEach(([k]) => { row[k] = Number($(`[data-pay="${k}"]`).value) || 0; });
      SALE_CATS.forEach(([k]) => { const x = $(`[data-cat="${k}"]`).value; row[k] = x === '' ? null : Number(x); });
      if (PAY_KEYS.every(([k]) => !row[k])) return toast('اكتب مبلغ واحد على الأقل', true);
      try { await q(sb.from('fin_daily').upsert(row)); toast('تم إقفال اليوم'); location.hash = `#/finance?l=d&at=${row.day}`; } catch (err) { toast(errMsg(err), true); }
    });
  }

  /* ======================= start ======================= */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const authType = hashParams.get('type');

  window.addEventListener('hashchange', () => { if (!/access_token|error_description/.test(location.hash)) route(); });

  let lastUser = undefined;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { S.session = session; renderSetPassword(); return; }
    const uid = session?.user?.id || null;
    if (event === 'TOKEN_REFRESHED' || (event === 'SIGNED_IN' && uid === lastUser)) { S.session = session; return; }
    if (uid === lastUser && event !== 'SIGNED_OUT') return;
    lastUser = uid;
    S.session = session;
    if (!session) { S.profile = null; renderLogin(); return; }
    setTimeout(() => {
      if (authType === 'invite' || authType === 'recovery') renderSetPassword();
      else {
        if (!location.hash || /access_token/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/home');
        boot();
      }
    }, 0);
  });
})();
