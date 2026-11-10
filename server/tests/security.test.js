// اختبارات الحماية: رفع الصلاحيات، المسارات المحمية، الترويسات، التخمين، الملفات
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/goldfactory-test-uploads';

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');

let server, base;
function client() {
  let cookie = '';
  return async (method, p, body, form, headers = {}) => {
    const h = { cookie, ...headers };
    if (!form && body) h['content-type'] = 'application/json';
    const r = await fetch(base + '/api' + p, { method, headers: h, body: form || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : await r.text() };
  };
}
const admin = client();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function user(username, role, perms = []) {
  if (perms.length) {
    await pool.query('insert into roles(code, name) values ($1,$1) on conflict do nothing', [role]);
    for (const p of perms) await pool.query('insert into role_permissions values ($1,$2) on conflict do nothing', [role, p]);
  }
  const id = (await pool.query('insert into users(username, password_hash, full_name, role_code, must_change_password) values ($1,$2,$1,$3,false) returning id', [username, hashPassword('Secure#2026x'), role])).rows[0].id;
  const c = client();
  assert.equal((await c('POST', '/auth/login', { username, password: 'Secure#2026x' })).status, 200);
  return { id, c };
}

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await admin('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' });
});
after(async () => { server?.close(); await pool.end(); });

test('منع رفع الصلاحيات: مسؤول الموظفين لا يصنع مديراً ولا يعدّل حساب المدير', async () => {
  const hr = await user('hr1', 'hr_test', ['employees.manage']);
  const adminId = (await pool.query("select id from users where username='admin'")).rows[0].id;
  assert.equal((await hr.c('POST', '/admin/employees', { username: 'evil', password: 'Evil#2026xx', full_name: 'x', role_code: 'admin' })).status, 403, 'لا يعيّن دور مدير النظام');
  assert.equal((await hr.c('POST', '/admin/employees', { username: 'pm1', password: 'Evil#2026xx', full_name: 'x', role_code: 'production_manager' })).status, 403, 'لا يعيّن دوراً بصلاحيات أعلى');
  assert.equal((await hr.c('PUT', `/admin/employees/${adminId}`, { password: 'Hacked#2026x' })).status, 403, 'لا يغيّر كلمة مرور المدير');
  assert.equal((await hr.c('PUT', `/admin/employees/${hr.id}`, { extra_perms: ['roles.manage'] })).status, 403, 'لا يمنح نفسه صلاحيات');
  const w = (await hr.c('POST', '/admin/employees', { username: 'wk_ok', password: 'Worker#2026x', full_name: 'عامل', role_code: 'worker' }));
  // دور العامل فيه صلاحيات (worker.self…) غير موجودة لدى مسؤول الموظفين → مرفوض حتى تُعطى له
  assert.equal(w.status, 403);
  await pool.query("insert into role_permissions select 'hr_test', perm_code from role_permissions where role_code='worker' on conflict do nothing");
  const w2 = await hr.c('POST', '/admin/employees', { username: 'wk_ok2', password: 'Worker#2026x', full_name: 'عامل', role_code: 'worker' });
  assert.equal(w2.status, 200, JSON.stringify(w2.data));
  // المدير (إدارة الأدوار) يستطيع كل شيء
  assert.equal((await admin('POST', '/admin/employees', { username: 'pm2', password: 'Pm#2026xxxx', full_name: 'م', role_code: 'production_manager' })).status, 200);
});

test('المسارات الداخلية لا تُفتح للزوار أو العملاء', async () => {
  const guest = client();
  for (const p of ['/admin/stages', '/admin/routes', '/admin/departments', '/admin/employees', '/orders', '/stones', '/finance/invoices']) {
    assert.ok([401, 403].includes((await guest('GET', p)).status), `الزائر: ${p}`);
  }
  const cu = await user('cust_x', 'customer');
  for (const p of ['/admin/stages', '/admin/routes', '/admin/departments']) assert.equal((await cu.c('GET', p)).status, 403, `العميل: ${p}`);
});

test('ترويسات الحماية وسياسة المحتوى', async () => {
  const r = await admin('GET', '/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(r.headers.get('permissions-policy'));
});

test('حماية CSRF: طلب من موقع آخر يُرفض، ومصدر غير صالح لا يسبب خطأ خادم', async () => {
  assert.equal((await admin('POST', '/notifications/read', {}, null, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await admin('POST', '/notifications/read', {}, null, { origin: 'null' })).status, 403);
  assert.equal((await admin('POST', '/notifications/read', {}, null, { referer: 'https://evil.example/x' })).status, 403);
  assert.equal((await admin('POST', '/notifications/read', {})).status, 200);
});

test('التخمين: المحاولات الفاشلة فقط تُحسب، وتُسجل في سجل التدقيق', async () => {
  await user('victim', 'worker');
  const g = client();
  for (let i = 0; i < 10; i++) assert.equal((await g('POST', '/auth/login', { username: 'victim', password: 'wrong' + i })).status, 400);
  assert.equal((await g('POST', '/auth/login', { username: 'victim', password: 'Secure#2026x' })).status, 429, 'مقفل بعد 10 محاولات خاطئة');
  const n = (await pool.query("select count(*)::int n from audit_log where action='login.failed'")).rows[0].n;
  assert.ok(n >= 10);
  // الدخول الصحيح المتكرر لا يقفل
  const ok = client();
  for (let i = 0; i < 15; i++) assert.equal((await ok('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' })).status, 200);
});

test('كلمة المرور الجديدة: حروف وأرقام ولا تحتوي اسم المستخدم', async () => {
  const u = await user('pwuser', 'worker');
  assert.equal((await u.c('POST', '/auth/change-password', { current: 'Secure#2026x', next: 'abcdefghij' })).status, 400);
  assert.equal((await u.c('POST', '/auth/change-password', { current: 'Secure#2026x', next: 'pwuser2026x' })).status, 400);
  assert.equal((await u.c('POST', '/auth/change-password', { current: 'Secure#2026x', next: 'Strong#2027y' })).status, 200);
});

test('الملفات: لا يُقبل HTML باسم صورة، وتُحذف ملفات الطلب الفاشل، وتُخدم بعزل', async () => {
  const dir = process.env.UPLOAD_DIR;
  const count = () => fs.readdirSync(dir, { recursive: true }).filter((f) => /[0-9a-f]{32}\./.test(path.basename(String(f)))).length;
  // HTML متنكر كصورة
  const f1 = new FormData();
  for (const [k, v] of Object.entries({ name: 'x', product_type: 'خاتم', karats: '21', colors: 'yellow' })) f1.append(k, v);
  f1.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.png');
  assert.equal((await admin('POST', '/catalog/products', null, f1)).status, 400);
  // طلب فاشل بعد رفع الملف: لا يبقى ملف يتيم
  const before = count();
  const f2 = new FormData();
  for (const [k, v] of Object.entries({ name: '', product_type: '', karats: '21' })) f2.append(k, v);
  f2.append('files', new Blob([PNG], { type: 'image/png' }), 'a.png');
  const r2 = await admin('POST', '/catalog/products', null, f2);
  assert.ok(r2.status >= 400);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(count(), before, 'حُذف الملف المرفوع للطلب الفاشل');
  // ملف صالح يُخدم مع sandbox
  const f3 = new FormData();
  for (const [k, v] of Object.entries({ name: 'منتج', product_type: 'خاتم', karats: '21', colors: 'yellow' })) f3.append(k, v);
  f3.append('files', new Blob([PNG], { type: 'image/png' }), 'ok.png');
  const p = (await admin('POST', '/catalog/products', null, f3)).data;
  const m = (await pool.query('select path from product_media where product_id=$1', [p.id])).rows[0].path;
  const fr = await admin('GET', `/files/${m}`);
  assert.equal(fr.status, 200);
  assert.match(fr.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await client()('GET', `/files/${m}`)).status, 401, 'الزائر لا يرى الملفات');
  assert.ok([403, 404].includes((await admin('GET', '/files/..%2f..%2fetc%2fpasswd')).status), 'منع الخروج من مجلد الملفات');
});

test('أداء المتجر: صفحات، أجور صحيحة لكل منتج، وصور مصغّرة WebP', async () => {
  const sharp = (await import('sharp')).default;
  const big = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#c9a' } }).jpeg({ quality: 90 }).toBuffer();
  const ids = [];
  for (let i = 0; i < 60; i++) {
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: `أداء ${i}`, product_type: i % 2 ? 'خاتم' : 'عقد', karats: '21', colors: 'yellow', approx_weight: '2', labor_method: 'per_gram', labor_rate: String(10 + (i % 3)) })) f.append(k, v);
    if (i === 0) f.append('files', new Blob([big], { type: 'image/jpeg' }), 'big.jpg');
    ids.push((await admin('POST', '/catalog/products', null, f)).data.id);
  }
  // قاعدة أجرة خاصة لنوع "خاتم" تتقدم على أجرة المنتج؟ لا: أجرة المنتج (20) أعلى من النوع (10)
  await pool.query("insert into labor_rates(name, scope, product_type, method, rate, active) values ('نوع خاتم','product','خاتم','per_gram',99,true)");
  await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('محل الأداء','م','0500000999','approved')");
  const cid = (await pool.query("select id from customers where shop_name='محل الأداء'")).rows[0].id;
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('perfshop',$1,'م','customer',$2,false)", [hashPassword('Perf#2026shop'), cid]);
  const c = client();
  assert.equal((await c('POST', '/auth/login', { username: 'perfshop', password: 'Perf#2026shop' })).status, 200);
  const p1 = (await c('GET', '/store/products?limit=48')).data;
  assert.equal(p1.products.length, 48);
  assert.ok(p1.has_more && p1.total >= 60);
  const p2 = (await c('GET', '/store/products?limit=48&offset=48')).data;
  assert.ok(p2.products.length >= 12);
  assert.equal(new Set([...p1.products, ...p2.products].map((p) => p.id)).size, p1.products.length + p2.products.length, 'بدون تكرار بين الصفحات');
  // الأجرة في القائمة = نفس حساب صفحة المنتج
  for (const p of [...p1.products, ...p2.products].slice(0, 20)) {
    const d = (await c('GET', `/store/products/${p.id}`)).data;
    assert.deepEqual(p.labor ? [p.labor.method, Number(p.labor.rate)] : null, d.labor ? [d.labor.method, Number(d.labor.rate)] : null, `أجرة ${p.name}`);
  }
  // صورة مصغّرة
  const m = (await pool.query('select path from product_media where product_id=$1', [ids[0]])).rows[0].path;
  const full = await fetch(`${base}/api/files/${m}`, { headers: { cookie: '' } });
  assert.equal(full.status, 401);
  const r = await c('GET', `/files/${m}?w=400`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  assert.ok(r.data.length < big.length / 3, 'المصغّرة أخف بكثير من الأصل');
  assert.match(r.headers.get('cache-control'), /max-age=2592000/);
});

test('إظهار/إخفاء المنتج في المتجر من القائمة', async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: 'منتج الإظهار', product_type: 'خاتم', karats: '21', colors: 'yellow' })) f.append(k, v);
  const p = (await admin('POST', '/catalog/products', null, f)).data;
  assert.equal((await admin('POST', `/catalog/products/${p.id}/visibility`, { active: false })).data.active, false);
  assert.equal((await pool.query('select active from products where id=$1', [p.id])).rows[0].active, false);
  assert.equal((await admin('POST', `/catalog/products/${p.id}/visibility`, { active: true })).data.active, true);
  const cu = await user('vis_cust', 'customer');
  assert.equal((await cu.c('POST', `/catalog/products/${p.id}/visibility`, { active: false })).status, 403);
});

test('جدول الطلبات: للمشرف وبصلاحية خاصة، حسب موعد التسليم', async () => {
  const sup = await user('sched_sup', 'supervisor');
  const cu = await user('sched_cust', 'customer');
  const mat = (await pool.query("select id from materials where karat=21 and active limit 1")).rows[0].id;
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const o = (await admin('POST', '/orders', { title: 'طلب الجدول', product_type: 'خاتم', karat: 21, material_id: mat, due_date: today, start: false })).data;
  const r = await sup.c('GET', `/orders/schedule?from=${today}&to=${today}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.rows.some((x) => x.id === o.id && x.due === today));
  assert.equal((await cu.c('GET', `/orders/schedule?from=${today}&to=${today}`)).status, 403);
  assert.equal((await sup.c('GET', '/orders/schedule?from=2026-01-01&to=2028-01-01')).status, 400, 'فترة طويلة جداً');
  assert.equal((await sup.c('GET', '/orders/schedule')).status, 400);
});

test('مصفوفة الصلاحيات: كل مسارات الموظفين مغلقة على الزائر والعميل والعامل', async () => {
  const fs = await import('node:fs');
  const MOUNTS = { 'supervisor.js': '/sup', 'orders.js': '/orders', 'admin.js': '/admin', 'inventory.js': '/inventory', 'stones.js': '/stones', 'catalog.js': '/catalog',
    'finance.js': '/finance', 'reports.js': '/reports', 'casting.js': '/casting', 'findings.js': '/findings' };
  const routes = [];
  for (const [file, prefix] of Object.entries(MOUNTS)) {
    const src = fs.readFileSync(new URL(`../src/routes/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/^r\.(get|post|put|delete)\('([^']+)'/gm)) routes.push([m[1].toUpperCase(), prefix + m[2]]);
  }
  for (const m of fs.readFileSync(new URL('../src/routes/statements.js', import.meta.url), 'utf8').matchAll(/^staff\.(get|post|put|delete)\('([^']+)'/gm)) routes.push([m[1].toUpperCase(), '/finance' + m[2]]);
  assert.ok(routes.length > 150, `عدد المسارات ${routes.length}`);
  const guest = client();
  const cu = await user('mx_cust', 'customer');
  const wk = await user('mx_worker', 'worker');
  // مسموح للعامل بالمسح فقط (يتحقق الخادم بعدها أن الطلب مسند إليه)
  // /sup/batches: العامل يرى/يوقّع جلساته فقط (يتحقق الخادم من الملكية)، والأقسام أسماء فقط
  const workerOk = new Set(['GET /sup/lookup', 'GET /sup/batches/:id', 'POST /sup/batches/:id/sign', 'GET /admin/departments']);
  const leaks = [];
  for (const [method, path] of routes) {
    const p = path.replace(/:[a-z_]+/gi, '1').replace(/\{?\*[a-z]+\}?/gi, 'x');
    const g = await guest(method, p, method === 'GET' ? undefined : {});
    if (![401, 403].includes(g.status)) leaks.push(`زائر ${method} ${p} → ${g.status}`);
    const c = await cu.c(method, p, method === 'GET' ? undefined : {});
    if (c.status !== 403) leaks.push(`عميل ${method} ${p} → ${c.status}`);
    if (!workerOk.has(`${method} ${path}`)) {
      const w = await wk.c(method, p, method === 'GET' ? undefined : {});
      if (w.status !== 403) leaks.push(`عامل ${method} ${p} → ${w.status}`);
    }
  }
  assert.deepEqual(leaks, []);
});

test('عزل العملاء: عميل لا يرى طلبات أو ملفات أو فواتير أو كشف عميل آخر', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  const mkCust = async (name, u) => {
    const cid = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ($1,'م',$2,'approved') returning id", [name, `05${Math.floor(Math.random() * 1e8)}`])).rows[0].id;
    await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ($1,$2,'م','customer',$3,false)", [u, hashPassword('Secure#2026x'), cid]);
    const c = client(); await c('POST', '/auth/login', { username: u, password: 'Secure#2026x' });
    return { cid, c };
  };
  const A = await mkCust('محل أ', 'iso_a'), B = await mkCust('محل ب', 'iso_b');
  const ob = (await admin('POST', '/orders', { title: 'طلب ب', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat, customer_id: B.cid })).data;
  const fd = new FormData(); fd.append('files', new Blob([PNG], { type: 'image/png' }), 'b.png'); fd.append('kind', 'design'); fd.append('customer_visible', 'true');
  await admin('POST', `/orders/${ob.id}/files`, null, fd);
  await pool.query('update order_files set customer_visible=true where order_id=$1', [ob.id]);
  const file = (await pool.query('select path from order_files where order_id=$1', [ob.id])).rows[0].path;
  assert.equal((await B.c('GET', `/files/${file}`)).status, 200, 'صاحب الطلب يرى ملفه');
  assert.equal((await A.c('GET', `/files/${file}`)).status, 403, 'غيره لا يرى');
  assert.equal((await A.c('GET', `/store/orders/${ob.id}`)).status, 404);
  for (const [m, p] of [['POST', `/store/orders/${ob.id}/cancel`], ['POST', `/store/orders/${ob.id}/note`], ['POST', `/store/orders/${ob.id}/quote`], ['POST', `/store/orders/${ob.id}/design`]]) {
    assert.ok([403, 404].includes((await A.c(m, p, { note: 'x', accept: true, decision: 'approved' })).status), `${m} ${p}`);
  }
  assert.ok(!(await A.c('GET', '/store/orders')).data.some((x) => x.id === ob.id), 'لا يظهر في قائمته');
  const stA = (await A.c('GET', '/store/statement')).data;
  assert.equal(stA.customer?.id ?? A.cid, A.cid, 'كشف حسابه فقط');
  assert.equal((await A.c('GET', `/finance/customers/${B.cid}/statement`)).status, 403);
  // لا يستطيع تزوير رقم العميل أو الفرع في الطلب
  const r = await A.c('PUT', '/store/account', { customer_id: B.cid, shop_name: 'اختراق' });
  assert.notEqual((await pool.query('select shop_name from customers where id=$1', [B.cid])).rows[0].shop_name, 'اختراق');
  assert.ok(r.status < 500);
});
