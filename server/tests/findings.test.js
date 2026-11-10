// خامات المصنع: إضافة رصيد، صرف للعامل كعهدة عامة، إضافتها على طلب عند الاستلام، وإرجاع غير المستخدم
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/goldfactory-test-uploads';

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');

let server, base, cookie = '';
const call = async (method, path, body) => {
  const r = await fetch(base + '/api' + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json() };
};
const n = (x) => Number(Number(x).toFixed(4));
const bal = async (type, ref, mat) => n((await pool.query('select coalesce(sum(balance),0) b from gold_balances where loc_type=$1 and loc_ref is not distinct from $2 and material_id=$3', [type, ref, mat])).rows[0].b);

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' });
});
after(async () => { server?.close(); await pool.end(); });

test('خامات المصنع: سلسال 1 جم يُضاف على طلب 5 جم ويُستلم 6 جم بدون عجز', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('fw1',$1,'عامل الخامات','worker','F1') returning id", [hashPassword('Fw#2026xx')])).rows[0].id;
  // خامة: سلسال عيار 21، 10 قطع بوزن 10 جم
  const f = (await call('POST', '/findings', { name: 'سلسال كارتير 45سم', category: 'سلسلة', material_id: mat, unit_weight: '1' })).data;
  assert.ok(f.id, JSON.stringify(f));
  assert.equal((await call('POST', `/findings/${f.id}/in`, { pieces: 10, weight: '10', note: 'شراء' })).status, 200);
  let list = (await call('GET', '/findings')).data.findings.find((x) => x.id === f.id);
  assert.deepEqual([n(list.stock_weight), list.stock_pieces], [10, 10]);
  // صرف 3 سلاسل (3 جم) للعامل كعهدة عامة
  const iss = await call('POST', '/findings/issue', { worker_id: w, items: [{ finding_id: f.id, pieces: 3, weight: '3' }] });
  assert.equal(iss.status, 200, JSON.stringify(iss.data));
  const fc = iss.data.custodies[0].custody_id;
  assert.equal(await bal('findings', f.id, mat), 7, 'نقصت الخامات');
  assert.equal(await bal('worker', w, mat), 3, 'أصبحت ذهباً لدى العامل');
  assert.equal((await call('POST', '/findings/issue', { worker_id: w, items: [{ finding_id: f.id, pieces: 1, weight: '50' }] })).status, 400, 'لا صرف أكثر من الرصيد');
  // طلب: بعد الصب 5 جم يُسلّم للعامل لإضافة سلسال
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '100', note: 'رصيد' });
  const o = (await call('POST', '/orders', { title: 'تعليقة مع سلسال', product_type: 'تعليقة', karat: 21, quantity: 1, material_id: mat })).data;
  let d = (await call('GET', `/orders/${o.id}`)).data;
  for (let i = 0; i < 6 && !d.order.handles_gold; i++) { await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'اختبار' }); d = (await call('GET', `/orders/${o.id}`)).data; }
  await call('POST', `/admin/stages/${d.order.current_stage_id}/rate`, { rate_percent: '0', note: 'x' });
  const ic = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o.id, weight: '5' }] })).data.custodies[0].id;
  assert.equal(await bal('worker', w, mat), 8);
  // عهد الخامات لدى العامل لاختيارها عند الاستلام
  const wf = (await call('GET', `/findings/worker/${w}`)).data;
  assert.equal(wf.length, 1);
  assert.equal(n(wf[0].available), 3);
  // الاستلام: 6 جم مع إضافة سلسال 1 جم → لا عجز
  const pv = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: ic, returned_weight: '6', additions: [{ source_custody_id: fc, weight: '1', pieces: 1 }] }] });
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  const st = pv.data.results[0].settlement;
  assert.deepEqual([n(st.weight_issued), n(st.returned_weight), n(st.actual_loss), n(st.gain_weight)], [6, 6, 0, 0]);
  assert.equal(st.status, 'approved');
  assert.equal(await bal('worker', w, mat), 2, 'خُصم السلسال من عهدة الخامات (3−1)');
  const fcRow = (await pool.query('select weight_issued, weight_used, status from custodies where id=$1', [fc])).rows[0];
  assert.deepEqual([n(fcRow.weight_used), fcRow.status], [1, 'open']);
  d = (await call('GET', `/orders/${o.id}`)).data;
  assert.equal(n(d.goldFlow.findings_added), 1, 'وزن الخامة مضاف على الطلب');
  assert.equal(n(d.gold.find((g) => g.loc_type === 'order').balance), 96 + 6 - 96, 'رصيد الطلب 6 جم');
  // لا يُضاف أكثر من المتبقي
  const o2 = (await call('POST', '/orders', { title: 'طلب 2', product_type: 'تعليقة', karat: 21, quantity: 1, material_id: mat })).data;
  let d2 = (await call('GET', `/orders/${o2.id}`)).data;
  for (let i = 0; i < 6 && !d2.order.handles_gold; i++) { await call('POST', `/orders/${o2.id}/advance`, { force: true, reason: 'اختبار' }); d2 = (await call('GET', `/orders/${o2.id}`)).data; }
  const ic2 = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o2.id, weight: '4' }] })).data.custodies[0].id;
  assert.equal((await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: ic2, returned_weight: '7', additions: [{ source_custody_id: fc, weight: '3' }] }] })).status, 400, 'أكثر من المتبقي (2 جم)');
  const r2 = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: ic2, returned_weight: '6', additions: [{ source_custody_id: fc, weight: '2', pieces: 2 }] }] });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal((await pool.query('select status from custodies where id=$1', [fc])).rows[0].status, 'closed', 'استُهلكت الخامات بالكامل فأُغلقت العهدة');
  assert.equal(await bal('worker', w, mat), 0);
  // المطابقة سليمة
  const rec = (await call('GET', '/inventory/reconciliation')).data;
  assert.equal(rec.ok, true, JSON.stringify(rec.workerCheck));
  // تصحيح التسوية يعيد الخامات لعهدة العامل
  assert.equal((await call('POST', `/sup/settlements/${r2.data.results[0].settlement.id}/reverse`, { reason: 'خطأ' })).status, 200);
  const back = (await pool.query('select weight_used, status from custodies where id=$1', [fc])).rows[0];
  assert.deepEqual([n(back.weight_used), back.status], [1, 'open']);
  assert.equal((await call('GET', '/inventory/reconciliation')).data.ok, true);
  // إرجاع غير المستخدم من الخامات يعود لمخزون الخامات وليس للخزنة
  await call('POST', `/sup/receive`, { worker_id: w, items: [{ custody_id: ic2, returned_weight: '4' }] });
  const ret = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: fc, returned_weight: '2', pieces_returned: 2 }] });
  assert.equal(ret.status, 200, JSON.stringify(ret.data));
  assert.equal(await bal('findings', f.id, mat), 9, '7 + 2 مرتجع');
  list = (await call('GET', '/findings')).data.findings.find((x) => x.id === f.id);
  assert.deepEqual([n(list.stock_weight), list.stock_pieces, n(list.at_workers)], [9, 9, 0]);
  assert.equal((await call('GET', '/inventory/reconciliation')).data.ok, true);
});

test('تأكيد وزن الحجر والزركون: يُخصم من وزن الميزان بدون مخزون وبدون حركة ذهب', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('zw1',$1,'عامل التركيب','worker','Z1') returning id", [hashPassword('Zw#2026xx')])).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '50', note: 'رصيد' });
  const o = (await call('POST', '/orders', { title: 'خاتم زركون', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat, zircon_weight: '1' })).data;
  let d = (await call('GET', `/orders/${o.id}`)).data;
  for (let i = 0; i < 6 && !d.order.handles_gold; i++) { await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'اختبار' }); d = (await call('GET', `/orders/${o.id}`)).data; }
  await call('POST', `/admin/stages/${d.order.current_stage_id}/rate`, { rate_percent: '0', note: 'x' });
  const ic = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o.id, weight: '5' }] })).data.custodies[0].id;
  const orderBal = await bal('order', o.id, mat);
  // العامل ركّب زركون 1 جم وحجر 0.5 جم
  const c = await call('POST', `/sup/orders/${o.id}/set-stones`, { zircon_weight: '1', stone_weight: '0.5', pearl_weight: '' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(n(c.data.confirmed_grams), 1.5);
  const lk = (await call('GET', `/sup/lookup?id=${o.id}`)).data;
  assert.deepEqual([n(lk.set_zircon_weight), n(lk.set_stone_weight), lk.set_pearl_weight, n(lk.stones.used)], [1, 0.5, null, 1.5]);
  assert.equal(await bal('order', o.id, mat), orderBal, 'لا حركة ذهب');
  // الاستلام: الميزان 6.5 جم = ذهب 5 + أحجار 1.5 → بدون عجز
  const r = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: ic, returned_weight: '6.5' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const st = r.data.results[0].settlement;
  assert.deepEqual([n(st.returned_weight), n(st.stones_weight), n(st.actual_loss)], [5, 1.5, 0]);
  assert.equal(await bal('worker', w, mat), 0);
});

test('الصور الداخلية: يرفعها فريق 3D فقط ولا تظهر للعميل', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  const o = (await call('POST', '/orders', { title: 'خاتم داخلي', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
  const mkW = async (u, spec) => { await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ($1,$2,$1,'worker',$1,$3)", [u, hashPassword('Int#2026xx'), spec]); let ck = '';
    const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'Int#2026xx' }); return go; };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const img = () => { const f = new FormData(); f.append('files', new Blob([PNG], { type: 'image/png' }), 'in.png'); return f; };
  const d3 = await mkW('int3d', 'طباعة الثري دي');
  const tw = await mkW('inttw', 'تشبيك');
  assert.equal((await d3('GET', '/auth/me')).data.is_3d, true);
  assert.equal((await tw('GET', '/auth/me')).data.is_3d, false);
  assert.equal((await tw('POST', `/w/orders/${o.id}/internal`, img())).status, 403, 'غير 3D ممنوع');
  assert.equal((await call('POST', `/orders/${o.id}/internal`, null)).status, 403, 'المدير ليس 3D');
  const up = await d3('POST', `/w/orders/${o.id}/internal`, img());
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal((await d3('GET', `/w/orders/${o.id}`)).status, 200, '3D يصل لأي طلب');
  const f = (await pool.query("select id, kind, customer_visible from order_files where order_id=$1", [o.id])).rows;
  assert.deepEqual(f.map((x) => [x.kind, x.customer_visible]), [['internal', false]]);
  assert.equal((await call('POST', `/orders/${o.id}/design/send`, { file_ids: [f[0].id] })).status, 400, 'لا تُرسل للعميل');
});
