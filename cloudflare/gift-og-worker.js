// Cloudflare Worker — مسار: beautfresh.com/gift/open*
// يخلي معاينة رابط الهدية في واتساب تطلع باسم المُهدى لها ولون بطاقتها، بدون ما يفتح الهدية (ما تنحسب «انفتحت»).
// المفتاح هنا هو المفتاح العام (publishable) نفسه اللي في assets/config.js — مو سري.
const SB = 'https://enrlujtrysrlzwbjexey.supabase.co';
const KEY = 'sb_publishable_28HPaKcl04mJcGOx28vCWA_9_e14OOJ';
const OCC = { 'عيد ميلاد': '🎂', 'عيد': '✨', 'يوم الأم': '🤍', 'مبروك': '🎉', 'شكرًا': '🌿', 'بدون مناسبة': '🎁' };
const THEMES = ['oud', 'rose', 'gold', 'sand'];

class Meta {
  constructor(map) { this.map = map; }
  element(el) {
    const k = el.getAttribute('property') || el.getAttribute('name');
    if (k && this.map[k] != null) el.setAttribute('content', this.map[k]);
  }
}
class Title { constructor(t) { this.t = t; } element(el) { el.setInnerContent(this.t); } }

export default {
  async fetch(req) {
    const res = await fetch(req);
    const url = new URL(req.url);
    const t = url.searchParams.get('t') || '';
    if (!/^[0-9a-f-]{36}$/i.test(t) || !(res.headers.get('content-type') || '').includes('text/html')) return res;
    let g = null;
    try {
      const r = await fetch(`${SB}/rest/v1/rpc/gift_og`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY }, body: JSON.stringify({ p_token: t }), cf: { cacheTtl: 300 } });
      if (r.ok) g = await r.json();
    } catch (_) { /* نرجع الصفحة العادية */ }
    if (!g || !g.to) return res;
    const theme = THEMES.includes(g.theme) ? g.theme : 'oud';
    const title = `${g.to}، وصلتك هدية ${OCC[g.occasion] || '🎁'}`;
    const desc = `${g.from ? `هدية من ${g.from}:` : 'أحد يحبك أهداك'} بطاقة من بيوتفريش${g.occasion && g.occasion !== 'بدون مناسبة' ? ` بمناسبة ${g.occasion}` : ''}. افتحيها وشوفي وش فيها 🤍`;
    const img = `https://beautfresh.com/gift/og-${theme}.jpg`;
    const out = new HTMLRewriter()
      .on('title', new Title(title))
      .on('meta', new Meta({ 'og:title': title, 'og:description': desc, 'og:image': img, 'twitter:title': title, 'twitter:description': desc, 'twitter:image': img }))
      .transform(res);
    const h = new Headers(out.headers); h.set('Cache-Control', 'private, max-age=0');
    return new Response(out.body, { status: out.status, headers: h });
  },
};
