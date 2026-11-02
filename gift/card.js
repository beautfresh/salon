/* بطاقة إهداء بيوتفريش: رسم مشترك بين صفحة التصميم وصفحة الفتح */
(() => {
  const AR = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  const fmt = (n) => AR(Math.round(Number(n || 0)).toLocaleString('en-US'));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const OCC = {
    'عيد ميلاد': ['🎂', 'كل عام وأنتِ بخير', ['كل عام وأنتِ بخير يا أحلى وحدة', 'عمرك كله فرح، وهذي بداية دلع السنة']],
    'عيد': ['✨', 'عيدك مبارك', ['عيدك مبارك، دلّعي نفسك على حسابي', 'كل عام وأنتِ بخير وعيدك سعيد']],
    'يوم الأم': ['🤍', 'لأحلى أم', ['لأحلى أم في الدنيا، تستاهلين كل الدلع', 'يا أمي، هذي لك وحدك']],
    'مبروك': ['🎉', 'ألف مبروك', ['ألف مبروك، تستاهلين كل خير', 'مبروك من القلب، وهذي هديتي']],
    'شكرًا': ['🌿', 'شكرًا لك', ['شكرًا على كل شي، هذي منّي لك', 'وجودك يفرق، شكرًا']],
    'بدون مناسبة': ['🎁', 'هدية لك', ['ما تحتاجين مناسبة عشان تتدلعين', 'هدية صغيرة لأنك تستاهلين']],
  };
  const THEMES = [['oud', 'عودي', 1], ['rose', 'وردي', 1], ['gold', 'ذهبي', 0], ['sand', 'رملي', 0]];
  const PATTERNS = [['rosette', 'نقشة بيوتفريش'], ['leaves', 'أوراق'], ['plain', 'سادة']];
  const FONTS = [['ruqaa', 'رقعة'], ['naskh', 'نسخ'], ['modern', 'حديث']];
  const DEFAULT = { theme: 'oud', pattern: 'rosette', font: 'ruqaa' };
  const dark = (t) => (THEMES.find((x) => x[0] === t) || THEMES[0])[2];
  const base = (document.currentScript && document.currentScript.src.replace(/gift\/card\.js.*$/, '')) || '../';

  function qrSvg(text, color) {
    if (!window.qrcode) return '';
    const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="${color}"/></svg>`;
  }
  const dateAr = (s) => { if (!s) return '—'; const d = new Date(s + 'T12:00:00'); return `${AR(d.getDate())} ${MONTHS[d.getMonth()]} ${AR(d.getFullYear())}`; };

  function html(c) {
    const ds = { ...DEFAULT, ...(c.design || {}) };
    const o = OCC[c.occasion] || OCC['بدون مناسبة'];
    const logo = `${base}home/assets/gift-logo${dark(ds.theme) ? '-cream' : ''}.svg`;
    const balance = c.balance != null ? c.balance : c.amount;
    return `<div class="bfc t-${ds.theme} p-${ds.pattern} f-${ds.font}${c.flipped ? ' flipped' : ''}" data-bfc><div class="bfc-in">
      <div class="bfc-f"><span class="bfc-pat"></span><span class="bfc-glow"></span><span class="bfc-shine"></span>
        <img class="bfc-logo" src="${logo}" alt="بيوتفريش للإهداء">
        <div class="bfc-occ">${esc(o[1])}</div>${c.occasion && c.occasion !== 'بدون مناسبة' ? `<div class="bfc-emo">${o[0]}</div>` : ''}
        <div class="bfc-to">إلى</div><div class="bfc-name">${esc(c.to || 'اسمها')}</div>
        ${c.message ? `<p class="bfc-msg">${esc(c.message)}</p>` : ''}
        ${c.from ? `<div class="bfc-from">— ${esc(c.from)}</div>` : ''}
        <div class="bfc-val"><b data-val>${fmt(c.amount)}</b><span>ريال</span></div>
        <div class="bfc-code">${esc(c.code || 'BF-•••••')}</div>
      </div>
      <div class="bfc-b"><span class="bfc-pat"></span><span class="bfc-shine"></span>
        <h4>قسيمة هدية من بيوتفريش</h4>
        <div class="bfc-qr">${c.code ? qrSvg(c.code, '#3F1D17') : `<img src="${base}home/assets/gift-mark.svg" alt="" style="width:70%">`}</div>
        <div class="bfc-bcode">${esc(c.code || 'BF-•••••')}</div>
        <div class="bfc-rows">
          <div><span>الرصيد</span><b>${fmt(balance)} ريال</b></div>
          <div><span>صالحة لين</span><b>${c.expires ? dateAr(c.expires) : '٦ أشهر من الإصدار'}</b></div>
          <div><span>المكان</span><b>بيوتفريش · الأحساء</b></div>
        </div>
        <p class="bfc-terms">تُستخدم لخدمات الصالون، وإذا كانت الخدمة أقل يبقى الباقي رصيد لك لين تنتهي الصلاحية. ما تُسترد نقدًا. أظهري الكود عند الحجز أو الحضور.</p>
      </div>
    </div></div>`;
  }

  // ميلان ولمعة مع الماوس/الجوال (يتربط مرة وحدة على الحاوية، ويلقى البطاقة الحالية كل مرة)
  function interact(wrap) {
    const cardOf = () => wrap.querySelector('[data-bfc]');
    const set = (x, y) => {
      const card = cardOf(); if (!card) return;
      card.querySelector('.bfc-in').style.transform = `${card.classList.contains('flipped') ? 'rotateY(180deg) ' : ''}rotateY(${x * 10}deg) rotateX(${-y * 8}deg)`;
      card.querySelectorAll('.bfc-shine').forEach((s) => s.style.setProperty('--sx', `${-70 + (x + 1) * 70}%`));
      card.querySelectorAll('.bfc-glow').forEach((s) => { s.style.setProperty('--gx', `${50 + x * 40}%`); s.style.setProperty('--gy', `${40 + y * 30}%`); });
    };
    if (!wrap.__bfc) {
      wrap.__bfc = true;
      wrap.addEventListener('pointermove', (e) => { if (e.pointerType && e.pointerType !== 'mouse') return; const c = cardOf(); if (!c) return; const r = c.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1); });
      wrap.addEventListener('pointerleave', () => set(0, 0));
      addEventListener('deviceorientation', (e) => { if (e.gamma == null) return; set(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 50) / 40))); });
    }
    return (flip) => { const c = cardOf(); if (!c) return; c.classList.toggle('flipped', flip ?? !c.classList.contains('flipped')); set(0, 0); };
  }

  window.BFCard = { html, interact, OCC, THEMES, PATTERNS, FONTS, DEFAULT, fmt, AR, esc, dateAr };
})();
