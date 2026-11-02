/* بيوتفريش · حجز الصالون */
(() => {
'use strict';
const CFG = window.APP_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const RK = async (body) => { const r = await fetch(CFG.supabaseUrl + '/functions/v1/rekaz-book', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.message || 'صار خطأ، جرّبي مرة ثانية'); return j; };
const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(error.message || 'صار خطأ'); return data; };
const ICONS={
 hair:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 12V50Q16 55 22 55H27V12ZM27 16H51M27 23H49M27 30H51M27 37H49M27 44H51M27 51H49"/></svg>',
 nails:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 50V27C21 16 43 16 43 27V50C43 58 21 58 21 50ZM21 36H43M26 31V25C26 20 38 20 38 25V31Z"/></svg>',
 face:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 34Q32 14 54 34Q32 54 10 34ZM32 26A8 8 0 1 0 32.1 26M18 24L14 18M26 20L24 13M38 20L40 13M46 24L50 18"/></svg>',
 drop:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M32 8C32 8 14 30 14 40A18 18 0 0 0 50 40C50 30 32 8 32 8ZM24 42A8 8 0 0 0 32 50"/></svg>',
 heat:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 22H46A6 6 0 0 1 46 34H14ZM22 34V54M40 14C36 10 44 8 40 4M30 14C26 10 34 8 30 4"/></svg>',
 sc:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 46A7 7 0 1 0 18.1 46M46 46A7 7 0 1 0 46.1 46M23 41L46 10M41 41L18 10"/></svg>',
 polish:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M26 6H38V22H26ZM20 22H44V54Q44 58 40 58H24Q20 58 20 54ZM20 34H44"/></svg>',
 lash:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 30Q32 52 56 30M14 36L8 44M22 41L18 50M32 43V52M42 41L46 50M50 36L56 44"/></svg>'};

const icu = (k) => "url('data:image/svg+xml;utf8," + encodeURIComponent(ICONS[k]) + "')";
const A = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const sar = (n) => A(Number(n).toLocaleString('en')) + ' ر.س';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dur = (m) => { if (!m) return ''; const h = Math.floor(m / 60), r = m % 60; let s = h === 0 ? '' : h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : A(h) + ' ساعات'; if (r) s += (s ? ' و' : '') + (r === 30 && h ? 'نص' : A(r) + ' دقيقة'); return s; };
const LEN = { S: ['قصير', 18], M: ['متوسط', 24], L: ['طويل', 30], VL: ['طويل جدًا', 36], '2VL': ['طويل جدًا ×٢', 40] };
const lenOf = (n) => { const m = n.match(/(2VL|VL|L|M|S)\s*$/); if (m) return LEN[m[1]]; if (/×\s*2|×٢/.test(n)) return LEN['2VL']; if (/جد(ًا|ا|اً)/.test(n)) return LEN.VL; if (/طويل/.test(n)) return LEN.L; if (/متوسط/.test(n)) return LEN.M; if (/قصير/.test(n)) return LEN.S; return null; };
const catIcon = (c) => /حرار/.test(c.name) ? 'heat' : /تسريح|قص/.test(c.name) ? 'sc' : /رموش/.test(c.name) ? 'lash' : /وجه|مكياج/.test(c.name) ? 'face' : c.grp === 'nails' ? (/^الأظافر$/.test(c.name) ? 'nails' : 'polish') : 'drop';
const GROUPS = [['hair', 'الشعر'], ['nails', 'الأظافر'], ['face', 'الوجه والمكياج']];
const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const RIYADH = 'Asia/Riyadh';
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: RIYADH });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const dayLabel = (iso) => { const t = todayISO(); if (iso === t) return 'اليوم'; if (iso === addDays(t, 1)) return 'بكرة'; return WD[dow(iso)] + ' ' + A(+iso.slice(8)); };
const tLabel = (hm) => { let [h, m] = hm.split(':').map(Number); const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return A(h + ':' + String(m).padStart(2, '0')) + ' ' + ap; };
const store = { get() { try { return JSON.parse(localStorage.getItem('bf-book') || 'null'); } catch { return null; } }, set(v) { try { localStorage.setItem('bf-book', JSON.stringify(v)); } catch {} } };

const $ = (s) => document.querySelector(s);
const main = $('#main');
let C = null; // catalog
const S = { step: 0, g: -1, q: '', sel: [], staff: 0, day: null, slot: null, name: '', phone: '', notes: '', dir: 0, res: null, busy: false };

function total() { return S.sel.reduce((a, x) => a + x.price, 0); }
function mins() { return S.sel.reduce((a, x) => a + x.dur, 0); }
function isSel(id) { return S.sel.some((x) => x.service_id === id); }
const itemsArg = () => S.sel.map((x) => ({ service_id: x.service_id, option_id: x.option_id || null }));
const svcById = (id) => C.services.find((s) => s.id === id);

function toggle(s, o) {
  const i = S.sel.findIndex((x) => x.service_id === s.id);
  if (i > -1 && !o) S.sel.splice(i, 1);
  else {
    if (i > -1) S.sel.splice(i, 1);
    const L = o && lenOf(o.name);
    S.sel.push({ service_id: s.id, option_id: o ? o.id : null, name: o ? (L ? s.name + ' · ' + L[0] : (o.name.includes(s.name) ? o.name : s.name + ' · ' + o.name)) : s.name, price: Number(o ? o.price : s.price), dur: o ? o.dur : s.dur });
  }
  S.slot = null; S.first = undefined;
  bar(true);
}
function bar(b) {
  const el = $('#bar');
  if (S.step >= 3 || !S.sel.length) { el.classList.remove('show'); return; }
  el.classList.add('show');
  $('#barT').textContent = sar(total());
  $('#barS').textContent = A(S.sel.length) + (S.sel.length === 1 ? ' خدمة' : ' خدمات') + ' · ' + dur(mins());
  const go = $('#barGo');
  if (S.step === 0) { go.innerHTML = 'اختاري الوقت <span>←</span>'; go.disabled = false; }
  else if (S.step === 1) { go.innerHTML = 'التالي <span>←</span>'; go.disabled = !S.slot; }
  else { go.innerHTML = S.busy ? 'لحظة…' : 'أكّدي الحجز'; go.disabled = S.busy || !(S.name.trim().length >= 2 && S.phone.length === 9); }
  if (b) { const i = el.querySelector('.in'); i.classList.remove('bump'); void i.offsetWidth; i.classList.add('bump'); }
}
function steps() { document.querySelectorAll('#steps i').forEach((i, k) => i.classList.toggle('on', k <= Math.min(S.step, 2))); $('#steps').style.visibility = S.step >= 3 ? 'hidden' : 'visible'; }
function go(n) { S.dir = n < S.step ? 1 : 0; S.step = n; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

/* ---------- الخدمات ---------- */
function svcRow(s) {
  const sel = isSel(s.id), v = s.opts && s.opts.length, byLen = v && s.opts.some((x) => lenOf(x.name));
  const minP = v ? Math.min(...s.opts.map((o) => +o.price)) : +s.price;
  const short = s.desc ? s.desc.split(/[،,.]/)[0] : '';
  return `<button class="svc${sel ? ' sel' : ''}" data-s="${s.id}"><span><b>${esc(s.name)}${v ? `<span class="vtag">${byLen ? 'حسب الطول' : A(s.opts.length) + ' خيارات'}</span>` : ''}</b><small>${esc([dur(s.dur), short].filter(Boolean).join(' · '))}</small></span><span class="pr num">${v ? '<em>من</em>' : ''}${sar(minP)}</span><span class="tick"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F3EBDF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></span></button>`;
}
function list() {
  const q = S.q.trim();
  const cats = C.cats.filter((c) => S.g < 0 || c.grp === GROUPS[S.g][0]);
  let h = '';
  for (const c of cats) {
    const items = C.services.filter((s) => s.cat === c.id && (!q || s.name.includes(q) || (s.desc || '').includes(q) || c.name.includes(q)));
    if (!items.length) continue;
    h += `<div class="cat"><div class="cath"><span class="ci"><i style="--ic:${icu(catIcon(c))}"></i></span><h3>${esc(c.name)}</h3><small>${A(items.length)}</small></div>${items.map(svcRow).join('')}</div>`;
  }
  return h || `<p class="empty">ما لقينا «${esc(q)}». جرّبي كلمة ثانية.</p>`;
}
function s0() {
  const last = store.get();
  const pops = C.services.filter((s) => s.pop).slice(0, 8);
  return `<div class="screen${S.dir ? ' back' : ''}">` +
    (S.pro ? `<div class="giftban pro"><span><b>حجزك مع ${esc(S.pro.name || 'أخصائيتك')}</b><small>نعرض لك أوقاتها هي بس.</small></span><button type="button" class="prox" id="pro-x">أي أخصائية</button></div>` : '') +
    (S.gift ? `<div class="giftban"><img src="../home/assets/gift-mark-cream.svg" alt=""><span><b>أهلًا ${esc(S.gift.to)}، عندك بطاقة هدية 🎁</b><small>رصيدك ${sar(S.gift.balance)}. اختاري خدمتك ونحجز لك، والدفع من رصيدك بالصالون.</small></span></div>` : '') +
    (!S.gift && last && last.name && last.items && last.items.length ? `<button class="again" id="again"><span><b>أهلًا ${esc(last.name)}، نرجع لنفس الطلّة؟</b><small>${esc(last.label || '')}</small></span><span class="arr">احجزيها ←</span></button>` : '') +
    `<h1>احجزي موعدك</h1><p class="sub">اختاري الخدمة والوقت، وخلاص. بدون حساب وبدون رمز.</p>` +
    `<label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="q" type="search" placeholder="ابحثي: استشوار، جيل، رموش…" value="${esc(S.q)}" autocomplete="off" aria-label="بحث"></label>` +
    `<div class="chips"><button class="chip${S.g < 0 ? ' on' : ''}" data-g="-1">الكل</button>${GROUPS.map((g, i) => `<button class="chip${S.g === i ? ' on' : ''}" data-g="${i}">${g[1]}</button>`).join('')}</div>` +
    (S.g < 0 && !S.q && pops.length ? `<div class="lbl">الأكثر طلبًا</div><div class="pop">${pops.map((s, k) => { const c = C.cats.find((x) => x.id === s.cat); const v = s.opts && s.opts.length; const minP = v ? Math.min(...s.opts.map((o) => +o.price)) : +s.price; return `<button class="pc${isSel(s.id) ? ' sel' : ''}" data-s="${s.id}"><div class="art g${k % 3}"><i style="--ic:${icu(catIcon(c))}"></i><span class="add">${isSel(s.id) ? '✓' : '+'}</span></div><b>${esc(s.name.replace('استشوار شعر - Beautfresh Signature', 'استشوار سيغنتشر'))}</b><small class="num">${v ? 'من ' : ''}${sar(minP)}</small></button>`; }).join('')}</div>` : '') +
    `<div id="list">${list()}</div></div>`;
}
function sheet(s) {
  const sh = $('#sheet'); let pick = null;
  const byLen = s.opts.some((x) => lenOf(x.name));
  sh.innerHTML = `<div class="grab"></div><h2>${esc(s.name)}</h2><p>${esc(s.desc || (byLen ? 'السعر حسب طول الشعر. اختاري الأقرب لطولك، والمختصة تأكد معك في الصالون.' : 'اختاري اللي يناسبك.'))}</p>` +
    s.opts.map((o, i) => { const L = lenOf(o.name); return `<button class="opt" data-v="${i}">${L ? `<span class="len" style="--h:${L[1]}px"></span>` : '<span class="len nol"></span>'}<span><b>${esc(L ? L[0] : o.name)}</b><small>${dur(o.dur)}</small></span><span class="pr num">${sar(o.price)}</span></button>`; }).join('') +
    `<button class="primary" id="vok" disabled>${byLen ? 'اختاري الطول' : 'اختاري واحد'}</button>`;
  const ok = sh.querySelector('#vok');
  sh.querySelectorAll('.opt').forEach((b) => b.onclick = () => { sh.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); pick = s.opts[+b.dataset.v]; ok.disabled = false; ok.textContent = 'أضيفيها · ' + sar(pick.price); });
  ok.onclick = () => { toggle(s, pick); close(); render(); };
  $('#veil').classList.add('show'); sh.classList.add('show');
}
function close() { $('#veil').classList.remove('show'); $('#sheet').classList.remove('show'); }

/* ---------- الوقت ---------- */
function staffList() {
  if (!C.staff || !C.staff.length) return [];
  const roles = [...new Set(S.sel.map((x) => C.cats.find((c) => c.id === svcById(x.service_id).cat).role))];
  return C.staff.filter((m) => roles.some((r) => (m.roles || []).includes(r)));
}
function dayOpen(iso) { return !(C.settings.closed_weekdays || []).includes(dow(iso)) && !(C.blackouts || []).includes(iso); }
function s1() {
  const st = staffList();
  const days = Array.from({ length: Math.min(C.settings.horizon_days || 14, 21) }, (_, i) => addDays(todayISO(), i));
  if (!S.day) S.day = S.first ? S.first.day : days.find(dayOpen);
  const memberArg = S.staff ? S.staff : null;
  return `<div class="screen${S.dir ? ' back' : ''}"><button class="backb" data-back>→ الخدمات</button><h1>متى يناسبك؟</h1>` +
    `<div class="picked">${S.sel.map((x) => `<span>${esc(x.name)}</span>`).join('')}</div>` +
    `<div id="soonBox">${S.first === undefined ? '<div class="soon"><span><small>أقرب موعد متاح</small><b>نبحث…</b></span></div>' : S.first ? `<button class="soon" id="soon"><span><small>أقرب موعد متاح</small><b>${dayLabel(S.first.day)} · ${tLabel(S.first.time)}</b></span><span class="pick">احجزيه</span></button>` : '<p class="nos">ما فيه مواعيد متاحة قريبة لهالخدمات. تواصلي معنا على الواتساب ونرتّب لك.</p>'}</div>` +
    (st.length ? `<div class="lbl">مع مين؟</div><div class="staff"><button class="st${!S.staff ? ' on' : ''}" data-st="0"><span class="av any"><i></i></span>أي مختصة</button>${st.map((m) => `<button class="st${S.staff === m.id ? ' on' : ''}" data-st="${m.id}"><span class="av" style="background:${esc(m.color)}22;color:${esc(m.color)}">${esc(m.name[0])}</span>${esc(m.name)}</button>`).join('')}</div>` : '') +
    `<div class="lbl">أو اختاري يوم</div><div class="days">${days.map((d) => `<button class="day${dayOpen(d) ? '' : ' full'}${S.day === d ? ' on' : ''}" data-d="${d}"${dayOpen(d) ? '' : ' disabled'}><small>${d === todayISO() ? 'اليوم' : d === addDays(todayISO(), 1) ? 'بكرة' : WD[dow(d)].replace('ال', '')}</small><b class="num">${A(+d.slice(8))}</b><i></i></button>`).join('')}</div>` +
    `<div id="slotBox"><div class="part">المواعيد</div><div class="slots">${'<span class="skel"></span>'.repeat(8)}</div></div></div>`;
}
async function loadFirst() {
  const key = JSON.stringify([itemsArg(), S.staff, S.pro && S.pro.id]);
  try { const f = C.settings.rekaz ? (await RK({ action: 'first', items: itemsArg(), member: S.pro ? S.pro.id : undefined })).first : await rpc('sb_first', { p_items: itemsArg(), p_member: S.staff || null }); if (key !== JSON.stringify([itemsArg(), S.staff, S.pro && S.pro.id]) || S.step !== 1) return; S.first = f; if (!S.dayPicked && f) S.day = f.day; }
  catch { S.first = null; }
  if (S.step === 1) { render(); }
}
async function loadSlots() {
  const box = $('#slotBox'); if (!box) return;
  const day = S.day, key = JSON.stringify([itemsArg(), S.staff, day]);
  let rows = [];
  try { rows = C.settings.rekaz ? (await RK({ action: 'slots', day, items: itemsArg(), member: S.pro ? S.pro.id : undefined })).slots.slice().sort().map((slot) => ({ slot })) : await rpc('sb_slots', { p_day: day, p_items: itemsArg(), p_member: S.staff || null }) || []; } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (key !== JSON.stringify([itemsArg(), S.staff, S.day]) || S.step !== 1) return;
  const parts = { 'الصباح': [], 'العصر': [], 'المساء': [] };
  rows.forEach((r) => { const h = +r.slot.slice(0, 2); parts[h < 13 ? 'الصباح' : h < 17 ? 'العصر' : 'المساء'].push(r.slot); });
  box.innerHTML = rows.length ? Object.entries(parts).filter(([, v]) => v.length).map(([k, v]) => `<div class="part">${k}</div><div class="slots">${v.map((t) => `<button class="slot num${S.slot && S.slot.day === day && S.slot.time === t ? ' on' : ''}" data-sl="${t}">${tLabel(t).replace(/ [صم]$/, '')}</button>`).join('')}</div>`).join('')
    : `<p class="nos">${dayLabel(day)} مليان. جرّبي يوم ثاني${S.staff ? ' أو «أي مختصة»' : ''}.</p>`;
  box.querySelectorAll('[data-sl]').forEach((b) => b.onclick = () => { S.slot = { day, time: b.dataset.sl }; box.querySelectorAll('.slot').forEach((x) => x.classList.toggle('on', x === b)); bar(true); });
}

/* ---------- البيانات ---------- */
function s2() {
  const st = S.staff ? C.staff.find((m) => m.id === S.staff) : null;
  return `<div class="screen${S.dir ? ' back' : ''}"><button class="backb" data-back>→ الوقت</button><h1>آخر خطوة</h1><p class="sub">اسمك وجوالك، عشان نأكد لك على الواتساب.</p>` +
    `<div class="card">${S.sel.map((x) => `<div class="sumrow"><span>${esc(x.name)}</span><span class="num">${sar(x.price)}</span></div>`).join('')}` +
    `<div class="sumrow"><span>الموعد</span><span>${dayLabel(S.slot.day)} · ${tLabel(S.slot.time)}</span></div>${st ? `<div class="sumrow"><span>المختصة</span><span>${esc(st.name)}</span></div>` : ''}` +
    `<div class="sumrow sumtot"><span>الإجمالي</span><span class="num">${sar(total())}</span></div></div>` +
    `<div class="fld"><label for="nm">الاسم</label><input id="nm" autocomplete="given-name" maxlength="60" placeholder="اسمك" value="${esc(S.name)}"></div>` +
    `<div class="fld"><label for="ph">الجوال</label><div class="tel"><span>+966</span><input id="ph" inputmode="tel" autocomplete="tel-national" placeholder="5X XXX XXXX" value="${esc(fmtPhone(S.phone))}"></div></div>` +
    `<div class="fld"><label for="nt">ملاحظة <small style="color:var(--mute)">(اختياري)</small></label><input id="nt" maxlength="300" placeholder="مثلًا: أول مرة أصبغ" value="${esc(S.notes)}"></div>` +
    `<div class="lbl">الدفع</div><div class="pay"><button class="pm on" type="button"><span class="rd"></span><span><b>الدفع في الصالون</b><small>كاش أو مدى أو Apple Pay بعد الخدمة</small></span></button>` +
    (C.settings.rekaz ? `</div>` : `<button class="pm" type="button" disabled><span class="rd"></span><span><b>ادفعي أونلاين</b><small>عربون يثبّت موعدك</small><span class="brands"><span>Apple Pay</span><span>mada</span><span>VISA</span></span></span><span class="soonb">قريبًا</span></button></div>`) +
    `<div id="err"></div><p class="note">${C.settings.rekaz ? 'تقدرين تعدلين موعدك أو تلغينه بالتواصل مع الصالون على الواتساب.' : 'تقدرين تعدلين موعدك أو تلغينه من رابط الواتساب.'}</p></div>`;
}
const fmtPhone = (d) => d.replace(/^(\d{2})(\d{0,3})(\d{0,4}).*/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
async function submit() {
  if (S.busy) return; S.busy = true; bar();
  try {
    const r = C.settings.rekaz
      ? await RK({ action: 'book', name: S.name.trim(), phone: '0' + S.phone, items: itemsArg(), day: S.slot.day, time: S.slot.time, gift: S.gift ? S.gift.token : undefined, member: S.pro ? S.pro.id : undefined })
      : await rpc('sb_create', { p: { name: S.name.trim(), phone: '0' + S.phone, items: itemsArg(), day: S.slot.day, time: S.slot.time, member_id: S.staff || null, notes: S.notes.trim() } });
    if (C.settings.rekaz) { r.code = r.number ? String(r.number) : ''; r.pay = null; }
    S.res = r;
    store.set({ name: S.name.trim(), phone: S.phone, items: itemsArg(), label: S.sel.map((x) => x.name).join('، '), at: Date.now() });
    S.busy = false; go(3);
  } catch (e) {
    S.busy = false; bar();
    $('#err').innerHTML = `<p class="err">${esc(e.message)}</p>`;
    if (/انحجز|متاح/.test(e.message)) { S.slot = null; S.first = undefined; setTimeout(() => go(1), 1600); }
  }
}

/* ---------- تم ---------- */
function manageUrl(tok) { return location.origin + location.pathname + '?t=' + tok; }
function waLink(text) { return 'https://wa.me/' + (C.settings.whatsapp || '966509492224') + '?text=' + encodeURIComponent(text); }
function s3() {
  const c = ['#C9A46A', '#5A2A22', '#E8DFD1', '#9B6B5E'];
  const conf = Array.from({ length: 18 }, (_, i) => { const a = i / 18 * 6.28, r = 70 + ((i * 37) % 50); return `<i class="conf" style="background:${c[i % 4]};--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r)}px;animation-delay:${0.5 + i % 5 * 0.03}s"></i>`; }).join('');
  const nm = S.name.trim();
  const link = S.res.pay || (S.res.token ? manageUrl(S.res.token) : '');
  const msg = `السلام عليكم 🤍\nحجزت موعد في بيوتفريش\n${S.res.code ? `• رقم الحجز: ${S.res.code}\n` : ''}• ${dayLabel(S.slot.day)} الساعة ${tLabel(S.slot.time)}\n• ${S.sel.map((x) => x.name).join('، ')}\n• الاسم: ${nm}${link ? `\n\nرابط الحجز: ${link}` : ''}`;
  return `<div class="screen"><div class="done"><div class="seal"><span class="rs"></span>${conf}<span class="ck"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#F3EBDF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></span></div>` +
    `<h1>انحجز، يا ${esc(nm)}</h1><div class="when">${dayLabel(S.slot.day)} · ${tLabel(S.slot.time)}</div>${S.res.code ? `<span class="status">رقم الحجز ${esc(S.res.code)}</span>` : ''}` +
    `<div class="card ticket">${S.sel.map((x) => `<div class="sumrow"><span>${esc(x.name)}</span><span class="num">${sar(x.price)}</span></div>`).join('')}<div class="sumrow sumtot"><span>الإجمالي</span><span class="num">${sar(total())}</span></div><div class="sumrow"><span>المكان</span><span>بيوتفريش · الأحساء</span></div></div>` +
    (S.res.pay ? `<a class="primary" href="${esc(S.res.pay)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-top:12px">تفاصيل الحجز والدفع</a>` : '') +
    (S.gift ? `<p class="note">🎁 حجزك مربوط ببطاقة هديتك <b dir="ltr">${esc(S.gift.code)}</b>، والدفع من رصيدك في الصالون.</p>` : '') +
    `<div class="card src" id="src"><b>سؤال سريع: كيف عرفتينا؟</b><div class="srcs">${SRC.map(([k, l]) => `<button type="button" data-src="${k}">${l}</button>`).join('')}</div></div>` +
    `<a class="waBtn" href="${waLink(msg)}" target="_blank" rel="noopener">أرسلي الحجز على واتساب الصالون</a>` +
    (C.settings.rekaz ? `<p class="note">تحتاجين تعدلين الموعد أو تلغينه؟ راسلينا على واتساب الصالون وحنا نرتبه لك.</p>` : `<p class="note">نأكد لك الموعد على الواتساب، ومن نفس الرابط تقدرين تعدلين أو تلغين.</p>`) +
    `<button class="primary" id="again2" style="margin-top:10px">احجزي موعد ثاني</button></div></div>`;
}

const SRC = [['instagram', 'إنستقرام'], ['tiktok', 'تيك توك'], ['snapchat', 'سناب'], ['google', 'قوقل'], ['friend', 'صديقة أو قريبة'], ['passby', 'مريت من عند الصالون'], ['influencer', 'مشهورة'], ['other', 'غيره']];
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-src]'); if (!b) return;
  const box = document.getElementById('src'); if (!box || box.dataset.sent) return; box.dataset.sent = '1';
  b.classList.add('on'); try { await rpc('src_submit', { p_phone: '0' + S.phone, p_source: b.dataset.src }); } catch {}
  box.innerHTML = '<b>شكرًا 🤍</b><span class="sub">هذا يساعدنا نوصل لعميلات مثلك</span>';
});

/* ---------- رابط الحجز ---------- */
const STAT = { pending: ['بانتظار التأكيد', ''], confirmed: ['مؤكد', 'ok'], arrived: ['وصلتِ', 'ok'], done: ['تمت الزيارة', 'ok'], no_show: ['ما حضرتِ', 'no'], cancelled: ['ملغي', 'no'] };
async function manage(tok) {
  main.innerHTML = '<div class="loading"><span class="spin"></span>نجيب حجزك…</div>';
  let b;
  try { b = await rpc('sb_get', { p_token: tok }); } catch { b = null; }
  if (!b) { main.innerHTML = '<div class="screen"><h1>ما لقينا الحجز</h1><p class="sub">تأكدي من الرابط، أو احجزي من جديد.</p><a class="primary" href="./" style="display:block;text-align:center;text-decoration:none">احجزي موعد</a></div>'; return; }
  const st = STAT[b.status] || [b.status, ''];
  const at = new Date(b.starts_at);
  const iso = at.toLocaleDateString('en-CA', { timeZone: RIYADH }), hm = at.toLocaleTimeString('en-GB', { timeZone: RIYADH, hour: '2-digit', minute: '2-digit' });
  $('#steps').style.visibility = 'hidden';
  main.innerHTML = `<div class="screen"><h1>حجزك يا ${esc(b.name)}</h1><p class="sub">رقم الحجز ${esc(b.code)} · <span class="status ${st[1]}">${st[0]}</span></p>` +
    `<div class="card">${(b.items || []).map((x) => `<div class="sumrow"><span>${esc(x.name)}${x.staff ? ` · مع ${esc(x.staff)}` : ''}</span><span class="num">${sar(x.price)}</span></div>`).join('')}` +
    `<div class="sumrow"><span>الموعد</span><span>${dayLabel(iso)} · ${tLabel(hm)}</span></div><div class="sumrow sumtot"><span>الإجمالي</span><span class="num">${sar(b.total)}</span></div></div>` +
    (b.can_confirm ? '<button class="primary" id="mConf">أأكد حضوري</button>' : '') +
    `<a class="waBtn" href="https://wa.me/${esc(b.whatsapp)}?text=${encodeURIComponent('السلام عليكم، بخصوص حجزي ' + b.code)}" target="_blank" rel="noopener">تواصلي معنا على الواتساب</a>` +
    (b.can_cancel ? '<button class="danger" id="mCan">إلغاء الموعد</button>' : (['pending', 'confirmed'].includes(b.status) ? `<p class="note">الإلغاء من الرابط متاح قبل الموعد بـ${A(b.cancel_hours)} ساعات. بعدها تواصلي معنا.</p>` : '')) +
    '<div id="mErr"></div><a class="ghost" href="./" style="margin-top:14px;text-decoration:none">احجزي موعد جديد</a></div>';
  const err = (e) => { $('#mErr').innerHTML = `<p class="err">${esc(e.message)}</p>`; };
  $('#mConf')?.addEventListener('click', async () => { try { await rpc('sb_confirm', { p_token: tok }); manage(tok); } catch (e) { err(e); } });
  const can = $('#mCan');
  if (can) can.onclick = async () => {
    if (!can.dataset.sure) { can.dataset.sure = '1'; can.textContent = 'متأكدة؟ اضغطي مرة ثانية للإلغاء'; return; }
    try { await rpc('sb_cancel', { p_token: tok }); manage(tok); } catch (e) { err(e); }
  };
}

/* ---------- الرسم والربط ---------- */
function render() {
  steps();
  main.innerHTML = [s0, s1, s2, s3][S.step]();
  bar(); bind();
  if (S.step === 1) { if (S.first === undefined) loadFirst(); loadSlots(); }
}
function bind() {
  main.querySelectorAll('[data-back]').forEach((b) => b.onclick = () => go(S.step - 1));
  if (S.step === 0) {
    const q = $('#q'); q.oninput = () => { S.q = q.value; $('#list').innerHTML = list(); bindList(); const p = main.querySelector('.pop'); if (p) p.style.display = S.q ? 'none' : ''; const l = main.querySelector('.lbl'); if (l) l.style.display = S.q ? 'none' : ''; };
    main.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { S.g = +b.dataset.g; render(); });
    const ag = $('#again');
    if (ag) ag.onclick = () => {
      const last = store.get(); S.sel = [];
      for (const it of last.items) { const s = svcById(it.service_id); if (!s) continue; const o = it.option_id ? (s.opts || []).find((x) => x.id === it.option_id) : null; if (it.option_id && !o) continue; toggle(s, o); }
      S.name = last.name || ''; S.phone = last.phone || '';
      if (S.sel.length) go(1);
    };
    bindList();
  }
  if (S.step === 1) {
    main.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => { S.staff = +b.dataset.st; S.slot = null; S.first = undefined; render(); });
    main.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { S.day = b.dataset.d; S.dayPicked = true; S.slot = null; main.querySelectorAll('.day').forEach((x) => x.classList.toggle('on', x === b)); bar(); loadSlots(); });
    const so = $('#soon'); if (so) so.onclick = () => { S.day = S.first.day; S.slot = { day: S.first.day, time: S.first.time }; go(2); };
  }
  if (S.step === 2) {
    const nm = $('#nm'), ph = $('#ph'), nt = $('#nt');
    nm.oninput = () => { S.name = nm.value; bar(); };
    nt.oninput = () => { S.notes = nt.value; };
    ph.oninput = () => { const d = ph.value.replace(/[٠-٩]/g, (x) => '٠١٢٣٤٥٦٧٨٩'.indexOf(x)).replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '').slice(0, 9); ph.value = fmtPhone(d); S.phone = d; bar(); };
  }
  if (S.step === 3) $('#again2').onclick = () => { S.sel = []; S.slot = null; S.res = null; S.first = undefined; S.dayPicked = false; S.day = null; go(0); };
}
function bindList() {
  main.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
    const s = svcById(+b.dataset.s);
    if (s.opts && s.opts.length && !isSel(s.id)) return sheet(s);
    toggle(s);
    const sel = isSel(s.id);
    main.querySelectorAll(`[data-s="${s.id}"]`).forEach((x) => { x.classList.toggle('sel', sel); const a = x.querySelector('.add'); if (a) a.textContent = sel ? '✓' : '+'; });
  });
}
$('#barGo').onclick = () => { if (S.step === 0) { S.first = undefined; S.dayPicked = false; S.day = null; go(1); } else if (S.step === 1 && S.slot) go(2); else if (S.step === 2) submit(); };
$('#veil').onclick = close;

(async () => {
  const P = new URLSearchParams(location.search);
  if (P.get('t')) return manage(P.get('t'));
  main.innerHTML = '<div class="loading"><span class="spin"></span>نجهّز الخدمات…</div>';
  try { C = await rpc('sb_catalog', {}); C.services.forEach((s) => { s.price = +s.price; (s.opts || []).forEach((o) => o.price = +o.price); }); }
  catch { main.innerHTML = '<div class="screen"><h1>صار خطأ بسيط</h1><p class="sub">تأكدي من الإنترنت وحدّثي الصفحة.</p><button class="primary" onclick="location.reload()">حدّثي</button></div>'; return; }
  if (!C.settings.accepting) { main.innerHTML = `<div class="screen"><h1>الحجز متوقف مؤقتًا</h1><p class="sub">تواصلي معنا على الواتساب ونرتّب موعدك.</p><a class="waBtn" href="https://wa.me/${esc(C.settings.whatsapp)}" target="_blank" rel="noopener">واتساب الصالون</a></div>`; return; }
  if (P.get('gift')) { try { const g = await rpc('gift_open', { p_token: P.get('gift') }); if (g && g.status === 'active') { S.gift = { token: P.get('gift'), to: g.to, code: g.code, balance: +g.balance }; S.name = g.to || ''; S.phone = String(g.phone || '').replace(/^0/, ''); } } catch {} }
  if (P.get('pro') && C.settings.rekaz && /^[0-9a-f-]{36}$/i.test(P.get('pro'))) S.pro = { id: P.get('pro'), name: String(P.get('pn') || '').slice(0, 40) };
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'pro-x') { S.pro = null; S.first = null; S.dayPicked = false; render(); } });
  const pre = +P.get('s'); if (pre) { const s = svcById(pre); if (s && !(s.opts && s.opts.length)) toggle(s); }
  render();
})();
})();
