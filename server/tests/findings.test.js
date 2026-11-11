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

test('مرحلة 3D: تحديد التصميم/الطباعة لكل قطعة ونقل الطلب كاملاً بدون المشرف', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  const mk = async (t) => (await call('POST', '/orders', { title: t, product_type: t, karat: 21, quantity: 2, material_id: mat })).data;
  const a = await mk('خاتم'), b = await mk('عقد');
  await pool.query("update orders set cart_ref='ORD-2026-555555' where id = any($1::int[])", [[a.id, b.id]]);
  const stageOf = async (id) => (await pool.query('select s.code from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [id])).rows[0].code;
  const login = async (u, spec) => { await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ($1,$2,$1,'worker',$1,$3)", [u, hashPassword('D3d#2026xx'), spec]); let ck = '';
    const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'D3d#2026xx' }); return go; };
  const d3 = await login('d3q', 'طباعة الثري دي');
  const tw = await login('d3tw', 'تشبيك');
  // المشرف ينقل الطلب كاملاً حتى مرحلة 3D
  for (let i = 0; i < 4 && (await stageOf(a.id)) !== 'design3d'; i++) {
    const r = await call('POST', `/orders/${a.id}/group-advance`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  assert.deepEqual([await stageOf(a.id), await stageOf(b.id)], ['design3d', 'design3d'], 'البنود انتقلت معاً');
  // طابور 3D
  const q = (await d3('GET', '/w/3d')).data;
  assert.ok(q.some((x) => x.id === a.id) && q.some((x) => x.id === b.id));
  assert.equal((await tw('GET', '/w/3d')).status, 403);
  assert.equal((await d3('POST', `/w/orders/${a.id}/3d`, { needs_design: true, needs_print: true })).status, 200);
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d`, { needs_design: false, needs_print: false })).status, 200);
  const fl = (await pool.query('select needs_3d_design, needs_3d_print from orders where id=$1', [a.id])).rows[0];
  assert.deepEqual([fl.needs_3d_design, fl.needs_3d_print], [true, true]);
  assert.equal((await tw('POST', `/w/orders/${a.id}/group-advance`)).status, 403, 'غير 3D');
  // موظف 3D ينقل الطلب كاملاً بدون اعتماد المشرف
  const mv = await d3('POST', `/w/orders/${a.id}/group-advance`);
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  assert.equal(mv.data.moved.length, 2);
  assert.notEqual(await stageOf(a.id), 'design3d');
  assert.equal(await stageOf(a.id), await stageOf(b.id));
  // خارج مرحلة 3D لا يستطيع النقل
  assert.equal((await d3('POST', `/w/orders/${a.id}/group-advance`)).status, 403);
});

test('الطلب متعدد المنتجات قطعة واحدة: صرف بوزن واحد، استلام واحد، والبنود تنتقل معاً، ووزن نهائي للطلب', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '100', note: 'رصيد' });
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('gw1',$1,'عامل الطلب','worker','GW1') returning id", [hashPassword('Gw#2026xx')])).rows[0].id;
  const mk = async (t, q) => (await call('POST', '/orders', { title: t, product_type: t, karat: 21, quantity: q, material_id: mat })).data;
  const a = await mk('خاتم', 2), b = await mk('عقد', 3);
  await pool.query("update orders set cart_ref='ORD-2026-444444' where id = any($1::int[])", [[a.id, b.id]]);
  const stage = async (id) => (await pool.query('select s.code, s.handles_gold from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [id])).rows[0];
  for (let i = 0; i < 8 && !(await stage(a.id)).handles_gold; i++) await call('POST', `/orders/${a.id}/group-advance`, { force: true });
  assert.ok((await stage(a.id)).handles_gold && (await stage(b.id)).handles_gold, 'وصل الطلب لمرحلة ذهب');
  const st = (await pool.query('select current_stage_id from orders where id=$1', [a.id])).rows[0].current_stage_id;
  await call('POST', `/admin/stages/${st}/rate`, { rate_percent: '0', note: 'x' });
  // ذهب مسجل سابقاً على البند الثاني يُدمج تلقائياً في الطلب
  assert.equal((await call('POST', `/orders/${b.id}/allocate`, { weight: '4' })).status, 200);
  assert.equal(await bal('order', a.id, mat), 4, 'التسجيل على أي بند يذهب للبند القائد');
  // قائمة بانتظار التسليم: الطلب مرة واحدة
  const waiting = (await call('GET', '/sup/awaiting-issue')).data.filter((x) => x.order_no === 'ORD-2026-444444');
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].quantity, 5);
  // المسح يعطي البند القائد ورصيد الطلب كاملاً
  const lk = (await call('GET', '/sup/lookup?code=ORD-2026-444444')).data;
  assert.deepEqual([lk.lead_id, Number(lk.group_balance), lk.group_qty], [a.id, 4, 5]);
  // صرف بوزن واحد (عن طريق البند الثاني) ← عهدة واحدة على البند القائد
  const iss = await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: b.id, weight: '10' }] });
  assert.equal(iss.status, 200, JSON.stringify(iss.data));
  assert.equal(iss.data.custodies.length, 1);
  const cus = iss.data.custodies[0];
  assert.deepEqual([cus.order_id, Number(cus.weight_issued), cus.pieces], [a.id, 10, 5]);
  assert.equal(await bal('worker', w, mat), 10);
  assert.equal((await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: a.id, weight: '1' }, { order_id: b.id, weight: '1' }] })).status, 400, 'لا تكرار للطلب');
  // استلام بوزن واحد ← البندان ينتقلان معاً
  const rc = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: cus.id, returned_weight: '10' }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  assert.equal((await stage(a.id)).code, (await stage(b.id)).code, 'البنود في نفس المرحلة');
  assert.notEqual((await pool.query('select current_stage_id from orders where id=$1', [b.id])).rows[0].current_stage_id, st, 'البند الثاني انتقل مع الطلب');
  // الوزن النهائي للطلب: وزن كل منتج، ومطابقة المجموع مع ذهب الطلب
  await pool.query("update orders set current_stage_id=(select id from stages where code='final_weight'), stage_seq=(select seq from route_stages rs join stages s on s.id=rs.stage_id where s.code='final_weight' and rs.route_id=orders.route_id) where id = any($1::int[])", [[a.id, b.id]]);
  assert.equal((await call('POST', `/orders/${b.id}/final-weight`, { weights: { [a.id]: '4', [b.id]: '5' } })).status, 400, 'فرق بدون سبب');
  const fw = await call('POST', `/orders/${b.id}/final-weight`, { weights: { [a.id]: '4', [b.id]: '6' } });
  assert.equal(fw.status, 200, JSON.stringify(fw.data));
  const fr = (await pool.query('select id, final_weight::float f from orders where id = any($1::int[]) order by id', [[a.id, b.id]])).rows.map((x) => x.f);
  assert.deepEqual(fr, [4, 6]);
});

test('النواقص وسحب الطلب من العامل', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '200', note: 'رصيد' });
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('sw1',$1,'عامل النواقص','worker','SW1') returning id", [hashPassword('Sw#2026xx')])).rows[0].id;
  const w2 = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('sw2',$1,'عامل بديل','worker','SW2') returning id", [hashPassword('Sw#2026xx')])).rows[0].id;
  const cust = (await call('POST', '/admin/customers', { shop_name: 'محل النواقص' })).data.id;
  const mk = async (t) => (await call('POST', '/orders', { title: t, product_type: t, karat: 21, quantity: 10, material_id: mat, customer_id: cust })).data;
  const ring = await mk('خاتم'), chain = await mk('عقد سلسلة'), rob = await mk('عقد روبتشن');
  const REF = 'ORD-2026-333333';
  for (const [i, o] of [ring, chain, rob].entries()) await pool.query('update orders set cart_ref=$2, order_no=$3 where id=$1', [o.id, REF, `${REF}-${i + 1}`]);
  const stage = async (id) => (await pool.query('select o.order_no, o.stage_state, o.current_stage_id, o.cart_ref, o.quantity, s.handles_gold from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [id])).rows[0];
  for (let i = 0; i < 8 && !(await stage(ring.id)).handles_gold; i++) await call('POST', `/orders/${ring.id}/group-advance`);
  const st = (await stage(ring.id)).current_stage_id;
  await call('POST', `/admin/stages/${st}/rate`, { rate_percent: '0', note: 'x' });
  // الطلب كامل لدى العامل بوزن 30
  const cus = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: ring.id, weight: '30' }] })).data.custodies[0];
  assert.equal(cus.pieces, 30);
  // اتضح عدم توفر الروبتشن: سحب 10 عقود روبتشن (8 جم) من العامل إلى النواقص
  assert.equal((await call('POST', `/orders/${rob.id}/shortage`, { kind: 'chain', weight: '8' })).status, 400, 'البيان إلزامي');
  const sh = await call('POST', `/orders/${rob.id}/shortage`, { kind: 'chain', weight: '8', reason: 'لا يوجد روبتشن 45 سم' });
  assert.equal(sh.status, 200, JSON.stringify(sh.data));
  const robNow = await stage(rob.id);
  assert.equal(robNow.stage_state, 'shortage');
  assert.notEqual(robNow.cart_ref, REF, 'طلب جديد برقم جديد');
  assert.equal(robNow.order_no, sh.data.order_no);
  assert.equal(await bal('order', rob.id, mat), 8, 'ذهب القطع الناقصة على الطلب الجديد');
  assert.equal(await bal('worker', w, mat), 22, 'خُصم من العامل');
  const c1 = (await pool.query('select weight_issued::float i, weight_used::float u, pieces from custodies where id=$1', [cus.id])).rows[0];
  assert.deepEqual([c1.i - c1.u, c1.pieces], [22, 20]);
  // الطلب الأصلي: صنفان، والملصق الجديد للنواقص
  const lk = (await call('GET', `/sup/lookup?code=${REF}`)).data;
  assert.equal(lk.group.length, 2);
  const lab = (await call('GET', `/orders/labels?ids=${rob.id}`)).data[0];
  assert.equal(lab.order_no, robNow.cart_ref);
  // لا يُسلَّم ولا ينتقل وهو في النواقص
  assert.equal((await call('POST', `/orders/${rob.id}/advance`)).status, 409);
  assert.equal((await call('POST', '/sup/issue', { worker_id: w2, items: [{ order_id: rob.id, weight: '8' }] })).status, 409);
  assert.ok((await call('GET', '/sup/shortages')).data.rows.some((x) => x.id === rob.id));
  // استلام باقي الطلب بدون عجز، والطلب الأصلي يكمل
  const rc = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: cus.id, returned_weight: '22' }] });
  assert.equal(Number(rc.data.results[0].settlement.actual_loss), 0);
  assert.notEqual((await stage(ring.id)).current_stage_id, st, 'الأصلي انتقل');
  assert.equal((await stage(rob.id)).current_stage_id, st, 'النواقص بقيت في مرحلتها');
  // العميل يرى القطع في النواقص
  const { hashPassword: hp } = await import('../src/lib/auth.js');
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('shcust',$1,'م','customer',$2,false)", [hp('Sh#2026cust'), cust]);
  await pool.query("update customers set status='approved' where id=$1", [cust]);
  let ck = '';
  const cu = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await cu('POST', '/auth/login', { username: 'shcust', password: 'Sh#2026cust' });
  const mine = (await cu('GET', '/store/orders')).data;
  assert.equal(mine.find((x) => x.id === rob.id).status, 'shortage');
  assert.equal(mine.find((x) => x.id === ring.id).status, 'in_production');
  // توفرت النواقص: استئناف
  assert.equal((await call('POST', `/orders/${rob.id}/shortage/resume`)).status, 200);
  assert.equal((await stage(rob.id)).stage_state, 'waiting');
  // جزء من الكمية + البند القائد: 4 خواتم من 10 للنواقص (والطلب لدى عامل)
  const cus2 = (await call('POST', '/sup/issue', { worker_id: w2, items: [{ order_id: ring.id, weight: '20' }] })).data.custodies[0];
  const p = await call('POST', `/orders/${ring.id}/shortage`, { kind: 'diamond', quantity: 4, weight: '3', reason: 'ألماس 1.5 مم غير متوفر' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal((await stage(ring.id)).quantity, 6);
  assert.equal((await stage(p.data.order_id)).quantity, 4);
  assert.equal(await bal('worker', w2, mat), 17);
  // سحب الطلب من العامل (غائب): وزن وسبب، والطلب يبقى في مرحلته بدون عامل
  const before = (await stage(ring.id)).current_stage_id;
  assert.equal((await call('POST', `/sup/custody/${cus2.id}/withdraw`, { returned_weight: '17' })).status, 400, 'السبب إلزامي');
  const wd = await call('POST', `/sup/custody/${cus2.id}/withdraw`, { returned_weight: '17', reason: 'العامل غائب' });
  assert.equal(wd.status, 200, JSON.stringify(wd.data));
  assert.equal(await bal('worker', w2, mat), 0);
  assert.equal((await stage(ring.id)).current_stage_id, before, 'لم ينتقل');
  assert.equal((await pool.query('select assigned_worker_id from orders where id=$1', [ring.id])).rows[0].assigned_worker_id, null);
});

test('النواقص: نقل البند القائد كاملاً ينقل ذهب وعهدة الطلب للبند التالي', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('lw1',$1,'عامل','worker','LW1') returning id", [hashPassword('Lw#2026xx')])).rows[0].id;
  const mk = async (t) => (await call('POST', '/orders', { title: t, product_type: t, karat: 21, quantity: 5, material_id: mat })).data;
  const a = await mk('خاتم'), b = await mk('حلق');
  await pool.query("update orders set cart_ref='ORD-2026-222222' where id = any($1::int[])", [[a.id, b.id]]);
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [a.id])).rows[0].h; i++) await call('POST', `/orders/${a.id}/group-advance`);
  await call('POST', `/orders/${a.id}/allocate`, { weight: '2' });
  const cus = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: a.id, weight: '10' }] })).data.custodies[0];
  assert.equal(cus.order_id, a.id);
  const r = await call('POST', `/orders/${a.id}/shortage`, { kind: 'stones', weight: '4', reason: 'زركون غير متوفر' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await pool.query('select order_id from custodies where id=$1', [cus.id])).rows[0].order_id, b.id, 'العهدة انتقلت للبند التالي');
  assert.equal(await bal('order', a.id, mat), 4);
  const rc = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: cus.id, returned_weight: '6' }] });
  assert.equal(Number(rc.data.results[0].settlement.actual_loss), 0);
});

test('تحويل الطلب من عامل لعامل المرحلة التالية: الثاني يؤكد الوزن ويقبل، والفرق عجز على الأول', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '50', note: 'رصيد' });
  const mkW = async (u, spec) => { const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ($1,$2,$1,'worker',$1,$3) returning id", [u, hashPassword('Tr#2026xx'), spec])).rows[0].id; let ck = '';
    const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'Tr#2026xx' }); return { id, go }; };
  const A = await mkW('trA', 'تشبيك'), B = await mkW('trB', 'تركيب');
  const o = (await call('POST', '/orders', { title: 'خاتم تحويل', product_type: 'خاتم', karat: 21, quantity: 2, material_id: mat })).data;
  const stageOf = async () => (await pool.query('select o.current_stage_id id, s.handles_gold h, s.name from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0];
  for (let i = 0; i < 8 && !(await stageOf()).h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'اختبار' });
  const st1 = (await stageOf()).id;
  await call('POST', `/admin/stages/${st1}/rate`, { rate_percent: '2', note: 'x' }); // عجز طبيعي مسموح 2%
  const cus = (await call('POST', '/sup/issue', { worker_id: A.id, items: [{ order_id: o.id, weight: '10' }] })).data.custodies[0];
  assert.equal((await A.go('POST', `/w/custody/${cus.id}/transfer`, { to_worker_id: B.id, weight: '9.5' })).status, 409, 'يقبل العهدة أولاً');
  await A.go('POST', `/w/custody/${cus.id}/ack`);
  const tr = await A.go('POST', `/w/custody/${cus.id}/transfer`, { to_worker_id: B.id, weight: '9.5' });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  assert.equal((await A.go('POST', `/w/custody/${cus.id}/transfer`, { to_worker_id: B.id, weight: '9.5' })).status, 409, 'تحويل واحد معلق');
  const inc = (await B.go('GET', '/w/transfers')).data.incoming;
  assert.equal(inc.length, 1);
  assert.equal(Number(inc[0].weight), 9.5);
  assert.equal((await A.go('POST', `/w/transfers/${tr.data.id}/accept`, { weight: '9.5' })).status, 404, 'الأول لا يقبل عن الثاني');
  // الثاني يزن ويؤكد 9.5 ويقبل
  const ac = await B.go('POST', `/w/transfers/${tr.data.id}/accept`, { weight: '9.5' });
  assert.equal(ac.status, 200, JSON.stringify(ac.data));
  const stl = ac.data.settlement;
  // العجز 0.5 على العامل الأول: الطبيعي حسب نسبة مهنته (التشبيك 0.1%) والباقي غير طبيعي
  assert.deepEqual([Number(stl.weight_issued), Number(stl.returned_weight), Number(stl.actual_loss)], [10, 9.5, 0.5]);
  assert.ok(Number(stl.normal_loss) > 0 && Math.abs(Number(stl.normal_loss) + Number(stl.abnormal_loss) - 0.5) < 1e-9, 'طبيعي + غير طبيعي = 0.5');
  assert.equal((await pool.query('select custody_id from settlements where id=$1', [stl.id])).rows[0].custody_id, cus.id, 'التسوية على عهدة الأول');
  assert.equal(await bal('worker', A.id, mat), 0);
  assert.equal(await bal('worker', B.id, mat), 9.5);
  assert.notEqual((await stageOf()).id, st1, 'انتقل للمرحلة التالية');
  const nc = (await pool.query('select worker_id, weight_issued::float w, worker_ack_at, stage_id from custodies where id=$1', [ac.data.custody_id])).rows[0];
  assert.deepEqual([nc.worker_id, nc.w, !!nc.worker_ack_at, nc.stage_id], [B.id, 9.5, true, (await stageOf()).id]);
  // رفض تحويل
  const tr2 = await B.go('POST', `/w/custody/${ac.data.custody_id}/transfer`, { to_worker_id: A.id, weight: '9' });
  assert.equal(tr2.status, 200);
  assert.equal((await A.go('POST', `/w/transfers/${tr2.data.id}/reject`, {})).status, 400, 'السبب إلزامي');
  assert.equal((await A.go('POST', `/w/transfers/${tr2.data.id}/reject`, { reason: 'الوزن ناقص' })).status, 200);
  assert.equal(await bal('worker', B.id, mat), 9.5, 'بقيت لدى الثاني');
  // وزن أكبر من المسلَّم لا يُقبل بدون مراجعة
  const tr3 = await B.go('POST', `/w/custody/${ac.data.custody_id}/transfer`, { to_worker_id: A.id, weight: '9.5' });
  assert.equal((await A.go('POST', `/w/transfers/${tr3.data.id}/accept`, { weight: '11' })).status, 409);
  assert.equal(await bal('worker', B.id, mat), 9.5);
});
