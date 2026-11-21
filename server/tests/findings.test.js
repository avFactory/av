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
  // وزن أكبر من المسلَّم: بدون عهدة عامة لدى المرسل يتوقف التحويل برسالة واضحة
  const tr3 = await B.go('POST', `/w/custody/${ac.data.custody_id}/transfer`, { to_worker_id: A.id, weight: '9.5' });
  const over = await A.go('POST', `/w/transfers/${tr3.data.id}/accept`, { weight: '11' });
  assert.equal(over.status, 409);
  assert.match(over.data.error, /العهدة العامة|عهدته العامة/);
  assert.equal(await bal('worker', B.id, mat), 9.5);
  // للمرسل عهدة عامة 3 جم: الزيادة 1.5 تُخصم منها ويستمر التحويل
  const gen = await call('POST', '/inventory/gold/to-worker', { worker_id: B.id, material_id: mat, weight: '3', purpose: 'ذهب إضافات' });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  const ok = await A.go('POST', `/w/transfers/${tr3.data.id}/accept`, { weight: '11' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(Number(ok.data.settlement.actual_loss), 0, 'لا عجز: 9.5 + 1.5 من العهدة العامة = 11');
  const g = (await pool.query("select (weight_issued - weight_used)::float left from custodies where worker_id=$1 and kind='general' and status='open'", [B.id])).rows[0];
  assert.equal(g.left, 1.5, 'خُصمت الزيادة من العهدة العامة');
  assert.equal(await bal('worker', B.id, mat), 1.5);
  assert.equal(await bal('worker', A.id, mat), 11);
  // المصادر المتاحة للإضافة تشمل العهدة العامة
  assert.ok((await call('GET', `/findings/worker/${B.id}`)).data.some((x) => x.general));
});

test('مرحلة الجودة يديرها عاملها: تسليم تلقائي، قبول بوزن الميزان، وزن نهائي وانتهيت ← الفوترة بدون المشرف', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '50', note: 'رصيد' });
  const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ('walidqc',$1,'وليد','worker','QC1','الجودة') returning id", [hashPassword('Qc#2026xx')])).rows[0].id;
  let ck = '';
  const W = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await W('POST', '/auth/login', { username: 'walidqc', password: 'Qc#2026xx' });
  const qc = (await pool.query("select id from stages where code='qc'")).rows[0].id;
  const s = (await call('GET', '/admin/stages')).data.find((x) => x.id === qc);
  assert.equal((await call('PUT', `/admin/stages/${qc}`, { ...s, worker_closes: true, worker_ids: [id] })).status, 200);
  await call('POST', `/admin/stages/${qc}/rate`, { rate_percent: '1', note: 'x' });

  const o = (await call('POST', '/orders', { title: 'خاتم جودة', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
  const cur = async () => (await pool.query('select o.current_stage_id id, s.code, s.kind, o.final_weight from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0];
  for (let i = 0; i < 6 && !['casting', 'prep'].includes((await cur()).code); i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'اختبار' });
  assert.equal((await call('POST', `/orders/${o.id}/allocate`, { weight: '10' })).status, 200);
  // من الغسيل للجودة (تجاوز المراحل للاختبار)
  for (let i = 0; i < 12 && (await cur()).code !== 'qc'; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'اختبار' });
  assert.equal((await cur()).code, 'qc');
  const tasks = (await W('GET', '/w/tasks')).data.custodies;
  const c = tasks.find((x) => x.order_id === o.id);
  assert.ok(c, 'سُلِّم تلقائياً لوليد');
  assert.equal(c.worker_closes, true);
  assert.equal(Number(c.weight_issued), 10);
  assert.equal(await bal('worker', id, mat), 10);
  // القبول بوزن الميزان
  assert.equal((await W('POST', `/w/custody/${c.id}/ack`, {})).status, 400, 'الوزن إلزامي');
  assert.equal((await W('POST', `/w/custody/${c.id}/ack`, { weight: '9.5' })).status, 400, 'وزن مختلف ← يرفض ويبلغ المشرف');
  assert.equal((await W('POST', `/w/custody/${c.id}/ack`, { weight: '10' })).status, 200);
  await W('POST', `/w/custody/${c.id}/start`, {});
  assert.equal((await W('POST', `/w/custody/${c.id}/finish`, {})).status, 400, 'الوزن النهائي إلزامي');
  const fin = await W('POST', `/w/custody/${c.id}/finish`, { weight: '9.95' });
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  const after = await cur();
  assert.equal(after.kind, 'invoicing', 'انتقل للفوترة بدون اعتماد المشرف');
  assert.equal(Number(after.final_weight), 9.95);
  assert.equal(await bal('worker', id, mat), 0);
  assert.equal(await bal('order', o.id, mat), 9.95);
  const stl = (await pool.query('select actual_loss::float l, status from settlements where custody_id=$1', [c.id])).rows[0];
  assert.deepEqual([stl.l, stl.status], [0.05, 'approved'], 'العجز على عامل الجودة');
  assert.ok((await pool.query("select 1 from notifications where title like $1", [`%جاهز للفوترة%`])).rowCount, 'إشعار المحاسب');
  await call('PUT', `/admin/stages/${qc}`, { ...s, worker_closes: false });
});

test('استلام جزء من عهدة العامل للمشرف: يعود لمكانه، تبقى العهدة بالباقي، والعجز على المتبقي فقط', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '100', note: 'رصيد' });
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('prw',$1,'عامل جزئي','worker','PR1') returning id", [hashPassword('Pr#2026xx')])).rows[0].id;
  // عهدة طلب
  const o = (await call('POST', '/orders', { title: 'خاتم جزئي', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  const st = (await pool.query('select current_stage_id from orders where id=$1', [o.id])).rows[0].current_stage_id;
  await call('POST', `/admin/stages/${st}/rate`, { rate_percent: '0', note: 'x' });
  const cus = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o.id, weight: '10' }] })).data.custodies[0];
  assert.equal((await call('POST', `/sup/custody/${cus.id}/partial-return`, { weight: '10' })).status, 400, 'الكل ← استلام كامل');
  assert.equal((await call('POST', `/sup/custody/${cus.id}/partial-return`, { weight: '0' })).status, 400);
  const pr = await call('POST', `/sup/custody/${cus.id}/partial-return`, { weight: '3', note: 'ذهب زائد' });
  assert.equal(pr.status, 200, JSON.stringify(pr.data));
  assert.equal(await bal('worker', w, mat), 7);
  assert.equal(await bal('order', o.id, mat), 3, 'رجع لرصيد الطلب');
  const prof = (await call('GET', `/sup/workers/${w}`)).data.custodies.find((c) => c.id === cus.id);
  assert.equal(Number(prof.weight_issued), 7, 'المعروض = المتبقي');
  // الاستلام الكامل لاحقاً: العجز على المتبقي (7) فقط
  const rc = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: cus.id, returned_weight: '6.9', advance: false }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  const stl = rc.data.results[0].settlement;
  assert.deepEqual([Number(stl.weight_issued), Number(stl.returned_weight), Number(stl.actual_loss)], [7, 6.9, 0.1]);
  assert.equal(await bal('worker', w, mat), 0);
  assert.equal(await bal('order', o.id, mat), 9.9);
  // عهدة عامة: الجزء يعود للخزنة
  const v0 = await bal('vault', null, mat);
  const g = await call('POST', '/inventory/gold/to-worker', { worker_id: w, material_id: mat, weight: '5', purpose: 'لحام', loss_rate_percent: '0' });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const gc = (await pool.query("select id from custodies where worker_id=$1 and kind='general' and status='open'", [w])).rows[0].id;
  assert.equal((await call('POST', `/sup/custody/${gc}/partial-return`, { weight: '2' })).status, 200);
  assert.equal(await bal('vault', null, mat), v0 - 3);
  assert.equal(await bal('worker', w, mat), 3);
  // حركة مسجلة في الدفتر
  assert.ok((await pool.query("select 1 from gold_ledger where kind='partial_return' and custody_id=$1", [gc])).rowCount);
});

test('العامل يسلّم جزءاً من عهدته للمشرف من صفحته: طلب ← المشرف يزن ويؤكد أو يرفض', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '50', note: 'رصيد' });
  const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('rqw',$1,'عامل يسلم جزء','worker','RQ1') returning id", [hashPassword('Rq#2026xx')])).rows[0].id;
  let ck = '';
  const W = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await W('POST', '/auth/login', { username: 'rqw', password: 'Rq#2026xx' });
  await call('POST', '/inventory/gold/to-worker', { worker_id: id, material_id: mat, weight: '8', purpose: 'لحام', loss_rate_percent: '0' });
  const c = (await W('GET', '/w/tasks')).data.custodies[0];
  assert.equal((await W('POST', `/w/custody/${c.id}/return-request`, { weight: '2' })).status, 409, 'يقبل العهدة أولاً');
  await W('POST', `/w/custody/${c.id}/ack`, {});
  assert.equal((await W('POST', `/w/custody/${c.id}/return-request`, { weight: '8' })).status, 400, 'الكل ← إنهاء المرحلة');
  const rq = await W('POST', `/w/custody/${c.id}/return-request`, { weight: '3', note: 'زائد' });
  assert.equal(rq.status, 200, JSON.stringify(rq.data));
  assert.equal((await W('POST', `/w/custody/${c.id}/return-request`, { weight: '1' })).status, 409, 'طلب واحد معلق');
  assert.equal((await W('GET', '/w/tasks')).data.custodies[0].return_request.id, rq.data.id);
  assert.equal(await bal('worker', id, mat), 8, 'لا يتحرك الذهب قبل تأكيد المشرف');
  const list = (await call('GET', `/sup/return-requests?worker=${id}`)).data;
  assert.deepEqual(list.map((x) => [x.id, Number(x.weight), Number(x.remaining)]), [[rq.data.id, 3, 8]]);
  // المشرف يزن 2.95 ويؤكد
  const v0 = await bal('vault', null, mat);
  const ac = await call('POST', `/sup/return-requests/${rq.data.id}/accept`, { weight: '2.95' });
  assert.equal(ac.status, 200, JSON.stringify(ac.data));
  assert.equal(await bal('worker', id, mat), 5.05);
  assert.equal(await bal('vault', null, mat), v0 + 2.95);
  assert.equal(Number((await W('GET', '/w/tasks')).data.custodies[0].weight_issued), 5.05, 'العامل يرى المتبقي');
  assert.equal((await call('POST', `/sup/return-requests/${rq.data.id}/accept`, {})).status, 409, 'لا تأكيد مرتين');
  // رفض طلب ثانٍ، وإلغاء ثالث من العامل
  const rq2 = (await W('POST', `/w/custody/${c.id}/return-request`, { weight: '1' })).data;
  assert.equal((await call('POST', `/sup/return-requests/${rq2.id}/reject`, {})).status, 400, 'السبب إلزامي');
  assert.equal((await call('POST', `/sup/return-requests/${rq2.id}/reject`, { reason: 'لم يصل الذهب' })).status, 200);
  const rq3 = (await W('POST', `/w/custody/${c.id}/return-request`, { weight: '1' })).data;
  assert.equal((await W('POST', `/w/return-requests/${rq3.id}/cancel`)).status, 200);
  assert.equal(await bal('worker', id, mat), 5.05);
  assert.equal((await call('GET', `/sup/return-requests?worker=${id}`)).data.length, 0);
});

test('تعديل العهدة المفتوحة للمدير فقط: قبل وبعد قبول العامل، والفرق بحركة موثقة، والاستلام والإلغاء بعد التعديل', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '100', note: 'رصيد' });
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('edw',$1,'عامل تعديل','worker','ED1') returning id", [hashPassword('Ed#2026xx')])).rows[0].id;
  let wk = '';
  const W = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: wk, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) wk = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await W('POST', '/auth/login', { username: 'edw', password: 'Ed#2026xx' });
  // مشرف (غير مدير)
  await pool.query("insert into users(username, password_hash, full_name, role_code, must_change_password) values ('edsup',$1,'مشرف','supervisor',false)", [hashPassword('Sup#2026edit')]);
  let sk = '';
  const SUP = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: sk, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) sk = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await SUP('POST', '/auth/login', { username: 'edsup', password: 'Sup#2026edit' });

  const o = (await call('POST', '/orders', { title: 'خاتم تعديل', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  const st = (await pool.query('select current_stage_id from orders where id=$1', [o.id])).rows[0].current_stage_id;
  await call('POST', `/admin/stages/${st}/rate`, { rate_percent: '0', note: 'x' });
  const cus = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o.id, weight: '10' }] })).data.custodies[0];
  assert.equal((await SUP('PUT', `/sup/custodies/${cus.id}`, { gross_weight: '12', reason: 'x' })).status, 403, 'المشرف لا يعدّل');
  assert.equal((await call('PUT', `/sup/custodies/${cus.id}`, { gross_weight: '12' })).status, 400, 'السبب إلزامي');
  // قبل القبول: زيادة إلى 12 (الطلب رصيده 0 ← من الخزنة)
  const v0 = await bal('vault', null, mat);
  const e1 = await call('PUT', `/sup/custodies/${cus.id}`, { gross_weight: '12', reason: 'خطأ وزن' });
  assert.equal(e1.status, 200, JSON.stringify(e1.data));
  assert.equal(await bal('worker', w, mat), 12);
  assert.equal(await bal('vault', null, mat), v0 - 2);
  assert.equal(Number((await W('GET', '/w/tasks')).data.custodies.find((c) => c.id === cus.id).weight_issued), 12, 'العامل يرى الوزن الجديد');
  // بعد القبول: إنقاص إلى 11.5 (الفرق يعود لرصيد الطلب)
  await W('POST', `/w/custody/${cus.id}/ack`, {});
  const e2 = await call('PUT', `/sup/custodies/${cus.id}`, { gross_weight: '11.5', reason: 'تصحيح' });
  assert.equal(e2.status, 200, JSON.stringify(e2.data));
  assert.equal(await bal('worker', w, mat), 11.5);
  assert.equal(await bal('order', o.id, mat), 0.5);
  assert.equal((await pool.query("select count(*)::int n from gold_ledger where custody_id=$1 and kind='custody_adjust'", [cus.id])).rows[0].n, 2);
  // الاستلام يحسب العجز على الوزن المعدّل
  const rc = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: cus.id, returned_weight: '11.4', advance: false }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  assert.deepEqual([Number(rc.data.results[0].settlement.weight_issued), Number(rc.data.results[0].settlement.actual_loss)], [11.5, 0.1]);
  assert.equal((await call('PUT', `/sup/custodies/${cus.id}`, { gross_weight: '5', reason: 'x' })).status, 409, 'بعد الاستلام لا تعديل');
  // عهدة عامة: تعديل ثم إلغاء التسليم يعيد كل شيء للخزنة
  const v1 = await bal('vault', null, mat);
  await call('POST', '/inventory/gold/to-worker', { worker_id: w, material_id: mat, weight: '4', purpose: 'لحام', loss_rate_percent: '0' });
  const gc = (await pool.query("select id from custodies where worker_id=$1 and kind='general' and status='open'", [w])).rows[0].id;
  assert.equal((await call('PUT', `/sup/custodies/${gc}`, { gross_weight: '6', reason: 'زيادة' })).status, 200);
  assert.equal(await bal('vault', null, mat), v1 - 6);
  assert.equal((await call('POST', `/sup/custodies/${gc}/reverse`, { reason: 'خطأ' })).status, 200);
  assert.equal(await bal('vault', null, mat), v1, 'الإلغاء يشمل التعديل');
  assert.equal(await bal('worker', w, mat), 0);
});

test('المكائن: التسليم والتحويل إليها يُسجل فوراً بدون قبول، والمشرف يستلم منها', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '100', note: 'رصيد' });
  const m = (await pool.query("insert into users(username, password_hash, full_name, role_code, kind, employee_no) values ('mcpol',$1,'ماكينة البوليش','worker','machine','M1') returning id", [hashPassword('Mc#2026xx')])).rows[0].id;
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('mcw',$1,'عامل قبل المكينة','worker','MW1') returning id", [hashPassword('Mw#2026xx')])).rows[0].id;
  let wk = '';
  const W = async (mt, p, body) => { const r = await fetch(base + '/api' + p, { method: mt, headers: { cookie: wk, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) wk = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await W('POST', '/auth/login', { username: 'mcw', password: 'Mw#2026xx' });
  const mkOrder = async (t) => {
    const o = (await call('POST', '/orders', { title: t, product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
    for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
    await call('POST', `/admin/stages/${(await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s}/rate`, { rate_percent: '0', note: 'x' });
    return o;
  };
  // تسليم مباشر لمكينة: مسجل فوراً
  const o1 = await mkOrder('خاتم مكينة');
  const c1 = (await call('POST', '/sup/issue', { worker_id: m, items: [{ order_id: o1.id, weight: '10' }] })).data.custodies[0];
  const r1 = (await pool.query('select worker_ack_at, work_state from custodies where id=$1', [c1.id])).rows[0];
  assert.ok(r1.worker_ack_at, 'بدون قبول'); assert.equal(r1.work_state, 'in_progress');
  // عهدة عامة لمكينة
  await call('POST', '/inventory/gold/to-worker', { worker_id: m, material_id: mat, weight: '3', purpose: 'تشغيل', loss_rate_percent: '0' });
  assert.ok((await pool.query("select worker_ack_at from custodies where worker_id=$1 and kind='general'", [m])).rows[0].worker_ack_at);
  // تحويل من عامل لمكينة: العامل لا يحوّل، والمشرف يحوّل ويُسجل فوراً
  const o2 = await mkOrder('خاتم تحويل لمكينة');
  const c2 = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o2.id, weight: '8' }] })).data.custodies[0];
  await W('POST', `/w/custody/${c2.id}/ack`, {});
  assert.ok(!(await W('GET', '/w/workers')).data.some((x) => x.id === m), 'المكائن لا تظهر للعامل');
  assert.equal((await W('POST', `/w/custody/${c2.id}/transfer`, { to_worker_id: m, weight: '8' })).status, 400);
  const tr = await call('POST', `/sup/custody/${c2.id}/transfer`, { to_worker_id: m, weight: '7.9' });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  assert.ok(tr.data.auto?.ok, 'اكتمل فوراً');
  const nc = (await pool.query("select id, worker_id, weight_issued::float w, worker_ack_at from custodies where worker_id=$1 and order_id=$2 and status='open'", [m, o2.id])).rows[0];
  assert.deepEqual([nc.worker_id, nc.w, !!nc.worker_ack_at], [m, 7.9, true]);
  assert.equal((await pool.query("select status from custody_transfers where id=$1", [tr.data.id])).rows[0].status, 'accepted');
  assert.equal(await bal('worker', w, mat), 0);
  assert.equal(Number((await pool.query('select actual_loss from settlements where custody_id=$1', [c2.id])).rows[0].actual_loss), 0.1, 'الفرق عجز على العامل');
  // الاستلام من المكينة
  const rc = await call('POST', '/sup/receive', { worker_id: m, items: [{ custody_id: nc.id, returned_weight: '7.9', advance: false }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  assert.equal(await bal('worker', m, mat), 13, '10 + 3 باقية على المكينة');
});

test('تصحيح تسوية خاطئة: يلغي العجز غير الطبيعي ويعيد الذهب لعهدة العامل، ثم استلام صحيح', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '400', note: 'رصيد' });
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('fixw',$1,'عامل تصحيح','worker','FX1') returning id", [hashPassword('Fx#2026xx')])).rows[0].id;
  const o = (await call('POST', '/orders', { title: 'طقم تصحيح', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  const c = (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o.id, weight: '300' }] })).data.custodies[0];
  // خطأ إدخال: 0.91 بدل 299.91
  const noNote = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c.id, returned_weight: '0.91' }] });
  assert.equal(noNote.status, 400, 'عجز كبير بدون ملاحظة يُرفض');
  assert.match(noNote.data.error, /عجز كبير/);
  const bad = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c.id, returned_weight: '0.91', reason: 'كتبتها خطأ' }] });
  assert.equal(bad.status, 200, JSON.stringify(bad.data));
  assert.equal(bad.data.results[0].settlement.status, 'pending_review', 'يُحال لمراجعة العجز بدل الاعتماد');
  const prof = async () => (await call('GET', `/sup/workers/${w}`)).data;
  const stId = (await prof()).custodies.find((x) => x.id === c.id).settlement_id;
  const rv = await call('POST', `/sup/settlements/${stId}/reverse`, { reason: 'خطأ في إدخال الوزن' });
  assert.equal(rv.status, 200, JSON.stringify(rv.data));
  const p2 = await prof();
  assert.equal(Number(p2.totals.abnormal_loss_total), 0, 'أُلغي العجز');
  assert.equal(await bal('worker', w, mat), 300, 'الذهب عاد للعامل');
  assert.equal(p2.custodies.find((x) => x.id === c.id).status, 'open');
  const ok = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c.id, returned_weight: '299.91', advance: false }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(Number((await prof()).totals.abnormal_loss_total) < 0.1);
});

test('تحويل العهدة لعامل آخر: نفس المرحلة (إعادة إسناد) والعهدة العامة، والخامات لا تُحوّل', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '100', note: 'رصيد' });
  const mkW = async (u) => { const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ($1,$2,$1,'worker',$1) returning id", [u, hashPassword('Ss#2026xx')])).rows[0].id; let ck = '';
    const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'Ss#2026xx' }); return { id, go }; };
  const A = await mkW('ssA'), B = await mkW('ssB');
  // طلب: نفس المرحلة
  const o = (await call('POST', '/orders', { title: 'خاتم إعادة إسناد', product_type: 'خاتم', karat: 21, quantity: 1, material_id: mat })).data;
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  const st = (await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s;
  await call('POST', `/admin/stages/${st}/rate`, { rate_percent: '0', note: 'x' });
  const c = (await call('POST', '/sup/issue', { worker_id: A.id, items: [{ order_id: o.id, weight: '10' }] })).data.custodies[0];
  await A.go('POST', `/w/custody/${c.id}/ack`, {});
  const tr = await A.go('POST', `/w/custody/${c.id}/transfer`, { to_worker_id: B.id, weight: '10', mode: 'same_stage' });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  const inc = (await B.go('GET', '/w/transfers')).data.incoming;
  assert.equal(inc[0].mode, 'same_stage');
  const ac = await B.go('POST', `/w/transfers/${tr.data.id}/accept`, { weight: '10' });
  assert.equal(ac.status, 200, JSON.stringify(ac.data));
  assert.equal((await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s, st, 'الطلب بقي في مرحلته');
  const nc = (await pool.query("select stage_id, worker_ack_at from custodies where id=$1", [ac.data.custody_id])).rows[0];
  assert.deepEqual([nc.stage_id, !!nc.worker_ack_at], [st, true]);
  assert.equal(await bal('worker', B.id, mat), 10);
  // عهدة عامة: تُحوّل وتظهر للمستلم، والفرق عجز على المرسل
  await call('POST', '/inventory/gold/to-worker', { worker_id: A.id, material_id: mat, weight: '6', purpose: 'لحام', loss_rate_percent: '0' });
  const gc = (await pool.query("select id from custodies where worker_id=$1 and kind='general' and status='open'", [A.id])).rows[0].id;
  await A.go('POST', `/w/custody/${gc}/ack`, {});
  const tg = await call('POST', `/sup/custody/${gc}/transfer`, { to_worker_id: B.id, weight: '5.9' });
  assert.equal(tg.status, 200, JSON.stringify(tg.data));
  const incG = (await B.go('GET', '/w/transfers')).data.incoming.find((x) => x.id === tg.data.id);
  assert.ok(incG && incG.order_no === 'عهدة عامة', 'العهدة العامة تظهر للمستلم');
  assert.equal((await B.go('POST', `/w/transfers/${tg.data.id}/accept`, { weight: '6.5' })).status, 409, 'لا يقبل أكثر من العهدة العامة');
  const ag = await B.go('POST', `/w/transfers/${tg.data.id}/accept`, { weight: '5.9' });
  assert.equal(ag.status, 200, JSON.stringify(ag.data));
  const g2 = (await pool.query("select purpose, weight_issued::float w, worker_ack_at from custodies where id=$1", [ag.data.custody_id])).rows[0];
  assert.deepEqual([g2.purpose, g2.w, !!g2.worker_ack_at], ['لحام', 5.9, true]);
  assert.equal(await bal('worker', A.id, mat), 0);
  assert.equal(await bal('worker', B.id, mat), 15.9);
  assert.equal(Number((await pool.query('select actual_loss from settlements where custody_id=$1', [gc])).rows[0].actual_loss), 0.1);
  // الخامات لا تُحوّل
  const f = (await call('POST', '/findings', { name: 'قفل تحويل', category: 'قفل', material_id: mat })).data;
  await call('POST', `/findings/${f.id}/in`, { source: 'vault', weight: '2', pieces: '2' });
  await call('POST', '/findings/issue', { worker_id: A.id, items: [{ finding_id: f.id, pieces: 1, weight: '1' }] });
  const fc = (await pool.query('select id from custodies where finding_id=$1 and worker_id=$2', [f.id, A.id])).rows[0].id;
  assert.equal((await call('POST', `/sup/custody/${fc}/transfer`, { to_worker_id: B.id, weight: '1' })).status, 400);
});

test('قبول أحد المشرفين يُعمَّم على باقي المشرفين: الإشعار يُعلَّم بمن عالجه عند الجميع', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '50', note: 'رصيد' });
  const mk = async (u, role, kind = null) => {
    const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, must_change_password) values ($1,$2,$1,$3,$1,false) returning id", [u, hashPassword('Nt#2026xx'), role])).rows[0].id;
    let ck = ''; const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'Nt#2026xx' }); void kind; return { id, go };
  };
  const S1 = await mk('ntsup1', 'supervisor'), S2 = await mk('ntsup2', 'supervisor'), Wk = await mk('ntwrk', 'worker');
  await call('POST', '/inventory/gold/to-worker', { worker_id: Wk.id, material_id: mat, weight: '10', purpose: 'لحام', loss_rate_percent: '0' });
  const c = (await Wk.go('GET', '/w/tasks')).data.custodies[0];
  await Wk.go('POST', `/w/custody/${c.id}/ack`, {});
  const rq = (await Wk.go('POST', `/w/custody/${c.id}/return-request`, { weight: '2' })).data;
  const notif = async (S) => (await S.go('GET', '/notifications')).data.find((n) => n.ref === `return_request:${rq.id}`);
  const n1 = await notif(S1), n2 = await notif(S2);
  assert.ok(n1 && n2 && !n2.read_at && !n2.resolved_at, 'وصل للمشرفَين');
  // المشرف الأول يؤكد ← يُعلَّم عند الثاني
  assert.equal((await S1.go('POST', `/sup/return-requests/${rq.id}/accept`, { weight: '2' })).status, 200);
  const n2b = await notif(S2);
  assert.ok(n2b.resolved_at && n2b.read_at, 'عولج ومقروء عند الثاني');
  assert.match(n2b.resolved_note, /ntsup1/);
  assert.equal((await S2.go('GET', '/sup/return-requests')).data.filter((x) => x.id === rq.id).length, 0, 'اختفى من قائمة الثاني');
  assert.equal((await S2.go('POST', `/sup/return-requests/${rq.id}/accept`, {})).status, 409);
  // إنهاء المرحلة ← الاستلام يعالج الإشعار عند الجميع
  await Wk.go('POST', `/w/custody/${c.id}/start`, {});
  await Wk.go('POST', `/w/custody/${c.id}/finish`, {});
  assert.ok(!(await S2.go('GET', '/notifications')).data.find((n) => n.ref === `custody_finish:${c.id}`).resolved_at);
  assert.equal((await S1.go('POST', '/sup/receive', { worker_id: Wk.id, items: [{ custody_id: c.id, returned_weight: '8' }] })).status, 200);
  const fin = (await S2.go('GET', '/notifications')).data.find((n) => n.ref === `custody_finish:${c.id}`);
  assert.ok(fin.resolved_at); assert.match(fin.resolved_note, /استلمه ntsup1/);
});
