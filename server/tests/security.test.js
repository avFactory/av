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
