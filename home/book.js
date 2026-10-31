/* بيوتفريش · العناية المنزلية — موقع الحجز */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');

  const CAT = { nails: 'الأظافر', hair: 'الشعر', package: 'الباقات', other: 'خدمات أخرى' };
  const CAT_ICON = { nails: 'nails', hair: 'hair', package: 'gift', other: 'care' };
  const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const MO = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const STATUS = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', on_way: 'في الطريق إليكِ', done: 'تمت الزيارة', cancelled: 'ملغي' };

  const store = {
    get(k, d) { try { const v = sessionStorage.getItem('bf_' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { sessionStorage.setItem('bf_' + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
    lget(k, d) { try { const v = localStorage.getItem('bf_' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    lset(k, v) { try { localStorage.setItem('bf_' + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };

  let CAT_DATA = null;
  const cart = new Map(store.get('cart', []));
  const draft = Object.assign({ step: 1, day: null, time: null, name: '', phone: '', district_id: '', address: '', map_url: '', notes: '', guests: 1 }, store.get('draft', {}));
  const save = () => { store.set('cart', [...cart]); store.set('draft', draft); };

  /* ---------- helpers ---------- */
  let tt;
  function toast(msg, err = false) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(tt); tt = setTimeout(() => { t.className = 'toast'; }, err ? 4500 : 2600);
  }
  function errMsg(e) {
    const m = String(e?.message || e || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'تعذر الاتصال، تحققي من الإنترنت';
    return m.replace(/^.*?: /, '') || 'حدث خطأ غير متوقع';
  }
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  const money = (v) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ر.س`;
  const dur = (m) => { m = Number(m); if (m < 60) return `${m} دقيقة`; const h = Math.floor(m / 60), r = m % 60; const hs = h === 1 ? 'ساعة' : h === 2 ? 'ساعتان' : `${h} ساعات`; return r ? `${hs} و${r} د` : hs; };
  const t12 = (hm) => { const [h, m] = hm.split(':').map(Number); const p = h < 12 ? 'ص' : 'م'; const hh = h % 12 || 12; return `${hh}:${String(m).padStart(2, '0')} ${p}`; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const riyadhToday = () => { const s = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).slice(0, 10); const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayLabel = (s) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${WD[dt.getDay()]} ${d} ${MO[m - 1]}`; };
  const fmtWhen = (ts) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long' });
    const hm = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} · ${t12(hm)}`;
  };
  const icon = (n) => `assets/${n}.svg`;
  const normPhone = (v) => {
    let p = String(v || '').replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
    if (/^9665\d{8}$/.test(p)) p = '0' + p.slice(3);
    if (/^5\d{8}$/.test(p)) p = '0' + p;
    return p;
  };
  const waLink = (num, text) => { if (!num) return null; let n = String(num).replace(/\D/g, ''); if (n.startsWith('0')) n = '966' + n.slice(1); return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`; };

  function svcById(id) { return CAT_DATA.services.find((s) => s.id === Number(id)); }
  function totals() {
    let minutes = 0, sum = 0, tbd = false, count = 0;
    for (const [id, qty] of cart) {
      const s = svcById(id); if (!s) continue;
      count += qty; minutes += s.duration_min * qty;
      if (s.price == null) tbd = true; else sum += Number(s.price) * qty;
    }
    const d = CAT_DATA.districts.find((x) => x.id === Number(draft.district_id));
    const fee = d ? d.visit_fee : null;
    return { minutes, sum, tbd, count, fee, feeKnown: d != null && fee != null, total: !tbd && d && fee != null ? sum + Number(fee) : null };
  }
  function priceHtml(p) { return p == null ? '<span class="price tbd">يُحدد عند التأكيد</span>' : `<span class="price num">${money(p)}</span>`; }

  async function loadCatalog() {
    if (CAT_DATA) return CAT_DATA;
    CAT_DATA = await rpc('bh_catalog');
    for (const id of [...cart.keys()]) if (!svcById(id)) cart.delete(id);
    const s = CAT_DATA.settings || {};
    if (s.open_time) $('#foot-hours').textContent = `يوميًا من ${t12(s.open_time)} إلى ${t12(s.close_time)}`;
    const wa = waLink(s.whatsapp); if (wa) { const a = $('#foot-wa'); a.href = wa; a.hidden = false; }
    return CAT_DATA;
  }

  function observeReveal() {
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 }) : null;
    $$('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
  }

  /* ---------- home ---------- */
  function serviceRows(cat) {
    const list = CAT_DATA.services.filter((s) => s.category === cat);
    return list.map((s) => `
      <div class="svc">
        <h3>${esc(s.name)}</h3>
        <div class="side">${priceHtml(s.price)}<button class="add ${cart.has(s.id) ? 'on' : ''}" data-add="${s.id}" aria-label="أضيفي ${esc(s.name)}">${cart.has(s.id) ? '✓' : '+'}</button></div>
        ${s.description ? `<p>${esc(s.description)}</p>` : ''}
        <div class="meta"><span>${dur(s.duration_min)}</span></div>
      </div>`).join('');
  }

  function pageHome(scrollTo) {
    const cats = Object.keys(CAT).filter((c) => CAT_DATA.services.some((s) => s.category === c));
    const first = cats[0] || 'nails';
    const accepting = CAT_DATA.settings?.accepting !== false && CAT_DATA.districts.length > 0;
    const marquee = ['أظافر', 'شعر', 'باقات', 'في بيتك', 'وقتك لكِ', 'بأيادي بيوتفريش'];
    const mq = marquee.map((w) => `<span>${w}</span><img src="assets/rosette-1.svg" alt="">`).join('');
    app.innerHTML = `
      <section class="hero">
        <div class="hero-pattern" aria-hidden="true"></div>
        <div class="wrap hero-in">
          <div class="hero-mark" aria-hidden="true"><img src="assets/home-mark.svg" alt=""></div>
          <img class="hero-line" src="assets/home-line.svg" alt="بيوتفريش للخدمات المنزلية">
          <h1 class="hero-title"><span>بيوتفريش،</span> <span>في بيتك.</span></h1>
          <p class="lead">الصالون اللي تحبينه.. يجيك لين بابك.<br>أظافر وشعر بأيادي بيوتفريش، في وقتك ومكانك.</p>
          <div class="cta">
            <a class="btn" href="#/book">${accepting ? 'احجزي موعدك' : 'قريبًا'}<i class="arr" aria-hidden="true">←</i></a>
            <a class="btn ghost" href="#/services">قائمة الخدمات</a>
          </div>
        </div>
        <div class="hero-scroll" aria-hidden="true"><span></span></div>
      </section>

      <div class="marquee" aria-hidden="true"><div class="mq-track">${mq}${mq}${mq}</div></div>

      <section class="block dark">
        <div class="wrap">
          <div class="sec-head reveal"><div><span class="label">How it works</span><h2>ثلاث خطوات،<br>ووقتك لكِ.</h2></div><p>تحجزين من هنا، ونرتّب الباقي معكِ إلى آخر لحظة في الزيارة.</p></div>
          <div class="steps">
            <div class="step reveal"><span class="n">١</span><img src="${icon('calendar')}" alt=""><h3>تحجزين</h3><p>تختارين الخدمة والحي والوقت المتاح.</p></div>
            <div class="step reveal" style="--d:.12s"><span class="n">٢</span><img src="${icon('message')}" alt=""><h3>نؤكّد</h3><p>نرسل لكِ التأكيد والإجمالي ورابط الدفع.</p></div>
            <div class="step reveal" style="--d:.24s"><span class="n">٣</span><img src="${icon('home')}" alt=""><h3>نزورك</h3><p>تجيكِ الأخصائية بأدواتها، ونرتّب المكان قبل ما نطلع.</p></div>
          </div>
        </div>
      </section>

      <section class="block" id="services">
        <div class="wrap">
          <div class="sec-head reveal"><div><span class="label">The Care Menu</span><h2>قائمة العناية.</h2></div><p>اختاري خدمة أو أكثر، وتنضاف لحجزك مباشرة.</p></div>
          <div class="tabs reveal" role="tablist">${cats.map((c) => `<button role="tab" data-tab="${c}" class="${c === first ? 'on' : ''}">${CAT[c]}</button>`).join('')}</div>
          <div class="svc-list" id="svc-list">${serviceRows(first)}</div>
          <div class="svc-foot"><a class="btn" href="#/book" id="go-book">${cart.size ? `أكملي الحجز (${cart.size})` : 'احجزي موعدك'}<i class="arr" aria-hidden="true">←</i></a><span class="muted">الأسعار النهائية ورسوم الزيارة تتأكد معكِ قبل الموعد.</span></div>
        </div>
      </section>

      <section class="block soft">
        <div class="wrap kit">
          <div class="reveal">
            <span class="label">The Arrival Kit</span>
            <h2>عنايتهم،<br>تجي معك.</h2>
            <p class="muted" style="max-width:38ch">نفس فريق بيوتفريش ونفس العناية، بحقيبة مجهزة لكل زيارة.</p>
          </div>
          <ul class="kit-list">
            <li class="reveal"><img src="assets/rosette-1.svg" alt=""><div><b>أدوات نظيفة ومجهزة</b><span>تنفتح قدامك، ولكِ وحدك.</span></div></li>
            <li class="reveal" style="--d:.08s"><img src="assets/rosette-2.svg" alt=""><div><b>مفرش عمل ومنشفة</b><span>نحمي فيها مكانك قبل ما نبدأ.</span></div></li>
            <li class="reveal" style="--d:.16s"><img src="assets/rosette-3.svg" alt=""><div><b>في موعدك</b><span>ونبلغك أول ما نطلع لك.</span></div></li>
            <li class="reveal" style="--d:.24s"><img src="assets/rosette-4.svg" alt=""><div><b>نرتّب قبل ما نطلع</b><span>ويرجع المكان مثل ما كان.</span></div></li>
          </ul>
        </div>
      </section>

      <section class="block">
        <div class="wrap">
          <div class="sec-head reveal"><div><span class="label">Before your visit</span><h2>قبل موعدك.</h2></div></div>
          <div class="faq reveal">
            <details><summary>متى يكون الموعد مؤكد؟</summary><p>${esc(CAT_DATA.settings?.policy_note || 'بعد رسالة التأكيد من الفريق.')}</p></details>
            <details><summary>كيف أدفع؟</summary><p>${esc(CAT_DATA.settings?.payment_note || '')}</p></details>
            <details><summary>وش أجهّز في البيت؟</summary><p>مكان فيه إضاءة جيدة، وكرسي مريح، وفيش كهرباء قريب. ونرسل لكِ أي متطلبات خاصة بالخدمة.</p></details>
            <details><summary>أقدر أحجز لأكثر من شخص؟</summary><p>إيه، زيدي العدد على الخدمة وقت الحجز ونرتّب الوقت والفريق.</p></details>
            <details><summary>أبي أعدّل أو ألغي موعدي</summary><p>من صفحة حجزك تقدرين تلغين قبل الموعد بست ساعات، أو تواصلي معنا لأي تعديل.</p></details>
            <details><summary>وين تغطّون؟</summary><p>${CAT_DATA.districts.length ? esc(CAT_DATA.districts.map((d) => d.name).join('، ')) + '.' : 'نعلن الأحياء قريبًا.'}</p></details>
          </div>
        </div>
      </section>

      <section class="cta-band dark">
        <div class="wrap reveal">
          <img class="cta-mark" src="assets/home-mark-cream.svg" alt="">
          <h2>وقت جميل،<br>محجوز لكِ.</h2>
          <a class="btn light" href="#/book">احجزي موعدك<i class="arr" aria-hidden="true">←</i></a>
        </div>
      </section>`;

    $$('[data-tab]').forEach((b) => b.onclick = () => {
      $$('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      $('#svc-list').innerHTML = serviceRows(b.dataset.tab);
    });
    $('#svc-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      const id = Number(b.dataset.add);
      if (cart.has(id)) cart.delete(id); else cart.set(id, 1);
      save();
      b.classList.toggle('on', cart.has(id)); b.textContent = cart.has(id) ? '✓' : '+'; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      $('#go-book').textContent = cart.size ? `أكملي الحجز (${cart.size})` : 'احجزي موعدك';
      if (cart.has(id)) toast(`أضفنا ${svcById(id).name}`);
    });
    observeReveal();
    if (scrollTo) setTimeout(() => $('#' + scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  /* ---------- booking flow ---------- */
  const STEPS = ['الخدمات', 'الموعد', 'بياناتك', 'المراجعة'];

  function summaryHtml() {
    const t = totals();
    if (!cart.size) return '<h3>حجزك</h3><p class="sum-empty">ما اخترتي خدمة بعد.</p>';
    const rows = [...cart].map(([id, q]) => { const s = svcById(id); return `<div class="sum-row"><span>${esc(s.name)}${q > 1 ? ` × ${q}` : ''}</span>${s.price == null ? '<span class="muted">—</span>' : `<span class="num">${money(s.price * q)}</span>`}</div>`; }).join('');
    const when = draft.day && draft.time ? `<div class="sum-row"><span class="muted">الموعد</span><span>${dayLabel(draft.day)} · ${t12(draft.time)}</span></div>` : '';
    const d = CAT_DATA.districts.find((x) => x.id === Number(draft.district_id));
    const fee = d ? `<div class="sum-row"><span class="muted">رسوم الزيارة</span><span class="num">${d.visit_fee == null ? 'تُحدد عند التأكيد' : money(d.visit_fee)}</span></div>` : '';
    const total = t.total != null ? `<div class="sum-row total"><span>الإجمالي</span><span class="num">${money(t.total)}</span></div>`
      : `<div class="sum-row total"><span>الإجمالي</span><span style="font-size:14px;font-weight:400">يتأكد معكِ</span></div>`;
    return `<h3>حجزك</h3>${rows}<div class="sum-row"><span class="muted">المدة التقريبية</span><span>${dur(t.minutes)}</span></div>${when}${fee}${total}`;
  }

  function mbarHtml(nextLabel, disabled) {
    const t = totals();
    return `<div class="mbar"><div class="info">${cart.size ? `${cart.size} خدمة · ${dur(t.minutes)}<b>${t.total != null ? money(t.total) : t.tbd ? 'السعر يتأكد معكِ' : money(t.sum)}</b>` : 'اختاري خدمة'}</div>
      <div style="display:flex;gap:8px">${draft.step > 1 ? '<button class="btn ghost sm" data-back>رجوع</button>' : ''}<button class="btn sm" data-next ${disabled ? 'disabled' : ''}>${nextLabel}</button></div></div>`;
  }

  async function pageBook() {
    if (CAT_DATA.settings?.accepting === false || !CAT_DATA.districts.length) {
      app.innerHTML = `<section class="book"><div class="wrap ticket"><div class="ticket-head"><img class="ros" src="assets/rosette-1.svg" alt=""><span class="label">Coming soon</span><h1>الحجز يفتح قريبًا.</h1><p class="muted">تابعينا على <a href="https://www.instagram.com/beautfresh" target="_blank" rel="noopener">@beautfresh</a> عشان تعرفين أول وحدة.</p></div></div></section>`;
      return;
    }
    if (!cart.size) draft.step = 1;
    const step = draft.step;
    app.innerHTML = `
      <section class="book"><div class="wrap">
        <div class="book-head"><div><span class="label">Book your visit</span><h1>${['اختاري خدمتك.', 'اختاري وقتك.', 'وين نجيكِ؟', 'راجعي حجزك.'][step - 1]}</h1></div></div>
        <div class="stepper">${STEPS.map((s, i) => `<div class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><b>${i + 1}</b><span>${s}</span></div>`).join('')}</div>
        <div class="book-grid"><div id="step-body"></div><aside class="summary-col"><div class="panel summary" id="summary">${summaryHtml()}</div></aside></div>
      </div></section>`;
    const body = $('#step-body');
    const refresh = () => { $('#summary').innerHTML = summaryHtml(); };
    const go = (n) => { draft.step = n; save(); route(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const bindNav = (canNext, onNext) => {
      $$('[data-next]').forEach((b) => b.onclick = async () => { if (!canNext()) return; await onNext(b); });
      $$('[data-back]').forEach((b) => b.onclick = () => go(step - 1));
    };

    if (step === 1) {
      const cats = Object.keys(CAT).filter((c) => CAT_DATA.services.some((s) => s.category === c));
      body.innerHTML = `
        ${cats.map((c) => `<div class="panel" style="margin-bottom:18px"><h2 style="display:flex;gap:10px;align-items:center"><img src="${icon(CAT_ICON[c])}" alt="" style="width:26px">${CAT[c]}</h2>
          ${CAT_DATA.services.filter((s) => s.category === c).map((s) => `
            <div class="svc" style="padding:16px 0">
              <h3 style="font-size:19px">${esc(s.name)}</h3>
              <div class="side">${priceHtml(s.price)}
                ${cart.has(s.id) ? `<div class="counter"><button data-dec="${s.id}" aria-label="أقل">−</button><span class="num">${cart.get(s.id)}</span><button data-inc="${s.id}" aria-label="أكثر">+</button></div>` : `<button class="add" data-add="${s.id}" aria-label="أضيفي">+</button>`}
              </div>
              ${s.description ? `<p>${esc(s.description)}</p>` : ''}
              <div class="meta"><span>${dur(s.duration_min)}</span></div>
            </div>`).join('')}</div>`).join('')}
        <p class="hint">لأكثر من شخص، زيدي العدد على الخدمة.</p>
        <div class="actions desk"><span></span><button class="btn" data-next ${cart.size ? '' : 'disabled'}>التالي: الموعد</button></div>
        ${mbarHtml('التالي', !cart.size)}`;
      body.addEventListener('click', (e) => {
        const a = e.target.closest('[data-add],[data-inc],[data-dec]'); if (!a) return;
        const id = Number(a.dataset.add || a.dataset.inc || a.dataset.dec);
        if (a.dataset.add) cart.set(id, 1);
        if (a.dataset.inc) cart.set(id, Math.min(10, (cart.get(id) || 1) + 1));
        if (a.dataset.dec) { const v = (cart.get(id) || 1) - 1; if (v <= 0) cart.delete(id); else cart.set(id, v); }
        draft.time = null; save(); pageBook();
      });
      bindNav(() => cart.size > 0, () => go(2));
      return;
    }

    if (step === 2) {
      const t = totals();
      const s = CAT_DATA.settings;
      const start = riyadhToday();
      const black = new Set(CAT_DATA.blackouts || []);
      const days = [];
      for (let i = 0; i <= (s.horizon_days || 21); i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const k = iso(d);
        days.push({ k, d, off: (s.closed_weekdays || []).includes(d.getDay()) || black.has(k) });
      }
      if (!draft.day || !days.some((d) => d.k === draft.day && !d.off)) draft.day = (days.find((d) => !d.off) || days[0]).k;
      body.innerHTML = `
        <div class="panel">
          <h2>اليوم</h2>
          <div class="days">${days.map((d) => `<button class="day ${d.k === draft.day ? 'on' : ''}" data-day="${d.k}" ${d.off ? 'disabled' : ''}><small>${WD[d.d.getDay()]}</small><strong class="num">${d.d.getDate()}</strong><small>${MO[d.d.getMonth()]}</small></button>`).join('')}</div>
          <div id="slots"><div class="loading" style="min-height:160px"><img src="assets/rosette-1.svg" alt=""></div></div>
          <p class="hint" style="margin-top:18px">المدة التقريبية لزيارتك ${dur(t.minutes)}. الأوقات المعروضة هي المتاحة فعلًا.</p>
        </div>
        <div class="actions desk"><button class="btn ghost" data-back>رجوع</button><button class="btn" data-next ${draft.time ? '' : 'disabled'}>التالي: بياناتك</button></div>
        ${mbarHtml('التالي', !draft.time)}`;
      const loadSlots = async () => {
        const box = $('#slots');
        box.innerHTML = '<div class="loading" style="min-height:160px"><img src="assets/rosette-1.svg" alt=""></div>';
        try {
          const rows = await rpc('bh_slots', { p_day: draft.day, p_duration: t.minutes });
          const list = (rows || []).map((r) => r.slot);
          if (draft.time && !list.includes(draft.time)) draft.time = null;
          if (!list.length) { box.innerHTML = '<p class="muted" style="margin-top:22px">ما فيه أوقات متاحة في هذا اليوم. جرّبي يوم ثاني.</p>'; }
          else {
            const groups = [['الصباح', list.filter((x) => +x.slice(0, 2) < 12)], ['الظهر والعصر', list.filter((x) => +x.slice(0, 2) >= 12 && +x.slice(0, 2) < 17)], ['المساء', list.filter((x) => +x.slice(0, 2) >= 17)]].filter((g) => g[1].length);
            box.innerHTML = groups.map(([n, g]) => `<div class="period">${n}</div><div class="slots">${g.map((x) => `<button class="slot num ${x === draft.time ? 'on' : ''}" data-slot="${x}">${t12(x)}</button>`).join('')}</div>`).join('');
          }
          save(); setNext();
        } catch (e) { box.innerHTML = `<p class="muted" style="margin-top:22px">${esc(errMsg(e))}</p>`; }
      };
      const setNext = () => {
        refresh();
        const m = $('.mbar'); if (m) m.outerHTML = mbarHtml('التالي', !draft.time);
        $$('[data-next]').forEach((b) => { b.disabled = !draft.time; });
        bindNav(() => !!draft.time, () => go(3));
      };
      body.addEventListener('click', (e) => {
        const d = e.target.closest('[data-day]');
        if (d && !d.disabled) { draft.day = d.dataset.day; draft.time = null; $$('[data-day]').forEach((x) => x.classList.toggle('on', x === d)); loadSlots(); return; }
        const sl = e.target.closest('[data-slot]');
        if (sl) { draft.time = sl.dataset.slot; $$('[data-slot]').forEach((x) => x.classList.toggle('on', x === sl)); save(); setNext(); }
      });
      bindNav(() => !!draft.time, () => go(3));
      $('.day.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
      loadSlots();
      return;
    }

    if (step === 3) {
      body.innerHTML = `
        <form class="panel" id="info" novalidate>
          <div class="two">
            <div class="field"><label for="f-name">الاسم</label><input class="input" id="f-name" autocomplete="name" value="${esc(draft.name)}" required maxlength="60"></div>
            <div class="field"><label for="f-phone">رقم الجوال</label><input class="input num" id="f-phone" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="05xxxxxxxx" value="${esc(draft.phone)}" required></div>
          </div>
          <div class="field"><label for="f-district">الحي</label>
            <select class="input" id="f-district" required><option value="">اختاري الحي</option>${CAT_DATA.districts.map((d) => `<option value="${d.id}" ${Number(draft.district_id) === d.id ? 'selected' : ''}>${esc(d.name)}${d.visit_fee != null ? ` · رسوم الزيارة ${money(d.visit_fee)}` : ''}</option>`).join('')}</select>
            <span class="hint">ما لقيتي حيّك؟ تواصلي معنا ونشوف التوفّر.</span>
          </div>
          <div class="field"><label for="f-address">العنوان</label><input class="input" id="f-address" autocomplete="street-address" placeholder="الشارع، رقم البيت، أي علامة تساعدنا" value="${esc(draft.address)}" maxlength="300"></div>
          <div class="field"><label for="f-map">رابط الموقع (اختياري)</label><input class="input" id="f-map" dir="ltr" placeholder="رابط من خرائط قوقل" value="${esc(draft.map_url)}" maxlength="500"></div>
          <div class="field"><label for="f-notes">ملاحظات (اختياري)</label><textarea class="input" id="f-notes" maxlength="500" placeholder="مثلًا: لون الأظافر المفضل، طول الشعر، مناسبة…">${esc(draft.notes)}</textarea></div>
        </form>
        <div class="actions desk"><button class="btn ghost" data-back>رجوع</button><button class="btn" data-next>التالي: المراجعة</button></div>
        ${mbarHtml('التالي', false)}`;
      const read = () => {
        draft.name = $('#f-name').value.trim(); draft.phone = $('#f-phone').value.trim();
        draft.district_id = $('#f-district').value; draft.address = $('#f-address').value.trim();
        draft.map_url = $('#f-map').value.trim(); draft.notes = $('#f-notes').value.trim(); save();
      };
      $('#info').addEventListener('input', () => { read(); refresh(); });
      $('#info').addEventListener('change', () => { read(); refresh(); });
      bindNav(() => {
        read();
        if (draft.name.length < 2) { toast('اكتبي اسمك', true); $('#f-name').focus(); return false; }
        if (!/^05\d{8}$/.test(normPhone(draft.phone))) { toast('رقم الجوال لازم يبدأ بـ 05 ويكون 10 أرقام', true); $('#f-phone').focus(); return false; }
        if (!draft.district_id) { toast('اختاري الحي', true); $('#f-district').focus(); return false; }
        if (draft.address.length < 4) { toast('اكتبي العنوان عشان نوصلك', true); $('#f-address').focus(); return false; }
        return true;
      }, () => go(4));
      return;
    }

    // step 4: review
    const t = totals();
    const d = CAT_DATA.districts.find((x) => x.id === Number(draft.district_id));
    body.innerHTML = `
      <div class="panel">
        <dl class="kv">
          <dt>الخدمات</dt><dd>${[...cart].map(([id, q]) => esc(svcById(id).name) + (q > 1 ? ` × ${q}` : '')).join('، ')}</dd>
          <dt>الموعد</dt><dd>${dayLabel(draft.day)} · ${t12(draft.time)}</dd>
          <dt>المدة</dt><dd>${dur(t.minutes)} تقريبًا</dd>
          <dt>الاسم</dt><dd>${esc(draft.name)}</dd>
          <dt>الجوال</dt><dd class="num" dir="ltr" style="text-align:right">${esc(normPhone(draft.phone))}</dd>
          <dt>العنوان</dt><dd>${esc(d?.name || '')}، ${esc(draft.address)}</dd>
          ${draft.notes ? `<dt>ملاحظات</dt><dd>${esc(draft.notes)}</dd>` : ''}
          <dt>الإجمالي</dt><dd>${t.total != null ? `<span class="price num">${money(t.total)}</span> <span class="muted" style="font-size:14px">شامل رسوم الزيارة</span>` : '<span class="muted">يتأكد معكِ في رسالة التأكيد</span>'}</dd>
        </dl>
        <div class="note" style="margin-top:24px">${esc(CAT_DATA.settings?.payment_note || '')} ${esc(CAT_DATA.settings?.policy_note || '')}</div>
      </div>
      <div class="actions desk"><button class="btn ghost" data-back>رجوع</button><button class="btn" data-next>تأكيد الحجز</button></div>
      ${mbarHtml('تأكيد الحجز', false)}`;
    bindNav(() => true, async (btn) => {
      $$('[data-next]').forEach((b) => { b.disabled = true; b.dataset.l = b.textContent; b.textContent = 'لحظات…'; });
      try {
        const res = await rpc('bh_create_booking', { p: {
          name: draft.name, phone: normPhone(draft.phone), district_id: Number(draft.district_id), address: draft.address,
          map_url: draft.map_url, notes: draft.notes, day: draft.day, time: draft.time,
          items: [...cart].map(([id, qty]) => ({ id, qty })),
        } });
        const mine = store.lget('mine', []);
        mine.unshift({ token: res.token, code: res.code, at: Date.now() });
        store.lset('mine', mine.slice(0, 20));
        cart.clear(); Object.assign(draft, { step: 1, day: null, time: null, notes: '' }); save();
        location.hash = `#/b/${res.token}?new=1`;
      } catch (e) {
        toast(errMsg(e), true);
        if (/متاح/.test(errMsg(e))) { draft.time = null; go(2); return; }
        $$('[data-next]').forEach((b) => { b.disabled = false; b.textContent = b.dataset.l; });
      }
      void btn;
    });
  }

  /* ---------- ticket ---------- */
  async function pageTicket(token, isNew) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) { app.innerHTML = '<section class="book"><div class="wrap ticket"><p>الرابط غير صحيح.</p></div></section>'; return; }
    const b = await rpc('bh_get_booking', { p_token: token });
    if (!b) { app.innerHTML = '<section class="book"><div class="wrap ticket"><div class="ticket-head"><h1>ما لقينا هذا الحجز.</h1><a class="btn" href="#/book">احجزي موعدك</a></div></div></section>'; return; }
    const order = ['pending', 'confirmed', 'on_way', 'done'];
    const idx = order.indexOf(b.status);
    const wa = waLink(b.whatsapp, `مرحبا، بخصوص حجزي ${b.code}`);
    app.innerHTML = `
      <section class="book"><div class="wrap ticket">
        <div class="ticket-head">
          <img class="ros" src="assets/rosette-1.svg" alt="">
          <span class="code num">${esc(b.code)}</span>
          <h1>${isNew ? `وصلنا طلبك، ${esc(b.name.split(' ')[0])}.` : b.status === 'cancelled' ? 'الحجز ملغي.' : `أهلًا ${esc(b.name.split(' ')[0])}.`}</h1>
          <p class="muted">${b.status === 'pending' ? 'نراجع الموعد ونرسل لكِ التأكيد والإجمالي على الجوال.' : b.status === 'confirmed' ? 'موعدك مؤكد. نشوفك على خير.' : b.status === 'on_way' ? 'أخصائيتك في الطريق إليكِ.' : b.status === 'done' ? 'شكرًا لأنك فتحتي لنا بابك.' : 'إذا تبين موعد جديد، احجزي من جديد.'}</p>
        </div>
        ${b.status !== 'cancelled' ? `<div class="timeline">${order.map((s, i) => `<div class="${i <= idx ? 'on' : ''}"><i></i>${STATUS[s]}</div>`).join('')}</div>` : '<p style="text-align:center;margin-bottom:24px"><span class="badge cancelled">ملغي</span></p>'}
        <div class="panel">
          <dl class="kv">
            <dt>الموعد</dt><dd>${fmtWhen(b.starts_at)}</dd>
            <dt>الخدمات</dt><dd>${(b.items || []).map((i) => esc(i.name) + (i.qty > 1 ? ` × ${i.qty}` : '')).join('، ')}</dd>
            <dt>العنوان</dt><dd>${esc(b.district || '')}${b.address ? '، ' + esc(b.address) : ''}</dd>
            <dt>الإجمالي</dt><dd>${b.total != null ? `<span class="price num">${money(b.total)}</span>` : '<span class="muted">يتأكد معكِ</span>'}</dd>
            <dt>الدفع</dt><dd>${b.payment_status === 'paid' ? 'مدفوع، شكرًا لكِ' : esc(b.payment_note || '')}</dd>
          </dl>
        </div>
        <div class="actions" style="justify-content:center;flex-wrap:wrap">
          ${b.status !== 'cancelled' && b.status !== 'done' ? `<button class="btn ghost" id="ics">أضيفيه للتقويم</button>` : ''}
          ${wa ? `<a class="btn ghost" href="${wa}" target="_blank" rel="noopener">تواصلي معنا</a>` : ''}
          ${b.can_cancel ? '<button class="link" id="cancel" style="align-self:center">إلغاء الحجز</button>' : ''}
        </div>
        <p class="hint" style="text-align:center;margin-top:26px">احفظي هذا الرابط، فيه تفاصيل حجزك وحالته.</p>
      </div></section>`;
    $('#ics')?.addEventListener('click', () => {
      const f = (v) => new Date(v).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Beautfresh//Home//AR', 'BEGIN:VEVENT', `UID:${b.code}@beautfresh`, `DTSTAMP:${f(Date.now())}`,
        `DTSTART:${f(b.starts_at)}`, `DTEND:${f(b.ends_at)}`, `SUMMARY:بيوتفريش في بيتك · ${b.code}`, `DESCRIPTION:${(b.items || []).map((i) => i.name).join('، ')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = `${b.code}.ics`; a.click();
    });
    $('#cancel')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'متأكدة؟ اضغطي مرة ثانية للإلغاء'; return; }
      try { await rpc('bh_cancel_booking', { p_token: token }); toast('تم إلغاء الحجز'); pageTicket(token, false); }
      catch (err) { toast(errMsg(err), true); }
    });
  }

  function pageMine() {
    const mine = store.lget('mine', []);
    app.innerHTML = `<section class="book"><div class="wrap ticket"><div class="ticket-head"><span class="label">My bookings</span><h1>حجوزاتي.</h1></div>
      ${mine.length ? `<div class="panel">${mine.map((m) => `<a class="sum-row" href="#/b/${esc(m.token)}" style="padding:14px 0;border-bottom:1px solid var(--line)"><span class="num">${esc(m.code)}</span><span class="muted">${new Date(m.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</span></a>`).join('')}</div>`
        : '<p class="muted" style="text-align:center">ما فيه حجوزات محفوظة على هذا الجهاز.</p>'}
      <div class="actions" style="justify-content:center"><a class="btn" href="#/book">حجز جديد</a></div></div></section>`;
  }

  /* ---------- router ---------- */
  async function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    $('#mine-link').hidden = !store.lget('mine', []).length;
    document.body.classList.toggle('home', !parts[0] || parts[0] === 'services');
    try {
      await loadCatalog();
      if (parts[0] === 'book') await pageBook();
      else if (parts[0] === 'b' && parts[1]) await pageTicket(parts[1], new URLSearchParams(qs || '').has('new'));
      else if (parts[0] === 'mine') pageMine();
      else { pageHome(parts[0] === 'services' ? 'services' : null); if (parts[0] !== 'services') window.scrollTo(0, 0); return; }
      window.scrollTo(0, 0);
    } catch (e) {
      app.innerHTML = `<section class="book"><div class="wrap ticket"><div class="ticket-head"><h1>تعذر التحميل.</h1><p class="muted">${esc(errMsg(e))}</p><button class="btn" onclick="location.reload()">إعادة المحاولة</button></div></div></section>`;
    }
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => $('.top').classList.toggle('scrolled', window.scrollY > 8), { passive: true });
  route();
})();
