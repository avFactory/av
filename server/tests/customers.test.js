// استيراد العملاء من Excel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
let server, base, cookie = '';
const call = async (method, path, body, form) => {
  const headers = { cookie };
  if (!form && body) headers['content-type'] = 'application/json';
  const r = await fetch(base + '/api' + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
};
before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' });
});
after(async () => { server?.close(); await pool.end(); });

test('استيراد العملاء: أعمدة بأي ترتيب، تجاوز الموجود، أخطاء واضحة، حساب متجر اختياري', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('C');
  ws.addRow(['قائمة عملاء المصنع']);
  ws.addRow(['الرقم الضريبي', 'جوال المحل', 'اسم المحل', 'اسم المالك', 'المدينة', 'الفئة', 'اسم المستخدم', 'كلمة المرور']);
  ws.addRow(['300000000000003', '0501111111', 'مجوهرات الماسة', 'خالد', 'الرياض', 'VIP', 'almasa', 'Almasa#2026']);
  ws.addRow([null, '0552222222', 'ذهب النخبة', 'سعد', 'جدة', 'فضي', null, null]);
  ws.addRow(['123', '0553333333', 'محل خطأ', null, null, null, null, null]);
  ws.addRow([null, '+966 50 111 1111', 'نفس الجوال باسم آخر', null, null, null, null, null]);
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'customers.xlsx');
  const p = await call('POST', '/admin/customers/import/parse', null, fd);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(p.data.rows.map((r) => r.status), ['new', 'new', 'error', 'new']);
  assert.equal(p.data.rows[0].phone, '0501111111');
  assert.equal(p.data.rows[0].shop_name, 'مجوهرات الماسة');
  const ok = await call('POST', '/admin/customers/import/commit', { rows: p.data.rows.filter((r) => r.status !== 'error').slice(0, 2) });
  assert.deepEqual([ok.data.created, ok.data.logins], [2, 1]);
  // إعادة الرفع: الموجودون يُتجاوزون، وتكرار الجوال يُكتشف
  const p2 = await call('POST', '/admin/customers/import/parse', null, fd);
  assert.deepEqual(p2.data.rows.map((r) => r.status), ['error', 'exists', 'error', 'exists'], 'اسم المستخدم مستخدم + موجود + خطأ + نفس الجوال');
  const list = (await call('GET', '/admin/customers')).data;
  const m = list.find((c) => c.shop_name === 'مجوهرات الماسة');
  assert.equal(m.status, 'approved');
  assert.equal(m.tier_name, 'VIP');
  assert.equal(list.find((c) => c.shop_name === 'ذهب النخبة').tier_name, 'عميل فضي', 'فضي ← عميل فضي');
  // دخول المتجر بالحساب المستورد مع إلزام تغيير كلمة المرور
  const lg = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'almasa', password: 'Almasa#2026' }) });
  assert.equal(lg.status, 200);
  const x = await call('GET', '/admin/customers.xlsx');
  assert.equal(x.status, 200);
  assert.ok(x.data.byteLength > 1000);
});

test('تصنيفات العملاء: ذهبي وفضي وعادي، والعادي افتراضي للعملاء الجدد', async () => {
  const tiers = (await call('GET', '/admin/tiers')).data;
  assert.deepEqual(tiers.slice(0, 3).map((t) => [t.name, t.color]), [['عميل ذهبي', 'gold'], ['عميل فضي', 'silver'], ['عميل عادي', 'normal']]);
  const reg = await fetch(base + '/api/auth/register-customer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'newshop', password: 'Newshop#2026', shop_name: 'محل جديد', owner_name: 'م', phone: '0599999999' }) });
  assert.equal(reg.status, 200);
  const list = (await call('GET', '/admin/customers')).data;
  const c = list.find((x) => x.shop_name === 'محل جديد');
  assert.equal(c.tier_name, 'عميل عادي');
  const gold = tiers.find((t) => t.color === 'gold');
  await call('PUT', `/admin/customers/${c.id}`, { tier_id: gold.id });
  assert.equal((await call('GET', `/admin/customers/${c.id}`)).data.customer.tier_name, 'عميل ذهبي');
  // أجرة خاصة للتصنيف الذهبي تنطبق على عملائه
  await call('POST', '/catalog/labor-rates', { name: 'افتراضي', scope: 'default', method: 'per_gram', rate: '15' });
  await call('POST', '/catalog/labor-rates', { name: 'أجرة الذهبي', scope: 'tier', tier_id: gold.id, method: 'per_gram', rate: '11' });
  const o = (await call('POST', '/orders', { title: 'خاتم', product_type: 'خاتم', karat: 21, color: 'yellow', customer_id: c.id })).data;
  assert.equal(Number((await call('GET', `/orders/${o.id}`)).data.order.labor_rate), 11);
});
