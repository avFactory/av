// اختبار تصنيفات الألماس واستيراد المخزون من ملف Excel
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/goldfactory-test-uploads';

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { parseStoneName } = await import('../src/routes/stones.js');

let server, base, cookie = '';
async function call(method, path, body, form) {
  const headers = { cookie };
  if (!form && body) headers['content-type'] = 'application/json';
  const r = await fetch(base + '/api' + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const d = await r.json(); if (!r.ok) throw new Error(`${path}: ${d.error}`); return d;
}

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' });
});
after(async () => { server?.close(); await pool.end(); });

test('تفكيك أسماء الأصناف إلى تصنيف ومقاس', async () => {
  const shapes = (await pool.query('select * from stone_shapes')).rows;
  const t = (n) => { const p = parseStoneName(n, shapes); return [p.shape, p.size_label]; };
  assert.deepEqual(t('راوند 1.3 mm'), ['راوند', '1.3 mm']);
  assert.deepEqual(t('راوند 2.8 MM'), ['راوند', '2.8 mm']);
  assert.deepEqual(t('راوند0.15'), ['راوند', '0.15']);
  assert.deepEqual(t('اوفال0.25'), ['اوفال', '0.25']);
  assert.deepEqual(t('أوفال 3'), ['اوفال', '3']);
  assert.deepEqual(t('دمعة 2.5'), ['دمعة', '2.5']);
  assert.deepEqual(t('قلب 0.5'), ['قلب', '0.5']);
  assert.deepEqual(t('ماركيز 0.25'), ['ماركيز', '0.25']);
  assert.deepEqual(t('مربع 2'), ['مربع', '2']);
  assert.deepEqual(t('SI'), ['أخرى', 'SI']);
  assert.equal(parseStoneName('الالماس الطبيعي MM 2.5 واقل', shapes).stone_type, 'ألماس طبيعي');
});

test('استيراد ملف Excel: معاينة ثم اعتماد، وإعادة الاستيراد تسوّي الفرق فقط', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow([null, 'الالماس في المخزون غير مركب']);
  ws.addRow([null, 'اسم الالماس', 'المخزون الدقيق بالقيراط']);
  for (const [n, c] of [['راوند 1.1 mm', 0.07], ['راوند 1.5 mm', '-'], ['راوند 0.25', '2,048.89'], ['اوفال0.25', 18.34], ['دمعة 3', 139.5], ['قلب 0.5', 477.24], ['ماركيز 1', 1], ['SI', null]]) ws.addRow([null, n, c]);
  const buf = await wb.xlsx.writeBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'stock.xlsx');
  const { rows } = await call('POST', '/stones/import/parse', null, fd);
  assert.equal(rows.length, 8);
  assert.equal(rows.find((r) => r.name === 'راوند 0.25').carats, '2048.8900');
  assert.equal(rows.find((r) => r.name === 'راوند 1.5 mm').carats, '0');
  const { plan } = await call('POST', '/stones/import/preview', { rows });
  assert.ok(plan.every((p) => p.action === 'create'));
  const res = await call('POST', '/stones/import/commit', { rows });
  assert.equal(res.created, 8);
  const lots = await call('GET', '/stones');
  const r025 = lots.find((l) => l.shape_name === 'راوند' && l.size_label === '0.25');
  assert.equal(Number(r025.stock_carats), 2048.89);
  // ترتيب: مقاسات mm أولاً تصاعدياً
  const round = lots.filter((l) => l.shape_name === 'راوند').map((l) => l.size_label);
  assert.deepEqual(round, ['1.1 mm', '1.5 mm', '0.25']);
  // جرد لاحق: تعديل رصيد صنف واحد فقط
  rows.find((r) => r.name === 'راوند 0.25').carats = '2000';
  const plan2 = (await call('POST', '/stones/import/preview', { rows })).plan;
  assert.deepEqual(plan2.filter((p) => p.action !== 'none').map((p) => [p.name, p.diff]), [['راوند 0.25', -48.89]]);
  const res2 = await call('POST', '/stones/import/commit', { rows });
  assert.deepEqual([res2.created, res2.adjusted], [0, 1]);
  const after2 = (await call('GET', '/stones')).find((l) => l.id === r025.id);
  assert.equal(Number(after2.stock_carats), 2000);
  const shapes = await call('GET', '/stones/shapes');
  assert.equal(shapes.find((s) => s.name === 'راوند').items, 3);
});

test('استيراد الألماس مع عمود العدد: إنشاء بالعدد، وجرد العدد والقيراط في اتجاهين مختلفين، ونموذج الملف', async () => {
  const mkFile = async (rowsIn) => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.addRow(['الصنف', 'القيراط', 'العدد']);
    for (const r of rowsIn) ws.addRow(r);
    const fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'count.xlsx');
    return (await call('POST', '/stones/import/parse', null, fd)).rows;
  };
  const rows = await mkFile([['قلب 1.7 mm', 3.5, 120], ['قلب 1.9 mm', 1.25, '٤٥']]);
  assert.deepEqual(rows.map((r) => [r.name, r.carats, r.count]), [['قلب 1.7 mm', '3.5000', '120'], ['قلب 1.9 mm', '1.2500', '45']]);
  const { plan } = await call('POST', '/stones/import/preview', { rows });
  assert.deepEqual(plan.map((p) => [p.action, p.target_count]), [['create', 120], ['create', 45]]);
  await call('POST', '/stones/import/commit', { rows });
  const lot = async (size) => (await call('GET', '/stones')).find((l) => l.size_label === size && l.shape_name === 'قلب');
  const a = await lot('1.7 mm');
  assert.deepEqual([Number(a.stock_carats), a.stock_count], [3.5, 120]);
  // جرد: القيراط يزيد والعدد ينقص ← حركتان
  const rows2 = await mkFile([['قلب 1.7 mm', 3.6, 118], ['قلب 1.9 mm', 1.25, 45]]);
  const plan2 = (await call('POST', '/stones/import/preview', { rows: rows2 })).plan;
  assert.deepEqual(plan2.map((p) => [p.action, p.diff, p.count_diff]), [['adjust', 0.1, -2], ['none', 0, 0]]);
  const r2 = await call('POST', '/stones/import/commit', { rows: rows2 });
  assert.deepEqual([r2.created, r2.adjusted], [0, 1]);
  const a2 = await lot('1.7 mm');
  assert.deepEqual([Number(a2.stock_carats), a2.stock_count], [3.6, 118]);
  // ملف بدون عمود العدد: العدد لا يتغير
  const fd = new FormData();
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow(['الصنف', 'القيراط']); ws.addRow(['قلب 1.7 mm', 3.6]);
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'nocount.xlsx');
  const rows3 = (await call('POST', '/stones/import/parse', null, fd)).rows;
  assert.equal(rows3[0].count, undefined);
  const plan3 = (await call('POST', '/stones/import/preview', { rows: rows3 })).plan;
  assert.deepEqual([plan3[0].action, plan3[0].count_diff], ['none', 0]);
  // نموذج الملف
  const t = await fetch(`${base}/api/stones/import/template.xlsx`, { headers: { cookie } });
  assert.equal(t.status, 200);
  const tw = new ExcelJS.Workbook(); await tw.xlsx.load(Buffer.from(await t.arrayBuffer()));
  assert.deepEqual(tw.worksheets[0].getRow(1).values.slice(1), ['الصنف', 'القيراط', 'العدد']);
  // النموذج نفسه يُرفع كما هو بدون أسطر زائدة
  const fd2 = new FormData(); fd2.append('file', new Blob([Buffer.from(await tw.xlsx.writeBuffer())]), 'template.xlsx');
  const back = (await call('POST', '/stones/import/parse', null, fd2)).rows;
  assert.deepEqual(back.map((r) => [r.name, r.carats, r.count]), [['راوند 1.3 mm', '2.5000', '250'], ['اوفال 0.25', '1.7500', '7']]);
});
