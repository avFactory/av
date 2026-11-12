// كشف حساب العميل: مبالغ وذهب، رصيد افتتاحي، ومستندات سداد من العميل تُعتمد أو تُرفض
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory_test';
process.env.ADMIN_PASSWORD = 'Admin#2026pass';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/goldfactory-test-uploads';

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/auth.js');
const ledger = await import('../src/lib/ledger.js');

let server, base;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function client() {
  let cookie = '';
  return async (method, p, body, form) => {
    const h = { cookie };
    if (!form && body) h['content-type'] = 'application/json';
    const r = await fetch(base + '/api' + p, { method, headers: h, body: form || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : null };
  };
}
const admin = client();
const form = (o, file = true) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); if (file) f.append('document', new Blob([PNG], { type: 'image/png' }), 'receipt.png'); return f; };

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate({ log: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await admin('POST', '/auth/login', { username: 'admin', password: 'Admin#2026pass' });
});
after(async () => { server?.close(); await pool.end(); });

test('كشف الحساب: أجور وألماس مدين، المستلم دائن، ذهب مباع/مسدد، رصيد افتتاحي، ومستندات سداد', async () => {
  const cid = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('محل الكشف','م','0500001111','approved') returning id")).rows[0].id;
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('stmtshop',$1,'م','customer',$2,false)", [hashPassword('Stmt#2026shop'), cid]);
  const cu = client();
  assert.equal((await cu('POST', '/auth/login', { username: 'stmtshop', password: 'Stmt#2026shop' })).status, 200);
  const m21 = (await pool.query("select id from materials where karat=21 and active limit 1")).rows[0].id;
  const m18 = (await pool.query("select id from materials where karat=18 and active limit 1")).rows[0].id;

  // رصيد افتتاحي: عليه 1000 ريال و 10 جم عيار 21
  const op = await admin('POST', `/finance/customers/${cid}/entries`, null, form({ kind: 'opening', money_debit: '1000', gold_debit: '10', karat: '21', entry_date: '2026-01-01', description: 'من النظام السابق' }, false));
  assert.equal(op.status, 200, JSON.stringify(op.data));
  assert.equal((await admin('POST', `/finance/customers/${cid}/entries`, null, form({ kind: 'opening', money_debit: '5' }, false))).status, 409, 'رصيد افتتاحي واحد');

  // فاتورة: أجور 100 + ألماس 200 + ضريبة 45 = 345
  const o = (await admin('POST', '/orders', { title: 'خاتم', product_type: 'خاتم', karat: 21, material_id: m21, customer_id: cid, start: false })).data;
  await pool.query(`insert into invoices(invoice_no, icv, customer_id, subtotal, vat_rate, vat_amount, total, invoice_hash, qr_tlv) values ('INV-T-1', 99001, $1, 300, 15, 45, 345, 'h', 'q')`, [cid]);
  const inv = (await pool.query("select id from invoices where invoice_no='INV-T-1'")).rows[0].id;
  await pool.query(`insert into invoice_lines(invoice_id, order_id, kind, description, qty, unit, unit_price, amount) values ($1,$2,'labor','أجور',1,'قطعة',100,100), ($1,$2,'stones','ألماس',1,'قطعة',200,200)`, [inv, o.id]);
  // دفعة مستلمة 300
  await admin('POST', '/finance/payments', { customer_id: cid, amount: '300', method: 'cash' });
  // ذهب: العميل سلّم 5 جم على الطلب، وسُلّم له الطلب بوزن 8 جم
  await ledger.post(pool, { kind: 'customer_gold_in', material_id: m21, weight: '5', from: ['external', cid], to: ['order', o.id], order_id: o.id, user_id: 1 });
  await ledger.post(pool, { kind: 'delivery', material_id: m21, weight: '8', from: ['order', o.id], to: ['delivered', o.id], order_id: o.id, user_id: 1 });

  let st = (await admin('GET', `/finance/customers/${cid}/statement`)).data;
  // مبالغ: 1000 + 345 − 300 = 1045 ؛ ذهب عيار 21: 10 + 8 − 5 = 13 جم = 11.375 صافي 24
  assert.equal(st.balance.money, 1045);
  assert.equal(st.balance.by_karat['21'], 13);
  assert.equal(st.balance.pure, 11.375);
  const invRow = st.rows.find((r) => r.ref === 'INV-T-1');
  assert.deepEqual([invRow.money_debit, invRow.labor, invRow.stones], [345, 100, 200], 'الأجور وقيمة الألماس مدين');
  assert.match(invRow.description, /أجور 100/);
  assert.match(invRow.description, /ألماس مخبري 200/);
  assert.equal(st.rows[0].type, 'opening', 'الرصيد الافتتاحي أولاً');

  // العميل يرفع مستند تحويل 500 ومستند تسليم ذهب 4 جم عيار 18
  assert.equal((await cu('POST', '/store/submissions', null, form({ kind: 'money', amount: '500' }, false))).status, 400, 'المستند إلزامي');
  const s1 = await cu('POST', '/store/submissions', null, form({ kind: 'money', amount: '500', method: 'transfer', reference: 'TRX-1', paid_at: '2026-11-01' }));
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  const s2 = (await cu('POST', '/store/submissions', null, form({ kind: 'gold', weight: '4', karat: '18', note: 'تسليم سبائك' }) /* العيار يُفرض 24 */)).data;
  const s3 = (await cu('POST', '/store/submissions', null, form({ kind: 'money', amount: '50' }))).data;
  // قبل الاعتماد لا يتغير الرصيد
  assert.equal((await cu('GET', '/store/statement')).data.balance.money, 1045);
  const m24 = (await pool.query("select id from materials where metal='gold' and karat=24 and active order by id limit 1")).rows[0].id;
  const vault18 = async () => Number((await pool.query("select coalesce(sum(balance),0) b from gold_balances where loc_type='vault' and material_id=$1", [m24])).rows[0].b);
  const v0 = await vault18();
  assert.equal((await admin('POST', `/finance/submissions/${s1.data.id}/approve`, {})).status, 200);
  assert.equal((await admin('POST', `/finance/submissions/${s2.id}/approve`, {})).status, 200);
  assert.equal((await admin('POST', `/finance/submissions/${s3.id}/reject`, { reason: 'المستند غير واضح' })).status, 200);
  assert.equal((await admin('POST', `/finance/submissions/${s1.data.id}/approve`, {})).status, 409, 'لا اعتماد مرتين');
  assert.equal(await vault18(), v0 + 4, 'الذهب المسدد دخل الخزنة');

  st = (await cu('GET', '/store/statement')).data;
  assert.equal(st.balance.money, 545, '1045 − 500');
  assert.equal(st.balance.by_karat['24'], -4, 'سداد الذهب بعيار 24 فقط');
  assert.equal(st.balance.pure, 11.375 - 4, '4 جم عيار 24 = 4 صافي');
  assert.deepEqual(st.submissions.map((s) => s.status).sort(), ['approved', 'approved', 'rejected']);

  // كشف لفترة: رصيد سابق ثم حركات الفترة فقط
  const p = (await admin('GET', `/finance/customers/${cid}/statement?from=2026-11-01&to=2099-12-31`)).data;
  assert.ok(p.rows.every((r) => r.date >= '2026-11-01'));
  assert.equal(p.opening.money, 1000, 'الرصيد الافتتاحي قبل الفترة');
  assert.equal(p.closing.money, 545);

  // إلغاء قيد سداد الذهب يعيد الرصيد ويخرج الذهب من الخزنة
  const ge = st.rows.find((r) => r.type === 'gold_payment');
  assert.equal((await admin('POST', `/finance/entries/${ge.entry_id}/reverse`, { reason: 'خطأ' })).status, 200);
  assert.equal(await vault18(), v0);
  assert.equal((await admin('GET', `/finance/customers/${cid}/statement`)).data.balance.pure, 11.375);

  // صلاحيات: العميل لا يرى كشف عميل آخر عبر مسار الموظفين
  assert.equal((await cu('GET', `/finance/customers/${cid}/statement`)).status, 403);
  assert.equal((await cu('POST', `/finance/submissions/${s3.id}/approve`, {})).status, 403);
  const xl = await fetch(`${base}/api/finance/customers/${cid}/statement.xlsx`, { headers: { cookie: '' } });
  assert.equal(xl.status, 401);
});

test('كشف حساب منفصل لكل فرع: رصيد افتتاحي ومدفوعات ومستندات لكل فرع، والفرع يرى كشفه فقط', async () => {
  const cid = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('شركة الفروع','م','0500002222','approved') returning id")).rows[0].id;
  const [ba, bb] = (await pool.query("insert into customer_branches(customer_id, name, phone) values ($1,'فرع أ','0511111111'),($1,'فرع ب','0522222222') returning id", [cid])).rows.map((r) => r.id);
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, must_change_password) values ('brmain',$1,'م','customer',$2,false)", [hashPassword('Brmain#2026'), cid]);
  await pool.query("insert into users(username, password_hash, full_name, role_code, customer_id, branch_id, must_change_password) values ('br-a-x',$1,'أ','customer',$2,$3,false)", [hashPassword('BranchA#2026'), cid, ba]);
  // رصيد افتتاحي لكل فرع، ولا يتكرر لنفس الفرع
  assert.equal((await admin('POST', `/finance/customers/${cid}/entries`, null, form({ kind: 'opening', money_debit: '1000', branch_id: String(ba) }, false))).status, 200);
  assert.equal((await admin('POST', `/finance/customers/${cid}/entries`, null, form({ kind: 'opening', money_debit: '300', gold_debit: '2', karat: '21', branch_id: String(bb) }, false))).status, 200);
  assert.equal((await admin('POST', `/finance/customers/${cid}/entries`, null, form({ kind: 'opening', money_debit: '5', branch_id: String(ba) }, false))).status, 409);
  const other = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('آخر','م','0500003333','approved') returning id")).rows[0].id;
  const ob = (await pool.query("insert into customer_branches(customer_id, name, phone) values ($1,'فرع غريب','0533333333') returning id", [other])).rows[0].id;
  assert.equal((await admin('POST', `/finance/customers/${cid}/entries`, null, form({ kind: 'money_adjust', money_debit: '5', branch_id: String(ob) }, false))).status, 400, 'فرع عميل آخر');
  // دفعة لفرع أ
  assert.equal((await admin('POST', '/finance/payments', { customer_id: cid, amount: '400', method: 'cash', branch_id: ba })).status, 200);
  const S = async (b) => (await admin('GET', `/finance/customers/${cid}/statement${b ? `?branch=${b}` : ''}`)).data;
  assert.equal((await S(ba)).balance.money, 600, 'فرع أ: 1000 − 400');
  assert.equal((await S(bb)).balance.money, 300, 'فرع ب منفصل');
  assert.equal((await S(bb)).balance.by_karat['21'], 2);
  assert.equal((await S()).balance.money, 900, 'كل الفروع مجمّعة');
  assert.equal((await S('main')).balance.money, 0, 'الحساب الرئيسي');
  // حساب الفرع يرى كشف فرعه فقط حتى لو طلب فرعاً آخر
  const cu = client();
  const opts = await fetch(base + '/api/auth/login-options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'brmain' }) }).then((r) => r.json());
  assert.equal((await cu('POST', '/auth/login', { username: 'brmain', password: 'BranchA#2026', branch_id: opts.branches.find((x) => x.name === 'فرع أ').id })).status, 200);
  const mine = (await cu('GET', `/store/statement?branch=${bb}`)).data;
  assert.equal(mine.balance.money, 600);
  assert.equal(mine.scope, ba);
  // مستند سداد من الفرع يُعتمد في حساب الفرع نفسه
  const sub = (await cu('POST', '/store/submissions', null, form({ kind: 'money', amount: '100' }))).data;
  assert.equal(sub.branch_id, ba);
  await admin('POST', `/finance/submissions/${sub.id}/approve`, {});
  assert.equal((await S(ba)).balance.money, 500);
  assert.equal((await S(bb)).balance.money, 300, 'لم يتأثر فرع ب');
  // الحساب الرئيسي يرى كل الفروع ويختار
  const main = client();
  assert.equal((await main('POST', '/auth/login', { username: 'brmain', password: 'Brmain#2026' })).status, 200);
  assert.equal((await main('GET', '/store/statement')).data.balance.money, 800);
  assert.equal((await main('GET', `/store/statement?branch=${bb}`)).data.balance.money, 300);
});

test('الفوترة على الطلب كاملاً: سطر واحد بمبلغ شامل الضريبة وذهب صافي 24، والكشف بالطلب', async () => {
  const cid = (await pool.query("insert into customers(shop_name, owner_name, phone, status) values ('محل الفوترة بالطلب','م','0500002222','approved') returning id")).rows[0].id;
  const m21 = (await pool.query("select id from materials where karat=21 and active limit 1")).rows[0].id;
  const mk = async (t, q) => (await admin('POST', '/orders', { title: t, product_type: t, karat: 21, quantity: q, material_id: m21, customer_id: cid })).data.id;
  const a = await mk('خاتم', 3), b = await mk('عقد', 2);
  await pool.query("update orders set cart_ref='ORD-2026-888888', final_weight=8, final_gold_weight=8 where id = any($1::int[])", [[a, b]]);
  const inv = (await admin('GET', `/finance/invoiceable?customer_id=${cid}`)).data;
  assert.equal(inv.length, 1, 'الطلب مرة واحدة مهما كان عدد أصنافه');
  assert.deepEqual([inv[0].key, inv[0].count, inv[0].pieces, inv[0].gold24], ['ORD-2026-888888', 2, 5, 14], 'الذهب المقترح: 16 جم عيار 21 = 14 صافي');
  const r = await admin('POST', '/finance/invoices', { customer_id: cid, orders: [{ order_id: b, amount: '4000', gold24: '5' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(Number(r.data.total), 4000, 'الإجمالي شامل الضريبة كما أُدخل');
  const lines = (await pool.query('select gold24::float g, covers, order_id from invoice_lines where invoice_id=$1', [r.data.id])).rows;
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].g, lines[0].order_id, lines[0].covers.sort()], [5, a, [a, b].sort()]);
  assert.equal((await admin('POST', '/finance/invoices', { customer_id: cid, orders: [{ order_id: a, amount: '10', gold24: '1' }] })).status, 409, 'مفوتر مسبقاً');
  assert.equal((await admin('GET', `/finance/invoiceable?customer_id=${cid}`)).data.length, 0);
  // الكشف: سطر الطلب بالمبلغ والذهب الصافي
  const st = (await admin('GET', `/finance/customers/${cid}/statement`)).data;
  const row = st.rows.find((x) => x.ref === r.data.invoice_no);
  assert.deepEqual([row.money_debit, row.gold_debit, row.karat, row.pure_debit], [4000, 5, 24, 5]);
  assert.match(row.description, /ORD-2026-888888/);
  assert.equal(st.balance.money, 4000);
  assert.equal(st.balance.pure, 5);
});
