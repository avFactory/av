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

// نموذج تسجيل محل مع المستندات الثلاث الإلزامية (صور PNG صغيرة)
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function regForm(fields, skip = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const k of ['cr_doc', 'vat_doc', 'address_doc']) if (!skip.includes(k)) fd.append(k, new Blob([PNG1], { type: 'image/png' }), `${k}.png`);
  return fd;
}

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
  const reg = await fetch(base + '/api/auth/register-customer', { method: 'POST', body: regForm({ username: 'newshop', password: 'Newshop#2026', shop_name: 'محل جديد', owner_name: 'م', phone: '0599999999' }) });
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
  assert.equal((await fetch(base + '/api/auth/register-customer', { method: 'POST', body: regForm({ username: 'brshop', password: 'Main#2026x', shop_name: 'مجوهرات الفروع', owner_name: 'م', phone: '0511111222' }) })).status, 200);
  await main('POST', '/auth/login', { username: 'brshop', password: 'Main#2026x' });
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
  const nm = p.data.plans.find((x) => x.username === 'nomain');
  assert.equal(nm.status, 'new', 'شركة بفروع فقط بدون حساب رئيسي');
  assert.equal(nm.branches_only, true);
  // فرع برقم مكرر = خطأ، وفرع بلا رقم يُقبل في الاستيراد (يُضاف رقمه لاحقاً)
  const wb3 = new ExcelJS.Workbook(); const w3 = wb3.addWorksheet('C');
  w3.addRow(['اسم المحل', 'اسم المستخدم', 'الفرع', 'كلمة المرور', 'جوال']);
  w3.addRow(['محل الأرقام', 'nums', null, 'Nums#Main1', '0577000000']);
  w3.addRow([null, null, 'أ', 'BranchA#2026', '0577000000']);
  w3.addRow([null, null, 'ب', 'BranchB#2026', null]);
  const fd3 = new FormData(); fd3.append('file', new Blob([await wb3.xlsx.writeBuffer()]), 'c.xlsx');
  const e3 = (await call('POST', '/admin/customers/import/parse', null, fd3)).data.plans[0];
  assert.equal(e3.status, 'error');
  assert.ok(e3.errors.some((x) => x.includes('مكرر')) && !e3.errors.some((x) => x.includes('"ب"')), JSON.stringify(e3.errors));
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

  // شركة بفروع فقط: لا دخول للحساب الرئيسي، والفرع يدخل
  const c3 = await call('POST', '/admin/customers/import/commit', { rows: p.data.rows.filter((r) => r.username === 'nomain') });
  assert.deepEqual([c3.data.created, c3.data.branches], [1, 1], JSON.stringify(c3.data));
  const lo = await fetch(base + '/api/auth/login-options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'nomain' }) }).then((r) => r.json());
  assert.equal(lo.main, false, 'لا خيار للحساب الرئيسي');
  assert.equal(lo.branches.length, 1);
  const tryLogin = (b) => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
  assert.equal(await tryLogin({ username: 'nomain', password: 'Branch1#2026' }), 400, 'الحساب الرئيسي لا يدخل');
  assert.equal(await tryLogin({ username: 'nomain', password: 'Branch1#2026', branch_id: lo.branches[0].id }), 200, 'الفرع يدخل');
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
  assert.deepEqual(lab.types, [{ type: 'خاتم', qty: 1 }]);
  // طلب من السلة ببنود: ملصق واحد للطلب بعدد كل نوع، والمسح يفتح بنده
  const ref = 'ORD-2026-777777';
  const mk = async (no, type, qty) => (await pool.query(`insert into orders(order_no, cart_ref, customer_id, source, product_type, title, material_id, quantity, status)
    values ($1,$2,$3,'store_catalog',$4,$4,$5,$6,'in_production') returning id`, [no, ref, c.data.id, type, mat.id, qty])).rows[0].id;
  const i1 = await mk(`${ref}-1`, 'خاتم', 3); const i2 = await mk(`${ref}-2`, 'عقد', 2); const i3 = await mk(`${ref}-3`, 'خاتم', 1);
  const g = (await call('GET', `/orders/labels?ids=${i1},${i2},${i3}`)).data;
  assert.equal(g.length, 1, 'ملصق واحد للطلب');
  assert.equal(g[0].order_no, ref);
  assert.deepEqual(g[0].types, [{ type: 'خاتم', qty: 4 }, { type: 'عقد', qty: 2 }]);
  assert.equal(g[0].qr_code, '2026777777');
  const lk = (await call('GET', `/sup/lookup?code=${g[0].qr_code}`)).data;
  assert.equal(lk.id, i1, 'مسح ملصق الطلب يفتح البند الأول');
  assert.equal(lk.group.length, 3, 'مسح ملصق الطلب يعرض الطلب كاملاً');
  // العامل المسند له بند واحد يرى الطلب كاملاً
  const { hashPassword } = await import('../src/lib/auth.js');
  const wid = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('grpw',$1,'عامل','worker','G1') returning id", [hashPassword('Grp#2026xx')])).rows[0].id;
  await pool.query('update orders set assigned_worker_id=$1 where id=$2', [wid, i1]);
  let ck = '';
  const wk = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await wk('POST', '/auth/login', { username: 'grpw', password: 'Grp#2026xx' });
  const w2 = await wk('GET', `/w/orders/${i2}`);
  assert.equal(w2.status, 200, 'يرى بقية بنود طلبه');
  assert.equal(w2.data.group.length, 3);
  assert.equal((await wk('GET', `/sup/lookup?code=${g[0].qr_code}`)).data.group.length, 3, 'العامل يمسح ملصق الطلب ويرى الطلب كاملاً');
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

test('التسعيرة المختصرة: أعمدة مختصرة فقط، والحساب على الخادم بدون كشف التكاليف', async () => {
  const { calc, SECTIONS } = await import('../src/lib/pricingFormulas.js');
  const a = (await call('GET', '/admin/pricing')).data;
  assert.match(a.token_short, /^[0-9a-f]{32}$/);
  assert.notEqual(a.token_short, a.token);
  const r = await fetch(`${base}/api/public/pricing/${a.token_short}`);
  const raw = await r.text();
  const d = JSON.parse(raw);
  assert.equal(d.view, 'short');
  assert.equal(d.rows, undefined, 'لا تُرسل الثوابت');
  for (const word of ['"profit"', '"ct"', '"base"', '"step"', '"pp"']) assert.ok(!raw.includes(word), `لا يكشف ${word}`);
  const dia = d.sections.find((s) => s.id === 'diamond');
  assert.deepEqual(dia.columns.map((c) => c[1]), ['المنتج', 'الوزن الاجمالي', 'وزن الألماس المخبري', 'شامل الضريبة للقطاعي']);
  assert.deepEqual(d.sections.find((s) => s.id === 'gold').columns.map((c) => c[1]), ['المنتج', 'الوزن الإجمالي', 'تكاليف المصنع', 'شامل الضريبة للقطاعي']);
  const c = await (await fetch(`${base}/api/public/pricing/${a.token_short}/calc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weights: { d_0_3: { e: '1.30', g: '1.53' } } }) })).json();
  const row = c.sections.find((s) => s.id === 'diamond').rows.find((x) => x.id === 'd_0_3');
  const base0 = { ...SECTIONS[0].rows[0], ...(a.rows.d_0_3 || {}), e: 1.3, g: 1.53 };
  assert.equal(row.values.m, Math.round(calc('diamond', base0, a.gold24, 15).m * 100) / 100, 'نفس نتيجة التسعيرة الكاملة');
  assert.equal((await fetch(`${base}/api/public/pricing/${a.token}/calc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404, 'الحساب للمختصرة فقط');
  const t2 = (await call('POST', '/admin/pricing/token', { which: 'short' })).data.token;
  assert.equal((await fetch(`${base}/api/public/pricing/${a.token_short}`)).status, 404, 'المختصر القديم يتوقف');
  assert.equal((await fetch(`${base}/api/public/pricing/${a.token}`)).status, 200, 'الرابط الكامل لا يتأثر');
  assert.equal((await fetch(`${base}/api/public/pricing/${t2}`)).status, 200);
});

test('صفحة الصب: أشجار الشمع وربطها بالطلب وتسجيل تاريخ التسليم والاستلام', async () => {
  const { castingCalc } = await import('../src/lib/castingFormulas.js');
  const c = castingCalc({ karat: 18, zircon: 0, wax: 5.26, gold_before: 88.61, gold_after: 83.06 });
  assert.equal(c.due.toFixed(2), '84.16'); assert.equal(c.need24.toFixed(2), '31.64'); assert.equal(c.alloy.toFixed(2), '10.44');
  assert.equal(c.need18.toFixed(2), '42.08'); assert.equal(c.loss.toFixed(2), '5.55');
  const mat = (await pool.query('select id from materials limit 1')).rows[0];
  const o = (await call('POST', '/orders', { title: 'خاتم للصب', product_type: 'خاتم', karat: 18, color: 'yellow', quantity: 1, material_id: mat.id })).data;
  const t = (await call('POST', '/casting', { tree_no: '22', color: 'اصفر', karat: 18, wax: '5.26', order_ids: [o.id] })).data;
  assert.equal(t.orders[0].id, o.id);
  assert.equal(t.issued_at, null);
  const t2 = (await call('PUT', `/casting/${t.id}`, { gold_before: '88.61' })).data;
  assert.ok(t2.issued_at, 'تاريخ التسليم تلقائي');
  const t3 = (await call('PUT', `/casting/${t.id}`, { gold_after: '٨٣٫٠٦'.replace('٫', '.') })).data;
  assert.ok(t3.received_at && t3.issued_at === t2.issued_at, 'تاريخ الاستلام تلقائي ولا يتغير تاريخ التسليم');
  assert.equal(Number(t3.gold_after), 83.06);
  assert.equal((await call('GET', `/casting?order=${o.id}`)).data.length, 1);
  assert.equal((await call('PUT', `/casting/${t.id}`, { karat: 22 })).status, 400);
  assert.equal((await call('DELETE', `/casting/${t.id}`)).data.ok, true);
  assert.equal((await fetch(`${base}/api/casting`)).status, 401, 'يتطلب تسجيل دخول');
});

test('عيار 22 محذوف من النظام', async () => {
  const lk = (await call('GET', '/meta/lookups')).data;
  const mats = lk.materials || (await pool.query('select karat from materials where active')).rows;
  assert.ok(!mats.some((m) => Number(m.karat) === 22), 'لا مواد عيار 22 في القوائم');
  const f = new FormData(); for (const [k, v] of Object.entries({ name: 'منتج 22', product_type: 'خاتم', karats: '22', colors: 'yellow' })) f.append(k, v);
  assert.equal((await call('POST', '/catalog/products', null, f)).status, 400, 'لا منتجات بعيار 22');
  assert.notEqual((await call('POST', '/orders', { title: 'طلب 22', product_type: 'خاتم', karat: 22, color: 'yellow', quantity: 1 })).status, 200, 'لا طلبات بعيار 22');
  const inv = (await call('GET', '/inventory/gold')).data;
  assert.ok(!inv.materials.some((m) => m.karat === 22));
});

test('أحجار المنتج: الألماس يُحجز من المخزون عند اعتماد الطلب، والصرف لا يخصم مرتين، والإلغاء يعيده', async () => {
  const shape = (await call('GET', '/stones/shapes')).data[0];
  const fl = new FormData(); for (const [k, v] of Object.entries({ shape_id: shape.id, size_label: '1.3 mm', carats: '10', count: '400' })) fl.append(k, v);
  const lot = (await call('POST', '/stones', null, fl)).data;
  const bal = async () => (await call('GET', '/stones')).data.find((l) => l.id === lot.id);
  const fp = new FormData();
  for (const [k, v] of Object.entries({ name: 'خاتم ألماس قلب', product_type: 'خاتم', karats: '18', colors: 'white', diamonds: JSON.stringify([{ lot_id: lot.id, carats: '0.5', count: '20' }]), pearl_weight: '1.2', zircon_weight: '' })) fp.append(k, v);
  const p = (await call('POST', '/catalog/products', null, fp)).data;
  assert.equal(Number(p.pearl_weight), 1.2);
  assert.equal(p.zircon_weight, null);
  const mat = (await pool.query("select id from materials where metal='gold' and karat=18 and active")).rows[0];
  const o = (await call('POST', '/orders', { title: 'خاتم ألماس قلب', product_id: p.id, product_type: 'خاتم', karat: 18, color: 'white', quantity: 2, material_id: mat.id, start: false })).data;
  assert.equal(Number((await bal()).stock_carats), 10, 'لا خصم قبل الاعتماد');
  assert.equal((await call('POST', `/orders/${o.id}/start`)).status, 200);
  let b = await bal();
  assert.deepEqual([Number(b.stock_carats), Number(b.reserved_carats), b.stock_count, b.reserved_count], [9, 1, 360, 40], 'حجز 0.5 × 2 قطعة');
  assert.notEqual((await call('POST', `/orders/${o.id}/start`)).status, 200, 'لا يُعتمد مرتين');
  assert.equal(Number((await bal()).reserved_carats), 1, 'لا يُحجز مرتين');
  const wk = (await pool.query("insert into users(username, password_hash, full_name, role_code) values ('dw1','x','عامل ألماس','worker') returning id")).rows[0].id;
  assert.equal((await call('POST', `/stones/${lot.id}/move`, { kind: 'issue', carats: '0.6', count: '24', order_id: o.id, worker_id: wk })).status, 200);
  b = await bal();
  assert.deepEqual([Number(b.stock_carats), Number(b.reserved_carats), Number(b.with_workers_carats)], [9, 0.4, 0.6], 'الصرف من المحجوز بدون خصم ثانٍ');
  assert.equal((await call('POST', `/orders/${o.id}/cancel`, { reason: 'اختبار' })).status, 200);
  b = await bal();
  assert.deepEqual([Number(b.stock_carats), Number(b.reserved_carats)], [9.4, 0], 'الإلغاء يعيد المحجوز');
  // مخزون غير كافٍ يمنع الاعتماد
  const o2 = (await call('POST', '/orders', { title: 'كمية كبيرة', product_id: p.id, product_type: 'خاتم', karat: 18, color: 'white', quantity: 40, material_id: mat.id, start: false })).data;
  const st = await call('POST', `/orders/${o2.id}/start`);
  assert.equal(st.status, 409);
  assert.match(st.data.error, /مخزون الألماس المخبري غير كافٍ/);
  const pub = (await call('GET', `/public/products/${p.id}`)).data;
  assert.equal(pub.diamond_details[0].carats, 0.5);
});

test('اطلب تصميمك مع الألماس والأحجار: يُحجز الألماس عند موافقة العميل على العرض', async () => {
  const mk = () => { let ck = ''; return async (m, p, b, form) => { const r = await fetch(base + '/api' + p, { method: m, headers: form ? { cookie: ck } : { 'content-type': 'application/json', cookie: ck }, body: form || (b ? JSON.stringify(b) : undefined) }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; };
  await call('POST', '/admin/customers', { shop_name: 'محل الألماس', username: 'dshop', password: 'Dshop#2026' });
  await pool.query("update users set must_change_password=false where username='dshop'");
  const cu = mk();
  assert.equal((await cu('POST', '/auth/login', { username: 'dshop', password: 'Dshop#2026' })).status, 200);
  const shape = (await call('GET', '/stones/shapes')).data[0];
  const fl = new FormData(); for (const [k, v] of Object.entries({ shape_id: shape.id, size_label: '2.1 mm', carats: '3', count: '50' })) fl.append(k, v);
  const lot = (await call('POST', '/stones', null, fl)).data;
  const types = (await cu('GET', '/store/diamond-types')).data;
  const t = types.find((x) => x.id === lot.id);
  assert.ok(t && t.available && t.stock_carats === undefined, 'الأنواع بدون كميات المخزون');
  const fd = new FormData();
  for (const [k, v] of Object.entries({ product_type: 'خاتم', title: 'خاتم سوليتير', karat: '18', color: 'white', quantity: '2', diamonds: JSON.stringify([{ lot_id: lot.id, carats: '0.7', count: '10' }]), pearl_weight: '', stone_weight: '0.4', zircon_weight: '' })) fd.append(k, v);
  const o = (await cu('POST', '/store/custom', null, fd)).data;
  assert.ok(o.id, JSON.stringify(o));
  const tr = (await cu('GET', `/store/orders/${o.id}`)).data.order;
  assert.equal(tr.diamond_details[0].carats, 0.7);
  assert.equal(Number(tr.stone_weight), 0.4);
  await call('POST', `/orders/${o.id}/quote`, { labor_method: 'per_gram', labor_rate: '20' });
  assert.equal((await cu('POST', `/store/orders/${o.id}/quote`, { decision: 'accept' })).status, 200);
  const b = (await call('GET', '/stones')).data.find((l) => l.id === lot.id);
  assert.deepEqual([Number(b.stock_carats), Number(b.reserved_carats)], [1.6, 1.4], '0.7 × 2 محجوز');
  // مخزون غير كافٍ: موافقة العميل تُسجل ولا يبدأ الإنتاج
  const fd2 = new FormData();
  for (const [k, v] of Object.entries({ product_type: 'خاتم', karat: '18', quantity: '5', diamonds: JSON.stringify([{ lot_id: lot.id, carats: '1', count: '' }]) })) fd2.append(k, v);
  const o2 = (await cu('POST', '/store/custom', null, fd2)).data;
  await call('POST', `/orders/${o2.id}/quote`, { labor_method: 'per_gram', labor_rate: '20' });
  assert.equal((await cu('POST', `/store/orders/${o2.id}/quote`, { decision: 'accept' })).status, 200);
  assert.equal((await pool.query('select status from orders where id=$1', [o2.id])).rows[0].status, 'approved', 'موافق عليه وينتظر توفر الألماس');

  // من السلة: عدة صور مع نوع كل ملف، ويُربط طلبان برقم سلة واحد
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd3 = new FormData();
  for (const [k, v] of Object.entries({ product_type: 'حلق', karat: '21', from_cart: '1', cart_ref: '', file_kinds: JSON.stringify(['reference', 'reference', 'sketch']) })) fd3.append(k, v);
  for (const n of ['a.png', 'b.png', 'c.png']) fd3.append('files', new Blob([png], { type: 'image/png' }), n);
  const c1 = (await cu('POST', '/store/custom', null, fd3)).data;
  assert.match(c1.cart_ref, /^ORD-/);
  assert.equal(c1.order_no, `${c1.cart_ref}-1`, 'بند أول داخل الطلب');
  const kinds = (await pool.query('select kind from order_files where order_id=$1 order by id', [c1.id])).rows.map((x) => x.kind);
  assert.deepEqual(kinds, ['reference', 'reference', 'sketch']);
  const fd4 = new FormData();
  for (const [k, v] of Object.entries({ product_type: 'عقد', karat: '21', from_cart: '1', cart_ref: c1.cart_ref })) fd4.append(k, v);
  const c2 = (await cu('POST', '/store/custom', null, fd4)).data;
  assert.equal(c2.cart_ref, c1.cart_ref, 'نفس رقم السلة');
  assert.equal(c2.order_no, `${c1.cart_ref}-2`);
});

test('تصنيفات المتجر: ذهب (يشمل الزركون) / ألماس مخبري / لؤلؤ / أحجار + نوع القطعة', async () => {
  const shape = (await call('GET', '/stones/shapes')).data[0];
  const fl = new FormData(); for (const [k, v] of Object.entries({ shape_id: shape.id, size_label: '3.3 mm', carats: '5' })) fl.append(k, v);
  const lot = (await call('POST', '/stones', null, fl)).data;
  const mk = async (name, type, extra) => { const f = new FormData(); for (const [k, v] of Object.entries({ name, product_type: type, karats: '18', colors: 'yellow', ...extra })) f.append(k, v); return (await call('POST', '/catalog/products', null, f)).data.id; };
  const ids = {
    gold: await mk('تصنيف ذهب', 'عقد', {}),
    zircon: await mk('تصنيف زركون', 'عقد', { zircon_weight: '0.5' }),
    diamond: await mk('تصنيف ألماس', 'خاتم', { diamonds: JSON.stringify([{ lot_id: lot.id, carats: '0.2' }]) }),
    pearl: await mk('تصنيف لؤلؤ', 'حلق', { pearl_weight: '2' }),
    stone: await mk('تصنيف حجر', 'خاتم', { stone_weight: '1' }),
  };
  const list = async (q) => (await call('GET', `/public/products?q=${encodeURIComponent('تصنيف')}&${q}`)).data.products.map((p) => p.id).sort();
  assert.deepEqual(await list('cat=gold'), [ids.gold, ids.zircon].sort(), 'الزركون مع الذهب');
  assert.deepEqual(await list('cat=diamond'), [ids.diamond]);
  assert.deepEqual(await list('cat=pearl'), [ids.pearl]);
  assert.deepEqual(await list('cat=stone'), [ids.stone]);
  assert.deepEqual(await list('cat=stone&type=' + encodeURIComponent('خاتم')), [ids.stone]);
  assert.equal((await list('')).length, 5);
});

test('رابط مخزون الألماس الخارجي: عرض فقط بدون أسعار أو بيانات داخلية', async () => {
  const shape = (await call('GET', '/stones/shapes')).data[0];
  const fl = new FormData(); for (const [k, v] of Object.entries({ shape_id: shape.id, size_label: '4.4 mm', carats: '2.5', count: '30', unit_price: '999', min_carats: '3' })) fl.append(k, v);
  const lot = (await call('POST', '/stones', null, fl)).data;
  const { token } = (await call('GET', '/stones/share')).data;
  assert.match(token, /^[0-9a-f]{32}$/);
  const r = await fetch(`${base}/api/public/stones/${token}`);
  assert.equal(r.status, 200);
  const raw = await r.text();
  for (const w of ['999', 'unit_price', 'lot_no', lot.lot_no, 'worker', 'order']) assert.ok(!raw.includes(w), `لا يكشف ${w}`);
  const d = JSON.parse(raw);
  const it = d.shapes.flatMap((s) => s.items).find((x) => x.size === '4.4 mm');
  assert.deepEqual([it.carats, it.count, it.status], [2.5, 30, 'low'], 'أقل من حد التنبيه = كمية محدودة');
  assert.equal((await fetch(`${base}/api/public/stones/${'0'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/stones/share`)).status, 401, 'إدارة الرابط تتطلب دخول');
  const t2 = (await call('POST', '/stones/share/rotate')).data.token;
  assert.equal((await fetch(`${base}/api/public/stones/${token}`)).status, 404, 'الرابط القديم يتوقف');
  assert.equal((await fetch(`${base}/api/public/stones/${t2}`)).status, 200);
});

test('العامل يرى صور الطلب وصورة المنتج', async () => {
  const fd = new FormData(); for (const [k, v] of Object.entries({ name: 'منتج بصورة للعامل', product_type: 'خاتم', karats: '21', colors: 'yellow' })) fd.append(k, v);
  fd.append('files', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'p.png');
  const p = (await call('POST', '/catalog/products', null, fd)).data;
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0];
  const o = (await call('POST', '/orders', { title: 'طلب بصورة', product_id: p.id, product_type: 'خاتم', karat: 21, color: 'yellow', quantity: 1, material_id: mat.id })).data;
  const wk = (await pool.query("insert into users(username, password_hash, full_name, role_code) values ('imgw','x','عامل الصور','worker') returning id")).rows[0].id;
  await pool.query('update orders set assigned_worker_id=$2 where id=$1', [o.id, wk]);
  const det = (await call('GET', `/orders/${o.id}`)).data.order;
  assert.ok(det.thumb, 'صورة الطلب في صفحة الإدارة');
  const list = (await call('GET', '/orders')).data.find((x) => x.id === o.id);
  assert.equal(list.thumb, det.thumb, 'صورة في قائمة الطلبات');
  // واجهة العامل (بصلاحية الإدارة لنفس المسار)
  const { createSession } = await import('../src/lib/auth.js');
  const r = await fetch(`${base}/api/w/orders/${o.id}`, { headers: { cookie } });
  assert.notEqual(r.status, 500, 'لا خطأ في صور الطلب للعامل');
  assert.ok(createSession);
});

test('العجز على حساب العامل: الوزن الفعلي من المشرف، شاشة العجز للعامل، وسلفة نهاية الشهر', async () => {
  const { hashPassword } = await import('../src/lib/auth.js');
  const mat = (await pool.query("select id from materials where metal='gold' and karat=21 and active")).rows[0];
  await call('POST', '/inventory/gold/in', { material_id: mat.id, weight: '200', note: 'رصيد اختبار' });
  const wk = (await pool.query("insert into users(username, password_hash, full_name, role_code, employee_no) values ('losswk',$1,'عامل العجز','worker','LW1') returning id", [hashPassword('Loss#2026w')])).rows[0].id;
  const o = (await call('POST', '/orders', { title: 'طلب عجز', product_type: 'خاتم', karat: 21, color: 'yellow', quantity: 1, material_id: mat.id, route_id: 2 })).data;
  let d = (await call('GET', `/orders/${o.id}`)).data;
  for (let i = 0; i < 4 && !d.order.handles_gold; i++) { await call('POST', `/orders/${o.id}/advance`, { force: true, reason: 'اختبار' }); d = (await call('GET', `/orders/${o.id}`)).data; }
  const stage = d.order.current_stage_id;
  await call('POST', `/admin/stages/${stage}/rate`, { rate_percent: '1', note: 'اختبار' }); // 1% مسموح
  const iss = (await call('POST', '/sup/issue', { worker_id: wk, items: [{ order_id: o.id, weight: '10' }] })).data;
  const cid = iss.custodies[0].id;
  // العامل يقبل ويبدأ وينهي بدون تسجيل أوزان
  let wck = '';
  const w = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { 'content-type': 'application/json', cookie: wck }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) wck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await pool.query("update users set must_change_password=false where id=$1", [wk]);
  assert.equal((await w('POST', '/auth/login', { username: 'losswk', password: 'Loss#2026w' })).status, 200);
  await w('POST', `/w/custody/${cid}/ack`); await w('POST', `/w/custody/${cid}/start`);
  assert.equal((await w('POST', `/w/custody/${cid}/finish`)).status, 200, 'إنهاء المرحلة بدون أوزان من العامل');
  // المشرف يستلم 9.8 جم (بدون بقايا ولا سبب): العجز 0.2، المسموح 9.8×1% = 0.098، على حساب العامل 0.102
  const rc = await call('POST', '/sup/receive', { worker_id: wk, items: [{ custody_id: cid, returned_weight: '9.8' }] });
  assert.equal(rc.data.results[0].settlement.status, 'approved', 'العجز يُسجَّل تلقائياً بدون مراجعة');
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  const L = (await w('GET', '/w/losses')).data;
  const row = L.rows.find((r) => r.order_id === o.id);
  assert.deepEqual([Number(row.actual_loss), Number(row.allowed), Number(row.net)], [0.2, 0.098, 0.102]);
  assert.equal(L.totals.charged, 0.102);
  // الإدارة: ملخص الشهر وتسجيل السلفة (0.102 جم عيار 21 = 0.0893 صافي × 400 = 35.72 ر.س)
  const A = (await call('GET', `/admin/loss-advances?month=${L.month}`)).data;
  const sw = A.workers.find((x) => x.worker_id === wk);
  assert.equal(Number(sw.charged), 0.102);
  const adv = await call('POST', '/admin/loss-advances', { worker_id: wk, month: L.month, price_per_gram: '400', include_pending: true });
  assert.equal(adv.status, 200, JSON.stringify(adv.data));
  assert.equal(Number(adv.data.amount), 35.72);
  assert.equal((await call('POST', '/admin/loss-advances', { worker_id: wk, month: L.month, price_per_gram: '400', include_pending: true })).status, 409, 'لا تتكرر سلفة نفس الشهر');
  assert.equal(Number((await w('GET', '/w/losses')).data.advance.amount), 35.72, 'العامل يرى السلفة');
  assert.equal((await w('GET', '/admin/loss-advances')).status, 403, 'العامل لا يدخل صفحة السلف');

  // نسبة حسب مهنة العامل: عامل تشبيك 0.1% بدلاً من نسبة المرحلة 1%
  const sr = (await call('GET', '/admin/specialty-rates')).data;
  assert.ok(sr.some((r) => r.specialty === 'تشبيك' && Number(r.rate_percent) === 0.1));
  await pool.query("update users set specialty='تشبيك' where id=$1", [wk]);
  const o2 = (await call('POST', '/orders', { title: 'طلب تشبيك', product_type: 'خاتم', karat: 21, color: 'yellow', quantity: 1, material_id: mat.id, route_id: 2 })).data;
  let d2 = (await call('GET', `/orders/${o2.id}`)).data;
  for (let i = 0; i < 4 && !d2.order.handles_gold; i++) { await call('POST', `/orders/${o2.id}/advance`, { force: true, reason: 'اختبار' }); d2 = (await call('GET', `/orders/${o2.id}`)).data; }
  const iss2 = (await call('POST', '/sup/issue', { worker_id: wk, items: [{ order_id: o2.id, weight: '10' }] })).data;
  assert.equal(Number(iss2.custodies[0].loss_rate_snapshot), 0.1);
  // زيادة الوزن تحتاج ملاحظة ومراجعة
  assert.equal((await call('POST', '/sup/receive', { worker_id: wk, items: [{ custody_id: iss2.custodies[0].id, returned_weight: '10.5' }] })).status, 400);
  const g = await call('POST', '/sup/receive', { worker_id: wk, items: [{ custody_id: iss2.custodies[0].id, returned_weight: '10.5', reason: 'زيادة' }] });
  assert.equal(g.data.results[0].settlement.status, 'pending_review');
  // تعديل النسب
  assert.equal((await call('PUT', '/admin/specialty-rates', { rates: [...sr.map((r) => ({ specialty: r.specialty, rate_percent: r.rate_percent })), { specialty: 'صب', rate_percent: '0.3' }] })).status, 200);
  assert.ok((await call('GET', '/admin/specialty-rates')).data.some((r) => r.specialty === 'صب'));
});

test('الصورة الرئيسية للمنتج: عند الإضافة أو التعديل', async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: 'عقد صور', product_type: 'عقد', karats: '21', colors: 'yellow', main_new: '2' })) f.append(k, v);
  for (const n of ['1.png', '2.png', '3.png']) f.append('files', new Blob([PNG1], { type: 'image/png' }), n);
  const p = (await call('POST', '/catalog/products', null, f)).data;
  const media = async () => (await pool.query('select id from product_media where product_id=$1 order by sort, id', [p.id])).rows.map((r) => r.id);
  const m = await media();
  assert.equal(m.length, 3);
  const all = (await pool.query('select id from product_media where product_id=$1 order by id', [p.id])).rows.map((r) => r.id);
  assert.equal(m[0], all[2], 'الصورة الثالثة أصبحت الرئيسية');
  const u = new FormData();
  for (const [k, v] of Object.entries({ name: 'عقد صور', product_type: 'عقد', karats: '21', colors: 'yellow', main_media: String(all[1]) })) u.append(k, v);
  assert.equal((await call('PUT', `/catalog/products/${p.id}`, null, u)).status, 200);
  assert.equal((await media())[0], all[1], 'تغيير الرئيسية لصورة محفوظة');
});

test('مدير المتجر بدون صلاحية المخزون يرى أنواع الألماس المخبري في نموذج المنتج (بدون الكميات)', async () => {
  const { hashPassword } = await import('../src/lib/auth.js');
  await pool.query("insert into roles(code, name) values ('store_mgr_t','مدير متجر اختبار') on conflict do nothing");
  await pool.query("insert into role_permissions values ('store_mgr_t','products.manage') on conflict do nothing");
  await pool.query("insert into users(username, password_hash, full_name, role_code, must_change_password) values ('storemgr',$1,'مدير المتجر','store_mgr_t',false)", [hashPassword('Store#2026m')]);
  const shape = (await call('GET', '/stones/shapes')).data[0];
  const fl = new FormData(); for (const [k, v] of Object.entries({ shape_id: shape.id, size_label: '7.77 mm', carats: '2' })) fl.append(k, v);
  const lot = (await call('POST', '/stones', null, fl)).data;
  let ck = '';
  const sm = async (m, p, body, form) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, ...(form ? {} : { 'content-type': 'application/json' }) }, body: form || (body ? JSON.stringify(body) : undefined) }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  assert.equal((await sm('POST', '/auth/login', { username: 'storemgr', password: 'Store#2026m' })).status, 200);
  assert.equal((await sm('GET', '/stones')).status, 403, 'لا يدخل المخزون');
  assert.equal((await sm('GET', '/admin/pricing')).status, 403, 'مدير المتجر لا يرى التسعيرة');
  assert.equal((await call('GET', '/admin/pricing')).status, 200, 'المدير يرى التسعيرة');
  const lots = (await sm('GET', '/catalog/diamond-lots')).data;
  const l = lots.find((x) => x.id === lot.id);
  assert.ok(l && l.available === true && l.stock_carats === undefined, JSON.stringify({ lot, l }));
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: 'خاتم ألماس', product_type: 'خاتم', karats: '18', colors: 'white', diamonds: JSON.stringify([{ lot_id: lot.id, carats: '0.5', count: '1' }]) })) f.append(k, v);
  const p = await sm('POST', '/catalog/products', null, f);
  assert.equal(p.status, 200, JSON.stringify(p.data));
});

test('طلب السلة برقم واحد وبنود، وبدء إنتاج الطلب كاملاً، وتقسيم كمية بند حسب الشغل', async () => {
  const mk = async (name) => { const f = new FormData(); for (const [k, v] of Object.entries({ name, product_type: 'خاتم', karats: '21', colors: 'yellow', approx_weight: '2', labor_method: 'per_gram', labor_rate: '10' })) f.append(k, v); return (await call('POST', '/catalog/products', null, f)).data; };
  const p1 = await mk('خاتم بند 1');
  const p2 = await mk('خاتم بند 2');
  const { hashPassword } = await import('../src/lib/auth.js');
  const c = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('محل البنود','م','0500000123','approved') returning id")).rows[0].id;
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('grpshop',$1,'م','customer',$2,false)", [hashPassword('Group#2026s'), c]);
  let ck = '';
  const cu = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  assert.equal((await cu('POST', '/auth/login', { username: 'grpshop', password: 'Group#2026s' })).status, 200);
  const sent = (await cu('POST', '/store/orders', { items: [{ product_id: p1.id, karat: 21, quantity: 10 }, { product_id: p2.id, karat: 21, quantity: 3 }] })).data;
  assert.match(sent.cart_ref, /^ORD-\d{4}-\d+$/);
  assert.deepEqual(sent.orders.map((o) => o.order_no), [`${sent.cart_ref}-1`, `${sent.cart_ref}-2`], 'بنود برقم الطلب نفسه');
  // تقسيم البند الأول: 4 قطع لمسار آخر
  const id1 = sent.orders[0].id;
  const route2 = (await pool.query('select id from routes where active order by id desc limit 1')).rows[0].id;
  assert.equal((await call('POST', `/orders/${id1}/split`, { quantity: 10 })).status, 400, 'لا تُفصل كل الكمية');
  const sp = await call('POST', `/orders/${id1}/split`, { quantity: 4, route_id: route2 });
  assert.equal(sp.status, 200, JSON.stringify(sp.data));
  assert.equal(sp.data.order_no, `${sent.cart_ref}-3`);
  const a = (await pool.query('select quantity, approx_weight::float w, labor_estimate::float e from orders where id=$1', [id1])).rows[0];
  const b = (await pool.query('select quantity, approx_weight::float w, labor_estimate::float e, route_id, cart_ref from orders where id=$1', [sp.data.id])).rows[0];
  assert.deepEqual([a.quantity, b.quantity], [6, 4]);
  assert.equal(Number((a.w + b.w).toFixed(4)), 20, 'الوزن التقريبي مقسوم بالنسبة');
  assert.equal(b.route_id, route2);
  assert.equal(b.cart_ref, sent.cart_ref);
  const d = (await call('GET', `/orders/${id1}`)).data;
  assert.equal(d.siblings.length, 3, 'بنود الطلب تظهر في التفاصيل');
  // بدء إنتاج الطلب كاملاً
  const st = await call('POST', '/orders/group/start', { ref: sent.cart_ref });
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.equal(st.data.started.length, 3);
  assert.equal((await pool.query("select count(*)::int n from orders where cart_ref=$1 and status='in_production'", [sent.cart_ref])).rows[0].n, 3);
  assert.equal((await call('POST', `/orders/${sp.data.id}/split`, { quantity: 1 })).status, 409, 'لا تقسيم بعد بدء الإنتاج');
  // العميل يرى الطلب كاملاً ببنوده
  const mine = (await cu('GET', '/store/orders')).data.filter((o) => o.cart_ref === sent.cart_ref);
  assert.equal(mine.length, 3);
  const det = (await cu('GET', `/store/orders/${id1}`)).data;
  assert.equal(det.items.length, 3, 'تفاصيل الطلب تعرض كل منتجاته');
  assert.equal(det.history, undefined, 'لا يُرسل سجل المراحل');
});

test('العميل: حذف الطلب الذي لم يُقبل، وملاحظة على الطلب قيد التصنيع', async () => {
  let ck = '';
  const cu = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  assert.equal((await cu('POST', '/auth/login', { username: 'grpshop', password: 'Group#2026s' })).status, 200);
  const prods = (await cu('GET', '/store/products?limit=2')).data.products;
  const sent = (await cu('POST', '/store/orders', { items: prods.map((p) => ({ product_id: p.id, karat: 21, quantity: 1 })) })).data;
  const [a, b] = sent.orders;
  // ملاحظة على طلب لم يبدأ تصنيعه: غير متاحة
  assert.equal((await cu('POST', `/store/orders/${a.id}/note`, { note: 'x' })).status, 409);
  // حذف بند واحد
  assert.equal((await cu('POST', `/store/orders/${a.id}/cancel`, {})).status, 200);
  let mine = (await cu('GET', '/store/orders')).data.filter((o) => o.cart_ref === sent.cart_ref);
  assert.deepEqual(mine.map((o) => o.id), [b.id], 'المحذوف لا يظهر في طلباتي');
  // بعد بدء الإنتاج لا يُحذف، وتُرسل ملاحظة
  assert.equal((await call('POST', `/orders/${b.id}/start`, {})).status, 200);
  assert.equal((await cu('POST', `/store/orders/${b.id}/cancel`, {})).status, 409, 'لا حذف بعد القبول');
  assert.equal((await cu('POST', `/store/orders/${b.id}/note`, { note: '' })).status, 400);
  assert.equal((await cu('POST', `/store/orders/${b.id}/note`, { note: 'نرجو تلميع إضافي' })).status, 200);
  const det = (await cu('GET', `/store/orders/${b.id}`)).data;
  assert.equal(det.notes[0].note, 'نرجو تلميع إضافي');
  const staff = (await call('GET', `/orders/${b.id}`)).data;
  assert.ok(staff.log.some((l) => l.event === 'customer_note' && l.note === 'نرجو تلميع إضافي'), 'الملاحظة تظهر للمصنع');
  // حذف الطلب كاملاً
  const s2 = (await cu('POST', '/store/orders', { items: prods.map((p) => ({ product_id: p.id, karat: 21, quantity: 1 })) })).data;
  const r = await cu('POST', `/store/orders/${s2.orders[0].id}/cancel`, { all: true });
  assert.equal(r.data.cancelled.length, 2);
  mine = (await cu('GET', '/store/orders')).data.filter((o) => o.cart_ref === s2.cart_ref);
  assert.equal(mine.length, 0);
});

test('مدة تنفيذ الطلب: حسب الفئة وتصنيف العميل، والمتوفر في المخزون بدون مدة', async () => {
  const tiers = (await call('GET', '/admin/lead-times')).data.tiers;
  const gold = tiers.find((t) => /ذهبي/.test(t.name));
  assert.ok(gold);
  const put = await call('PUT', '/admin/lead-times', { rows: [
    { kind: 'catalog', category: 'gold', tier_id: null, days: 14 }, { kind: 'catalog', category: 'diamond', tier_id: null, days: 21 },
    { kind: 'catalog', category: 'diamond', tier_id: gold.id, days: 10 }, { kind: 'catalog', category: 'gold', tier_id: gold.id, days: 18 },
  ] });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const { hashPassword } = await import('../src/lib/auth.js');
  const c = (await pool.query("insert into customers(shop_name, owner_name, phone, status, tier_id) values ('محل المدة','م','0500000777','approved',$1) returning id", [gold.id])).rows[0].id;
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('leadshop',$1,'م','customer',$2,false)", [hashPassword('Lead#2026shop'), c]);
  let ck = '';
  const cu = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  assert.equal((await cu('POST', '/auth/login', { username: 'leadshop', password: 'Lead#2026shop' })).status, 200);
  const mk = async (fields) => { const f = new FormData(); for (const [k, v] of Object.entries({ product_type: 'خاتم', karats: '21', colors: 'yellow', ...fields })) f.append(k, v); return (await call('POST', '/catalog/products', null, f)).data; };
  const pGold = await mk({ name: 'خاتم ذهب مدة' });
  const pDia = await mk({ name: 'خاتم ألماس مخبري مدة' });
  const pStock = await mk({ name: 'خاتم جاهز مدة', availability: 'available' });
  await pool.query('update products set stock_qty=5 where id=$1', [pStock.id]);
  const { calendarDays: cd } = await import('../src/lib/leadTime.js');
  const days = (d) => Math.round((new Date(d) - new Date(new Date().toISOString().slice(0, 10))) / 864e5);
  assert.equal((await cu('GET', `/store/products/${pDia.id}`)).data.lead_days, 10, 'ألماس لعميل ذهبي');
  assert.equal((await cu('GET', `/store/products/${pGold.id}`)).data.lead_days, 18, 'ذهب لعميل ذهبي');
  assert.equal((await cu('GET', `/store/products/${pStock.id}`)).data.lead_days, null, 'المتوفر بدون مدة');
  const sent = (await cu('POST', '/store/orders', { items: [pGold, pDia, pStock].map((p) => ({ product_id: p.id, karat: 21, quantity: 1 })) })).data;
  const due = async (id) => (await pool.query("select to_char(due_date,'YYYY-MM-DD') d, due_auto from orders where id=$1", [id])).rows[0];
  const [g, d, s] = await Promise.all(sent.orders.map((o) => due(o.id)));
  assert.ok(Math.abs(days(g.d) - cd(18)) <= 1 && g.due_auto, JSON.stringify(g));
  assert.ok(Math.abs(days(d.d) - cd(10)) <= 1, JSON.stringify(d));
  assert.equal(s.d, null, 'المتوفر في المخزون بدون موعد');
  // التصميم الخاص: نفس مدة حسب الطلب، والموعد الذي يطلبه العميل لا يتغير
  assert.equal((await cu('GET', '/store/lead-times')).data.custom_gold, 18);
  const f1 = new FormData(); for (const [k, v] of Object.entries({ product_type: 'حلق', karat: '21' })) f1.append(k, v);
  const c1 = await fetch(base + '/api/store/custom', { method: 'POST', headers: { cookie: ck }, body: f1 }).then((r) => r.json());
  assert.ok(Math.abs(days((await due(c1.id)).d) - cd(18)) <= 1);
  const f2 = new FormData(); for (const [k, v] of Object.entries({ product_type: 'حلق', karat: '21', due_date: '2027-01-15' })) f2.append(k, v);
  const c2 = await fetch(base + '/api/store/custom', { method: 'POST', headers: { cookie: ck }, body: f2 }).then((r) => r.json());
  assert.deepEqual(await due(c2.id), { d: '2027-01-15', due_auto: false });
  // بدء الإنتاج يعيد حساب الموعد التلقائي فقط
  await call('POST', `/orders/${sent.orders[0].id}/start`, {});
  assert.ok(Math.abs(days((await due(sent.orders[0].id)).d) - cd(18)) <= 1);
});

test('مدة التنفيذ بأيام العمل: الجمعة لا تُحسب ولا يقع الموعد فيها', async () => {
  const { calendarDays } = await import('../src/lib/leadTime.js');
  const d = (s) => new Date(`${s}T12:00:00Z`);
  assert.equal(calendarDays(6, d('2026-11-07')), 7, 'من السبت 6 أيام عمل = السبت التالي');
  assert.equal(calendarDays(1, d('2026-11-12')), 2, 'من الخميس يوم عمل = السبت');
  assert.equal(calendarDays(1, d('2026-11-11')), 1);
  assert.equal(calendarDays(14, d('2026-11-07')), 16, 'جمعتان لا تُحسبان');
  for (let n = 0; n < 40; n++) for (const day of ['2026-11-07', '2026-11-10', '2026-11-12', '2026-11-13']) {
    const due = new Date(d(day).getTime() + calendarDays(n, d(day)) * 864e5);
    assert.notEqual(due.getUTCDay(), 5, `الموعد لا يقع يوم جمعة (${day} + ${n})`);
  }
});

test('الطاقة الإنتاجية اليومية: اليوم الممتلئ يؤجل موعد الطلب الجديد يوماً لكل يوم مشغول', async () => {
  const { calendarDays } = await import('../src/lib/leadTime.js');
  await call('PUT', '/admin/lead-times', { rows: [{ kind: 'catalog', category: 'gold', tier_id: null, days: 5 }] });
  assert.equal((await call('PUT', '/admin/settings', { capacity: { orders: 'abc' } })).status, 400);
  assert.equal((await call('PUT', '/admin/settings', { capacity: { orders: '1', grams: '', pieces: '' } })).status, 200);
  const mat = (await pool.query("select id from materials where karat=21 and active limit 1")).rows[0].id;
  // تفريغ الأيام القادمة من طلبات الاختبارات السابقة حتى يكون الحساب واضحاً
  await pool.query("update orders set due_date = null where due_date >= (now() at time zone 'Asia/Riyadh')::date");
  const mk = async (t) => (await call('POST', '/orders', { title: t, product_type: 'حلقة', karat: 21, material_id: mat, quantity: 1, start: false })).data.id;
  const due = async (id) => (await pool.query("select to_char(due_date,'YYYY-MM-DD') d from orders where id=$1", [id])).rows[0].d;
  const nextWork = (iso) => { const d = new Date(`${iso}T00:00:00Z`); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 5); return d.toISOString().slice(0, 10); };
  const base = new Date(Date.now() + 3 * 3600e3 + calendarDays(5) * 864e5).toISOString().slice(0, 10);
  const a = await due(await mk('طاقة 1'));
  const b = await due(await mk('طاقة 2'));
  const c = await due(await mk('طاقة 3'));
  assert.equal(a, base, 'اليوم المحسوب فارغ');
  assert.equal(b, nextWork(base), 'يوم مشغول = يوم إضافي');
  assert.equal(c, nextWork(nextWork(base)), 'يومان مشغولان = يومان إضافيان');
  for (const x of [a, b, c]) assert.notEqual(new Date(`${x}T00:00:00Z`).getUTCDay(), 5, 'لا يقع يوم جمعة');
  // بدون حد: نفس يوم الموعد المحسوب
  await call('PUT', '/admin/settings', { capacity: { orders: '', grams: '', pieces: '' } });
  assert.equal(await due(await mk('بدون حد')), base);
  // حد الجرامات: طلب أكبر من الحد يأخذ يوماً فارغاً كاملاً
  await call('PUT', '/admin/settings', { capacity: { grams: '10' } });
  const w = async (g) => due((await call('POST', '/orders', { title: `وزن ${g}`, product_type: 'حلقة', karat: 21, material_id: mat, approx_weight: g, start: false })).data.id);
  assert.equal(await w('8'), base, '8 جم ضمن حد 10');
  assert.equal(await w('5'), nextWork(base), '8 + 5 > 10 → اليوم التالي');
  await call('PUT', '/admin/settings', { capacity: {} });
});

test('السبائك: صنف في المتجر، سبائك أو جنيهات بوزن القطعة، وتنتقل للطلب', async () => {
  const mk = async (name, extra = {}) => { const f = new FormData(); for (const [k, v] of Object.entries({ name, product_type: 'تعليقة', karats: '21', colors: 'yellow', ...extra })) f.append(k, v); return (await call('POST', '/catalog/products', null, f)); };
  assert.equal((await mk('جنيه خطأ', { bullion_type: 'gold' })).status, 400);
  const coin = (await mk('تعليقة جنيه', { bullion_type: 'coin', bullion_weight: '8' })).data;
  const plain = (await mk('تعليقة ذهب')).data;
  assert.deepEqual([coin.bullion_type, Number(coin.bullion_weight)], ['coin', 8]);
  const { hashPassword } = await import('../src/lib/auth.js');
  const cid = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('محل السبائك','م','0500004444','approved') returning id")).rows[0].id;
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('bullshop',$1,'م','customer',$2,false)", [hashPassword('Bull#2026shop'), cid]);
  let ck = '';
  const cu = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
  await cu('POST', '/auth/login', { username: 'bullshop', password: 'Bull#2026shop' });
  const ids = (q) => cu('GET', `/store/products?limit=200&${q}`).then((r) => r.data.products.map((p) => p.id));
  const bull = await ids('cat=bullion');
  assert.ok(bull.includes(coin.id) && !bull.includes(plain.id), 'صنف السبائك');
  const gold = await ids('cat=gold');
  assert.ok(gold.includes(plain.id) && !gold.includes(coin.id), 'الذهب لا يشمل السبائك');
  assert.equal((await cu('GET', `/store/products/${coin.id}`)).data.bullion_type, 'coin');
  // تنتقل للطلب
  const o = (await cu('POST', '/store/orders', { items: [{ product_id: coin.id, karat: 21, quantity: 2 }] })).data.orders[0];
  const row = (await pool.query('select bullion_type, bullion_weight::float w from orders where id=$1', [o.id])).rows[0];
  assert.deepEqual([row.bullion_type, row.w], ['coin', 8]);
  // تصميم خاص بسبيكة
  const fd = new FormData(); for (const [k, v] of Object.entries({ product_type: 'تعليقة', karat: '21', bullion_type: 'bar', bullion_weight: '20' })) fd.append(k, v);
  const c = await fetch(base + '/api/store/custom', { method: 'POST', headers: { cookie: ck }, body: fd }).then((r) => r.json());
  assert.equal((await pool.query('select bullion_type from orders where id=$1', [c.id])).rows[0].bullion_type, 'bar');
});

test('تخصيص المنتج: الافتراضي للجميع، أو لعملاء بالاسم أو بالفئة فقط', async () => {
  const { hashPassword } = await import('../src/lib/auth.js');
  const tier = (await pool.query("insert into customer_tiers(name) values ('فئة خاصة للتخصيص') returning id")).rows[0].id;
  const mkC = async (u, t) => {
    const id = (await pool.query("insert into customers(shop_name, owner_name, phone, status, tier_id) values ($1,'م',$2,'approved',$3) returning id", [`محل ${u}`, `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, t])).rows[0].id;
    await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ($1,$2,'م','customer',$3,false)", [u, hashPassword('Aud#2026shop'), id]);
    let ck = '';
    const cu = async (m, p, b) => { const r = await fetch(base + '/api' + p, { method: m, headers: { cookie: ck, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { status: r.status, data: await r.json() }; };
    await cu('POST', '/auth/login', { username: u, password: 'Aud#2026shop' });
    return { id, cu };
  };
  const named = await mkC('audnamed', null);
  const tiered = await mkC('audtier', tier);
  const other = await mkC('audother', null);
  const mk = async (name, extra = {}) => { const f = new FormData(); for (const [k, v] of Object.entries({ name, product_type: 'خاتم', karats: '21', colors: 'yellow', ...extra })) f.append(k, v); return (await call('POST', '/catalog/products', null, f)).data; };
  const pub = await mk('منتج عام');
  const priv = await mk('منتج مخصص', { allowed_customer_ids: String(named.id), allowed_tier_ids: String(tier) });
  assert.deepEqual([pub.allowed_customer_ids, pub.allowed_tier_ids], [[], []], 'الافتراضي بدون تخصيص');
  const sees = async (c) => (await c.cu('GET', '/store/products?limit=200')).data.products.map((p) => p.id);
  for (const c of [named, tiered]) {
    const ids = await sees(c);
    assert.ok(ids.includes(pub.id) && ids.includes(priv.id), 'العميل المخصص يرى المنتج');
    assert.equal((await c.cu('GET', `/store/products/${priv.id}`)).status, 200);
  }
  const ids = await sees(other);
  assert.ok(ids.includes(pub.id) && !ids.includes(priv.id), 'غيره لا يرى المنتج المخصص');
  assert.equal((await other.cu('GET', `/store/products/${priv.id}`)).status, 404);
  assert.equal((await other.cu('POST', '/store/orders', { items: [{ product_id: priv.id, karat: 21, quantity: 1 }] })).status, 400, 'ولا يستطيع طلبه');
  assert.ok((await call('GET', '/catalog/audience')).data.customers.some((c) => c.id === named.id));
  // إلغاء التخصيص: يرجع للجميع
  const f = new FormData(); for (const [k, v] of Object.entries({ name: 'منتج مخصص', product_type: 'خاتم', karats: '21', colors: 'yellow', allowed_customer_ids: '', allowed_tier_ids: '' })) f.append(k, v);
  assert.equal((await call('PUT', `/catalog/products/${priv.id}`, null, f)).status, 200);
  assert.ok((await sees(other)).includes(priv.id));
});

test('نوع القطعة طقم: رقم المنتج TKM000001', async () => {
  assert.ok((await call('GET', '/catalog/product-types')).data.some((t) => t.name === 'طقم' && t.prefix === 'TKM'));
  assert.equal((await call('GET', `/catalog/next-sku?type=${encodeURIComponent('طقم')}`)).data.sku, 'TKM000001');
});
