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
// عجز الشهر المعلق في حساب العامل (لم يُثبَّت بإقفال الشهر)
const heldOf = async (w, mat) => n((await pool.query(`select coalesce(sum(st.actual_loss - coalesce(st.recovered_weight,0)),0) h from settlements st join custodies c on c.id=st.custody_id where c.worker_id=$1 and c.material_id=$2 and st.loss_held and st.loss_fixed_at is null and st.status <> 'reversed'`, [w, mat])).rows[0].h);

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
  assert.equal(await bal('worker', A.id, mat), await heldOf(A.id, mat), 'العجز يبقى في حساب العامل حتى إقفال الشهر');
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
  assert.equal(+(await bal('worker', A.id, mat) - await heldOf(A.id, mat)).toFixed(4), 11, 'عهدته + عجزه المعلق');
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
  assert.equal(await bal('worker', id, mat), await heldOf(id, mat), 'العجز يبقى في حساب العامل حتى إقفال الشهر');
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
  assert.equal(await bal('worker', w, mat), await heldOf(w, mat), 'العجز يبقى في حساب العامل حتى إقفال الشهر');
  assert.equal(await bal('order', o.id, mat), 9.9);
  // عهدة عامة: الجزء يعود للخزنة
  const v0 = await bal('vault', null, mat);
  const g = await call('POST', '/inventory/gold/to-worker', { worker_id: w, material_id: mat, weight: '5', purpose: 'لحام', loss_rate_percent: '0' });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const gc = (await pool.query("select id from custodies where worker_id=$1 and kind='general' and status='open'", [w])).rows[0].id;
  assert.equal((await call('POST', `/sup/custody/${gc}/partial-return`, { weight: '2' })).status, 200);
  assert.equal(await bal('vault', null, mat), v0 - 3);
  assert.equal(+(await bal('worker', w, mat) - await heldOf(w, mat)).toFixed(4), 3);
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
  assert.equal(await bal('worker', w, mat), await heldOf(w, mat), 'العجز يبقى في حساب العامل حتى إقفال الشهر');
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
  assert.equal(await bal('worker', w, mat), await heldOf(w, mat), 'العجز يبقى في حساب العامل حتى إقفال الشهر');
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
  assert.equal(await bal('worker', A.id, mat), await heldOf(A.id, mat), 'العجز يبقى في حساب العامل حتى إقفال الشهر');
  assert.equal(await bal('worker', B.id, mat), 15.9);
  assert.equal(Number((await pool.query('select actual_loss from settlements where custody_id=$1', [gc])).rows[0].actual_loss), 0.1);
  // الخامات لا تُحوّل
  const f = (await call('POST', '/findings', { name: 'قفل تحويل', category: 'قفل', material_id: mat })).data;
  await call('POST', `/findings/${f.id}/in`, { source: 'vault', weight: '2', pieces: '2' });
  await call('POST', '/findings/issue', { worker_id: A.id, items: [{ finding_id: f.id, pieces: 1, weight: '1' }] });
  const fc = (await pool.query('select id from custodies where finding_id=$1 and worker_id=$2', [f.id, A.id])).rows[0].id;
  assert.equal((await call('POST', `/sup/custody/${fc}/transfer`, { to_worker_id: B.id, weight: '1' })).status, 400);
});

test('تحويل جزء من العهدة لعامل آخر: ينتقل الجزء فقط ويبقى الباقي لدى المرسل بلا عجز، وتحويل الكل بوزن ناقص كثيراً يُمنع', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '200', note: 'رصيد' });
  const mkW = async (u) => { const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ($1,$2,$1,'worker',$1) returning id", [u, hashPassword('Ss#2026xx')])).rows[0].id; let ck = '';
    const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'Ss#2026xx' }); return { id, go }; };
  const A = await mkW('ptA'), B = await mkW('ptB');
  // عهدة عامة 20 جم: تحويل 3.24 جزءاً
  await call('POST', '/inventory/gold/to-worker', { worker_id: A.id, material_id: mat, weight: '20', purpose: 'لحام', loss_rate_percent: '0' });
  const gc = (await pool.query("select id from custodies where worker_id=$1 and kind='general' and status='open'", [A.id])).rows[0].id;
  await A.go('POST', `/w/custody/${gc}/ack`, {});
  const full = await A.go('POST', `/w/custody/${gc}/transfer`, { to_worker_id: B.id, weight: '3.24' });
  assert.equal(full.status, 400, 'تحويل الكل بوزن أقل بكثير من العهدة يُمنع (كان يُحسب الباقي عجزاً)');
  assert.match(full.data.error, /جزء من العهدة/);
  assert.equal((await A.go('POST', `/w/custody/${gc}/transfer`, { to_worker_id: B.id, weight: '20', portion: 'part' })).status, 400, 'الجزء أقل من الكل');
  const tr = await A.go('POST', `/w/custody/${gc}/transfer`, { to_worker_id: B.id, weight: '3.24', portion: 'part' });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  assert.equal((await B.go('GET', '/w/transfers')).data.incoming.find((x) => x.id === tr.data.id).portion, 'part');
  const ac = await B.go('POST', `/w/transfers/${tr.data.id}/accept`, { weight: '3.24' });
  assert.equal(ac.status, 200, JSON.stringify(ac.data));
  const g1 = (await pool.query('select status, (weight_issued-weight_used)::float r from custodies where id=$1', [gc])).rows[0];
  assert.deepEqual([g1.status, g1.r], ['open', 16.76], 'الباقي يبقى مفتوحاً لدى المرسل');
  assert.equal((await pool.query('select count(*)::int n from settlements where custody_id=$1', [gc])).rows[0].n, 0, 'لا تسوية ولا عجز');
  assert.equal(await bal('worker', A.id, mat), 16.76);
  assert.equal(await bal('worker', B.id, mat), 3.24);
  const g2 = (await pool.query("select kind, purpose, weight_issued::float w, worker_ack_at from custodies where id=$1", [ac.data.custody_id])).rows[0];
  assert.deepEqual([g2.kind, g2.purpose, g2.w, !!g2.worker_ack_at], ['general', 'لحام', 3.24, true]);
  // عهدة طلب: الجزء يبقى في نفس المرحلة حتى لو طُلبت التالية
  const o = (await call('POST', '/orders', { title: 'خاتم جزء', product_type: 'خاتم', karat: 18, quantity: 1, material_id: mat })).data;
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  const st = (await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s;
  const c = (await call('POST', '/sup/issue', { worker_id: A.id, items: [{ order_id: o.id, weight: '10' }] })).data.custodies[0];
  await A.go('POST', `/w/custody/${c.id}/ack`, {});
  const t2 = await A.go('POST', `/w/custody/${c.id}/transfer`, { to_worker_id: B.id, weight: '4', portion: 'part', mode: 'next_stage' });
  assert.equal(t2.status, 200, JSON.stringify(t2.data));
  assert.equal((await B.go('POST', `/w/transfers/${t2.data.id}/accept`, { weight: '10' })).status, 409, 'المؤكد لا يساوي الكل في تحويل الجزء');
  const a2 = await B.go('POST', `/w/transfers/${t2.data.id}/accept`, { weight: '4' });
  assert.equal(a2.status, 200, JSON.stringify(a2.data));
  assert.equal((await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s, st, 'الطلب بقي في مرحلته');
  const c1 = (await pool.query('select status, (weight_issued-weight_used)::float r from custodies where id=$1', [c.id])).rows[0];
  assert.deepEqual([c1.status, c1.r], ['open', 6]);
  const c2 = (await pool.query('select order_id, stage_id, weight_issued::float w from custodies where id=$1', [a2.data.custody_id])).rows[0];
  assert.deepEqual([c2.order_id, c2.stage_id, c2.w], [o.id, st, 4]);
  assert.equal(await bal('worker', A.id, mat), 22.76);
  assert.equal(await bal('worker', B.id, mat), 7.24);
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

test('ترتيب العمال والمكائن ثابت حسب الرقم في التسليم والاستلام والمتابعة (لا يتغير مع العهد)', async () => {
  const mk = (u, no, kind = 'person') => pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, kind) values ($1,$2,$1,'worker',$3,$4) returning id", [u, hashPassword('Ss#2026xx'), no, kind]);
  await mk('ord10', '9010'); await mk('ord2', '9002'); await mk('ordM', 'M9005', 'machine');
  const nos = (await call('GET', '/sup/workers')).data.map((w) => w.employee_no).filter((n) => ['9010', '9002', 'M9005'].includes(n));
  assert.deepEqual(nos, ['9002', 'M9005', '9010'], 'ترتيب رقمي (2 قبل 10) والمكينة في مكان رقمها');
  const all = (await call('GET', '/sup/workers')).data.map((w) => w.id);
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '5', note: 'رصيد' });
  const last = all[all.length - 1];
  await call('POST', '/inventory/gold/to-worker', { worker_id: last, material_id: mat, weight: '1', purpose: 'x', loss_rate_percent: '0' });
  assert.deepEqual((await call('GET', '/sup/workers')).data.map((w) => w.id), all, 'العهدة لا تغير مكان العامل');
});

test('نقل الطلب لمرحلة تتطلب تسليم واستلام: رسالة توضيحية ثم الموافقة تنقله بنفس وزن الذهب', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '50', note: 'رصيد' });
  const o = (await call('POST', '/orders', { title: 'نقل بنفس الوزن', product_type: 'خاتم', karat: 18, quantity: 1, material_id: mat })).data;
  for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  const st = (await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s;
  await pool.query('update stages set requires_weight=true where id=$1', [st]);
  const before = await bal('order', o.id, mat);
  const r1 = await call('POST', `/orders/${o.id}/advance`, {});
  assert.equal(r1.status, 409);
  assert.equal(r1.data.details?.needs_gold, true, 'الخادم يطلب التأكيد');
  const r2 = await call('POST', `/orders/${o.id}/advance`, { skip_gold: true });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.notEqual((await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s, st, 'انتقل للمرحلة التالية');
  assert.equal(await bal('order', o.id, mat), before, 'بنفس وزن الذهب');
  const log = (await pool.query("select note as reason from order_stage_log where order_id=$1 and stage_id=$2 and event='completed' order by id desc limit 1", [o.id, st])).rows[0];
  assert.match(log.reason, /بنفس وزن الذهب/);
});

test('إلغاء ذهب مستلم من العميل سُجّل بالخطأ: حركة عكسية للمدير بسبب، ثم تسجيل الوزن الصحيح', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0].id;
  const cust = (await pool.query('select id from customers limit 1')).rows[0]?.id;
  const o = (await call('POST', '/orders', { title: 'ذهب العميل', product_type: 'خاتم', karat: 18, quantity: 1, material_id: mat, ...(cust ? { customer_id: cust } : {}) })).data;
  for (let i = 0; i < 3 && (await pool.query('select status from orders where id=$1', [o.id])).rows[0].status !== 'in_production'; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
  await pool.query("update orders set status='in_production' where id=$1 and status not in ('in_production')", [o.id]);
  assert.equal((await call('POST', `/orders/${o.id}/allocate`, { source: 'customer', weight: '50', note: 'خطأ' })).status, 200);
  const d = (await call('GET', `/orders/${o.id}`)).data;
  assert.equal(d.customerGold.length, 1);
  const mv = d.customerGold[0].id;
  assert.equal((await call('POST', `/orders/${o.id}/customer-gold/${mv}/reverse`, {})).status, 400, 'السبب إلزامي');
  assert.equal((await call('POST', `/orders/${o.id}/customer-gold/${mv}/reverse`, { reason: 'الوزن الصحيح 5' })).status, 200);
  assert.equal((await call('POST', `/orders/${o.id}/customer-gold/${mv}/reverse`, { reason: 'x' })).status, 409, 'لا يُلغى مرتين');
  assert.equal(await bal('order', o.id, mat), 0);
  await call('POST', `/orders/${o.id}/allocate`, { source: 'customer', weight: '5' });
  assert.equal(await bal('order', o.id, mat), 5);
  assert.equal((await call('GET', `/orders/${o.id}`)).data.customerGold.length, 1);
});

test('طلب متعدد المنتجات من شاشتنا: رقم واحد وبنود، بيانات مشتركة، ومنتج واحد يبقى طلباً عادياً', async () => {
  const r = await call('POST', '/orders/multi', { due_date: '2030-01-15', items: [
    { title: 'خاتم متعدد', product_type: 'خاتم', karat: '18', quantity: '2', approx_weight: '4' },
    { title: 'حلق متعدد', product_type: 'حلق', karat: '21', quantity: '1' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.orders.length, 2);
  const rows = (await pool.query('select order_no, cart_ref, status, title, quantity, to_char(due_date, \'YYYY-MM-DD\') d from orders where id = any($1::int[]) order by id', [r.data.orders.map((o) => o.id)])).rows;
  assert.deepEqual(rows.map((x) => x.order_no), [`${r.data.cart_ref}-1`, `${r.data.cart_ref}-2`]);
  assert.ok(rows.every((x) => x.cart_ref === r.data.cart_ref && x.status === 'in_production' && x.d === '2030-01-15'));
  assert.deepEqual(rows.map((x) => [x.title, x.quantity]), [['خاتم متعدد', 2], ['حلق متعدد', 1]]);
  const d = (await call('GET', `/orders/${r.data.orders[1].id}`)).data;
  assert.equal(d.siblings.length, 2, 'البنود تظهر معاً في صفحة الطلب');
  const one = await call('POST', '/orders/multi', { items: [{ title: 'منتج واحد', product_type: 'خاتم', karat: '21' }] });
  assert.equal(one.data.cart_ref, null);
  assert.equal((await pool.query('select cart_ref from orders where id=$1', [one.data.orders[0].id])).rows[0].cart_ref, null);
  const bad = await call('POST', '/orders/multi', { items: [{ title: 'سليم', karat: '21' }, { title: 'خطأ', karat: '21', quantity: '0' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /^المنتج 2:/);
  assert.equal((await pool.query("select count(*)::int n from orders where title='سليم'")).rows[0].n, 0, 'لا يُنشأ شيء عند خطأ في أي منتج');
  assert.equal((await call('POST', '/orders/multi', { items: [] })).status, 400);
});

test('مدير المبيعات: يضيف للسلة ويختار العميل والفرع، والطلب يُسجل باسم العميل ويصله إشعار', async () => {
  const cust = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('محل المبيعات','أبو علي','0551112222','approved') returning id")).rows[0].id;
  const br = (await pool.query("insert into customer_branches(customer_id, name) values ($1,'فرع العليا') returning id", [cust])).rows[0].id;
  const cu = (await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id) values ('sales_cust',$1,'محل المبيعات','customer',$2) returning id", [hashPassword('Ss#2026xx'), cust])).rows[0].id;
  const other = (await pool.query("insert into customers(shop_name, status) values ('محل غير معتمد','pending') returning id")).rows[0].id;
  const p = (await pool.query("insert into products(sku, name, product_type, karats, colors, approx_weight, active) values ('SLS-1','خاتم مبيعات','خاتم','{21}','{yellow}',3,true) returning id")).rows[0].id;
  const pOnly = (await pool.query("insert into products(sku, name, product_type, karats, colors, approx_weight, active, allowed_customer_ids) values ('SLS-2','خاص بعميل آخر','خاتم','{21}','{yellow}',3,true,$1) returning id", [[other]])).rows[0].id;
  // حساب مدير المبيعات
  await pool.query("insert into users(username, password_hash, full_name, role_code) values ('sales1',$1,'سالم المبيعات','sales_manager')", [hashPassword('Ss#2026xx')]);
  let ck = '';
  const S = async (m, path, body) => { const r = await fetch(base + '/api' + path, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await S('POST', '/auth/login', { username: 'sales1', password: 'Ss#2026xx' });
  const list = (await S('GET', '/sales/customers')).data;
  const row = list.find((c) => c.id === cust);
  assert.ok(row && row.branches.some((b) => b.id === br), 'العملاء المعتمدون مع فروعهم');
  assert.ok(!list.some((c) => c.id === other), 'غير المعتمد لا يظهر');
  const items = [{ product_id: p, karat: 21, color: 'yellow', quantity: 5 }];
  assert.equal((await S('POST', '/sales/orders', { customer_id: other, items })).status, 400, 'عميل غير معتمد');
  assert.equal((await S('POST', '/sales/orders', { customer_id: cust, items: [{ product_id: pOnly, karat: 21, quantity: 5 }] })).status, 400, 'منتج غير مسموح لهذا العميل');
  assert.equal((await S('POST', '/store/orders', { items })).status, 403, 'لا يطلب كعميل مباشرة');
  const r = await S('POST', '/sales/orders', { customer_id: cust, branch_id: br, items });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const o = (await pool.query('select customer_id, branch_id, created_by, status, source from orders where id=$1', [r.data.orders[0].id])).rows[0];
  const seller = (await pool.query("select id from users where username='sales1'")).rows[0].id;
  assert.deepEqual([o.customer_id, o.branch_id, o.created_by, o.status, o.source], [cust, br, seller, 'pending_review', 'store_catalog']);
  const n = (await pool.query("select title from notifications where user_id=$1 order by id desc limit 1", [cu])).rows[0];
  assert.match(n.title, /سالم المبيعات/);
  // موظف بدون الصلاحية
  ck = '';
  await pool.query("insert into users(username, password_hash, full_name, role_code) values ('sup_nosales',$1,'مشرف','supervisor')", [hashPassword('Ss#2026xx')]);
  await S('POST', '/auth/login', { username: 'sup_nosales', password: 'Ss#2026xx' });
  assert.equal((await S('GET', '/sales/customers')).status, 403);
});

test('المطابقة اليومية تحت الصب: القائم − الأكياس − المعالق − العلب − وزن آخر = الباقي، بأوزان قابلة للتعديل', async () => {
  const r = await call('POST', '/casting/daily', { gross: '100', bags: '4', spoons: '2', boxes_weight: '10.5', other_weight: '1', other_note: 'ورق' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(Number(r.data.net), +(100 - 4 * 0.383 - 2 * 0.75 - 10.5 - 1).toFixed(3));
  const r2 = await call('POST', '/casting/daily', { gross: '50', bags: '2', bag_weight: '0.4', spoons: '1', spoon_weight: '0.8' });
  assert.equal(Number(r2.data.net), +(50 - 0.8 - 0.8).toFixed(3));
  const d = (await call('GET', '/casting/daily')).data;
  assert.equal(d.rows.length, 2);
  assert.deepEqual([Number(d.defaults.bag_weight), Number(d.defaults.spoon_weight)], [0.4, 0.8], 'آخر وزن مستخدم يصبح الافتراضي');
  assert.equal((await call('POST', '/casting/daily', { gross: '1', bags: '10' })).status, 400, 'الخصومات أكبر من القائم');
  assert.equal((await call('POST', '/casting/daily', { gross: '' })).status, 400);
  assert.equal((await call('POST', '/casting/daily', { gross: '5', bags: '1.5' })).status, 400, 'عدد الأكياس صحيح');
  assert.equal((await call('DELETE', `/casting/daily/${r.data.id}`)).status, 200);
  assert.equal((await call('GET', '/casting/daily')).data.rows.length, 1);
});

test('تخفيض ذهب الطلب المسجل بالزيادة: يرجع للخزنة بسبب إلزامي ولا يتجاوز رصيد الطلب', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '200', note: 'رصيد' });
  const o = (await call('POST', '/orders', { title: 'تخفيض', product_type: 'خاتم', karat: 18, material_id: mat })).data;
  await call('POST', `/orders/${o.id}/allocate`, { source: 'vault', weight: '99.44' });
  const v0 = await bal('vault', null, mat);
  assert.equal((await call('POST', `/orders/${o.id}/deallocate`, { weight: '50' })).status, 400, 'السبب إلزامي');
  assert.equal((await call('POST', `/orders/${o.id}/deallocate`, { weight: '100', note: 'x' })).status, 400, 'أكثر من رصيد الطلب');
  assert.equal((await call('POST', `/orders/${o.id}/deallocate`, { weight: '89.44', note: 'سُجل أكثر من الفعلي' })).status, 200);
  assert.equal(await bal('order', o.id, mat), 10);
  assert.equal(await bal('vault', null, mat), v0 + 89.44);
  const log = (await pool.query("select note from order_stage_log where order_id=$1 and event='note' order by id desc limit 1", [o.id])).rows[0].note;
  assert.match(log, /تخفيض ذهب الطلب 89.44/);
});

test('العجز يبقى في حساب العامل حتى إقفال الشهر: الزيادة تُسحب من عهده الأخرى ثم من عجزه المعلق، والإقفال يثبّت العجز عليه', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '500', note: 'رصيد' });
  const w = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('heldW',$1,'عامل المعلق','worker','HW1') returning id", [hashPassword('Ss#2026xx')])).rows[0].id;
  const mk = async (t) => {
    const o = (await call('POST', '/orders', { title: t, product_type: 'خاتم', karat: 21, material_id: mat })).data;
    for (let i = 0; i < 8 && !(await pool.query('select s.handles_gold h from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0].h; i++) await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'x' });
    await call('POST', `/admin/stages/${(await pool.query('select current_stage_id s from orders where id=$1', [o.id])).rows[0].s}/rate`, { rate_percent: '0', note: 'x' });
    return (await call('POST', '/sup/issue', { worker_id: w, items: [{ order_id: o.id, weight: '10' }] })).data.custodies[0];
  };
  const recon = async () => (await call('GET', '/inventory/reconciliation')).data.ok;
  // 1) عجز 1 جم: يبقى في رصيد العامل
  const c1 = await mk('معلق 1');
  const r1 = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c1.id, returned_weight: '9' }] });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.results[0].settlement.status, 'approved');
  assert.equal(await bal('worker', w, mat), 1, 'العجز لم يخرج من حسابه');
  assert.equal(await bal('loss_abnormal', null, mat) >= 0, true);
  assert.equal(await recon(), true, 'المطابقة سليمة مع العجز المعلق');
  // 2) زيادة 0.4 بدون عهدة أخرى: تُغطى من عجزه المعلق بلا مراجعة
  const c2 = await mk('معلق 2');
  const r2 = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c2.id, returned_weight: '10.4' }] });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.results[0].settlement.status, 'approved', 'لا مراجعة');
  assert.equal(Number(r2.data.results[0].settlement.held_offset), 0.4);
  assert.equal(await bal('worker', w, mat), 0.6);
  // 3) زيادة 0.5 مع عهدة عامة 2 جم: تُسحب من العهدة العامة أولاً
  await call('POST', '/inventory/gold/to-worker', { worker_id: w, material_id: mat, weight: '2', purpose: 'إضافات', loss_rate_percent: '0' });
  const c3 = await mk('معلق 3');
  const r3 = await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c3.id, returned_weight: '10.5' }] });
  assert.equal(r3.status, 200, JSON.stringify(r3.data));
  assert.equal(Number(r3.data.results[0].settlement.held_offset), 0);
  const g = (await pool.query("select (weight_issued - weight_used)::float l from custodies where worker_id=$1 and kind='general' and status='open'", [w])).rows[0];
  assert.equal(g.l, 1.5, 'خُصمت الزيادة من العهدة العامة');
  assert.equal(await bal('worker', w, mat), 2.1, 'عامة 1.5 + عجز معلق 0.6');
  // 4) زيادة أكبر من كل ما لديه: مراجعة كما كانت
  const c4 = await mk('معلق 4');
  assert.equal((await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c4.id, returned_weight: '13' }] })).status, 400, 'تحتاج ملاحظة ومراجعة');
  await call('POST', '/sup/receive', { worker_id: w, items: [{ custody_id: c4.id, returned_weight: '10' }] });
  // ملخص العجز الشهري: 1 − 0.4 = 0.6
  const month = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
  const la = (await call('GET', `/admin/loss-advances?month=${month}`)).data;
  const h = la.held.find((x) => x.worker_id === w);
  assert.equal(Number(h.held), 0.6);
  assert.equal(Number(la.workers.find((x) => x.worker_id === w).charged), 0.6, 'على حسابه في الشهر');
  // 5) إقفال الشهر: يثبّت العجز ويخرج من رصيده
  const lossAb0 = await bal('loss_abnormal', null, mat);
  const fx = await call('POST', '/admin/loss-advances/fix', { month, worker_id: w });
  assert.equal(fx.status, 200, JSON.stringify(fx.data));
  assert.equal(await bal('worker', w, mat), 1.5, 'بقيت العهدة العامة فقط');
  assert.equal(+(await bal('loss_abnormal', null, mat) - lossAb0).toFixed(4), 0.6, 'ثُبّت غير طبيعي (المسموح 0%)');
  assert.equal(await recon(), true);
  assert.equal((await call('POST', `/sup/settlements/${r1.data.results[0].settlement.id}/reverse`, { reason: 'x' })).status, 409, 'لا تصحيح بعد التثبيت');
  assert.equal((await call('GET', `/admin/loss-advances?month=${month}`)).data.held.filter((x) => x.worker_id === w).length, 0);
  const cl = (await call('GET', `/admin/loss-advances?month=${month}`)).data.closings.find((x) => x.worker_id === w);
  assert.equal(Number(cl.abnormal), 0.6);
});

test('فريق 3D: أي طلب يعرض كل منتجاته بكل صورها، ويضيف صور/ملفات 3D على كل منتج (لا تظهر للعميل)', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0].id;
  const r = await call('POST', '/orders/multi', { items: [{ title: 'عقد 1', product_type: 'عقد', karat: '18' }, { title: 'عقد 2', product_type: 'عقد', karat: '18' }] });
  const [a, b] = r.data.orders;
  const mkUser = async (u, spec) => { await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ($1,$2,$1,'worker',$1,$3)", [u, hashPassword('D3d#2026xx'), spec]); let ck = '';
    const go = async (m, p, body, form) => { const res = await fetch(base + '/api' + p, { method: m, headers: form ? { cookie: ck } : { cookie: ck, 'content-type': 'application/json' }, body: form || (body ? JSON.stringify(body) : undefined) }); const sc = res.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: res.status, data: await res.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'D3d#2026xx' }); return go; };
  const d3 = await mkUser('d3all', 'ثري دي');
  const tw = await mkUser('d3not', 'تلميع');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('files', new Blob([PNG], { type: 'image/png' }), 'render.png'); fd.append('files', new Blob(['solid x\nendsolid x\n'], { type: 'model/stl' }), 'ring.stl');
  const up = await d3('POST', `/w/orders/${b.id}/3d-files`, null, fd);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const v = (await d3('GET', `/w/orders/${a.id}`)).data;
  assert.equal(v.items3d.length, 2, 'كل منتجات الطلب');
  const it = v.items3d.find((x) => x.id === b.id);
  assert.deepEqual(it.files.map((f) => f.kind).sort(), ['model3d', 'model3d']);
  assert.equal((await pool.query("select count(*)::int n from order_files where order_id=$1 and kind='model3d' and not customer_visible", [b.id])).rows[0].n, 2, 'لا تظهر للعميل');
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d`, { needs_design: true, needs_print: false })).status, 200);
  assert.equal((await d3('GET', `/w/orders/${a.id}`)).data.items3d.find((x) => x.id === b.id).needs_3d_design, true);
  // غير فريق 3D
  const fd2 = new FormData(); fd2.append('files', new Blob([PNG], { type: 'image/png' }), 'x.png');
  assert.equal((await tw('POST', `/w/orders/${b.id}/3d-files`, null, fd2)).status, 403);
  assert.equal((await tw('GET', `/w/orders/${a.id}`)).status, 403);
  void mat;
});

test('فريق 3D: صفحة التصاميم وصفحة الطباعة لكل منتج على حدة (وليس الطلب كاملاً)', async () => {
  const r = await call('POST', '/orders/multi', { items: [{ title: 'خاتم أ', product_type: 'خاتم', karat: '18' }, { title: 'حلق ب', product_type: 'حلق', karat: '18' }, { title: 'عقد ج', product_type: 'عقد', karat: '18' }] });
  const [a, b, c] = r.data.orders;
  const mkUser = async (u, spec) => { await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ($1,$2,$1,'worker',$1,$3)", [u, hashPassword('D3d#2026xx'), spec]); let ck = '';
    const go = async (m, p, body, form) => { const res = await fetch(base + '/api' + p, { method: m, headers: form ? { cookie: ck } : { cookie: ck, 'content-type': 'application/json' }, body: form || (body ? JSON.stringify(body) : undefined) }); const sc = res.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: res.status, data: await res.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'D3d#2026xx' }); return go; };
  const d3 = await mkUser('d3dp', 'ثري دي');
  await d3('POST', `/w/orders/${b.id}/3d`, { needs_design: true, needs_print: true });
  await d3('POST', `/w/orders/${c.id}/3d`, { needs_design: false, needs_print: true });
  const des = (await d3('GET', '/w/3d/design')).data.map((x) => x.id);
  assert.ok(des.includes(b.id) && !des.includes(a.id) && !des.includes(c.id), 'المنتج المحدد للتصميم فقط');
  const pr = (await d3('GET', '/w/3d/print')).data.map((x) => x.id);
  assert.ok(pr.includes(b.id) && pr.includes(c.id) && !pr.includes(a.id), 'كل منتج للطباعة وحده');
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d-done`, { kind: 'design' })).status, 400, 'ارفع ملف التصميم أولاً');
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d-done`, { kind: 'print' })).status, 400, 'الطباعة بعد التصميم');
  assert.equal((await d3('POST', `/w/orders/${c.id}/3d-done`, { kind: 'print' })).status, 200, 'طباعة منتج لا يحتاج تصميم');
  const fd = new FormData(); fd.append('files', new Blob(['solid x\nendsolid x\n'], { type: 'model/stl' }), 'b.stl');
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d-files`, null, fd)).status, 200);
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d-done`, { kind: 'design' })).status, 200);
  assert.ok(!(await d3('GET', '/w/3d/design')).data.some((x) => x.id === b.id), 'خرج من الحالية');
  assert.ok((await d3('GET', '/w/3d/design?done=1')).data.some((x) => x.id === b.id && x.design_by_name === 'd3dp'), 'في المنجزة');
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d-done`, { kind: 'print' })).status, 200);
  const st = (await pool.query('select d3_design_done_at is not null d, d3_print_done_at is not null p from orders where id=$1', [b.id])).rows[0];
  assert.deepEqual([st.d, st.p], [true, true]);
  assert.equal((await pool.query('select count(*)::int n from orders where id=$1 and d3_print_done_at is not null', [a.id])).rows[0].n, 0, 'بقية منتجات الطلب لم تتأثر');
  assert.equal((await d3('POST', `/w/orders/${b.id}/3d-done`, { kind: 'print', undo: true })).status, 200, 'تراجع');
  const tw = await mkUser('d3no', 'تلميع');
  assert.equal((await tw('GET', '/w/3d/design')).status, 403);
  assert.equal((await tw('POST', `/w/orders/${c.id}/3d-done`, { kind: 'print' })).status, 403);
});

test('أولوية كل منتج (ليس مستعجلاً/مستعجل/مستعجل جداً) ترتب قوائم 3D، وباركود واحد للطلب كاملاً يطبعه فريق 3D', async () => {
  const r = await call('POST', '/orders/multi', { items: [{ title: 'أ', product_type: 'خاتم', karat: '18' }, { title: 'ب', product_type: 'حلق', karat: '18' }] });
  const [a, b] = r.data.orders;
  assert.equal((await call('POST', `/orders/${b.id}/priority`, { priority: 2 })).status, 200);
  assert.equal((await call('POST', `/orders/${b.id}/priority`, { priority: 5 })).status, 400);
  assert.equal((await pool.query('select priority from orders where id=$1', [a.id])).rows[0].priority, 0, 'بقية المنتجات لم تتأثر');
  const mkUser = async (u, spec) => { await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no, specialty) values ($1,$2,$1,'worker',$1,$3)", [u, hashPassword('D3d#2026xx'), spec]); let ck = '';
    const go = async (m, p, body) => { const res = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = res.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: res.status, data: await res.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'D3d#2026xx' }); return go; };
  const d3 = await mkUser('d3pr', 'ثري دي');
  assert.equal((await d3('POST', `/w/orders/${a.id}/priority`, { priority: 1 })).status, 200);
  await d3('POST', `/w/orders/${a.id}/3d`, { needs_design: true, needs_print: false });
  await d3('POST', `/w/orders/${b.id}/3d`, { needs_design: true, needs_print: false });
  const des = (await d3('GET', '/w/3d/design')).data.filter((x) => [a.id, b.id].includes(x.id)).map((x) => x.id);
  assert.deepEqual(des, [b.id, a.id], 'المستعجل جداً أولاً');
  // باركود واحد للطلب كاملاً — فريق 3D يطبعه
  const lb = await d3('GET', `/orders/labels?ids=${a.id},${b.id}`);
  assert.equal(lb.status, 200);
  assert.equal(lb.data.length, 1, 'ملصق واحد للطلب');
  assert.equal(lb.data[0].qr_code, r.data.cart_ref.replace(/\D/g, ''));
  const tw = await mkUser('d3pn', 'تلميع');
  assert.equal((await tw('GET', `/orders/labels?ids=${a.id}`)).status, 403);
  assert.equal((await tw('POST', `/w/orders/${a.id}/priority`, { priority: 1 })).status, 403);
});

test('كشف حساب العامل: مدين (المسلَّم له والمحوّل إليه) ودائن (المستلم منه والمحوّل منه) والرصيد والإجمالي وتصدير Excel', async () => {
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0].id;
  await call('POST', '/inventory/gold/in', { material_id: mat, weight: '300', note: 'رصيد' });
  const mkW = async (u) => { const id = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ($1,$2,$1,'worker',$1) returning id", [u, hashPassword('Ss#2026xx')])).rows[0].id; let ck = '';
    const go = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await go('POST', '/auth/login', { username: u, password: 'Ss#2026xx' }); return { id, go }; };
  const A = await mkW('stA'), B = await mkW('stB');
  await call('POST', '/inventory/gold/to-worker', { worker_id: A.id, material_id: mat, weight: '20', purpose: 'عامة', loss_rate_percent: '0' });
  const gc = (await pool.query("select id from custodies where worker_id=$1 and kind='general' and status='open'", [A.id])).rows[0].id;
  await A.go('POST', `/w/custody/${gc}/ack`, {});
  // تحويل جزء 5 جم لـ B
  const tr = await A.go('POST', `/w/custody/${gc}/transfer`, { to_worker_id: B.id, weight: '5', portion: 'part' });
  assert.equal((await B.go('POST', `/w/transfers/${tr.data.id}/accept`, { weight: '5' })).status, 200);
  // استلام جزء 3 جم من A للخزنة
  assert.equal((await call('POST', `/sup/custody/${gc}/partial-return`, { weight: '3' })).status, 200);
  const st = (await call('GET', `/sup/workers/${A.id}/statement`)).data;
  assert.equal(Number(st.totals.debit), 20);
  assert.equal(Number(st.totals.credit), 8, '5 محوّل + 3 مستلم');
  assert.equal(Number(st.totals.balances[0].weight), 12);
  assert.equal(Number(st.totals.balance_pure), +(12 * 21 / 24).toFixed(4));
  assert.ok(st.rows.some((r) => r.credit && r.party.includes('stB')), 'الطرف في التحويل');
  assert.equal(Number(st.rows[st.rows.length - 1].balance), 12, 'الرصيد بعد آخر حركة');
  const stB = (await call('GET', `/sup/workers/${B.id}/statement`)).data;
  assert.ok(stB.rows.some((r) => r.debit && r.party.includes('stA')), 'محوّل له من عامل آخر = مدين');
  // فترة: رصيد افتتاحي
  const tomorrow = new Date(Date.now() + 86400e3 + 3 * 3600e3).toISOString().slice(0, 10);
  const stF = (await call('GET', `/sup/workers/${A.id}/statement?from=${tomorrow}`)).data;
  assert.equal(stF.rows.length, 0); assert.equal(Number(stF.opening[0].weight), 12);
  const x = await fetch(base + `/api/sup/workers/${A.id}/statement.xlsx`, { headers: { cookie } });
  assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheet/);
});
