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

  const ROLE_LABEL = { admin: 'مدير النظام', partner: 'شريك', staff: 'موظف' };
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
          <p class="sub">${signup ? 'بعد التسجيل يراجع مدير النظام طلبك ويحدد صلاحياتك.' : 'الحجوزات والمخزون، في مكان واحد.'}</p>
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
    const L = [
      { href: '#/home', label: 'الرئيسية', icon: I.home, key: 'home' },
      { href: '#/bookings', label: 'الحجوزات المنزلية', icon: I.cal, key: 'bookings' },
    ];
    L.push({ href: '#/clients', label: 'العميلات', icon: I.heart, key: 'clients' });
    L.push({ href: '#/marketing', label: 'التسويق', icon: I.mega, key: 'marketing' });
    if (isManager()) L.push({ href: '#/finance', label: 'المالية', icon: I.coin, key: 'finance' });
    L.push(
      { sep: true },
      { href: '#/items', label: 'الأصناف', icon: I.box, key: 'items' },
      { href: '#/issue', label: 'صرف من المخزون', icon: I.out, key: 'issue' },
      { href: '#/invoices', label: 'فواتير الشراء', icon: I.invoice, key: 'invoices' },
      { sep: true },
      { href: '#/shopping', label: 'قائمة المشتريات', icon: I.cart, key: 'shopping' },
      { href: '#/movements', label: 'سجل الحركات', icon: I.list, key: 'movements' },
    );
    if (isManager()) L.push({ href: '#/reports', label: 'التقارير', icon: I.chart, key: 'reports' });
    if (isAdmin()) {
      L.push({ sep: true });
      L.push({ href: '#/users', label: 'المستخدمين', icon: I.users, key: 'users' });
      L.push({ href: '#/catalog', label: 'الفئات والموردين', icon: I.tag, key: 'catalog' });
      L.push({ href: '#/more', label: 'الإعدادات', icon: I.key, key: 'more' });
    }
    return L;
  }

  function renderShell() {
    const p = S.profile;
    $('#app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand"><img class="logo" src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><span>لوحة الإدارة</span></div>
          <nav>${navLinks().map((l) => l.sep ? '<div class="sep"></div>' : `<a href="${l.href}" data-nav="${l.key}"><span class="ic">${l.icon}</span>${l.label}</a>`).join('')}</nav>
          <div class="foot">
            <div style="color:#fff;font-weight:600">${esc(p.full_name || p.login)}</div>
            <div>${ROLE_LABEL[p.role]}</div>
            <div style="margin-top:8px;display:flex;gap:12px"><button data-act="pw">كلمة المرور</button><button data-act="out">خروج</button></div>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="tb-title"><img class="tb-logo" src="../home/assets/Beautfresh-brown.svg" alt="بيوتفريش"><h1 id="page-title"></h1></div>
            <div class="who"><span class="hide-sm">${esc(p.full_name || p.login)}</span><span class="avatar">${esc(initial(p.full_name || p.login))}</span></div>
          </header>
          <div class="content" id="view"></div>
        </div>
        <nav class="bottomnav">
          <a href="#/home" data-nav="home"><span class="ic">${I.home}</span>الرئيسية</a>
          <a href="#/bookings" data-nav="bookings"><span class="ic">${I.cal}</span>الحجوزات</a>
          <a href="#/issue" data-nav="issue" class="primary"><span class="ic">${I.out}</span>صرف</a>
          <a href="#/invoices" data-nav="invoices"><span class="ic">${I.invoice}</span>الفواتير</a>
          <a href="#/more" data-nav="more"><span class="ic">${I.more}</span>الإعدادات</a>
        </nav>
      </div>`;
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
    marketing: { title: 'التسويق', nav: 'marketing', fn: pageMarketing },
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
    view.innerHTML = '<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>';
    window.scrollTo(0, 0);
    try {
      await r.fn(view, parts.slice(1), params, () => seq === routeSeq);
    } catch (e) {
      if (seq === routeSeq) view.innerHTML = `<div class="notice danger">${esc(errMsg(e))}</div>`;
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
  async function pageHome(view, _a, _p, alive) {
    const low = S.items.filter((i) => i.is_active && isLow(i));
    const [expiring, drafts, moves] = await Promise.all([
      q(sb.rpc('get_expiring', { p_days: CFG.expiryWarningDays })),
      q(sb.from('purchase_invoices').select('id', { count: 'exact', head: false }).eq('status', 'draft')),
      q(sb.from('stock_movements').select('id,item_id,movement_type,qty,reason,created_by,created_at').order('created_at', { ascending: false }).limit(8)),
    ]);
    if (!alive()) return;
    const pendingUsers = isAdmin() ? [...S.profiles.values()].filter((p) => !p.is_active && !p.approved_at).length : 0;
    const hello = (S.profile.full_name || '').split(' ')[0];
    const dayStart = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) + 'T00:00:00+03:00');
    let bk = { today: [], pending: 0, next: null };
    try {
      const [td, pd, nx] = await Promise.all([
        q(sb.from('home_bookings').select('id,customer_name,starts_at,status').gte('starts_at', dayStart.toISOString()).lt('starts_at', new Date(dayStart.getTime() + 86400000).toISOString()).neq('status', 'cancelled').order('starts_at')),
        sb.from('home_bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        q(sb.from('home_bookings').select('id,customer_name,starts_at,district_name').gte('starts_at', new Date().toISOString()).in('status', ['pending', 'confirmed']).order('starts_at').limit(1)),
      ]);
      bk = { today: td, pending: pd.count || 0, next: nx[0] || null };
    } catch (_) { /* bookings unavailable */ }
    if (!alive()) return;
    const tk = todayR();
    let hl = _p.get('l') || (() => { try { return localStorage.getItem('bf-home-lens'); } catch { return null; } })() || 'd';
    if (!['d', 'w', 'm'].includes(hl)) hl = 'd';
    try { localStorage.setItem('bf-home-lens', hl); } catch {}
    const [hs, he] = lensRange(hl, D(tk));
    const yday = dk(lensShift('d', D(tk), -1));
    const [fr, tg, yc, cl, oc, L] = await Promise.all([
      isManager() ? q(sb.rpc('fin_range', { p_from: dk(hs), p_to: dk(he) })).catch(() => null) : null,
      isManager() ? q(sb.from('fin_targets').select('revenue').eq('month', monthKey(D(tk))).maybeSingle()).catch(() => null) : null,
      isManager() ? q(sb.from('fin_daily').select('day').eq('day', yday).maybeSingle()).catch(() => 'x') : 'x',
      q(sb.from('clients_overview').select('id,name,phone,birthday,segment,stamps,last_visit').limit(3000)).catch(() => []),
      sb.from('client_feedback').select('id', { count: 'exact', head: true }).eq('kind', 'complaint').eq('status', 'open').then((x) => ({ count: x.count || 0 }), () => ({ count: 0 })),
      loyalty().catch(() => ({ active: false })),
    ]);
    let mrev = null;
    if (isManager() && tg && hl !== 'm') { const [ms, me] = lensRange('m', D(tk)); const mr = await q(sb.rpc('fin_range', { p_from: dk(ms), p_to: dk(me) })).catch(() => null); mrev = mr?.revenue; }
    else if (fr && hl === 'm') mrev = fr.revenue;
    if (!alive()) return;
    const soon = (c) => { if (!c.birthday) return null; const b = D(c.birthday); const t = D(tk); let n = new Date(t.getFullYear(), b.getMonth(), b.getDate(), 12); if (n < t) n = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate(), 12); const d = Math.round((n - t) / 86400000); return d <= 7 ? d : null; };
    const bdays = cl.map((c) => [c, soon(c)]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
    const ready = L.active ? cl.filter((c) => c.stamps >= L.stamps).length : 0;
    const away = cl.filter((c) => c.segment === 'away').length;
    const alerts = [];
    if (isManager() && yc === null && D(yday).getDay() !== 5) alerts.push(['warn', I.coin, 'أمس ما انقفل', 'سجّلوا مبيعاته عشان تكتمل الأرقام', `#/closing?d=${yday}`]);
    if (oc.count) alerts.push(['danger', I.heart, `${oc.count === 1 ? 'شكوى مفتوحة' : oc.count + ' شكاوى مفتوحة'}`, 'ردّوا عليها وسجّلوا الحل', '#/feedback?t=open']);
    bdays.slice(0, 3).forEach(([c, d]) => alerts.push(['gold', '🎂', `ميلاد ${esc(firstName(c.name))} ${d === 0 ? 'اليوم' : d === 1 ? 'بكرة' : d === 2 ? 'بعد يومين' : `بعد ${d} أيام`}`, 'رسالة تهنئة صغيرة تفرق', `#/client/${c.id}`]));
    if (ready) alerts.push(['ok', `<img src="${ROSETTE}" alt="">`, `${ready === 1 ? 'عميلة وصلت' : ready + ' عميلات وصلوا'} لمكافأة الولاء`, 'بلغوهم عشان يستلمونها', '#/clients?s=reward']);
    if (away) alerts.push(['', I.heart, `${away} ${away === 1 ? 'عميلة غابت' : away <= 10 ? 'عميلات غابوا' : 'عميلة غابوا'} أكثر من ٤٥ يوم`, 'رسالة «وحشتينا» ممكن ترجّعهم', '#/clients?s=away']);
    const HL = { d: 'اليوم', w: 'الأسبوع', m: 'الشهر' };
    const fdelta = fr && fr.prev_revenue > 0 ? Math.round(((fr.revenue - fr.prev_revenue) / fr.prev_revenue) * 100) : null;
    const tpct = tg && mrev != null ? Math.min(100, (mrev / Number(tg.revenue)) * 100) : null;
    const pulse = !fr ? '' : `<div class="pulse">
        <div class="lens sm">${Object.entries(HL).map(([k, l]) => `<a href="#/home?l=${k}" class="${k === hl ? 'on' : ''}">${l}</a>`).join('')}</div>
        <a class="pulse-body" href="#/finance?l=${hl}&at=${tk}">
          <div><span>مبيعات ${HL[hl] === 'اليوم' ? 'اليوم' : 'هذا ' + HL[hl]}</span><b class="num">${sar(fr.revenue)}</b>${fdelta != null ? `<em class="${fdelta >= 0 ? 'up' : 'down'}">${fdelta >= 0 ? '▲' : '▼'} ${Math.abs(fdelta)}٪</em>` : ''}</div>
          <div><span>صافي الربح</span><b class="num">${sar(fr.net)}</b></div>
          ${tpct != null ? `<div class="pulse-ring" style="--p:${tpct}"><b class="num">${Math.round(tpct)}٪</b><span>من هدف الشهر</span></div>` : `<div class="pulse-ring empty"><span>حطّوا هدف للشهر</span></div>`}
        </a>
        ${hl === 'd' && !fr.closed_days && D(tk).getDay() !== 5 ? `<a class="pulse-cta" href="#/closing">آخر الدوام لا تنسون إقفال اليوم ←</a>` : ''}
      </div>`;
    const alertsHtml = alerts.length ? `<div class="section-title"><h2>يحتاج انتباهك</h2></div><div class="alerts">${alerts.map(([c, ic, t, sub, h]) => `<a class="alert ${c}" href="${h}"><span class="al-ic">${ic}</span><div><b>${t}</b><span>${sub}</span></div></a>`).join('')}</div>` : '';
    const hourNow = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }));
    const greet = hourNow >= 4 && hourNow < 12 ? 'صباح الخير' : 'مساء الخير';
    view.innerHTML = `
      <div class="hello"><div><span class="eyebrow">${greet}</span><h2>${esc(hello || 'أهلًا')}</h2></div><img src="../home/assets/rosette-1.svg" alt=""></div>
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
    const expLink = $('a[href="#expiring"]', view);
    expLink.addEventListener('click', (e) => { e.preventDefault(); $('#expiring').scrollIntoView({ behavior: 'smooth' }); });
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
          <div class="hint">الموظف: صرف وإدخال فواتير مسودة بدون رؤية الأسعار. الشريك: يرى كل شيء والتقارير. مدير النظام: كل الصلاحيات.</div></div>
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
    const links = navLinks().filter((l) => !l.sep && !['home', 'bookings', 'issue', 'invoices', 'more'].includes(l.key));
    view.innerHTML = `
      <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span class="avatar" style="width:44px;height:44px;font-size:18px">${esc(initial(S.profile.full_name || S.profile.login))}</span>
        <div><div style="font-weight:700">${esc(S.profile.full_name || S.profile.login)}</div><div class="muted small">${ROLE_LABEL[S.profile.role]}</div></div>
      </div>
      <div id="push-box"></div>
      <div class="list">
        ${links.map((l) => `<a class="row" href="${l.href}"><span class="ic" style="color:var(--accent)">${l.icon}</span><div class="grow title">${l.label}</div></a>`).join('')}
        <a class="row" href="install.html"><span class="ic" style="color:var(--accent)">${I.home}</span><div class="grow title">ثبّت التطبيق على الجوال</div></a>
        <button class="row" id="m-pw"><span class="ic" style="color:var(--accent)">${I.key}</span><div class="grow title">تغيير كلمة المرور</div></button>
        <button class="row" id="m-out"><span class="ic" style="color:var(--danger)">${I.logout}</span><div class="grow title" style="color:var(--danger)">تسجيل الخروج</div></button>
      </div>`;
    $('#m-pw').onclick = changePassword;
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
    const tpls = [['thanks', 'شكر بعد الزيارة'], ['remind', 'تذكير بموعد'], ['stamps', full ? 'مكافأتك جاهزة' : 'كم باقي للمكافأة'], ['miss', 'وحشتينا'], ['bday', 'عيد ميلاد']];
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
    const tabs = [['seasons', 'المواسم'], ['content', 'المحتوى'], ...(isManager() ? [['campaigns', 'الحملات']] : [])];
    const head = `<div class="lens" style="margin-bottom:16px">${tabs.map(([k, l]) => `<a href="#/marketing?t=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
    if (tab === 'content') return mktContent(view, params, alive, head);
    if (tab === 'campaigns' && isManager()) return mktCampaigns(view, alive, head);
    return mktSeasons(view, alive, head);
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
    const dayCard = lens !== 'd' ? '' : (r.closed_days ? '' : `<a class="day-open" href="#/closing?d=${dk(s)}"><b>${dk(s) > todayKey ? 'هذا اليوم ما جا بعد' : 'هذا اليوم ما انقفل'}</b><span>${dk(s) > todayKey ? 'تقدرون تشوفونه بعد ما يخلص الدوام' : 'سجّلوا مبيعاته من إقفال اليوم ←'}</span></a>`);
    view.innerHTML = `
      <div class="lens" role="group" aria-label="العدسة">${LENSES.map(([k, l]) => `<a href="${link(k, at)}" class="${k === lens ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div class="fin-head">
        <a class="icon-btn" href="${link(lens, lensShift(lens, at, -1))}" aria-label="السابق">›</a>
        <div class="fin-title"><h2>${lensTitle(lens, s, e)}</h2>${!isCurrent ? `<a class="small" href="${link(lens, D(todayKey))}">ارجع للحالي</a>` : ''}</div>
        <a class="icon-btn ${dk(e) >= todayKey ? 'off' : ''}" href="${link(lens, lensShift(lens, at, 1))}" aria-label="التالي">‹</a>
      </div>
      <div class="fin-actions"><a class="btn primary" href="#/closing${lens === 'd' ? `?d=${dk(s)}` : ''}">${I.plus} إقفال اليوم</a><button class="btn" id="exp-new">${I.plus} مصروف</button><a class="btn" href="#/expenses?m=${monthKey(s)}">المصروفات</a></div>
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
      ${r.partners.length && lens !== 'd' ? `<div class="partners">${r.partners.map((p) => `<div class="partner"><span class="pav">${esc(initial(p.name))}</span><div><div class="pn">${esc(p.name)} <small>${Number(p.pct)}٪</small></div><b class="num">${sar(p.amount)} ر.س</b></div></div>`).join('')}</div>` : ''}
      ${chart}
      <div class="fin-grid">
        <div><div class="section-title"><h2>طرق الدفع</h2></div><div class="card">${methods.length ? bars(methods, Math.max(...methods.map((x) => x[1])), ident) : `<div class="empty">ما فيه إقفالات ${LENS_THIS[lens]}</div>`}</div></div>
        <div><div class="section-title"><h2>المبيعات حسب القسم</h2></div><div class="card">${cats.length ? bars(cats, Math.max(...cats.map((x) => x[1])), ident) : '<div class="empty">سجّلوا تفصيل الأقسام في الإقفال اليومي عشان يطلع هنا</div>'}</div></div>
      </div>
      <div class="section-title"><h2>المصروفات</h2><a class="small" href="#/expenses?m=${monthKey(s)}">كل المصروفات</a></div>
      <div class="card">${exps.length ? bars(exps, exps[0][1], ident) : `<div class="empty">ما فيه مصروفات ${LENS_THIS[lens]}</div>`}</div>`;
    $('#exp-new').onclick = () => expenseForm(null, () => route());
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
