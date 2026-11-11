// اختبار استيراد العمال من Excel وإلزام تغيير كلمة المرور عند أول دخول
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/goldfactory-test-uploads';

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');

let server, base;
function client() {
  let cookie = '';
  return async (method, path, body, form) => {
    const headers = { cookie };
    if (!form && body) headers['content-type'] = 'application/json';
    const r = await fetch(base + '/api' + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
}
const admin = client();

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await admin('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' });
});
after(async () => { server?.close(); await pool.end(); });

async function sheet(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('W');
  ws.addRow(['رقم العامل', 'اسم العامل', 'اسم المستخدم', 'كلمة المرور', 'مهمة']);
  rows.forEach((r) => ws.addRow(r));
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'workers.xlsx');
  return fd;
}

test('استيراد العمال: معاينة، إنشاء، ربط بالمرحلة، وتجاوز الموجودين', async () => {
  const fd = await sheet([[102, 'صدام', 'SADAAM', '123123123', 'تشبيك'], [104, 'اشرف', 'ASHRAF', '123123123', 'تنفيش'], [116, 'نعيم', 'NAIM', '123123123', 'تركيب'], [120, 'خطأ', 'BAD USER', '123', 'تشبيك']]);
  const p = await admin('POST', '/admin/employees/import/parse', null, fd);
  assert.equal(p.status, 200);
  assert.equal(p.data.rows.length, 4);
  assert.deepEqual(p.data.rows.map((r) => r.status), ['new', 'new', 'new', 'error']);
  const blocked = await admin('POST', '/admin/employees/import/commit', { rows: p.data.rows });
  assert.equal(blocked.status, 400, 'الصفوف الخاطئة تمنع الاعتماد');
  const ok = await admin('POST', '/admin/employees/import/commit', { rows: p.data.rows.slice(0, 3) });
  assert.equal(ok.data.created, 3);
  const again = await admin('POST', '/admin/employees/import/commit', { rows: p.data.rows.slice(0, 3) });
  assert.deepEqual([again.data.created, again.data.skipped.length], [0, 3]);
  const emps = (await admin('GET', '/admin/employees')).data;
  const sad = emps.find((e) => e.username === 'SADAAM');
  assert.equal(sad.employee_no, '102');
  assert.equal(sad.specialty, 'تشبيك');
  const stages = (await admin('GET', '/admin/stages')).data;
  assert.ok(stages.find((s) => s.name === 'التشبيك').worker_ids.includes(sad.id), 'ربط تشبيك بمرحلة التشبيك');
  assert.ok(stages.find((s) => s.name === 'تركيب الأحجار والألماس المخبري').worker_ids.includes(emps.find((e) => e.username === 'NAIM').id));
});

test('المكائن: تُعرف من الاسم، قسم المكائن، وربط البوليش بالتلميع، وتستلم عهدة', async () => {
  const fd = await sheet([[102, 'صدام', 'SADAAM', '123123123', 'تشبيك'], [200, 'ملكينة البوليش', 'Polishing', '123123123', null], [203, 'مكينة الليزر', 'Laser', '123123123', null]]);
  const p = await admin('POST', '/admin/employees/import/parse', null, fd);
  assert.deepEqual(p.data.rows.map((r) => [r.status, r.kind]), [['exists', 'person'], ['new', 'machine'], ['new', 'machine']]);
  const c = await admin('POST', '/admin/employees/import/commit', { rows: p.data.rows });
  assert.deepEqual([c.data.created, c.data.skipped], [2, ['SADAAM']]);
  const emps = (await admin('GET', '/admin/employees')).data;
  const pol = emps.find((e) => e.username === 'Polishing');
  assert.equal(pol.kind, 'machine');
  assert.equal(pol.department, 'المكائن');
  const stages = (await admin('GET', '/admin/stages')).data;
  assert.ok(stages.find((s) => s.name === 'التلميع').worker_ids.includes(pol.id));
  const list = (await admin('GET', '/sup/workers')).data;
  assert.equal(list.find((w) => w.id === pol.id).kind, 'machine');
});

test('إلزام تغيير كلمة المرور عند أول دخول', async () => {
  const w = client();
  const login = await w('POST', '/auth/login', { username: 'sadaam', password: '123123123' });
  assert.equal(login.status, 200, 'الدخول غير حساس لحالة الأحرف');
  assert.equal((await w('GET', '/auth/me')).data.must_change_password, true);
  assert.equal((await w('GET', '/w/tasks')).status, 403, 'لا يستخدم النظام قبل التغيير');
  assert.equal((await w('POST', '/auth/change-password', { current: '123123123', next: '123123123' })).status, 400);
  assert.equal((await w('POST', '/auth/change-password', { current: '123123123', next: 'Factory#2026w' })).status, 200);
  assert.equal((await w('GET', '/w/tasks')).status, 200, 'الجلسة الحالية تبقى صالحة بعد التغيير');
  assert.equal((await w('GET', '/auth/me')).data.must_change_password, false);
});

test('إضافة عامل: اسم مستخدم بدون مسافات وبدون تكرار حالة الأحرف، أرقام عربية، مكينة، ونسبة عجز المهنة', async () => {
  const emp = { full_name: 'عامل جديد', password: 'Worker#2026', role_code: 'worker' };
  assert.equal((await admin('POST', '/admin/employees', { ...emp, username: 'ali ahmed' })).status, 400, 'مسافة');
  assert.equal((await admin('POST', '/admin/employees', { ...emp, username: 'a' })).status, 400, 'قصير');
  const a = await admin('POST', '/admin/employees', { ...emp, username: 'Ali.W', employee_no: '١٢٣', phone: '٠٥٥١٢٣٤٥٦٧', specialty: 'تشبيك ذهب' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal((await admin('POST', '/admin/employees', { ...emp, username: 'ali.w' })).status, 400, 'نفس الاسم بحالة أحرف مختلفة');
  assert.equal((await admin('POST', '/admin/employees', { ...emp, username: 'other1', employee_no: '123' })).status, 400, 'رقم وظيفي مكرر');
  const m = await admin('POST', '/admin/employees', { ...emp, username: 'laser1', full_name: 'ليزر', kind: 'machine' });
  assert.equal(m.status, 200);
  const list = (await admin('GET', '/admin/employees')).data;
  const ua = list.find((x) => x.id === a.data.id);
  assert.deepEqual([ua.employee_no, ua.phone, Number(ua.specialty_rate)], ['123', '0551234567', 0.1], 'أرقام إنجليزية ونسبة التشبيك');
  assert.equal(list.find((x) => x.id === m.data.id).kind, 'machine');
  assert.ok((await admin('GET', '/admin/specialties')).data.some((x) => x.specialty === 'تفنيش'));
  // الدخول باسم المستخدم بأي حالة أحرف
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ALI.w', password: 'Worker#2026' }) });
  assert.equal(r.status, 200);
});
