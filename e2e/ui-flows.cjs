// اختبار الواجهة عبر متصفح حقيقي (Playwright). يتطلب خادماً يعمل مع بيانات تجريبية: npm run seed:demo
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = __dirname + '/shots/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const problems = [];
async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|401/.test(m.text())) problems.push(`[console] ${page.url()} ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[5xx] ${r.status()} ${r.url()}`); });
  return page;
}
async function login(page, u, p) {
  await page.goto(BASE + '/login');
  await page.fill('input[autocomplete=username]', u);
  await page.fill('input[type=password]', p);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
}
async function sign(page) {
  const c = page.locator('canvas').last();
  await c.scrollIntoViewIfNeeded();
  const b = await c.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 40); await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 90, { steps: 8 }); await page.mouse.move(b.x + 200, b.y + 50, { steps: 8 }); await page.mouse.up();
}
(async () => {
  const browser = await chromium.launch();
  // 1) admin: visit all pages
  const a = await newPage(browser, { width: 1366, height: 900 });
  await login(a, 'admin', 'ChangeMe!2026');
  const routes = ['/sup', '/sup/issue', '/sup/receive', '/sup/workers', '/sup/review', '/sup/log', '/sup/scan', '/orders', '/orders/new', '/orders/1', '/admin', '/admin/employees', '/admin/roles', '/admin/customers', '/admin/customers/1',
    '/admin/stages', '/admin/inventory', '/admin/inventory?tab=counts', '/admin/inventory?tab=rec', '/admin/inventory?tab=items', '/admin/inventory?tab=products', '/admin/stones', '/admin/products', '/admin/labor',
    '/admin/invoices', '/admin/payments', '/admin/expenses', '/admin/reports', '/admin/audit', '/admin/settings', '/notifications', '/account', '/print/labels?ids=1,2,3'];
  for (const r of routes) {
    await a.goto(BASE + r); await a.waitForLoadState('networkidle'); await a.waitForTimeout(150);
    const err = await a.locator('.alert-bad').count();
    if (err) problems.push(`[alert] ${r}: ${await a.locator('.alert-bad').first().innerText()}`);
    if (['/sup', '/admin', '/orders/1', '/admin/stages', '/admin/inventory?tab=rec', '/sup/workers'].includes(r)) await a.screenshot({ path: SHOTS + 'admin' + r.replace(/[/?=]/g, '_') + '.png', fullPage: true });
  }
  // 2) supervisor issue flow via UI
  const s = await newPage(browser, { width: 1280, height: 900 });
  await login(s, 'demo_sup', 'Demo#2026');
  await s.screenshot({ path: SHOTS + 'sup_home.png', fullPage: true });
  await s.click('text=تسليم ذهب للعامل');
  await s.fill('input[type=search]', 'تجريبي 6');
  await s.click('.pick >> text=عامل تجريبي 6');
  await s.locator('.pick').first().click();
  await s.waitForSelector('.line-item');
  const w = s.locator('.line-item input.weight').first();
  if (!(await w.inputValue())) await w.fill('12.5');
  await sign(s);
  await s.screenshot({ path: SHOTS + 'sup_issue.png', fullPage: true });
  await s.click('button:has-text("تأكيد التسليم")');
  await s.waitForSelector('text=تم التسليم بنجاح', { timeout: 8000 });
  // 3) receive from worker 1 with abnormal loss
  await s.goto(BASE + '/sup/receive');
  await s.locator('.pick:not([disabled])').first().click();
  await s.waitForSelector('.line-item');
  await s.locator('.line-item input[type=checkbox]').first().check();
  await s.locator('.line-item input.weight').first().fill('12.4');
  await s.waitForTimeout(200);
  await s.screenshot({ path: SHOTS + 'sup_receive_calc.png', fullPage: true });
  const reason = s.locator('.line-item textarea');
  if (await reason.count()) await reason.first().fill('اختبار واجهة: تطاير');
  await sign(s);
  await s.click('button:has-text("تأكيد الاستلام")');
  await s.waitForSelector('text=تم الاستلام', { timeout: 8000 });
  await s.screenshot({ path: SHOTS + 'sup_receive_done.png', fullPage: true });
  await s.goto(BASE + '/sup/review'); await s.waitForLoadState('networkidle');
  await s.screenshot({ path: SHOTS + 'sup_review.png', fullPage: true });
  // supervisor mobile
  const sm = await newPage(browser, { width: 390, height: 844 });
  await login(sm, 'demo_sup', 'Demo#2026');
  await sm.screenshot({ path: SHOTS + 'sup_home_mobile.png', fullPage: true });
  // 4) worker mobile flow
  const wk = await newPage(browser, { width: 390, height: 844 });
  await login(wk, 'demo_w6', 'Demo#2026');
  await wk.screenshot({ path: SHOTS + 'worker_home.png', fullPage: true });
  await wk.locator('a.task:has-text("لم يبدأ"), a.task:has-text("بانتظار تأكيدك")').first().click();
  await wk.waitForLoadState('networkidle');
  if (await wk.locator('text=أؤكد الاستلام').count()) { await sign(wk); await wk.click('text=أؤكد الاستلام'); await wk.waitForTimeout(500); }
  await wk.click('button:has-text("بدء العمل")'); await wk.waitForTimeout(500);
  await wk.locator('input.weight').nth(0).fill('12.48'); await wk.locator('input.weight').nth(1).fill('0.01');
  await wk.click('button:has-text("حفظ الأوزان")'); await wk.waitForTimeout(400);
  wk.on('dialog', (d) => d.accept());
  await wk.click('button:has-text("إنهاء المرحلة وتسليمها")'); await wk.waitForTimeout(700);
  await wk.screenshot({ path: SHOTS + 'worker_custody.png', fullPage: true });
  // 5) store
  const st = await newPage(browser, { width: 1280, height: 900 });
  await login(st, 'demo_shop', 'Demo#2026');
  for (const r of ['/store', '/store/custom', '/store/orders', '/store/invoices', '/store/account', '/store/cart']) { await st.goto(BASE + r); await st.waitForLoadState('networkidle'); }
  await st.goto(BASE + '/store/orders'); await st.waitForLoadState('networkidle');
  if (await st.locator('.card').count()) { await st.locator('button.card').first().click(); await st.waitForLoadState('networkidle'); await st.screenshot({ path: SHOTS + 'store_track.png', fullPage: true }); }
  const sto = await newPage(browser, { width: 390, height: 844 });
  await login(sto, 'demo_shop', 'Demo#2026');
  await sto.screenshot({ path: SHOTS + 'store_mobile.png', fullPage: true });
  // horizontal overflow check on mobile
  for (const [pg, name] of [[sm, 'sup'], [wk, 'worker'], [sto, 'store']]) {
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (ov) problems.push(`[overflow] ${name} mobile has horizontal scroll at ${pg.url()}`);
  }
  await browser.close();
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
})().catch((e) => { console.error('FAILED', e.message); console.log(problems.join('\n')); process.exit(1); });
