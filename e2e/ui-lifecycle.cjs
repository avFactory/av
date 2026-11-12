// اختبار الواجهة عبر متصفح حقيقي (Playwright). يتطلب خادماً يعمل مع بيانات تجريبية: npm run seed:demo
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = __dirname + '/shots/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const problems = [];
let cookie = '';
async function api(method, path, body) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const d = await r.json(); if (!r.ok) throw new Error(path + ' ' + d.error); return d;
}
async function newPage(browser, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|401/.test(m.text())) problems.push(`[console] ${page.url()} ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[5xx] ${r.url()}`); });
  return page;
}
async function login(page, u, p) { await page.goto(BASE + '/login'); await page.fill('input[autocomplete=username]', u); await page.fill('input[type=password]', p); await page.click('button[type=submit]'); await page.waitForLoadState('networkidle'); }
(async () => {
  await api('POST', '/auth/login', { username: 'admin', password: 'ChangeMe!2026' });
  // الطلب 1 (للعميل التجريبي) لدى العامل 1 في مرحلة التجهيز: نستلمه ثم نمرره بكل المراحل عبر API
  const w = (await api('GET', '/sup/workers')).find((x) => x.full_name === 'عامل تجريبي 1');
  let open = await api('GET', `/sup/workers/${w.id}/open`);
  await api('POST', '/sup/receive', { worker_id: w.id, items: [{ custody_id: open[0].id, returned_weight: open[0].weight_issued, scrap_weight: '0' }] });
  for (let i = 0; i < 6; i++) {
    let d = await api('GET', '/orders/1');
    if (d.order.stage_name === 'المختبر لإصدار الشهادة') { await api('POST', '/orders/1/advance'); d = await api('GET', '/orders/1'); }
    if (!d.order.handles_gold || (d.order.stage_kind === 'final_weight' && d.custodies.some((c) => c.stage_id === d.order.current_stage_id && c.status === 'closed'))) break;
    const bal = d.gold.find((g) => g.loc_type === 'order').balance;
    const r = await api('POST', '/sup/issue', { worker_id: w.id, items: [{ order_id: 1, weight: bal }] });
    await api('POST', '/sup/receive', { worker_id: w.id, items: [{ custody_id: r.custodies[0].id, returned_weight: bal, scrap_weight: '0' }] });
  }
  const browser = await chromium.launch();
  const a = await newPage(browser, { width: 1366, height: 900 });
  await login(a, 'admin', 'ChangeMe!2026');
  await a.goto(BASE + '/orders/1'); await a.waitForLoadState('networkidle');
  await a.click('button:has-text("تسجيل الوزن النهائي")');
  await a.click('.modal button:has-text("حفظ")'); await a.waitForTimeout(600);
  await a.click('button:has-text("نقل للمرحلة التالية")'); await a.waitForTimeout(800);
  await a.click('text=إصدار فاتورة الأجور'); await a.waitForSelector('.modal');
  await a.waitForSelector('.inv-order.on'); await a.fill('.inv-order.on input[placeholder="مثال: 4000"]', '1150');
  await a.click('.modal button:has-text("معاينة")'); await a.waitForSelector('.modal table');
  await a.screenshot({ path: SHOTS + 'invoice_new.png', fullPage: true });
  await a.click('.modal button:has-text("إصدار الفاتورة")'); await a.waitForSelector('text=فاتورة ضريبية');
  await a.screenshot({ path: SHOTS + 'invoice_view.png', fullPage: true });
  await a.goto(BASE + '/orders/1'); await a.waitForLoadState('networkidle');
  await a.click('button:has-text("نقل للمرحلة التالية")'); await a.waitForTimeout(700);
  await a.click('button:has-text("نقل للمرحلة التالية")'); await a.waitForTimeout(700);
  await a.click('button:has-text("تسليم الطلب للعميل وإقفاله")');
  await a.fill('.modal input', 'استلمه المالك'); await a.click('.modal button:has-text("تأكيد التسليم")'); await a.waitForTimeout(800);
  const status = await a.locator('h1 .badge').innerText();
  if (status !== 'تم التسليم') problems.push('order not delivered: ' + status);
  await a.screenshot({ path: SHOTS + 'order_delivered.png', fullPage: true });
  await a.goto(BASE + '/admin/inventory?tab=rec'); await a.waitForLoadState('networkidle');
  if (!(await a.locator('text=الأرصدة متطابقة').count())) problems.push('reconciliation not ok');
  const c = await newPage(browser, { width: 390, height: 844 });
  await login(c, 'demo_shop', 'Demo#2026');
  await c.goto(BASE + '/store/orders/1'); await c.waitForSelector('text=نسبة الإنجاز');
  const txt = await c.locator('body').innerText();
  for (const bad of ['عامل تجريبي', 'العجز', 'عهدة']) if (txt.includes(bad)) problems.push('customer sees internal info: ' + bad);
  await c.screenshot({ path: SHOTS + 'store_track_mobile.png', fullPage: true });
  await c.goto(BASE + '/store/invoices'); await c.waitForLoadState('networkidle');
  await c.locator('.table tbody tr').first().click(); await c.waitForSelector('text=فاتورة ضريبية');
  const s = await newPage(browser, { width: 390, height: 844 });
  await login(s, 'demo_sup', 'Demo#2026');
  await s.screenshot({ path: SHOTS + 'sup_home_mobile2.png', fullPage: true });
  for (const [pg, n] of [[c, 'store'], [s, 'sup']]) if (await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) problems.push('overflow ' + n);
  await browser.close();
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
})().catch((e) => { console.error('FAILED', e.message); console.log(problems.join('\n')); process.exit(1); });
