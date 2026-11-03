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
  assert.deepEqual(p.data.plans.map((r) => r.status), ['new', 'new', 'error', 'new']);
  assert.equal(p.data.plans[0].phone, '0501111111');
  assert.equal(p.data.plans[0].shop_name, 'مجوهرات الماسة');
  const ok = await call('POST', '/admin/customers/import/commit', { rows: p.data.rows.filter((r) => r.shop_name !== 'محل خطأ' && r.shop_name !== 'نفس الجوال باسم آخر') });
  assert.deepEqual([ok.data.created, ok.data.logins], [2, 1]);
  // إعادة الرفع: الموجودون يُتجاوزون، وتكرار الجوال يُكتشف
  const p2 = await call('POST', '/admin/customers/import/parse', null, fd);
  assert.deepEqual(p2.data.plans.map((r) => r.status), ['exists', 'exists', 'error', 'exists'], 'موجود + موجود + خطأ + نفس الجوال');
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

test('فروع العملاء: اختيار الفرع عند الدخول، كلمة مرور لكل فرع، وفصل الطلبات بين الفروع', async () => {
  const mk = () => { let ck = ''; return async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { 'content-type': 'application/json', cookie: ck }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; };
  const main = mk();
  assert.equal((await main('POST', '/auth/register-customer', { username: 'brshop', password: 'Main#2026x', shop_name: 'مجوهرات الفروع', owner_name: 'م', phone: '0511111222' })).status, 200);
  const cid = (await call('GET', '/admin/customers')).data.find((c) => c.shop_name === 'مجوهرات الفروع').id;
  await call('PUT', `/admin/customers/${cid}`, { status: 'approved' });
  await main('POST', '/auth/login', { username: 'brshop', password: 'Main#2026x' });
  // لا فروع بعد
  assert.deepEqual((await mk()('POST', '/auth/login-options', { username: 'brshop' })).data.branches, []);
  const b1 = (await main('POST', '/store/branches', { name: 'فرع العليا', city: 'الرياض', phone: '0511111301', password: 'Olaya#2026' })).data;
  const b2 = (await main('POST', '/store/branches', { name: 'فرع جدة', city: 'جدة', phone: '0511111302', password: 'Jeddah#2026' })).data;
  assert.equal((await main('POST', '/store/branches', { name: 'فرع العليا', phone: '0511111303', password: 'Other#2026' })).status, 400, 'لا يتكرر اسم الفرع');
  // رقم تواصل مختلف لكل فرع
  assert.equal((await main('POST', '/store/branches', { name: 'فرع بلا رقم', password: 'NoPhone#2026' })).status, 400, 'رقم التواصل مطلوب');
  assert.equal((await main('POST', '/store/branches', { name: 'فرع مكرر', phone: '+966 51 111 1301', password: 'DupPh#2026' })).status, 400, 'رقم فرع آخر');
  assert.equal((await main('POST', '/store/branches', { name: 'فرع الرئيسي', phone: '0511111222', password: 'MainPh#2026' })).status, 400, 'رقم المحل الرئيسي');
  const opts = (await mk()('POST', '/auth/login-options', { username: 'BRSHOP' })).data.branches.map((b) => b.name).sort();
  assert.deepEqual(opts, ['فرع العليا', 'فرع جدة'].sort());
  assert.deepEqual((await mk()('POST', '/auth/login-options', { username: 'nobody' })).data.branches, []);
  // كلمة مرور كل فرع مستقلة
  const olaya = mk();
  assert.equal((await olaya('POST', '/auth/login', { username: 'brshop', password: 'Jeddah#2026', branch_id: b1.id })).status, 400, 'كلمة مرور فرع آخر مرفوضة');
  assert.equal((await olaya('POST', '/auth/login', { username: 'brshop', password: 'Main#2026x', branch_id: b1.id })).status, 400, 'كلمة مرور الرئيسي لا تفتح الفرع');
  assert.equal((await olaya('POST', '/auth/login', { username: 'brshop', password: 'Olaya#2026', branch_id: b1.id })).status, 200);
  const me = (await olaya('GET', '/auth/me')).data;
  assert.deepEqual([me.branch_id, me.branch_name, me.customer_id], [b1.id, 'فرع العليا', cid]);
  const jeddah = mk();
  assert.equal((await jeddah('POST', '/auth/login', { username: 'brshop', password: 'Jeddah#2026', branch_id: b2.id })).status, 200);
  // اسم المستخدم الداخلي للفرع لا يدخل مباشرة
  const internal = (await pool.query('select username from users where branch_id=$1', [b1.id])).rows[0].username;
  assert.equal((await mk()('POST', '/auth/login', { username: internal, password: 'Olaya#2026' })).status, 400);
  // الطلبات تُسجَّل بالفرع، والفرع لا يرى طلبات غيره، والرئيسي يرى الكل
  const o1 = (await olaya('POST', '/store/orders', { items: [] })).status;
  assert.equal(o1, 400, 'السلة الفارغة مرفوضة');
  const p = (await call('POST', '/catalog/products', null, (() => { const f = new FormData(); for (const [k, v] of Object.entries({ sku: 'BR-1', name: 'خاتم فرع', product_type: 'خاتم', karats: '21', colors: 'yellow' })) f.append(k, v); return f; })())).data;
  const oa = (await olaya('POST', '/store/orders', { items: [{ product_id: p.id, karat: 21, quantity: 1 }] })).data.orders[0];
  const ob = (await jeddah('POST', '/store/orders', { items: [{ product_id: p.id, karat: 21, quantity: 2 }] })).data.orders[0];
  assert.deepEqual((await olaya('GET', '/store/orders')).data.map((o) => o.id), [oa.id]);
  assert.equal((await olaya('GET', `/store/orders/${ob.id}`)).status, 404, 'فرع العليا لا يرى طلب جدة');
  const all = (await main('GET', '/store/orders')).data;
  assert.deepEqual(all.map((o) => o.branch_name).sort(), ['فرع العليا', 'فرع جدة'].sort());
  assert.equal((await call('GET', `/orders/${oa.id}`)).data.order.branch_name, 'فرع العليا', 'الإدارة ترى الفرع');
  // بيانات المنشأة والفروع للحساب الرئيسي فقط
  assert.equal((await olaya('PUT', '/store/account', { city: 'x' })).status, 409);
  assert.equal((await olaya('POST', '/store/branches', { name: 'x', password: 'Xxxxxxxx1' })).status, 409);
  // إيقاف الفرع يمنع دخوله ويُخرجه
  await main('PUT', `/store/branches/${b2.id}`, { active: false });
  assert.equal((await jeddah('GET', '/store/orders')).status, 401);
  assert.equal((await mk()('POST', '/auth/login', { username: 'brshop', password: 'Jeddah#2026', branch_id: b2.id })).status, 400);
  assert.deepEqual((await mk()('POST', '/auth/login-options', { username: 'brshop' })).data.branches.map((b) => b.name), ['فرع العليا']);
  // الإدارة تغيّر كلمة مرور الفرع
  await call('PUT', `/admin/customers/${cid}/branches/${b1.id}`, { password: 'NewOlaya#26' });
  assert.equal((await mk()('POST', '/auth/login', { username: 'brshop', password: 'NewOlaya#26', branch_id: b1.id })).status, 200);
  assert.equal((await call('GET', `/admin/customers/${cid}`)).data.branches.length, 2);
});

test('استيراد العملاء مع الفروع: اسم مستخدم واحد للمحل وكلمة مرور لكل فرع', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('C');
  ws.addRow(['اسم المحل', 'اسم المستخدم', 'الفرع', 'كلمة المرور', 'المدينة', 'جوال الفرع']);
  ws.addRow(['ذهب الشرق', 'sharq', null, 'Sharq#Main1', 'الدمام', '0533000000']);
  ws.addRow(['ذهب الشرق', 'sharq', 'فرع الخبر', 'Khobar#2026', 'الخبر', '0533000001']);
  ws.addRow([null, null, 'فرع الظهران', 'Dhahran#2026', 'الظهران', '0533000002']);
  ws.addRow(['محل بلا رئيسي', 'nomain', 'فرع 1', 'Branch1#2026', null, '0544000001']);
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'c.xlsx');
  const p = await call('POST', '/admin/customers/import/parse', null, fd);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const sharq = p.data.plans.find((x) => x.username === 'sharq');
  assert.equal(sharq.status, 'new');
  assert.deepEqual(sharq.branches.map((b) => b.name), ['فرع الخبر', 'فرع الظهران'], 'صف الفرع بلا اسم محل يتبع المحل السابق');
  assert.equal(p.data.plans.find((x) => x.username === 'nomain').status, 'error', 'الفروع تحتاج صف الحساب الرئيسي');
  // فرع بلا رقم أو برقم مكرر = خطأ
  const wb3 = new ExcelJS.Workbook(); const w3 = wb3.addWorksheet('C');
  w3.addRow(['اسم المحل', 'اسم المستخدم', 'الفرع', 'كلمة المرور', 'جوال']);
  w3.addRow(['محل الأرقام', 'nums', null, 'Nums#Main1', '0577000000']);
  w3.addRow([null, null, 'أ', 'BranchA#2026', '0577000000']);
  w3.addRow([null, null, 'ب', 'BranchB#2026', null]);
  const fd3 = new FormData(); fd3.append('file', new Blob([await wb3.xlsx.writeBuffer()]), 'c.xlsx');
  const e3 = (await call('POST', '/admin/customers/import/parse', null, fd3)).data.plans[0];
  assert.equal(e3.status, 'error');
  assert.ok(e3.errors.some((x) => x.includes('مكرر')) && e3.errors.some((x) => x.includes('مفقود')), JSON.stringify(e3.errors));
  const c = await call('POST', '/admin/customers/import/commit', { rows: p.data.rows.filter((r) => r.username !== 'nomain') });
  assert.deepEqual([c.data.created, c.data.logins, c.data.branches], [1, 1, 2]);
  const opts = await fetch(base + '/api/auth/login-options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'sharq' }) }).then((r) => r.json());
  assert.deepEqual(opts.branches.map((b) => b.name).sort(), ['فرع الخبر', 'فرع الظهران'].sort());
  const bid = opts.branches.find((b) => b.name === 'فرع الخبر').id;
  const lg = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'sharq', password: 'Khobar#2026', branch_id: bid }) });
  assert.equal(lg.status, 200);
  // إعادة الرفع مع فرع جديد: يُضاف الفرع الجديد فقط للمحل الموجود
  ws.addRow(['ذهب الشرق', 'sharq', 'فرع الجبيل', 'Jubail#2026', 'الجبيل', '0533000003']);
  const fd2 = new FormData();
  fd2.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'c.xlsx');
  const p2 = await call('POST', '/admin/customers/import/parse', null, fd2);
  const s2 = p2.data.plans.find((x) => x.username === 'sharq');
  assert.equal(s2.status, 'update');
  const c2 = await call('POST', '/admin/customers/import/commit', { rows: p2.data.rows.filter((r) => r.username !== 'nomain') });
  assert.deepEqual([c2.data.created, c2.data.branches], [0, 1]);
  // عميل جديد يدوياً مع فروعه
  const n = await call('POST', '/admin/customers', { shop_name: 'محل يدوي', username: 'manualshop', password: 'Manual#2026', branches: [{ name: 'الفرع أ', phone: '0566000001', password: 'BranchA#2026' }, { name: 'الفرع ب', phone: '0566000002', password: 'BranchB#2026' }] });
  assert.equal(n.status, 200, JSON.stringify(n.data));
  assert.equal((await call('GET', `/admin/customers/${n.data.id}`)).data.branches.length, 2);
  assert.equal((await call('POST', '/admin/customers', { shop_name: 'بلا مستخدم', branches: [{ name: 'x', password: 'Xxxxxxxx1' }] })).status, 400);
});

test('الاسم المختصر على الملصق، ورمز QR رقمي يُقرأ بأي ماسح', async () => {
  const c = await call('POST', '/admin/customers', { shop_name: 'شركة مجوهرات اديار للذهب والمجوهرات' });
  assert.equal(c.data.short_name, 'اديار', 'يُستنتج تلقائياً');
  assert.equal((await call('POST', '/admin/customers', { shop_name: 'محل', short_name: 'كلمة كلمة كلمة كلمة' })).status, 400, 'حتى 3 كلمات');
  await call('PUT', `/admin/customers/${c.data.id}`, { short_name: 'أديار الرياض' });
  const mat = (await call('GET', '/meta/lookups')).data?.materials?.[0] || (await pool.query('select id from materials limit 1')).rows[0];
  const o = await call('POST', '/orders', { title: 'خاتم', product_type: 'خاتم', karat: 21, color: 'yellow', quantity: 1, customer_id: c.data.id, material_id: mat.id });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const lab = (await call('GET', `/orders/labels?ids=${o.data.id}`)).data[0];
  assert.equal(lab.customer_label, 'أديار الرياض');
  assert.match(lab.qr_code, /^\d{10}$/);
  assert.equal((await call('GET', `/sup/lookup?code=${lab.qr_code}`)).data.id, o.data.id, 'المسح بالأرقام');
  assert.equal((await call('GET', `/sup/lookup?code=${encodeURIComponent(lab.qr_code.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]))}`)).data.id, o.data.id, 'أرقام عربية');
});

test('رقم المنتج تلقائي حسب نوع القطعة', async () => {
  const mk = async (type, extra = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: `منتج ${type}`, product_type: type, karats: '21', colors: 'yellow', ...extra })) f.append(k, v);
    return call('POST', '/catalog/products', null, f);
  };
  assert.equal((await call('GET', '/catalog/next-sku?type=خاتم')).data.sku, 'RIN000001');
  assert.equal((await mk('خاتم')).data.sku, 'RIN000001');
  const second = await mk('خاتم'); assert.equal(second.data.sku, 'RIN000002', JSON.stringify(second.data));
  const exp = { 'أسورة': 'SW', 'اسوارة': 'SW', 'عقد': 'NK', 'كف': 'HAN', 'حلق': 'EAR', 'سبحة': 'SP', 'تعليقة': 'PR', 'خلخال': 'KHL' };
  for (const [t, pre] of Object.entries(exp)) assert.match((await mk(t)).data.sku, new RegExp(`^${pre}\\d{6}$`), t);
  assert.equal((await mk('خاتم', { sku: 'CUSTOM-1' })).data.sku, 'CUSTOM-1', 'الإدخال اليدوي ما زال ممكناً');
});

test('حذف المنتج: نهائي إن لم يُستخدم، وأرشفة إن ارتبط بطلب', async () => {
  const mk = async (name) => { const f = new FormData(); for (const [k, v] of Object.entries({ name, product_type: 'حلق', karats: '21', colors: 'yellow' })) f.append(k, v); return (await call('POST', '/catalog/products', null, f)).data; };
  const a = await mk('حلق للحذف');
  assert.equal((await call('DELETE', `/catalog/products/${a.id}`)).data.deleted, true);
  assert.equal((await pool.query('select count(*)::int n from products where id=$1', [a.id])).rows[0].n, 0);
  const b = await mk('حلق مرتبط');
  const mat = (await pool.query('select id from materials limit 1')).rows[0];
  await call('POST', '/orders', { title: 'حلق', product_type: 'حلق', product_id: b.id, karat: 21, color: 'yellow', quantity: 1, material_id: mat.id });
  assert.equal((await call('DELETE', `/catalog/products/${b.id}`)).data.archived, true);
  assert.ok(!(await call('GET', '/catalog/products')).data.some((p) => p.id === b.id), 'يختفي من القائمة');
  assert.equal((await call('DELETE', `/catalog/products/${b.id}`)).status, 404);
});

test('تتبع الطلب برابط عام بدون تسجيل دخول (عرض فقط)', async () => {
  const mat = (await pool.query('select id from materials limit 1')).rows[0];
  const o = (await call('POST', '/orders', { title: 'عقد للتتبع', product_type: 'عقد', karat: 21, color: 'yellow', quantity: 1, material_id: mat.id })).data;
  const token = (await pool.query('select qr_token from orders where id=$1', [o.id])).rows[0].qr_token;
  const r = await fetch(`${base}/api/public/track/${token}`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.order_no, o.order_no);
  for (const k of ['final_weight', 'labor_rate', 'labor_estimate', 'customer_id', 'shop_name', 'notes', 'id']) assert.equal(d[k], undefined, `لا يكشف ${k}`);
  assert.ok(!d.stages.some((s) => s.name === 'المختبر لإصدار الشهادة'), 'طلب بدون ألماس: لا مرحلة مختبر');
  // طلب ألماس: مرحلة المختبر قبل التشييك مباشرة
  const od = (await call('POST', '/orders', { title: 'عقد ألماس للتتبع', product_type: 'عقد', karat: 18, color: 'white', quantity: 1, material_id: mat.id })).data;
  const tokD = (await pool.query('select qr_token from orders where id=$1', [od.id])).rows[0].qr_token;
  const dd = await (await fetch(`${base}/api/public/track/${tokD}`)).json();
  const names = dd.stages.map((s) => s.name);
  assert.ok(names.includes('المختبر لإصدار الشهادة'), 'طلب الألماس يمر بالمختبر');
  // مسار "منتج بدون أحجار" لا يحتوي مرحلة المختبر
  const r2 = (await pool.query("select count(*)::int n from route_stages rs join stages s on s.id=rs.stage_id join routes r on r.id=rs.route_id where s.code='lab' and r.name like '%بدون أحجار%'")).rows[0].n;
  assert.equal(r2, 0);
  assert.ok(names.indexOf('المختبر لإصدار الشهادة') === names.findIndex((n) => n.startsWith('التشييك')) - 1, 'المختبر قبل التشييك مباشرة');
  assert.equal((await fetch(`${base}/api/public/track/${'0'.repeat(20)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/public/track/${o.order_no}`)).status, 404, 'رقم الطلب وحده لا يكفي');
  // لا توجد أي عملية كتابة عامة على الطلب
  assert.equal((await fetch(`${base}/api/public/track/${token}`, { method: 'POST' })).status, 404);
});

test('التسعيرة برابط خارجي: قراءة فقط بدون تسجيل دخول، والتعديل للمدير فقط', async () => {
  const a = (await call('GET', '/admin/pricing')).data;
  assert.match(a.token, /^[0-9a-f]{32}$/);
  const pub = await fetch(`${base}/api/public/pricing/${a.token}`);
  assert.equal(pub.status, 200);
  const d = await pub.json();
  assert.equal(d.token, undefined, 'لا يكشف الرمز');
  assert.equal(d.gold24, 467);
  assert.equal((await fetch(`${base}/api/public/pricing/${'0'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/public/pricing/${a.token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"gold24":1}' })).status, 404, 'لا تعديل عبر الرابط');
  assert.equal((await fetch(`${base}/api/admin/pricing`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"gold24":1}' })).status, 401, 'التعديل يتطلب دخول');
  const s = (await call('PUT', '/admin/pricing', { gold24: 480, rows: { d_0_3: { c: 140 } } })).data;
  assert.equal(s.gold24, 480);
  assert.equal(s.rows.d_0_3.c, 140);
  assert.equal(s.updated_at, new Date().toISOString().slice(0, 10), 'تاريخ التحديث تلقائي');
  assert.equal((await call('GET', '/admin/settings')).data.pricing_sheet, undefined, 'الرمز لا يظهر في الإعدادات العامة');
  const t2 = (await call('POST', '/admin/pricing/token')).data.token;
  assert.equal((await fetch(`${base}/api/public/pricing/${a.token}`)).status, 404, 'الرابط القديم يتوقف');
  assert.equal((await fetch(`${base}/api/public/pricing/${t2}`)).status, 200);
});
