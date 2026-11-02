// اختبار القبول: السيناريو الكامل المطلوب في شروط التسليم + اختبارات الرقابة والصلاحيات والتزامن
// يعمل على قاعدة بيانات اختبار مستقلة (DATABASE_URL_TEST)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/goldfactory-test-uploads';

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, path, body, { form } = {}) {
    const headers = { cookie: this.cookie };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  async ok(method, path, body, opts) {
    const r = await this.req(method, path, body, opts);
    if (r.status >= 400) throw new Error(`${this.name} ${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  get(p) { return this.ok('GET', p); }
  post(p, b, o) { return this.ok('POST', p, b ?? {}, o); }
  put(p, b) { return this.ok('PUT', p, b); }
  async login(username, password) { await this.ok('POST', '/api/auth/login', { username, password }); return this; }
}

const admin = new Client('admin');
const sup = new Client('supervisor');
const w1 = new Client('worker1');
const w2 = new Client('worker2');
const cust = new Client('customer');
const acct = new Client('accountant');
const ids = {};
const n = (x) => Number(x);

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await admin.login('admin', 'Admin#2026pass');
});

after(async () => {
  server?.close();
  await pool.end();
});

async function stageId(code) {
  return (await pool.query('select id from stages where code=$1', [code])).rows[0].id;
}
async function orderOf(id) { return (await admin.get(`/api/orders/${id}`)).order; }

test('0) التهيئة: موظفون، عميل، نسب عجز، مخزون، أجور', async () => {
  const mk = (u, role, extra = {}) => admin.post('/api/admin/employees', { username: u, password: 'Passw0rd!', full_name: extra.full_name || u, role_code: role, ...extra });
  ids.sup = (await mk('sup1', 'supervisor', { full_name: 'المشرف أحمد' })).id;
  ids.w1 = (await mk('w1', 'worker', { full_name: 'العامل الأول', employee_no: 'W-001' })).id;
  ids.w2 = (await mk('w2', 'worker', { full_name: 'العامل الثاني', employee_no: 'W-002' })).id;
  ids.w3 = (await mk('w3', 'worker', { full_name: 'العامل الثالث', employee_no: 'W-003' })).id;
  ids.acct = (await mk('acct', 'accountant', { full_name: 'المحاسب' })).id;
  await sup.login('sup1', 'Passw0rd!');
  await w1.login('w1', 'Passw0rd!');
  await w2.login('w2', 'Passw0rd!');
  await acct.login('acct', 'Passw0rd!');

  // تسجيل محل من المتجر ثم موافقة الإدارة
  await cust.ok('POST', '/api/auth/register-customer', { username: 'shop1', password: 'Passw0rd!', shop_name: 'محل الماسة', owner_name: 'خالد', phone: '0500000000', vat_number: '300000000000003' });
  const me = await cust.get('/api/auth/me');
  ids.customer = me.customer_id;
  const blocked = await cust.req('GET', '/api/store/products');
  assert.equal(blocked.status, 403, 'العميل غير المعتمد لا يدخل المتجر');
  await admin.put(`/api/admin/customers/${ids.customer}`, { status: 'approved' });
  await cust.login('shop1', 'Passw0rd!');

  // نسب العجز تبدأ صفراً
  const stages = await admin.get('/api/admin/stages');
  assert.ok(stages.every((s) => n(s.loss_rate) === 0), 'النسب الافتراضية صفر');
  for (const code of ['prep', 'assembly', 'setting', 'polishing', 'washing', 'qc']) await admin.post(`/api/admin/stages/${await stageId(code)}/rate`, { rate_percent: '0.1' });
  await admin.post(`/api/admin/stages/${await stageId('casting')}/rate`, { rate_percent: '0.2', note: 'نسبة الصب المعتمدة' });

  await admin.post('/api/admin/settings', {}).catch(() => {});
  await admin.put('/api/admin/settings', { company: { name: 'مصنع الاختبار', vat_number: '310000000000003', cr_number: '1010101010', address: 'الرياض' } });
  ids.m21 = (await pool.query("select id from materials where karat=21 and color='yellow'")).rows[0].id;
  await admin.post('/api/inventory/gold/in', { material_id: ids.m21, weight: '5000', note: 'رصيد افتتاحي للخزنة' });
  await admin.post('/api/catalog/labor-rates', { name: 'أجرة افتراضية', scope: 'default', method: 'per_gram', rate: '15' });
});

test('1-16) السيناريو الكامل: من الطلب حتى التسليم وإقفال الطلب', async () => {
  // 1) طلب تصنيع جديد من المتجر (اطلب تصميمك)
  const fd = new FormData();
  fd.append('product_type', 'خاتم');
  fd.append('title', 'خاتم بتصميم خاص');
  fd.append('karat', '21');
  fd.append('color', 'yellow');
  fd.append('approx_weight', '95');
  fd.append('quantity', '1');
  fd.append('files', new Blob([Buffer.from(PNG.split(',')[1], 'base64')], { type: 'image/png' }), 'ref.png');
  const created = await cust.post('/api/store/custom', undefined, { form: fd });
  ids.order = created.id;
  await admin.post(`/api/orders/${ids.order}/quote`, { labor_method: 'per_gram', labor_rate: '15', note: 'أجور تصنيع فقط' });
  const q = await cust.get(`/api/store/orders/${ids.order}`);
  assert.equal(q.order.status, 'quoted');
  await cust.post(`/api/store/orders/${ids.order}/quote`, { decision: 'accept' });
  let o = await orderOf(ids.order);
  assert.equal(o.status, 'in_production');
  assert.equal(o.stage_name, 'استلام الطلب');

  // مراحل ما قبل الذهب: استلام -> مراجعة -> تصميم 3D
  await sup.post(`/api/orders/${ids.order}/advance`);
  await sup.post(`/api/orders/${ids.order}/advance`);
  o = await orderOf(ids.order);
  assert.equal(o.stage_name, 'التصميم 3D');
  // لا يمكن الصب قبل اعتماد التصميم
  const early = await sup.req('POST', '/api/sup/issue', { worker_id: ids.w1, items: [{ order_id: ids.order, weight: '10', stage_id: await stageId('casting') }] });
  assert.equal(early.status, 409, 'منع الصب قبل اعتماد التصميم');
  await sup.post(`/api/orders/${ids.order}/assign`, { worker_id: ids.w1 });
  const dfd = new FormData();
  dfd.append('kind', 'design');
  dfd.append('files', new Blob([Buffer.from(PNG.split(',')[1], 'base64')], { type: 'image/png' }), 'design.png');
  await w1.post(`/api/w/orders/${ids.order}/files`, undefined, { form: dfd });
  const files = (await admin.get(`/api/orders/${ids.order}`)).files.filter((f) => f.kind === 'design');
  await admin.post(`/api/orders/${ids.order}/design/send`, { file_ids: files.map((f) => f.id), message: 'يرجى الاعتماد' });
  await w1.post(`/api/w/orders/${ids.order}/finish`);
  o = await orderOf(ids.order);
  assert.equal(o.stage_name, 'اعتماد التصميم من العميل');
  const blockedAdv = await sup.req('POST', `/api/orders/${ids.order}/advance`);
  assert.equal(blockedAdv.status, 409, 'لا تقدم قبل اعتماد العميل');
  await cust.post(`/api/store/orders/${ids.order}/design`, { decision: 'approved' });
  await sup.post(`/api/orders/${ids.order}/advance`);
  o = await orderOf(ids.order);
  assert.equal(o.stage_name, 'تجهيز الذهب والألماس');

  // 2) تسجيل 100 جرام ذهب على الطلب
  await sup.post(`/api/orders/${ids.order}/allocate`, { weight: '100', source: 'vault' });
  // مرحلة التجهيز: تسليم واستلام بلا عجز
  let iss = await sup.post('/api/sup/issue', { worker_id: ids.w1, items: [{ order_id: ids.order, weight: '100' }], signature: PNG });
  let cid = iss.custodies[0].id;
  await sup.post('/api/sup/receive', { worker_id: ids.w1, items: [{ custody_id: cid, returned_weight: '100', scrap_weight: '0' }], signature: PNG });
  o = await orderOf(ids.order);
  assert.equal(o.stage_name, 'الصب');

  // 3+4) تسليم الذهب للعامل الأول مع التوقيع
  iss = await sup.post('/api/sup/issue', { worker_id: ids.w1, items: [{ order_id: ids.order, weight: '100.000', notes: 'صب الخاتم' }], signature: PNG, idempotency_key: 'k-cast-1' });
  cid = iss.custodies[0].id;
  assert.equal(n(iss.custodies[0].weight_issued), 100);
  assert.equal(n(iss.custodies[0].loss_rate_snapshot), 0.2, 'لقطة النسبة عند بدء العمل');
  // تغيير النسبة لاحقاً لا يؤثر بأثر رجعي
  await admin.post(`/api/admin/stages/${await stageId('casting')}/rate`, { rate_percent: '0.5', note: 'تغيير لاحق' });

  // 5) العامل: يرى عهدته فقط، يبدأ مرحلة الصب
  const tasks = await w1.get('/api/w/tasks');
  assert.ok(tasks.custodies.some((c) => c.id === cid));
  assert.equal((await w2.get('/api/w/tasks')).custodies.length, 0, 'العامل الثاني لا يرى عهد غيره');
  assert.equal((await w2.req('POST', `/api/w/custody/${cid}/start`)).status, 404);
  await w1.post(`/api/w/custody/${cid}/start`);
  assert.equal((await w1.req('POST', `/api/w/custody/${cid}/pause`, {})).status, 400, 'الإيقاف يتطلب سبباً');
  await w1.post(`/api/w/custody/${cid}/pause`, { reason: 'انقطاع الكهرباء' });
  await w1.post(`/api/w/custody/${cid}/resume`);
  // 6) العامل يسجل الوزن المرتجع والبقايا وينهي المرحلة
  await w1.post(`/api/w/custody/${cid}/declare`, { returned: '99.7', scrap: '0' });
  await w1.post(`/api/w/custody/${cid}/finish`);
  assert.equal((await sup.get('/api/sup/summary')).awaiting_receive, 1);

  // 7) الحساب التلقائي
  const pv = await sup.post('/api/sup/preview', { custody_id: cid, returned_weight: '99.7', scrap_weight: '0' });
  assert.equal(n(pv.actual_loss), 0.3);
  assert.equal(n(pv.allowed_loss), 0.2);
  assert.equal(n(pv.abnormal_loss), 0.1);
  // 8) العجز غير الطبيعي يتطلب سبباً
  const noReason = await sup.req('POST', '/api/sup/receive', { worker_id: ids.w1, items: [{ custody_id: cid, returned_weight: '99.7', scrap_weight: '0' }] });
  assert.equal(noReason.status, 400);
  const rcv = await sup.post('/api/sup/receive', { worker_id: ids.w1, items: [{ custody_id: cid, returned_weight: '99.7', scrap_weight: '0', reason: 'تطاير أثناء الصب' }], signature: PNG, idempotency_key: 'r-cast-1' });
  const stl = rcv.results[0].settlement;
  assert.equal(stl.status, 'pending_review');
  assert.equal(n(stl.normal_loss), 0.2);
  assert.equal(n(stl.abnormal_loss), 0.1);
  // منع تكرار تسجيل الوزن
  const dup = await sup.req('POST', '/api/sup/receive', { worker_id: ids.w1, items: [{ custody_id: cid, returned_weight: '99.7', scrap_weight: '0', reason: 'x' }] });
  assert.equal(dup.status, 409, 'منع تكرار تسجيل الوزن');
  const dupKey = await sup.post('/api/sup/receive', { worker_id: ids.w1, items: [{ custody_id: cid, returned_weight: '99.7', scrap_weight: '0', reason: 'x' }], idempotency_key: 'r-cast-1' });
  assert.equal(dupKey.duplicate, true, 'إعادة الإرسال بنفس المفتاح لا تكرر');
  o = await orderOf(ids.order);
  assert.equal(o.stage_name, 'الصب', 'لا يتقدم الطلب قبل اعتماد العجز');
  assert.equal((await w1.req('GET', '/api/sup/reviews')).status, 403, 'العامل لا يعتمد التسويات');

  // 9) المراجعة: إحالة للتحقيق ثم نتيجة التحقيق (المسؤولية ليست تلقائية على العامل)
  await sup.post(`/api/sup/reviews/${stl.id}`, { decision: 'investigate', notes: 'مراجعة البوتقة' });
  assert.equal((await sup.req('POST', `/api/sup/reviews/${stl.id}/investigation`, { result: 'x', decision: 'no_fault' })).status, 403, 'التحقيق لمدير الإنتاج');
  await admin.post(`/api/sup/reviews/${stl.id}/investigation`, { result: 'وجد جزء في البوتقة', decision: 'no_fault', recovered_weight: '0.05' });
  // 10+11) إقفال العهدة ونقل الطلب للمرحلة التالية تلقائياً
  o = await orderOf(ids.order);
  assert.equal(o.stage_name, 'التشبيك');
  const cust1 = (await admin.get(`/api/orders/${ids.order}`)).custodies.find((c) => c.id === cid);
  assert.equal(cust1.status, 'closed');

  // 12) عهدة العامل التالي، ثم 13) بقية المراحل
  const gold = async () => n((await admin.get(`/api/orders/${ids.order}`)).gold.find((g) => g.loc_type === 'order')?.balance ?? 0);
  let bal = await gold();
  assert.equal(bal, 99.7);
  const steps = [
    ['التشبيك', ids.w2, w2, '0.05', '0.03'],
    ['تركيب الأحجار والألماس', ids.w2, w2, '0', '0'],
    ['التلميع', ids.w1, w1, '0.04', '0.02'],
    ['الغسيل', ids.w1, w1, '0', '0'],
    ['التشييك والجودة', ids.w2, w2, '0', '0'],
  ];
  for (const [stage, wid, wc, scrap, loss] of steps) {
    assert.equal((await orderOf(ids.order)).stage_name, stage);
    const r1 = await sup.post('/api/sup/issue', { worker_id: wid, items: [{ order_id: ids.order, weight: String(bal) }], signature: PNG });
    const c1 = r1.custodies[0].id;
    await wc.post(`/api/w/custody/${c1}/start`);
    const ret = (bal - n(scrap) - n(loss)).toFixed(4);
    await wc.post(`/api/w/custody/${c1}/declare`, { returned: ret, scrap });
    await wc.post(`/api/w/custody/${c1}/finish`);
    const rr = await sup.post('/api/sup/receive', { worker_id: wid, items: [{ custody_id: c1, returned_weight: ret, scrap_weight: scrap }], signature: PNG });
    assert.equal(rr.results[0].settlement.status, 'approved', `${stage}: ضمن العجز الطبيعي`);
    bal = await gold();
    assert.equal(bal.toFixed(4), n(ret).toFixed(4));
  }
  assert.equal((await orderOf(ids.order)).stage_name, 'الوزن النهائي');
  const mismatch = await sup.req('POST', `/api/orders/${ids.order}/final-weight`, { weight: '99.5' });
  assert.equal(mismatch.status, 400, 'الوزن النهائي المخالف لرصيد الطلب يتطلب سبباً');
  await sup.post(`/api/orders/${ids.order}/final-weight`, { weight: bal.toFixed(4) });
  await sup.post(`/api/orders/${ids.order}/advance`);
  assert.equal((await orderOf(ids.order)).stage_name, 'الفوترة');
  assert.equal((await sup.req('POST', `/api/orders/${ids.order}/advance`)).status, 409, 'لا تقدم قبل الفاتورة');

  // 14) فاتورة أجور التصنيع فقط
  assert.equal((await sup.req('POST', '/api/finance/invoices', { customer_id: ids.customer, order_ids: [ids.order] })).status, 403, 'المشرف لا يصدر فواتير');
  const inv = await acct.post('/api/finance/invoices', { customer_id: ids.customer, order_ids: [ids.order] });
  const invD = await acct.get(`/api/finance/invoices/${inv.id}`);
  assert.equal(invD.lines.length, 1);
  assert.equal(invD.lines[0].kind, 'labor');
  const expected = Math.round(bal * 15 * 100) / 100;
  assert.equal(n(inv.subtotal), expected, 'الأجرة = الوزن × أجرة الجرام فقط');
  assert.equal(n(inv.vat_amount), Math.round(expected * 0.15 * 100) / 100);
  assert.ok(inv.qr_tlv.length > 20, 'QR الفوترة الإلكترونية');
  assert.equal((await acct.req('POST', '/api/finance/invoices', { customer_id: ids.customer, order_ids: [ids.order] })).status, 409, 'لا فوترة مزدوجة');
  await acct.post('/api/finance/payments', { customer_id: ids.customer, invoice_id: inv.id, amount: inv.total, method: 'transfer' });

  await sup.post(`/api/orders/${ids.order}/advance`); // -> التغليف
  await sup.post(`/api/orders/${ids.order}/advance`); // -> جاهز للتسليم
  o = await orderOf(ids.order);
  assert.equal(o.status, 'ready');

  // 15) ظهور الحالة للعميل - بدون أي معلومات داخلية
  const view = await cust.get(`/api/store/orders/${ids.order}`);
  assert.equal(view.order.status, 'ready');
  assert.equal(view.order.stage_name, 'جاهز للتسليم');
  const raw = JSON.stringify(view);
  for (const w of ['العامل الأول', 'العامل الثاني', 'custody', 'loss_rate', 'abnormal', 'المشرف']) assert.ok(!raw.includes(w), `لا تظهر للعميل: ${w}`);
  assert.equal((await cust.req('GET', `/api/orders/${ids.order}`)).status, 403);
  const invs = await cust.get('/api/store/invoices');
  assert.equal(invs.length, 1);

  // 16) التسليم وإقفال الطلب
  await sup.post(`/api/orders/${ids.order}/deliver`, { note: 'استلمه المالك' });
  o = await orderOf(ids.order);
  assert.equal(o.status, 'delivered');
  assert.equal((await cust.get(`/api/store/orders/${ids.order}`)).order.progress, 100);
  const flow = (await admin.get(`/api/orders/${ids.order}`)).goldFlow;
  assert.equal(n(flow.allocated), 100);
  // 100 = المسلم للعميل + البقايا + العجز الطبيعي + غير الطبيعي
  const del = (await admin.get(`/api/orders/${ids.order}`)).gold.find((g) => g.loc_type === 'delivered');
  assert.equal((n(del.balance) + n(flow.scrap) + n(flow.recovered) + n(flow.normal_loss) + n(flow.abnormal_loss)).toFixed(4), '100.0000');
});

test('العمليات الجماعية: تسليم واستلام عدة طلبات في جلسة واحدة + كشف للطباعة', async () => {
  const orders = [];
  for (let i = 0; i < 3; i++) {
    const o = await admin.post('/api/orders', { title: `سلسال ${i + 1}`, product_type: 'سلسال', karat: 21, color: 'yellow', quantity: 2, route_id: 2 });
    orders.push(o.id);
    await sup.post(`/api/orders/${o.id}/advance`); // استلام -> مراجعة
    await sup.post(`/api/orders/${o.id}/advance`); // مراجعة -> تجهيز
  }
  const items = orders.map((id, i) => ({ order_id: id, weight: String(10 + i) }));
  const a = await sup.post('/api/sup/issue', { worker_id: ids.w3, items, signature: PNG, idempotency_key: 'batch-1' });
  assert.equal(a.custodies.length, 3);
  const again = await sup.post('/api/sup/issue', { worker_id: ids.w3, items, signature: PNG, idempotency_key: 'batch-1' });
  assert.equal(again.duplicate, true);
  const open = await sup.get(`/api/sup/workers/${ids.w3}/open`);
  assert.equal(open.length, 3, 'لا تكرار بالإرسال المزدوج');
  const sheet = await sup.get(`/api/sup/batches/${a.batch_id}`);
  assert.equal(sheet.lines.length, 3);
  assert.ok(sheet.batch.signature_path);
  // كل طلب حركة مستقلة
  const mv = await pool.query("select count(*)::int n from gold_ledger where batch_id=$1 and kind='issue'", [a.batch_id]);
  assert.equal(mv.rows[0].n, 3);
  const r = await sup.post('/api/sup/receive', {
    worker_id: ids.w3, signature: PNG,
    items: open.map((c) => ({ custody_id: c.id, returned_weight: String(n(c.weight_issued) - 0.005), scrap_weight: '0' })),
  });
  assert.equal(r.results.length, 3);
  // نسبة 0.1% من 10 = 0.01 > 0.005 => ضمن الطبيعي
  assert.ok(r.results.every((x) => x.settlement.status === 'approved'));
  assert.equal((await sup.get(`/api/sup/batches/${r.batch_id}`)).lines.length, 3);
  ids.batchOrders = orders;
});

test('منع التعديل الصامت: الحركات المعتمدة لا تعدل ولا تحذف - التصحيح بحركة عكسية', async () => {
  await assert.rejects(pool.query('update gold_ledger set weight = 1 where id = (select min(id) from gold_ledger)'), /IMMUTABLE/);
  await assert.rejects(pool.query('delete from gold_ledger where id = (select min(id) from gold_ledger)'), /IMMUTABLE/);
  await assert.rejects(pool.query("update settlements set returned_weight = 1 where id = (select min(id) from settlements)"), /IMMUTABLE/);
  await assert.rejects(pool.query('delete from audit_log'), /IMMUTABLE/);
  await assert.rejects(pool.query('update stage_loss_rates set rate_percent = 9'), /IMMUTABLE/);

  // تصحيح تسوية آخر طلب في الدفعة: عكس ثم إعادة الاستلام
  const oid = ids.batchOrders[0];
  const d = await admin.get(`/api/orders/${oid}`);
  const c = d.custodies[d.custodies.length - 1];
  assert.equal((await sup.req('POST', `/api/sup/settlements/${c.settlement_id}/reverse`, { reason: 'خطأ إدخال' })).status, 403, 'المشرف لا يصحح دون صلاحية');
  assert.equal((await admin.req('POST', `/api/sup/settlements/${c.settlement_id}/reverse`, {})).status, 400, 'السبب إلزامي');
  await admin.post(`/api/sup/settlements/${c.settlement_id}/reverse`, { reason: 'خطأ في قراءة الميزان' });
  const after1 = await admin.get(`/api/orders/${oid}`);
  assert.equal(after1.custodies.find((x) => x.id === c.id).status, 'open');
  const rev = await pool.query("select count(*)::int n from gold_ledger where kind='reversal' and settlement_id=$1", [c.settlement_id]);
  assert.ok(rev.rows[0].n >= 1);
  const audit = await admin.get(`/api/admin/audit?entity=settlement&entity_id=${c.settlement_id}`);
  assert.ok(audit.some((a) => a.action === 'settlement.reverse' && a.details.reason));
  await sup.post('/api/sup/receive', { worker_id: ids.w3, items: [{ custody_id: c.id, returned_weight: c.weight_issued, scrap_weight: '0' }] });
});

test('عشرات العمال بالتزامن دون تضارب', async () => {
  const workers = [];
  for (let i = 0; i < 40; i++) {
    workers.push((await admin.post('/api/admin/employees', { username: `bulk${i}`, password: 'Passw0rd!', full_name: `عامل ${i}`, role_code: 'worker', employee_no: `B-${i}` })).id);
  }
  const orders = [];
  for (let i = 0; i < 40; i++) {
    const o = await admin.post('/api/orders', { title: `قطعة ${i}`, product_type: 'أسورة', karat: 21, color: 'yellow', route_id: 2 });
    await admin.post(`/api/orders/${o.id}/advance`);
    await admin.post(`/api/orders/${o.id}/advance`);
    orders.push(o.id);
  }
  const vaultBefore = await pool.query("select balance from gold_balances where loc_type='vault' and material_id=$1", [ids.m21]);
  const res = await Promise.all(workers.map((wid, i) => sup.req('POST', '/api/sup/issue', { worker_id: wid, items: [{ order_id: orders[i], weight: '5.5' }], signature: PNG })));
  assert.ok(res.every((r) => r.status === 200), JSON.stringify(res.find((r) => r.status !== 200)));
  const vaultAfter = await pool.query("select balance from gold_balances where loc_type='vault' and material_id=$1", [ids.m21]);
  assert.equal((n(vaultBefore.rows[0].balance) - n(vaultAfter.rows[0].balance)).toFixed(4), (40 * 5.5).toFixed(4));
  // نفس الطلب لعاملين في نفس اللحظة: ينجح واحد على الأقل دون إفساد الأرصدة
  const list = await sup.get('/api/sup/workers');
  assert.ok(list.filter((w) => w.open_count === 1).length >= 40);
  const rcv = await Promise.all(workers.map(async (wid) => {
    const open = await sup.get(`/api/sup/workers/${wid}/open`);
    return sup.req('POST', '/api/sup/receive', { worker_id: wid, items: [{ custody_id: open[0].id, returned_weight: '5.5', scrap_weight: '0' }] });
  }));
  assert.ok(rcv.every((r) => r.status === 200));
});

test('مطابقة إجمالي الذهب بين المخزون والعهد والطلبات', async () => {
  const rec = await admin.get('/api/inventory/reconciliation');
  assert.equal(rec.ok, true, JSON.stringify(rec));
  const m = rec.perMaterial.find((x) => x.id === ids.m21);
  const inside = ['vault', 'orders', 'workers', 'scrap', 'finished', 'loss_normal', 'loss_abnormal', 'loss_suspense', 'delivered', 'variance'].reduce((s, k) => s + n(m[k]), 0);
  assert.equal(inside.toFixed(4), n(m.net_in).toFixed(4), 'المخزون + العهد + الطلبات + البقايا + الفقد + المسلم = صافي الوارد');
});

test('الصلاحيات لكل نوع مستخدم', async () => {
  const inv = new Client('inv');
  await admin.post('/api/admin/employees', { username: 'inv1', password: 'Passw0rd!', full_name: 'أمين المخزن', role_code: 'inventory_officer' });
  await inv.login('inv1', 'Passw0rd!');
  const pm = new Client('pm');
  await admin.post('/api/admin/employees', { username: 'pm1', password: 'Passw0rd!', full_name: 'مدير الإنتاج', role_code: 'production_manager' });
  await pm.login('pm1', 'Passw0rd!');
  const checks = [
    [w1, 'GET', '/api/sup/summary', 403], [w1, 'GET', '/api/admin/stats', 403], [w1, 'POST', `/api/admin/stages/${await stageId('casting')}/rate`, 403],
    [w1, 'GET', '/api/orders', 403], [w1, 'GET', '/api/finance/invoices', 403], [w1, 'GET', '/api/w/tasks', 200],
    [cust, 'GET', '/api/sup/summary', 403], [cust, 'GET', '/api/orders', 403], [cust, 'GET', '/api/w/tasks', 403], [cust, 'GET', '/api/store/orders', 200],
    [sup, 'GET', '/api/sup/summary', 200], [sup, 'GET', '/api/finance/invoices', 403], [sup, 'POST', `/api/admin/stages/${await stageId('casting')}/rate`, 403], [sup, 'GET', '/api/admin/audit', 403],
    [acct, 'POST', '/api/sup/issue', 403], [acct, 'GET', '/api/finance/invoices', 200], [acct, 'GET', '/api/admin/stats', 200],
    [inv, 'GET', '/api/inventory/gold', 200], [inv, 'POST', '/api/sup/issue', 403], [inv, 'GET', '/api/finance/invoices', 403],
    [pm, 'GET', '/api/sup/reviews', 200], [pm, 'POST', '/api/finance/invoices', 403], [pm, 'GET', '/api/admin/audit', 403],
    [admin, 'GET', '/api/admin/audit', 200], [new Client('anon'), 'GET', '/api/orders', 401],
  ];
  for (const [c, m, p, st] of checks) {
    const r = await c.req(m, p, m === 'POST' ? {} : undefined);
    assert.equal(r.status === 400 && st === 200 ? 200 : r.status, st, `${c.name} ${m} ${p}`);
  }
  // عامل يمسح QR لطلب غير مسند إليه
  const foreign = await admin.post('/api/orders', { title: 'طلب آخر', product_type: 'خاتم', karat: 21, color: 'yellow' });
  const qr = (await admin.get(`/api/orders/${foreign.id}`)).order.qr_token;
  assert.equal((await w1.req('GET', `/api/sup/lookup?code=${qr}`)).status, 403);
  assert.equal((await sup.req('GET', `/api/sup/lookup?code=${qr}`)).status, 200);
  // تخصيص الصلاحيات: منع صلاحية عن مستخدم محدد
  await admin.put(`/api/admin/employees/${ids.sup}`, { denied_perms: ['custody.issue'] });
  await sup.login('sup1', 'Passw0rd!');
  assert.equal((await sup.req('POST', '/api/sup/issue', {})).status, 403);
  await admin.put(`/api/admin/employees/${ids.sup}`, { denied_perms: [] });
});

test('المتجر: منتجات جاهزة وسلة وأجور خاصة بالعميل', async () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ sku: 'RG-100', name: 'خاتم كلاسيك', product_type: 'خاتم', karats: '18,21', colors: 'yellow,white', approx_weight: '6', sizes: '16,17,18', labor_method: 'per_gram', labor_rate: '12', availability: 'made_to_order' })) fd.append(k, v);
  const p = await admin.post('/api/catalog/products', undefined, { form: fd });
  await admin.post('/api/catalog/labor-rates', { name: 'أجرة خاصة لمحل الماسة', scope: 'customer', customer_id: ids.customer, method: 'per_gram', rate: '10' });
  const list = await cust.get('/api/store/products');
  const prod = list.products.find((x) => x.id === p.id);
  assert.equal(n(prod.labor.rate), 10, 'أجرة العميل الخاصة');
  assert.ok(!('price' in prod) && !JSON.stringify(prod).includes('gold_price'));
  const r = await cust.post('/api/store/orders', { items: [{ product_id: p.id, karat: 21, color: 'white', size: '17', quantity: 3 }] });
  assert.equal(r.orders.length, 1);
  const bad = await cust.req('POST', '/api/store/orders', { items: [{ product_id: p.id, karat: 24, color: 'white', quantity: 1 }] });
  assert.equal(bad.status, 400, 'العيار غير المتاح');
  const mine = await cust.get('/api/store/orders');
  assert.ok(mine.some((o) => o.id === r.orders[0].id));
  await admin.post(`/api/orders/${r.orders[0].id}/start`);
  assert.equal((await orderOf(r.orders[0].id)).status, 'in_production');
});

test('تقسيم طلب على عدة عمال + القبول الإلكتروني بدل التوقيع + الرفض', async () => {
  const o = await admin.post('/api/orders', { title: 'طقم للتقسيم', product_type: 'طقم', karat: 21, color: 'yellow', quantity: 10, route_id: 2 });
  await sup.post(`/api/orders/${o.id}/advance`);
  await sup.post(`/api/orders/${o.id}/advance`);
  await sup.post(`/api/orders/${o.id}/allocate`, { weight: '100', source: 'vault' });
  const dupW = await sup.req('POST', '/api/sup/issue-split', { order_id: o.id, parts: [{ worker_id: ids.w1, weight: '50' }, { worker_id: ids.w1, weight: '50' }] });
  assert.equal(dupW.status, 400, 'لا يتكرر العامل');
  const r = await sup.post('/api/sup/issue-split', { order_id: o.id, idempotency_key: 'split-1', parts: [{ worker_id: ids.w1, weight: '60', pieces: 6 }, { worker_id: ids.w2, weight: '40', pieces: 4 }] });
  assert.equal(r.parts.length, 2);
  const again = await sup.post('/api/sup/issue-split', { order_id: o.id, idempotency_key: 'split-1', parts: [{ worker_id: ids.w1, weight: '60', pieces: 6 }, { worker_id: ids.w2, weight: '40', pieces: 4 }] });
  assert.ok(again.parts.every((p) => p.duplicate), 'لا تكرار بالإرسال المزدوج');
  const c1 = r.parts[0].custodies[0];
  const c2 = r.parts[1].custodies[0];
  assert.equal(c1.worker_ack_at, null, 'بدون توقيع: بانتظار قبول العامل');
  assert.equal((await sup.get('/api/sup/summary')).pending_ack >= 2, true);
  assert.equal((await w1.req('POST', `/api/w/custody/${c1.id}/start`)).status, 409, 'لا يبدأ قبل القبول');
  await w1.post(`/api/w/custody/${c1.id}/ack`);
  await w1.post(`/api/w/custody/${c1.id}/start`);
  // العامل الثاني يرفض لخطأ في الوزن
  assert.equal((await w2.req('POST', `/api/w/custody/${c2.id}/reject`, {})).status, 400, 'سبب الرفض إلزامي');
  await w2.post(`/api/w/custody/${c2.id}/reject`, { reason: 'الوزن 39.5 وليس 40' });
  const open2 = await sup.get(`/api/sup/workers/${ids.w2}/open`);
  assert.equal(open2.find((x) => x.id === c2.id).worker_reject_reason, 'الوزن 39.5 وليس 40');
  // المشرف يلغي التسليم الخاطئ ويعيد التسليم الصحيح
  await admin.post(`/api/sup/custodies/${c2.id}/reverse`, { reason: 'رفض العامل - وزن خاطئ' });
  const fix = await sup.post('/api/sup/issue', { worker_id: ids.w2, items: [{ order_id: o.id, weight: '40', pieces: 4 }] });
  const c2b = fix.custodies[0].id;
  await w2.post(`/api/w/custody/${c2b}/ack`);
  // الطلب لا ينتقل حتى تُستلم كل العهد
  await sup.post('/api/sup/receive', { worker_id: ids.w1, items: [{ custody_id: c1.id, returned_weight: '59.98', scrap_weight: '0' }] });
  assert.equal((await orderOf(o.id)).stage_name, 'تجهيز الذهب والألماس');
  await sup.post('/api/sup/receive', { worker_id: ids.w2, items: [{ custody_id: c2b, returned_weight: '39.99', scrap_weight: '0' }] });
  assert.equal((await orderOf(o.id)).stage_name, 'الصب', 'انتقل بعد استلام عهد كل العمال');
  const sheet = await sup.get(`/api/sup/batches/${fix.batch_id}`);
  assert.ok(sheet.lines[0].worker_ack_at, 'الكشف يحمل وقت القبول الإلكتروني');
});

test('عهدة عامة: تحويل ذهب من الخزنة لعامل بدون طلب، ثم إرجاعه للخزنة مع حساب العجز', async () => {
  const vault = async () => n((await pool.query("select coalesce(sum(balance),0) b from gold_balances where loc_type='vault' and material_id=$1", [ids.m21])).rows[0].b);
  const before = await vault();
  assert.equal((await w1.req('POST', '/api/inventory/gold/to-worker', { worker_id: ids.w3, material_id: ids.m21, weight: '25', purpose: 'x' })).status, 403, 'العامل لا يحوّل');
  assert.equal((await sup.req('POST', '/api/inventory/gold/to-worker', { worker_id: ids.w3, material_id: ids.m21, weight: '25' })).status, 400, 'الغرض إلزامي');
  const g = await sup.post('/api/inventory/gold/to-worker', { worker_id: ids.w3, material_id: ids.m21, weight: '25', purpose: 'رصيد لحام وتصليحات', loss_rate_percent: '0.2', idempotency_key: 'gen-1' });
  const dup = await sup.post('/api/inventory/gold/to-worker', { worker_id: ids.w3, material_id: ids.m21, weight: '25', purpose: 'رصيد لحام وتصليحات', idempotency_key: 'gen-1' });
  assert.equal(dup.duplicate, true);
  assert.equal((await vault()).toFixed(4), (before - 25).toFixed(4));
  const list = await sup.get('/api/inventory/gold/general-custodies');
  assert.equal(list.length, 1);
  // تظهر في عهد العامل وشاشة الاستلام
  const open = await sup.get(`/api/sup/workers/${ids.w3}/open`);
  const c = open.find((x) => x.id === g.custody_id);
  assert.equal(c.order_no, 'عهدة عامة');
  assert.equal((await sup.get('/api/inventory/reconciliation')).ok, true, 'المطابقة سليمة مع العهدة العامة');
  // إرجاع 24.9: عجز 0.1، المسموح 0.05 → غير طبيعي 0.05 يتطلب سبباً
  const noReason = await sup.req('POST', '/api/sup/receive', { worker_id: ids.w3, items: [{ custody_id: g.custody_id, returned_weight: '24.9', scrap_weight: '0' }] });
  assert.equal(noReason.status, 400);
  const r = await sup.post('/api/sup/receive', { worker_id: ids.w3, items: [{ custody_id: g.custody_id, returned_weight: '24.9', scrap_weight: '0', reason: 'لحام' }] });
  assert.equal(r.results[0].settlement.status, 'pending_review');
  assert.equal(r.results[0].order_no, 'عهدة عامة - رصيد لحام وتصليحات');
  await admin.post(`/api/sup/reviews/${r.results[0].settlement.id}`, { decision: 'approve', notes: 'مقبول' });
  assert.equal((await vault()).toFixed(4), (before - 0.1).toFixed(4), 'عاد المرتجع للخزنة');
  const rec = await sup.get('/api/inventory/reconciliation');
  assert.equal(rec.ok, true);
  const rep = await admin.get('/api/reports/losses/worker');
  assert.ok(rep.find((x) => x.key === ids.w3));
  // تصحيح التسوية يعيد العهدة مفتوحة ويسحب الذهب من الخزنة
  await admin.post(`/api/sup/settlements/${r.results[0].settlement.id}/reverse`, { reason: 'خطأ وزن' });
  assert.equal((await vault()).toFixed(4), (before - 25).toFixed(4));
  await sup.post('/api/sup/receive', { worker_id: ids.w3, items: [{ custody_id: g.custody_id, returned_weight: '25', scrap_weight: '0' }] });
  assert.equal((await vault()).toFixed(4), before.toFixed(4));
});

test('المتجر العام: التصفح بدون تسجيل، والطلب يتطلب حساباً معتمداً', async () => {
  const guest = new Client('guest');
  const list = await guest.req('GET', '/api/public/products');
  assert.equal(list.status, 200);
  assert.ok(list.data.products.length >= 1);
  const p = list.data.products[0];
  assert.ok(!('labor' in p) && !('stock_qty' in p), 'لا أجور ولا كميات مخزون للزوار');
  assert.equal((await guest.req('GET', `/api/public/products/${p.id}`)).status, 200);
  assert.equal((await guest.req('POST', '/api/store/orders', { items: [{ product_id: p.id, karat: 21, quantity: 1 }] })).status, 401, 'الزائر لا يرسل طلباً');
  assert.equal((await guest.req('GET', '/api/store/products')).status, 401, 'أسعار العملاء محمية');
  // عميل غير معتمد يتصفح العام لكن لا يطلب
  const pend = new Client('pending');
  await pend.ok('POST', '/api/auth/register-customer', { username: 'pendshop', password: 'Passw0rd!', shop_name: 'محل قيد المراجعة', owner_name: 'م', phone: '0544444444' });
  assert.equal((await pend.req('GET', '/api/public/products')).status, 200);
  assert.equal((await pend.req('POST', '/api/store/orders', { items: [{ product_id: p.id, karat: 21, quantity: 1 }] })).status, 403);
});
