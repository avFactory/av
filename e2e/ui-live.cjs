// اختبار التحديث الفوري لشاشة العامل: الوزن في «مهامي» يتحدث بدون إعادة تحميل الصفحة،
// أثناء الاتصال، وبعد انقطاع الاتصال وعودته (مثل جوال نام ثم استيقظ)
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let ck = '';
async function api(m, p, b) { const r = await fetch(BASE + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json', origin: BASE }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return r.json(); }
const weightOf = async (page) => Number((await page.locator('.wk-body .card').first().innerText()).replace(/[^\d.]/g, ''));
async function waitWeight(page, expected, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (Math.abs((await weightOf(page)) - expected) < 0.0005) return true; await page.waitForTimeout(250); }
  return false;
}
(async () => {
  const problems = [];
  await api('POST', '/auth/login', { username: 'admin', password: 'ChangeMe!2026' });
  const emps = await api('GET', '/admin/employees'); const w = emps.find((e) => e.username === 'demo_w9');
  const m21 = (await api('GET', '/inventory/gold')).materials.find((x) => x.karat === 21).id;
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // نتحكم في اتصال التحديثات الفورية داخل الصفحة لمحاكاة انقطاعه الحقيقي (الجوال نائم أو الشبكة ضعيفة)
  await ctx.addInitScript(() => {
    const Orig = window.EventSource; window.__es = [];
    window.EventSource = function ES(u, o) { const e = new Orig(u, o); window.__es.push(e); return e; };
    window.EventSource.prototype = Orig.prototype;
  });
  const page = await ctx.newPage();
  const cut = () => page.evaluate(() => window.__es[window.__es.length - 1].close());
  await page.goto(BASE + '/login'); await page.fill('input[autocomplete=username]', 'demo_w9'); await page.fill('input[type=password]', 'Demo#2026'); await page.click('button[type=submit]'); await page.waitForLoadState('networkidle');
  if (await page.locator('.lang-pick').count()) { await page.click('.lang-btn:has-text("العربية")'); await page.waitForLoadState('networkidle'); }
  await page.waitForTimeout(1000);
  const w0 = await weightOf(page);
  // 1) أثناء الاتصال: عهدة عامة جديدة تظهر خلال ثوانٍ
  await api('POST', '/inventory/gold/to-worker', { worker_id: w.id, material_id: m21, weight: '7', purpose: 'اختبار فوري', loss_rate_percent: '0' });
  if (!(await waitWeight(page, w0 + 7, 6000))) problems.push(`لم يتحدث الوزن فورياً: ${await weightOf(page)} بدل ${w0 + 7}`);
  // 2) انقطاع الاتصال (الجوال نائم) ثم تغيير ثم عودة الاتصال
  await cut();
  const gc = (await api('GET', `/sup/workers/${w.id}/open`)).find((c) => c.title === 'اختبار فوري');
  await api('PUT', `/sup/custodies/${gc.id}`, { gross_weight: '5', reason: 'اختبار' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const e = window.__es[window.__es.length - 1]; e.onerror && e.onerror(new Event('error')); });
  if (!(await waitWeight(page, w0 + 5, 12000))) problems.push(`لم يتحدث الوزن بعد عودة الاتصال: ${await weightOf(page)} بدل ${w0 + 5}`);
  // 3) العودة للتطبيق (الصفحة تصبح ظاهرة) تجلب أحدث البيانات
  await cut();
  await api('PUT', `/sup/custodies/${gc.id}`, { gross_weight: '4', reason: 'اختبار' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  if (!(await waitWeight(page, w0 + 4, 6000))) problems.push(`لم يتحدث الوزن عند العودة للتطبيق: ${await weightOf(page)} بدل ${w0 + 4}`);
  await browser.close();
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.log('FAILED', e.message); process.exit(1); });
