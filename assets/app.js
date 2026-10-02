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
  const UNITS = ['حبة', 'علبة', 'عبوة', 'زجاجة', 'أنبوب', 'كيس', 'لفة', 'باكيت', 'كرتون', 'جالون', 'طقم'];

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
        <form class="auth-card" id="auth-form" autocomplete="on">
          <div class="auth-logo">${I.bag}</div>
          <h1>${signup ? 'إنشاء حساب' : esc(CFG.appName)}</h1>
          <p class="sub">${signup ? 'بعد التسجيل يراجع مدير النظام طلبك ويحدد صلاحياتك.' : 'تسجيل الدخول لإدارة مخزون الصالون'}</p>
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
        <div class="auth-logo">${I.bag}</div>
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
        <div class="auth-logo">${I.bag}</div>
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
    } catch (e) {
      $('#app').innerHTML = `<div class="auth"><div class="auth-card"><h1>تعذر التحميل</h1><p class="sub">${esc(errMsg(e))}</p><button class="btn primary block" onclick="location.reload()">إعادة المحاولة</button></div></div>`;
    }
  }

  /* ======================= shell & router ======================= */
  function navLinks() {
    const L = [
      { href: '#/home', label: 'الرئيسية', icon: I.home, key: 'home' },
      { href: '#/items', label: 'الأصناف', icon: I.box, key: 'items' },
      { href: '#/issue', label: 'صرف من المخزون', icon: I.out, key: 'issue' },
      { href: '#/invoices', label: 'فواتير الشراء', icon: I.invoice, key: 'invoices' },
      { sep: true },
      { href: '#/shopping', label: 'قائمة المشتريات', icon: I.cart, key: 'shopping' },
      { href: '#/movements', label: 'سجل الحركات', icon: I.list, key: 'movements' },
    ];
    if (isManager()) L.push({ href: '#/reports', label: 'التقارير', icon: I.chart, key: 'reports' });
    if (isAdmin()) {
      L.push({ sep: true });
      L.push({ href: '#/users', label: 'المستخدمين', icon: I.users, key: 'users' });
      L.push({ href: '#/catalog', label: 'الفئات والموردين', icon: I.tag, key: 'catalog' });
    }
    return L;
  }

  function renderShell() {
    const p = S.profile;
    $('#app').innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand"><span class="mark">${I.bag}</span>${esc(CFG.appName)}</div>
          <nav>${navLinks().map((l) => l.sep ? '<div class="sep"></div>' : `<a href="${l.href}" data-nav="${l.key}"><span class="ic">${l.icon}</span>${l.label}</a>`).join('')}</nav>
          <div class="foot">
            <div style="color:#fff;font-weight:600">${esc(p.full_name || p.login)}</div>
            <div>${ROLE_LABEL[p.role]}</div>
            <div style="margin-top:8px;display:flex;gap:12px"><button data-act="pw">كلمة المرور</button><button data-act="out">خروج</button></div>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <h1 id="page-title"></h1>
            <div class="who"><span class="hide-sm">${esc(p.full_name || p.login)}</span><span class="avatar">${esc(initial(p.full_name || p.login))}</span></div>
          </header>
          <div class="content" id="view"></div>
        </div>
        <nav class="bottomnav">
          <a href="#/home" data-nav="home"><span class="ic">${I.home}</span>الرئيسية</a>
          <a href="#/items" data-nav="items"><span class="ic">${I.box}</span>الأصناف</a>
          <a href="#/issue" data-nav="issue" class="primary"><span class="ic">${I.out}</span>صرف</a>
          <a href="#/invoices" data-nav="invoices"><span class="ic">${I.invoice}</span>الفواتير</a>
          <a href="#/more" data-nav="more"><span class="ic">${I.more}</span>المزيد</a>
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
    more: { title: 'المزيد', nav: 'more', fn: pageMore },
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
    view.innerHTML = `
      <p class="muted" style="margin:0 0 14px">أهلاً ${esc(hello)}، هذا ملخص المخزون اليوم.</p>
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
          <div class="field"><label>الوحدة</label><input class="input" name="unit" list="units" required value="${esc(it.unit)}">
            <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist></div>
        </div>
        <div class="field"><label>الحد الأدنى</label><input class="input num" name="min_qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(it.min_qty)}">
          <div class="hint">يظهر تنبيه وينضاف الصنف لقائمة المشتريات إذا وصل رصيده لهذا الحد.</div></div>
        <div class="field"><label class="check"><input type="checkbox" name="track_expiry" ${it.track_expiry ? 'checked' : ''}> تتبع تاريخ الصلاحية</label>
          <div class="hint">عند التفعيل يُطلب تاريخ الانتهاء مع كل فاتورة شراء لهذا الصنف.</div></div>
        ${item ? `<div class="field"><label class="check"><input type="checkbox" name="is_active" ${it.is_active ? 'checked' : ''}> الصنف نشط</label></div>` : ''}
        <div class="field"><label>ملاحظات</label><textarea class="input" name="notes">${esc(it.notes || '')}</textarea></div>
        <div class="actions end"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">حفظ</button></div>
      </form>`, (el, close) => {
      $('#item-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const row = {
          name: f.get('name').trim(),
          category_id: f.get('category_id') ? Number(f.get('category_id')) : null,
          unit: f.get('unit').trim() || 'حبة',
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

  /* ---------- more (mobile) ---------- */
  async function pageMore(view) {
    const links = navLinks().filter((l) => !l.sep && !['home', 'items', 'issue', 'invoices'].includes(l.key));
    view.innerHTML = `
      <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span class="avatar" style="width:44px;height:44px;font-size:18px">${esc(initial(S.profile.full_name || S.profile.login))}</span>
        <div><div style="font-weight:700">${esc(S.profile.full_name || S.profile.login)}</div><div class="muted small">${ROLE_LABEL[S.profile.role]}</div></div>
      </div>
      <div class="list">
        ${links.map((l) => `<a class="row" href="${l.href}"><span class="ic" style="color:var(--accent)">${l.icon}</span><div class="grow title">${l.label}</div></a>`).join('')}
        <button class="row" id="m-pw"><span class="ic" style="color:var(--accent)">${I.key}</span><div class="grow title">تغيير كلمة المرور</div></button>
        <button class="row" id="m-out"><span class="ic" style="color:var(--danger)">${I.logout}</span><div class="grow title" style="color:var(--danger)">تسجيل الخروج</div></button>
      </div>`;
    $('#m-pw').onclick = changePassword;
    $('#m-out').onclick = () => sb.auth.signOut();
  }

  /* ======================= start ======================= */
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
