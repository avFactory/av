// الظهور في محركات البحث: صفحة تعريفية عامة تُبنى في الخادم (بدون جافاسكربت) للزوار ومحركات البحث،
// وملفا robots.txt و sitemap.xml، ومنع فهرسة صفحات النظام الداخلية والروابط السرية.
import { pool } from '../db.js';

const SITE = () => (process.env.SITE_URL || 'https://avfactory.sa').replace(/\/+$/, '');
/** الصفحات المسموح فهرستها فقط */
export const INDEXABLE = new Set(['/', '/login', '/register']);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TITLE = 'مصنع AV للمجوهرات | مصنع ذهب ومجوهرات بالجملة وألماس – AV Factory';
const DESC = 'مصنع AV للمجوهرات (اي في للمجوهرات – AV Factory): مصنع ذهب سعودي لتصنيع المجوهرات وبيع الذهب بالجملة للمحلات، '
  + 'مشغولات ذهب عيار 18 و21، ألماس مخبري، لؤلؤ وأحجار، سبائك وجنيهات ذهب، وتصاميم خاصة حسب الطلب.';
const KEYWORDS = 'ذهب جملة, ذهب بالجملة, الماس, ألماس مخبري, مصنع ذهب, مصنع مجوهرات, مجوهرات, اي في, مصنع اي في, اي في للمجوهرات, '
  + 'مصنع AV, AV للمجوهرات, AV Factory, AV Jewelry, gold wholesale, jewelry factory, سبائك ذهب, جنيهات ذهب';

export function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /$',
    'Allow: /login',
    'Allow: /register',
    'Allow: /logo-gold.png',
    'Allow: /login-bg.webp',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /sup',
    'Disallow: /orders',
    'Disallow: /store',
    'Disallow: /print',
    'Disallow: /i/',
    'Disallow: /t/',
    'Disallow: /p/',
    'Disallow: /s/',
    '',
    `Sitemap: ${SITE()}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml() {
  const day = new Date().toISOString().slice(0, 10);
  const urls = [['/', '1.0', 'weekly'], ['/register', '0.6', 'monthly'], ['/login', '0.4', 'monthly']];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p, f]) => `  <url><loc>${SITE()}${u}</loc><lastmod>${day}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')}
</urlset>
`;
}

async function company() {
  try {
    const r = await pool.query("select value from settings where key='company'");
    return r.rows[0]?.value || {};
  } catch { return {}; }
}

export async function landingHtml() {
  const c = await company();
  const site = SITE();
  const name = c.name || 'مصنع AV للمجوهرات';
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['Organization', 'JewelryStore'],
        '@id': `${site}/#org`,
        name,
        alternateName: ['AV Factory', 'AV Jewelry', 'مصنع اي في', 'اي في للمجوهرات', 'مصنع AV', 'مصنع اي في للمجوهرات'],
        url: `${site}/`,
        logo: `${site}/logo-gold.png`,
        image: `${site}/logo-gold.png`,
        description: DESC,
        ...(c.phone ? { telephone: c.phone } : {}),
        ...(c.email ? { email: c.email } : {}),
        ...(c.vat_number ? { vatID: c.vat_number } : {}),
        address: { '@type': 'PostalAddress', addressCountry: 'SA', ...(c.city ? { addressLocality: c.city } : {}), ...(c.address ? { streetAddress: c.address } : {}) },
        areaServed: { '@type': 'Country', name: 'Saudi Arabia' },
        knowsAbout: ['ذهب جملة', 'مصنع ذهب', 'مجوهرات', 'ألماس مخبري', 'سبائك ذهب', 'جنيهات ذهب'],
        makesOffer: ['مشغولات ذهب بالجملة', 'مجوهرات ألماس مخبري', 'سبائك وجنيهات ذهب', 'تصنيع حسب الطلب'].map((n) => ({ '@type': 'Offer', itemOffered: { '@type': 'Product', name: n } })),
      },
      { '@type': 'WebSite', '@id': `${site}/#site`, url: `${site}/`, name, alternateName: 'AV Factory', inLanguage: 'ar', publisher: { '@id': `${site}/#org` } },
    ],
  };
  const verify = process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}" />\n` : '';
  const contact = [c.phone && `<a href="tel:${esc(c.phone)}" dir="ltr">${esc(c.phone)}</a>`, c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, [c.city, c.address].filter(Boolean).map(esc).join(' – ')].filter(Boolean);
  const card = (icon, h, p) => `<article class="card"><div class="ic">${icon}</div><h3>${h}</h3><p>${p}</p></article>`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESC)}" />
<meta name="keywords" content="${esc(KEYWORDS)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
${verify}<link rel="canonical" href="${site}/" />
<link rel="alternate" hreflang="ar" href="${site}/" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ar_SA" />
<meta property="og:site_name" content="${esc(name)}" />
<meta property="og:title" content="${esc(TITLE)}" />
<meta property="og:description" content="${esc(DESC)}" />
<meta property="og:url" content="${site}/" />
<meta property="og:image" content="${site}/logo-gold.png" />
<meta name="twitter:card" content="summary" />
<meta name="theme-color" content="#111111" />
<link rel="icon" type="image/png" href="/favicon.png?v=2" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" />
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;background:#0f0f0f;color:#eee;line-height:1.8}
a{color:#d4af37}.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
header.hero{background:#111 url(/login-bg.webp) center/cover;position:relative}header.hero:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.85))}
.hero .wrap{position:relative;padding:28px 16px 64px;text-align:center}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:40px}
.top img{height:56px}.top nav{display:flex;gap:18px;flex-wrap:wrap}.top nav a{text-decoration:none}
h1{font-size:clamp(26px,5vw,44px);margin:0 0 8px;color:#f3d77a}.sub{font-size:clamp(16px,2.6vw,20px);color:#ddd;margin:0 auto 26px;max-width:760px}
.btn{display:inline-block;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:700;margin:6px}.btn.p{background:#d4af37;color:#111}.btn.s{border:1px solid #d4af37}
section{padding:44px 0}h2{color:#f3d77a;font-size:26px;margin:0 0 18px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.card{background:#181818;border:1px solid #2a2a2a;border-radius:14px;padding:20px}.card h3{margin:6px 0;color:#f3d77a;font-size:19px}.card p{margin:0;color:#ccc}.ic{font-size:30px}
.about p{max-width:860px;margin:0 auto 12px;color:#ccc;text-align:center}
footer{border-top:1px solid #2a2a2a;padding:24px 0;color:#999;text-align:center;font-size:14px}footer .c a{margin:0 8px}
</style>
</head>
<body>
<header class="hero"><div class="wrap">
  <div class="top"><img src="/logo-gold.png" alt="شعار ${esc(name)} – AV Factory" width="56" height="56" /><nav><a href="/login">تسجيل الدخول</a><a href="/register">فتح حساب محل</a></nav></div>
  <h1>${esc(name)} – مصنع ذهب ومجوهرات بالجملة</h1>
  <p class="sub">مصنع اي في للمجوهرات (AV Factory): تصنيع المجوهرات وبيع <strong>الذهب بالجملة</strong> لمحلات الذهب، مشغولات عيار 18 و21، <strong>ألماس مخبري</strong>، سبائك وجنيهات، وتصاميم خاصة حسب طلبك.</p>
  <a class="btn p" href="/register">سجّل محلك وتصفح المنتجات</a><a class="btn s" href="/login">دخول العملاء</a>
</div></header>
<main>
<section><div class="wrap">
  <h2>منتجات وخدمات مصنع AV</h2>
  <div class="grid">
    ${card('◯', 'ذهب جملة', 'مشغولات ذهب بالجملة لمحلات المجوهرات: خواتم، أطقم، عقود، أساور وتعاليق بعيار 18 و21 بأجور مصنعية منافسة.')}
    ${card('💎', 'ألماس مخبري', 'مجوهرات ألماس مخبري (Lab Grown Diamond) بقصّات وأحجام متعددة مع تفاصيل الأحجار لكل قطعة.')}
    ${card('🪙', 'سبائك وجنيهات ذهب', 'تصنيع سبائك ذهب وجنيهات بالأوزان المطلوبة للقطعة الواحدة، وتعاليق الجنيهات.')}
    ${card('⚪', 'لؤلؤ وأحجار', 'مجوهرات مرصعة باللؤلؤ والأحجار الكريمة والزركون بتشطيب عالي الجودة.')}
    ${card('✎', 'تصاميم خاصة حسب الطلب', 'ارفع صورة أو ملف PDF لتصميمك، ونصنعه لك في المصنع مع متابعة مراحل التصنيع ومدة التنفيذ.')}
    ${card('🏭', 'مصنع ذهب سعودي', 'خطوط إنتاج متكاملة: صب، تشبيك، تركيب، تفنيش وتلميع، مع رقابة دقيقة على الأوزان والجودة.')}
  </div>
</div></section>
<section class="about"><div class="wrap">
  <h2>لماذا مصنع اي في للمجوهرات؟</h2>
  <p>${esc(name)} (AV Factory / AV Jewelry) مصنع ذهب ومجوهرات يخدم محلات الذهب والمجوهرات في المملكة العربية السعودية بنظام الجملة.</p>
  <p>متجر إلكتروني خاص بالمحلات لطلب المنتجات الجاهزة أو التصاميم الخاصة، ومتابعة الطلبات لحظياً، والفواتير وكشف الحساب بالذهب والريال.</p>
  <p style="margin-top:20px"><a class="btn p" href="/register">افتح حساب محلك الآن</a></p>
</div></section>
</main>
<footer><div class="wrap">
  ${contact.length ? `<div class="c">${contact.join(' · ')}</div>` : ''}
  <div>© ${new Date().getFullYear()} ${esc(name)} – AV Factory. مصنع ذهب، ذهب جملة، ألماس، مجوهرات.</div>
</div></footer>
</body>
</html>`;
}
