// كشف حساب العميل (مبالغ وذهب)، الرصيد الافتتاحي والقيود، ومستندات السداد التي يرفعها العميل
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { HttpError, bad, conflict, notFound, int, str, oneOf, money, weight as W } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyCustomer, notifyPerm } from '../lib/notify.js';
import { upload, registerFiles } from '../lib/uploads.js';
import * as ledger from '../lib/ledger.js';
import { buildStatement } from '../lib/statement.js';
import { materialFor } from './orders.js';
import { sendXlsx } from '../lib/xlsx.js';

const KARATS = [18, 21, 22, 24];
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const period = (q) => ({ from: isoDate(q.from), to: isoDate(q.to) });

async function customerInfo(db, id) {
  const c = (await db.query(`select c.id, c.shop_name, c.owner_name, c.phone, c.vat_number, c.cr_number, c.city, c.address, t.name as tier_name
    from customers c left join customer_tiers t on t.id=c.tier_id where c.id=$1`, [id])).rows[0];
  if (!c) throw notFound('العميل غير موجود');
  return c;
}

const subsQuery = `select s.*, s.amount::text, s.weight::text, c.shop_name, b.name as branch_name, u.full_name as created_by_name, r.full_name as reviewed_by_name
  from customer_submissions s join customers c on c.id=s.customer_id left join customer_branches b on b.id=s.branch_id
  left join users u on u.id=s.created_by left join users r on r.id=s.reviewed_by`;

/** قيد ذهب يدخل الخزنة (سداد ذهب من العميل) */
async function goldIntoVault(db, req, customerId, karat, weight, reason) {
  const mat = await materialFor(db, karat);
  return ledger.post(db, { kind: 'customer_gold_payment', material_id: mat, weight, from: ['external', customerId], to: ['vault', null], reason, user_id: req.user.id });
}

// ================================================================ للموظفين (/api/finance)
export const staff = Router();

staff.get('/customers/:id/statement', requirePerm('finance.view', 'customers.view'), async (req, res) => {
  const id = int(req.params.id);
  const customer = await customerInfo(pool, id);
  const st = await buildStatement(pool, id, period(req.query));
  const submissions = await many(`${subsQuery} where s.customer_id=$1 order by (s.status='pending') desc, s.id desc limit 50`, [id]);
  res.json({ customer, ...st, submissions });
});

staff.get('/customers/:id/statement.xlsx', requirePerm('finance.view', 'customers.view'), async (req, res) => {
  const id = int(req.params.id);
  const c = await customerInfo(pool, id);
  const st = await buildStatement(pool, id, period(req.query));
  const rows = [{ date: '', description: 'رصيد سابق', ref: '', money_debit: '', money_credit: '', money_balance: st.opening.money, gold_debit: '', gold_credit: '', karat: '', pure_balance: st.opening.pure }, ...st.rows];
  await sendXlsx(res, `كشف حساب ${c.shop_name}`.slice(0, 31), [['التاريخ', 'date'], ['البيان', 'description'], ['المرجع', 'ref'],
    ['مدين (ر.س)', (x) => x.money_debit || ''], ['دائن (ر.س)', (x) => x.money_credit || ''], ['الرصيد (ر.س)', 'money_balance'],
    ['ذهب مدين (جم)', (x) => x.gold_debit || ''], ['ذهب دائن (جم)', (x) => x.gold_credit || ''], ['العيار', (x) => x.karat || ''], ['رصيد الذهب (صافي 24)', 'pure_balance']], rows, `statement-${id}.xlsx`);
});

/** قيد يدوي: رصيد افتتاحي، سداد ذهب (يدخل الخزنة)، أو تسوية */
staff.post('/customers/:id/entries', requirePerm('payments.manage'), upload.single('document'), async (req, res) => {
  const id = int(req.params.id);
  const b = req.body;
  res.json(await tx(async (db) => {
    await customerInfo(db, id);
    const kind = oneOf(b.kind, ['opening', 'gold_payment', 'money_adjust', 'gold_adjust'], 'نوع القيد');
    const amt = (k) => (b[k] === '' || b[k] == null ? '0' : money(b[k], 'المبلغ', { allowZero: true }));
    const wt = (k) => (b[k] === '' || b[k] == null ? '0' : W(b[k], 'الوزن', { allowZero: true }));
    let md = amt('money_debit'), mc = amt('money_credit'), gd = wt('gold_debit'), gc = wt('gold_credit');
    if (kind === 'gold_payment') { md = '0'; mc = '0'; gd = '0'; if (!(Number(gc) > 0)) throw bad('أدخل وزن الذهب المسدد'); }
    if (kind === 'money_adjust') { gd = '0'; gc = '0'; }
    if (kind === 'gold_adjust') { md = '0'; mc = '0'; }
    if (!(Number(md) || Number(mc) || Number(gd) || Number(gc))) throw bad('أدخل مبلغاً أو وزناً');
    if (Number(md) && Number(mc)) throw bad('المبلغ إما مدين أو دائن');
    if (Number(gd) && Number(gc)) throw bad('الذهب إما مدين أو دائن');
    const karat = Number(gd) || Number(gc) ? oneOf(int(b.karat, 'العيار'), KARATS, 'العيار') : null;
    if (kind === 'opening' && (await db.query("select 1 from customer_entries where customer_id=$1 and kind='opening' and not reversed", [id])).rowCount)
      throw conflict('يوجد رصيد افتتاحي لهذا العميل - ألغِه أولاً لإدخال رصيد جديد');
    const [doc] = await registerFiles(db, req.file ? [req.file] : [], req.user.id);
    const desc = str(b.description, 'البيان', { max: 300 });
    const ledgerMv = kind === 'gold_payment' ? await goldIntoVault(db, req, id, karat, gc, `سداد ذهب من العميل${desc ? `: ${desc}` : ''}`) : null;
    const e = (await db.query(`insert into customer_entries(entry_no, customer_id, entry_date, kind, money_debit, money_credit, gold_debit, gold_credit, karat, description, document_path, ledger_id, created_by)
      values (next_doc_no('CEN'),$1,coalesce($2::date, (now() at time zone 'Asia/Riyadh')::date),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [id, isoDate(b.entry_date), kind, md, mc, gd, gc, karat, desc, doc?.path || null, ledgerMv?.id || null, req.user.id])).rows[0];
    await audit(db, req, `customer_entry.${kind}`, 'customer', id, { entry: e.entry_no, md, mc, gd, gc, karat });
    return e;
  }));
});

staff.post('/entries/:id/reverse', requirePerm('payments.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const e = (await db.query('select * from customer_entries where id=$1 for update', [int(req.params.id)])).rows[0];
    if (!e || e.reversed) throw notFound('القيد غير موجود');
    const reason = str(req.body.reason, 'السبب', { required: true });
    if (e.ledger_id) {
      const mv = (await db.query('select * from gold_ledger where id=$1', [e.ledger_id])).rows[0];
      await ledger.requireBalance(db, mv.to_type, mv.to_ref, mv.material_id, mv.weight, 'رصيد الخزنة لا يكفي لإلغاء سداد الذهب');
      await ledger.reverse(db, mv, `إلغاء ${e.entry_no}: ${reason}`, req.user.id);
    }
    await db.query('update customer_entries set reversed=true, reversed_by=$2, reversed_at=now(), reversal_reason=$3 where id=$1', [e.id, req.user.id, reason]);
    if (e.submission_id) await db.query("update customer_submissions set status='rejected', review_note=$2 where id=$1", [e.submission_id, `أُلغي القيد: ${reason}`]);
    await audit(db, req, 'customer_entry.reverse', 'customer', e.customer_id, { entry: e.entry_no, reason });
    return { ok: true };
  }));
});

staff.get('/submissions', requirePerm('finance.view'), async (req, res) => {
  const st = req.query.status ? oneOf(req.query.status, ['pending', 'approved', 'rejected'], 'الحالة') : null;
  res.json(await many(`${subsQuery} where ($1::text is null or s.status=$1) order by s.id desc limit 300`, [st]));
});

/** اعتماد مستند سداد: المبلغ يُسجل دفعة، والذهب قيد سداد ذهب يدخل الخزنة */
staff.post('/submissions/:id/approve', requirePerm('payments.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const s = (await db.query('select * from customer_submissions where id=$1 for update', [int(req.params.id)])).rows[0];
    if (!s) throw notFound();
    if (s.status !== 'pending') throw conflict('تمت مراجعة المستند مسبقاً');
    const note = str(req.body.note, 'ملاحظة', { max: 300 });
    let paymentId = null, entryId = null;
    if (s.kind === 'money') {
      const amount = req.body.amount ? money(req.body.amount, 'المبلغ') : s.amount;
      const p = (await db.query(`insert into payments(payment_no, customer_id, kind, amount, method, reference, note, received_by, received_at)
        values (next_doc_no('PAY'),$1,'payment',$2,$3,$4,$5,$6,coalesce($7::timestamptz, now())) returning id`,
        [s.customer_id, amount, s.method || 'transfer', s.reference, `مستند سداد ${s.submission_no}${note ? ` — ${note}` : ''}`, req.user.id, s.paid_at])).rows[0];
      paymentId = p.id;
    } else {
      const w = req.body.weight ? W(req.body.weight, 'الوزن') : s.weight;
      const mv = await goldIntoVault(db, req, s.customer_id, s.karat, w, `سداد ذهب من العميل (${s.submission_no})`);
      entryId = (await db.query(`insert into customer_entries(entry_no, customer_id, entry_date, kind, gold_credit, karat, description, document_path, submission_id, ledger_id, created_by)
        values (next_doc_no('CEN'),$1,coalesce($2::date, (now() at time zone 'Asia/Riyadh')::date),'gold_payment',$3,$4,$5,$6,$7,$8,$9) returning id`,
        [s.customer_id, s.paid_at, w, s.karat, `مستند ${s.submission_no}${s.reference ? ` — ${s.reference}` : ''}${note ? ` — ${note}` : ''}`, s.document_path, s.id, mv.id, req.user.id])).rows[0].id;
    }
    await db.query("update customer_submissions set status='approved', review_note=$2, reviewed_by=$3, reviewed_at=now(), payment_id=$4, entry_id=$5 where id=$1", [s.id, note, req.user.id, paymentId, entryId]);
    await notifyCustomer(db, s.customer_id, { kind: 'payment', title: `اعتُمد مستند السداد ${s.submission_no}`, body: s.kind === 'money' ? `${s.amount} ر.س أُضيفت لحسابكم` : `${s.weight} جم عيار ${s.karat} أُضيفت لحسابكم`, link: '/store/statement' });
    await audit(db, req, 'submission.approve', 'customer', s.customer_id, { submission: s.submission_no, payment_id: paymentId, entry_id: entryId });
    return { ok: true, payment_id: paymentId, entry_id: entryId };
  }));
});

staff.post('/submissions/:id/reject', requirePerm('payments.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const s = (await db.query('select * from customer_submissions where id=$1 for update', [int(req.params.id)])).rows[0];
    if (!s) throw notFound();
    if (s.status !== 'pending') throw conflict('تمت مراجعة المستند مسبقاً');
    const reason = str(req.body.reason, 'سبب الرفض', { required: true });
    await db.query("update customer_submissions set status='rejected', review_note=$2, reviewed_by=$3, reviewed_at=now() where id=$1", [s.id, reason, req.user.id]);
    await notifyCustomer(db, s.customer_id, { kind: 'payment', title: `تعذر اعتماد مستند السداد ${s.submission_no}`, body: reason, link: '/store/statement' });
    await audit(db, req, 'submission.reject', 'customer', s.customer_id, { submission: s.submission_no, reason });
    return { ok: true };
  }));
});

// ================================================================ للعميل (/api/store)
export const store = Router();
const approvedOnly = (req, _res, next) => { if (req.user.customer_status !== 'approved') throw new HttpError(403, 'حسابكم بانتظار موافقة إدارة المصنع'); next(); };

store.get('/statement', requirePerm('store.access'), approvedOnly, async (req, res) => {
  const st = await buildStatement(pool, req.user.customer_id, period(req.query));
  const submissions = await many(`${subsQuery} where s.customer_id=$1 order by s.id desc limit 50`, [req.user.customer_id]);
  for (const s of submissions) { delete s.created_by_name; delete s.reviewed_by_name; }
  res.json({ customer: await customerInfo(pool, req.user.customer_id), ...st, submissions });
});

/** رفع مستند سداد (تحويل مبلغ أو تسليم ذهب) — يُضاف للحساب بعد موافقة المصنع */
store.post('/submissions', requirePerm('store.access'), approvedOnly, upload.single('document'), async (req, res) => {
  const b = req.body;
  if (!req.file) throw bad('أرفق صورة أو ملف المستند');
  if (!/^(image\/|application\/pdf)/.test(req.file.mimetype)) throw bad('المستند يجب أن يكون صورة أو PDF');
  res.json(await tx(async (db) => {
    const kind = oneOf(b.kind, ['money', 'gold'], 'نوع السداد');
    const [doc] = await registerFiles(db, [req.file], req.user.id);
    const s = (await db.query(`insert into customer_submissions(submission_no, customer_id, branch_id, kind, amount, weight, karat, method, reference, paid_at, note, document_path, original_name, mime, created_by)
      values (next_doc_no('PDS'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [req.user.customer_id, req.user.branch_id || null, kind, kind === 'money' ? money(b.amount, 'المبلغ') : null,
       kind === 'gold' ? W(b.weight, 'الوزن') : null, kind === 'gold' ? oneOf(int(b.karat, 'العيار'), KARATS, 'العيار') : null,
       kind === 'money' ? oneOf(b.method || 'transfer', ['cash', 'transfer', 'card', 'cheque', 'other'], 'طريقة الدفع') : null,
       str(b.reference, 'المرجع', { max: 120 }), isoDate(b.paid_at), str(b.note, 'ملاحظات', { max: 500 }), doc.path, doc.original_name, doc.mime, req.user.id])).rows[0];
    await notifyPerm(db, 'payments.manage', { kind: 'payment', title: `مستند سداد جديد من ${req.user.shop_name}`, body: kind === 'money' ? `${s.amount} ر.س` : `${s.weight} جم عيار ${s.karat}`, link: `/admin/customers/${req.user.customer_id}/statement` });
    await audit(db, req, 'submission.create', 'customer', req.user.customer_id, { submission: s.submission_no, kind });
    return s;
  }));
});
