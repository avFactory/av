// اختبار الواجهة: تقسيم طلب على عدة عمال + قبول/رفض العامل من الجوال. يتطلب خادماً مع npm run seed:demo
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = __dirname + '/shots/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const problems = [];
async function newPage(browser, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[5xx] ${r.url()}`); });
  return page;
}
async function login(page, u, p) { await page.goto(BASE + '/login'); await page.fill('input[autocomplete=username]', u); await page.fill('input[type=password]', p); await page.click('button[type=submit]'); await page.waitForLoadState('networkidle'); }
(async () => {
  const browser = await chromium.launch();
  const s = await newPage(browser, { width: 1280, height: 900 });
  await login(s, 'demo_sup', 'Demo#2026');
  await s.goto(BASE + '/sup/issue'); await s.click('button[role=tab]:has-text("تقسيم طلب")');
  await s.locator('.pick').first().click(); await s.waitForSelector('text=العامل 1');
  const sel = s.locator('.line-item select');
  await sel.nth(0).selectOption({ label: 'عامل تجريبي 7 (W-007)' });
  await sel.nth(1).selectOption({ label: 'عامل تجريبي 8 (W-008)' });
  const w = s.locator('.line-item input.weight');
  await w.nth(0).fill('6'); await w.nth(1).fill('4');
  const pcs = s.locator('.line-item input[inputmode=numeric]');
  await pcs.nth(0).fill('1'); await pcs.nth(1).fill('1');
  await s.screenshot({ path: SHOTS + 'split.png', fullPage: true });
  await s.click('button:has-text("تأكيد التقسيم والتسليم")');
  await s.waitForSelector('text=على 2 عمال');
  await s.screenshot({ path: SHOTS + 'split_done.png', fullPage: true });
  // العامل 7 يقبل، العامل 8 يرفض
  const w7 = await newPage(browser, { width: 390, height: 844 });
  await login(w7, 'demo_w7', 'Demo#2026');
  await w7.locator('a.task:has-text("بانتظار قبولك")').first().click();
  await w7.screenshot({ path: SHOTS + 'accept.png', fullPage: true });
  await w7.click('button:has-text("قبول الاستلام")'); await w7.waitForSelector('button:has-text("بدء العمل")');
  const w8 = await newPage(browser, { width: 390, height: 844 });
  await login(w8, 'demo_w8', 'Demo#2026');
  await w8.locator('a.task:has-text("بانتظار قبولك")').first().click();
  await w8.click('button:has-text("رفض")'); await w8.fill('.modal input', 'الوزن غير مطابق'); await w8.click('button:has-text("إرسال الرفض")');
  await w8.waitForSelector('text=رفضتَ هذا التسليم');
  await s.goto(BASE + '/sup'); await s.waitForSelector('text=رفضه العمال');
  await s.screenshot({ path: SHOTS + 'sup_rejected.png' });
  await browser.close();
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
})().catch((e) => { console.error('FAILED', e.message); console.log(problems.join('\n')); process.exit(1); });
