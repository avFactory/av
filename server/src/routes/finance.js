// المالية: فواتير أجور التصنيع فقط + ضريبة القيمة المضافة + QR الفوترة الإلكترونية، المدفوعات، المصروفات، التقارير
// ملاحظة: قيمة الذهب خارج حسابات النظام تماماً - لا يوجد أي سعر ذهب.
import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, oneOf, money, weight as W } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyCustomer } from '../lib/notify.js';
import { sendXlsx } from '../lib/xlsx.js';
import { METHOD_LABELS } from '../lib/labor.js';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { orderThumb } from '../lib/orderThumb.js';
import { groupInfo } from '../lib/orderGroups.js';
import { UPLOAD_DIR } from '../lib/uploads.js';
import { thumbnail } from '../lib/thumbs.js';

const r = Router();

/** QR وفق صيغة TLV المعتمدة من هيئة الزكاة والضريبة والجمارك (المرحلة الأولى) */
export function zatcaTLV({ seller, vatNumber, timestamp, total, vat }) {
  const parts = [seller, vatNumber, timestamp, total, vat].map((v, i) => {
    const val = Buffer.from(String(v ?? ''), 'utf8');
    return Buffer.concat([Buffer.from([i + 1, val.length]), val]);
  });
  return Buffer.concat(parts).toString('base64');
}

async function companySettings(db) {
  const rows = (await db.query("select key, value from settings where key in ('company','vat_rate')")).rows;
  const s = Object.fromEntries(rows.map((x) => [x.key, x.value]));
  return { company: s.company || {}, vatRate: String(s.vat_rate ?? '15') };
}

async function invoicedOrders(db, orderIds) {
  return (await db.query(`select distinct x.id as order_id from invoice_lines l join invoices i on i.id=l.invoice_id
      cross join lateral unnest(array_append(l.covers, l.order_id)) x(id)
    where x.id = any($1::int[]) and l.kind='labor' and i.invoice_type='invoice' and i.status='issued'
      and not exists (select 1 from invoices c where c.credit_for_id=i.id)`, [orderIds])).rows.map((x) => x.order_id);
}

/** بناء بنود الفاتورة: أجور التصنيع (مفصولة) + أجور المراحل + بنود إضافية مستقلة (أحجار/خدمات) */
export async function buildLines(db, customerId, orderIds, extra, { allowEmpty = false } = {}) {
  const lines = [];
  const orders = orderIds.length ? (await db.query('select * from orders where id = any($1::int[]) order by id', [orderIds])).rows : [];
  if (orders.length !== orderIds.length) throw bad('طلب غير موجود');
  const already = await invoicedOrders(db, orderIds);
  for (const o of orders) {
    if (o.customer_id !== customerId) throw bad(`الطلب ${o.order_no} لا يخص هذا العميل`);
    if (already.includes(o.id)) throw conflict(`الطلب ${o.order_no} مفوتر مسبقاً`);
    if (['cancelled', 'rejected', 'pending_review', 'quoted'].includes(o.status)) throw conflict(`الطلب ${o.order_no} غير قابل للفوترة`);
    const w = o.final_gold_weight ?? o.final_weight;
    if (!o.labor_method) throw bad(`لم تحدد طريقة أجرة التصنيع للطلب ${o.order_no}`);
    if (o.labor_method === 'per_gram') {
      if (!w) throw conflict(`الطلب ${o.order_no}: يجب تسجيل الوزن النهائي قبل الفوترة بالجرام`);
      lines.push({ order_id: o.id, kind: 'labor', description: `أجور تصنيع ${o.order_no} - ${o.title} (${METHOD_LABELS.per_gram})`, qty: w, unit: 'جرام', unit_price: o.labor_rate });
    } else if (o.labor_method === 'per_piece') {
      lines.push({ order_id: o.id, kind: 'labor', description: `أجور تصنيع ${o.order_no} - ${o.title} (${METHOD_LABELS.per_piece})`, qty: String(o.quantity), unit: 'قطعة', unit_price: o.labor_rate });
    } else if (o.labor_method === 'manual') {
      if (!o.labor_manual_approved_by) throw conflict(`الطلب ${o.order_no}: الأجرة اليدوية لم تعتمد من الإدارة`);
      lines.push({ order_id: o.id, kind: 'labor', description: `أجور تصنيع ${o.order_no} - ${o.title} (أجرة معتمدة)`, qty: '1', unit: 'طلب', unit_price: o.labor_rate });
    } else {
      lines.push({ order_id: o.id, kind: 'labor', description: `أجور تصنيع ${o.order_no} - ${o.title} (أجرة ثابتة)`, qty: '1', unit: 'طلب', unit_price: o.labor_rate });
    }
    // أجور إضافية حسب مراحل المسار
    const stageRates = (await db.query(`select lr.*, s.name as stage_name from labor_rates lr join stages s on s.id=lr.stage_id
      join route_stages rs on rs.stage_id=lr.stage_id and rs.route_id=$1 where lr.active and lr.scope='stage'`, [o.route_id])).rows;
    for (const sr of stageRates) {
      if (sr.method === 'per_gram' && !w) continue;
      lines.push({ order_id: o.id, kind: 'stage_labor', description: `أجرة مرحلة ${sr.stage_name} - ${o.order_no}`,
        qty: sr.method === 'per_gram' ? w : sr.method === 'per_piece' ? String(o.quantity) : '1', unit: sr.method === 'per_gram' ? 'جرام' : sr.method === 'per_piece' ? 'قطعة' : 'طلب', unit_price: sr.rate });
    }
  }
  for (const e of extra || []) {
    lines.push({
      order_id: e.order_id ? int(e.order_id) : null, kind: oneOf(e.kind || 'other', ['stones', 'service', 'other'], 'نوع البند'),
      description: str(e.description, 'وصف البند', { required: true }), qty: money(e.qty ?? 1, 'الكمية'), unit: str(e.unit, 'الوحدة') || 'وحدة',
      unit_price: money(e.unit_price, 'سعر الوحدة', { allowZero: true }),
    });
  }
  if (!lines.length && !allowEmpty) throw bad('لا توجد بنود للفاتورة');
  for (const l of lines) l.amount = (await db.query('select round($1::numeric * $2::numeric, 2)::text v', [l.qty, l.unit_price ?? 0])).rows[0].v;
  return lines;
}

/**
 * الفوترة على الطلب كاملاً: سطر واحد لكل طلب (مهما كان عدد أصنافه) بمبلغ شامل الضريبة وذهب صافي عيار 24.
 * entries: [{ order_id (أي صنف من الطلب), amount (شامل الضريبة), gold24 (جم صافي 24) }]
 */
export async function buildOrderLines(db, customerId, entries) {
  const { vatRate } = await companySettings(db);
  const rate = Number(vatRate) / 100;
  const lines = [];
  const seen = new Set();
  for (const e of entries) {
    const g = await groupInfo(db, int(e.order_id, 'الطلب'));
    if (!g) throw notFound('الطلب غير موجود');
    if (seen.has(g.lead)) throw bad('الطلب مكرر في الفاتورة');
    seen.add(g.lead);
    const items = (await db.query('select o.*, m.karat from orders o join materials m on m.id=o.material_id where o.id = any($1::int[]) order by o.id', [g.ids])).rows;
    const ref = g.isGroup ? g.cart_ref : items[0].order_no;
    for (const o of items) {
      if (o.customer_id !== customerId) throw bad(`الطلب ${o.order_no} لا يخص هذا العميل`);
      if (['cancelled', 'rejected', 'pending_review', 'quoted'].includes(o.status)) throw conflict(`الطلب ${o.order_no} غير قابل للفوترة`);
    }
    if ((await invoicedOrders(db, g.ids)).length) throw conflict(`الطلب ${ref} مفوتر مسبقاً`);
    const total = Number(money(e.amount, `مبلغ الطلب ${ref} شامل الضريبة`));
    const gold24 = e.gold24 == null || e.gold24 === '' ? '0' : W(e.gold24, `ذهب الطلب ${ref}`, { allowZero: true });
    // المبلغ قبل الضريبة بحيث يكون الإجمالي شامل الضريبة مطابقاً لما أُدخل
    let sub = Math.round((total / (1 + rate)) * 100) / 100;
    for (const d of [0, 0.01, -0.01]) { const s = Math.round((sub + d) * 100) / 100; if (Math.round((s + Math.round(s * rate * 100) / 100) * 100) / 100 === total) { sub = s; break; } }
    const pieces = items.reduce((a, o) => a + Number(o.quantity || 0), 0);
    const kinds = [...new Set(items.map((o) => o.product_type || o.title))].slice(0, 4).join('، ');
    lines.push({ order_id: g.lead, covers: g.ids, kind: 'labor', description: `الطلب ${ref} — ${items.length > 1 ? `${items.length} أصناف · ` : ''}${pieces} قطعة (${kinds})`,
      qty: '1', unit: 'طلب', unit_price: sub.toFixed(2), amount: sub.toFixed(2), gold24 });
  }
  if (!lines.length) throw bad('اختر طلباً واحداً على الأقل');
  return lines;
}

/** الطلبات القابلة للفوترة لعميل: مجمعة على الطلب الرئيسي، مع اقتراح الذهب الصافي عيار 24 من الوزن الفعلي */
r.get('/invoiceable', requirePerm('invoices.manage'), async (req, res) => {
  const cid = int(req.query.customer_id, 'العميل');
  const rows = (await pool.query(`select o.id, o.order_no, o.cart_ref, o.title, o.product_type, o.quantity, o.status, o.branch_id, m.karat,
      coalesce(o.final_gold_weight, o.final_weight, o.approx_weight)::float as w, o.final_weight is not null as final, o.labor_estimate::float as est
    from orders o join materials m on m.id=o.material_id
    where o.customer_id=$1 and o.status in ('in_production','ready','delivered') order by o.id`, [cid])).rows;
  const done = new Set(await invoicedOrders(pool, rows.map((x) => x.id)));
  const groups = new Map();
  for (const x of rows) {
    if (done.has(x.id)) continue;
    const k = x.cart_ref || x.order_no;
    if (!groups.has(k)) groups.set(k, { key: k, lead_id: x.id, items: [], branch_id: x.branch_id });
    groups.get(k).items.push(x);
  }
  res.json([...groups.values()].map((g) => ({
    key: g.key, order_id: g.lead_id, ids: g.items.map((x) => x.id), branch_id: g.branch_id, count: g.items.length, pieces: g.items.reduce((a, x) => a + Number(x.quantity || 0), 0),
    title: [...new Set(g.items.map((x) => x.product_type || x.title))].slice(0, 4).join('، '), status: g.items[0].status,
    all_final: g.items.every((x) => x.final),
    gold24: +g.items.reduce((a, x) => a + (Number(x.w || 0) * Number(x.karat || 24)) / 24, 0).toFixed(3),
  })));
});

/** فرع للعميل (يُتحقق أنه يخصه)؛ فارغ = الحساب الرئيسي */
export async function branchOf(db, customerId, v) {
  if (v === undefined || v === null || v === '' || v === 'main') return null;
  const id = int(v, 'الفرع');
  if (!(await db.query('select 1 from customer_branches where id=$1 and customer_id=$2', [id, customerId])).rowCount) throw bad('الفرع لا يخص هذا العميل');
  return id;
}

async function issueInvoice(db, req, { customerId, lines, notes, type = 'invoice', creditFor = null, branchId: branchIn = null }) {
  await db.query("select pg_advisory_xact_lock(hashtext('invoice_chain'))");
  const { company, vatRate } = await companySettings(db);
  const sums = (await db.query(`select round(sum(a), 2)::text sub, round(round(sum(a),2) * $2::numeric / 100, 2)::text vat,
      (round(sum(a),2) + round(round(sum(a),2) * $2::numeric / 100, 2))::text total from unnest($1::numeric[]) a`, [lines.map((l) => l.amount), vatRate])).rows[0];
  const prev = (await db.query('select invoice_hash, icv from invoices order by icv desc limit 1')).rows[0];
  const icv = (prev?.icv || 0) + 1;
  const prefix = type === 'invoice' ? 'INV' : 'CRN';
  const no = (await db.query('select next_doc_no($1) v', [prefix])).rows[0].v;
  const issueDate = new Date();
  const qr = zatcaTLV({ seller: company.name, vatNumber: company.vat_number, timestamp: issueDate.toISOString(), total: sums.total, vat: sums.vat });
  const previousHash = prev?.invoice_hash || Buffer.from('0').toString('base64');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ no, icv, customerId, lines, sums, issueDate, previousHash })).digest('base64');
  // كل فرع حسابه منفصل: الفاتورة لفرع واحد (أو للحساب الرئيسي)
  const orderIds = [...new Set(lines.map((l) => l.order_id).filter(Boolean))];
  const brs = orderIds.length ? (await db.query('select distinct branch_id from orders where id = any($1::int[])', [orderIds])).rows.map((x) => x.branch_id) : [];
  if (brs.length > 1) throw bad('الطلبات تخص أكثر من فرع - أصدر فاتورة مستقلة لكل فرع');
  const branchId = brs.length ? brs[0] : (branchIn ?? null);
  const inv = (await db.query(`insert into invoices(invoice_no, icv, invoice_type, credit_for_id, customer_id, issue_date, subtotal, vat_rate, vat_amount, total,
      previous_hash, invoice_hash, qr_tlv, notes, created_by, branch_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
    [no, icv, type, creditFor, customerId, issueDate, sums.sub, vatRate, sums.vat, sums.total, previousHash, hash, qr, notes, req.user.id, branchId])).rows[0];
  for (const l of lines) {
    await db.query('insert into invoice_lines(invoice_id, order_id, kind, description, qty, unit, unit_price, amount, gold24, covers) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [inv.id, l.order_id, l.kind, l.description, l.qty, l.unit, l.unit_price ?? 0, l.amount, l.gold24 ?? null, l.covers || []]);
  }
  return inv;
}

r.post('/invoices/preview', requirePerm('invoices.manage'), async (req, res) => {
  const customerId = int(req.body.customer_id, 'العميل');
  const lines = Array.isArray(req.body.orders)
    ? [...await buildOrderLines(pool, customerId, req.body.orders), ...await buildLines(pool, customerId, [], req.body.extra_lines, { allowEmpty: true })]
    : await buildLines(pool, customerId, (req.body.order_ids || []).map((x) => int(x)), req.body.extra_lines);
  res.json({ lines, vat_rate: (await companySettings(pool)).vatRate });
});

r.post('/invoices', requirePerm('invoices.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const customerId = int(req.body.customer_id, 'العميل');
    const perOrder = Array.isArray(req.body.orders);
    let orderIds = (req.body.order_ids || []).map((x) => int(x));
    if (perOrder) orderIds = [...new Set((await Promise.all(req.body.orders.map(async (e) => (await groupInfo(db, int(e.order_id, 'الطلب')))?.ids || []))).flat())];
    for (const id of [...orderIds].sort((a, b) => a - b)) await db.query('select 1 from orders where id=$1 for update', [id]);
    const lines = perOrder
      ? [...await buildOrderLines(db, customerId, req.body.orders), ...await buildLines(db, customerId, [], req.body.extra_lines, { allowEmpty: true })]
      : await buildLines(db, customerId, orderIds, req.body.extra_lines);
    const inv = await issueInvoice(db, req, { customerId, lines, notes: str(req.body.notes, 'ملاحظات'), branchId: await branchOf(db, customerId, req.body.branch_id) });
    for (const oid of orderIds) await db.query("insert into order_stage_log(order_id, event, user_id, note, customer_visible) values ($1,'status',$2,$3,true)", [oid, req.user.id, `صدرت الفاتورة ${inv.invoice_no}`]);
    await notifyCustomer(db, customerId, { kind: 'invoice', title: `صدرت فاتورة ${inv.invoice_no}`, body: `${inv.total} ر.س`, link: `/store/invoices/${inv.id}` });
    await audit(db, req, 'invoice.issue', 'invoice', inv.id, { no: inv.invoice_no, total: inv.total, orders: orderIds });
    return inv;
  }));
});

/** إلغاء فاتورة بإشعار دائن (لا تعديل ولا حذف للفاتورة الصادرة) */
r.post('/invoices/:id/credit', requirePerm('invoices.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const reason = str(req.body.reason, 'سبب الإشعار الدائن', { required: true });
    const inv = (await db.query('select * from invoices where id=$1 for update', [int(req.params.id)])).rows[0];
    if (!inv) throw notFound();
    if (inv.invoice_type !== 'invoice') throw conflict('لا يمكن إصدار إشعار دائن لإشعار دائن');
    if ((await db.query('select 1 from invoices where credit_for_id=$1', [inv.id])).rowCount) throw conflict('صدر إشعار دائن لهذه الفاتورة مسبقاً');
    const lines = (await db.query('select order_id, kind, description, qty::text, unit, unit_price::text, amount::text, gold24::text, covers from invoice_lines where invoice_id=$1', [inv.id])).rows;
    const cn = await issueInvoice(db, req, { customerId: inv.customer_id, lines: lines.map((l) => ({ ...l, description: `عكس: ${l.description}` })), notes: `إشعار دائن للفاتورة ${inv.invoice_no}: ${reason}`, type: 'credit_note', creditFor: inv.id, branchId: inv.branch_id });
    await audit(db, req, 'invoice.credit', 'invoice', inv.id, { reason, credit_note: cn.invoice_no });
    return cn;
  }));
});

r.get('/invoices', requirePerm('finance.view'), async (req, res) => {
  res.json(await many(`select i.id, i.invoice_no, i.invoice_type, i.issue_date, i.subtotal::text, i.vat_amount::text, i.total::text, i.status, c.shop_name,
      (select invoice_no from invoices x where x.credit_for_id=i.id) as credited_by,
      coalesce((select sum(case when kind='refund' then -amount else amount end) from payments p where p.invoice_id=i.id),0)::text as paid
    from invoices i join customers c on c.id=i.customer_id where ($1::int is null or i.customer_id=$1) order by i.id desc limit 1000`, [req.query.customer_id ? int(req.query.customer_id) : null]));
});

export async function invoiceDetail(db, id) {
  const inv = (await db.query(`select i.*, i.subtotal::text, i.vat_amount::text, i.total::text, i.vat_rate::text, c.shop_name, c.owner_name, c.vat_number as customer_vat,
      c.cr_number as customer_cr, c.address as customer_address, c.city as customer_city, c.phone as customer_phone, c.email as customer_email, u.full_name as created_by_name,
      (select invoice_no from invoices x where x.id=i.credit_for_id) as credit_for_no, (select invoice_no from invoices x where x.credit_for_id=i.id) as credited_by
    from invoices i join customers c on c.id=i.customer_id left join users u on u.id=i.created_by where i.id=$1`, [id])).rows[0];
  if (!inv) return null;
  const lines = (await db.query(`select l.*, l.qty::text, l.unit_price::text, l.amount::text, l.gold24::text as gold24,
      case when cardinality(l.covers) > 0 then coalesce(o.cart_ref, o.order_no) end as order_ref,
      case when cardinality(l.covers) > 0 then (select sum(x.quantity) from orders x where x.id = any(l.covers)) end as covers_qty, o.order_no, o.title as order_title, o.size, o.notes as order_notes, o.quantity as order_qty,
      coalesce(o.final_weight, o.approx_weight)::text as weight, o.final_weight is not null as weight_final, m.karat, coalesce(o.color, m.color) as color, ${orderThumb()} as thumb
    from invoice_lines l left join orders o on o.id=l.order_id left join materials m on m.id=o.material_id where invoice_id=$1 order by l.id`, [id])).rows;
  const payments = (await db.query('select payment_no, kind, amount::text, method, received_at from payments where invoice_id=$1 order by id', [id])).rows;
  const { company } = await companySettings(db);
  const branch = (await db.query(`select b.name, b.phone, b.address, b.city from invoice_lines l join orders o on o.id=l.order_id join customer_branches b on b.id=o.branch_id
    where l.invoice_id=$1 limit 1`, [id])).rows[0] || null;
  return { invoice: inv, lines, payments, company, branch };
}

/** رابط الفاتورة العام + رمز QR له + صور مصغّرة مضمّنة (تظهر في الرابط العام والطباعة بدون تسجيل دخول) */
export async function withInvoiceExtras(d, req) {
  const link = `${req.protocol}://${req.get('host')}/i/${d.invoice.public_token}`;
  d.link = link;
  d.link_qr_svg = await QRCode.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  for (const l of d.lines) {
    l.thumb_data = null;
    if (!l.thumb) continue;
    try {
      const abs = path.resolve(UPLOAD_DIR, l.thumb);
      if (!abs.startsWith(UPLOAD_DIR + path.sep)) continue;
      const t = await thumbnail(abs, l.thumb, 200);
      if (t) l.thumb_data = `data:image/webp;base64,${fs.readFileSync(t).toString('base64')}`;
    } catch { /* بدون صورة */ }
    delete l.thumb;
  }
  delete d.invoice.created_by_name;
  return d;
}

r.get('/invoices/:id', requirePerm('finance.view'), async (req, res) => {
  const d = await invoiceDetail(pool, int(req.params.id));
  if (!d) throw notFound();
  res.json(await withInvoiceExtras(d, req));
});

/** تصدير الفاتورة بصيغة UBL 2.1 XML (أساس الفوترة الإلكترونية - المرحلة الثانية تتطلب ربط وشهادة من الهيئة) */
r.get('/invoices/:id/xml', requirePerm('finance.view'), async (req, res) => {
  const d = await invoiceDetail(pool, int(req.params.id));
  if (!d) throw notFound();
  const { invoice: i, lines, company } = d;
  const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(i.invoice_no)}</cbc:ID>
  <cbc:UUID>${i.uuid}</cbc:UUID>
  <cbc:IssueDate>${new Date(i.issue_date).toISOString().slice(0, 10)}</cbc:IssueDate>
  <cbc:IssueTime>${new Date(i.issue_date).toISOString().slice(11, 19)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0100000">${i.invoice_type === 'invoice' ? 388 : 381}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${i.icv}</cbc:UUID></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(i.previous_hash)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${i.qr_tlv}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="CRN">${esc(company.cr_number)}</cbc:ID></cac:PartyIdentification>
    <cac:PostalAddress><cbc:StreetName>${esc(company.address)}</cbc:StreetName><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(company.vat_number)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(company.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>${esc(i.customer_address)}</cbc:StreetName><cbc:CityName>${esc(i.customer_city)}</cbc:CityName><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(i.customer_vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(i.shop_name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${i.vat_amount}</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">${i.subtotal}</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">${i.vat_amount}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${i.vat_rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">${i.subtotal}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="SAR">${i.subtotal}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${i.total}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="SAR">${i.total}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines.map((l, n) => `  <cac:InvoiceLine><cbc:ID>${n + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="${l.unit === 'جرام' ? 'GRM' : 'PCE'}">${l.qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">${l.amount}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${i.vat_rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">${l.unit_price}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join('\n')}
</Invoice>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${i.invoice_no}.xml"`);
  res.send(xml);
});

// ------------------------------------------------------------------ المدفوعات
r.get('/payments', requirePerm('finance.view'), async (req, res) => {
  res.json(await many(`select p.*, p.amount::text, c.shop_name, i.invoice_no, o.order_no, u.full_name as received_by_name
    from payments p join customers c on c.id=p.customer_id left join invoices i on i.id=p.invoice_id left join orders o on o.id=p.order_id
    left join users u on u.id=p.received_by where ($1::int is null or p.customer_id=$1) order by p.id desc limit 1000`, [req.query.customer_id ? int(req.query.customer_id) : null]));
});

r.post('/payments', requirePerm('payments.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const b = req.body;
    const customerId = int(b.customer_id, 'العميل');
    const invoiceId = b.invoice_id ? int(b.invoice_id) : null;
    if (invoiceId) {
      const inv = (await db.query('select customer_id from invoices where id=$1', [invoiceId])).rows[0];
      if (!inv || inv.customer_id !== customerId) throw bad('الفاتورة لا تخص العميل');
    }
    // فرع الدفعة: فرع الفاتورة إن وُجدت، وإلا المحدد (فارغ = الحساب الرئيسي)
    const branchId = invoiceId ? (await db.query('select branch_id from invoices where id=$1', [invoiceId])).rows[0].branch_id : await branchOf(db, customerId, b.branch_id);
    const p = (await db.query(`insert into payments(payment_no, customer_id, invoice_id, order_id, kind, amount, method, reference, note, received_by, reverses_id, branch_id)
      values (next_doc_no('PAY'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [customerId, invoiceId, b.order_id ? int(b.order_id) : null, oneOf(b.kind || 'payment', ['advance', 'payment', 'refund'], 'نوع الدفعة'),
       money(b.amount), oneOf(b.method || 'cash', ['cash', 'transfer', 'card', 'cheque', 'other'], 'طريقة الدفع'), str(b.reference, 'المرجع'),
       str(b.note, 'ملاحظات'), req.user.id, b.reverses_id ? int(b.reverses_id) : null, branchId])).rows[0];
    await audit(db, req, 'payment.create', 'payment', p.id, { amount: p.amount, kind: p.kind, customer: customerId });
    return p;
  }));
});

// ------------------------------------------------------------------ المصروفات
r.get('/expenses', requirePerm('finance.view'), async (_req, res) => {
  res.json(await many('select e.*, e.amount::text, e.vat_amount::text, u.full_name as created_by_name from expenses e left join users u on u.id=e.created_by order by expense_date desc, id desc limit 1000'));
});
r.post('/expenses', requirePerm('expenses.manage'), async (req, res) => {
  const b = req.body;
  const e = await one(`insert into expenses(category, description, amount, vat_amount, expense_date, paid_to, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [str(b.category, 'التصنيف', { required: true }), str(b.description, 'الوصف'), money(b.amount), money(b.vat_amount || 0, 'الضريبة', { allowZero: true }), b.expense_date || new Date().toISOString().slice(0, 10), str(b.paid_to, 'المستفيد'), req.user.id]);
  await audit(pool, req, 'expense.create', 'expense', e.id, e);
  res.json(e);
});
r.delete('/expenses/:id', requirePerm('expenses.manage'), async (req, res) => {
  const id = int(req.params.id);
  const e = await one('select * from expenses where id=$1', [id]);
  if (!e) throw notFound();
  await pool.query('delete from expenses where id=$1', [id]);
  await audit(pool, req, 'expense.delete', 'expense', id, e);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ كشف حساب وأرصدة
r.get('/statement/:customerId', requirePerm('finance.view'), async (req, res) => {
  const id = int(req.params.customerId);
  const rows = await many(`
    select issue_date as date, invoice_no as ref, case when invoice_type='invoice' then 'فاتورة' else 'إشعار دائن' end as type,
           case when invoice_type='invoice' then total else 0 end as debit, case when invoice_type='credit_note' then total else 0 end as credit
    from invoices where customer_id=$1 and status='issued'
    union all
    select received_at, payment_no, case kind when 'advance' then 'دفعة مقدمة' when 'refund' then 'استرداد' else 'سداد' end,
           case when kind='refund' then amount else 0 end, case when kind='refund' then 0 else amount end
    from payments where customer_id=$1 order by 1`, [id]);
  let bal = 0;
  for (const x of rows) { bal += Number(x.debit) - Number(x.credit); x.balance = bal.toFixed(2); }
  res.json({ rows, balance: bal.toFixed(2) });
});

// ------------------------------------------------------------------ التقارير
r.get('/reports/revenue', requirePerm('reports.view', 'finance.view'), async (req, res) => {
  const from = req.query.from || '2000-01-01';
  const to = req.query.to || '2999-12-31';
  const monthly = await many(`select to_char(date_trunc('month', issue_date),'YYYY-MM') m,
      sum(case when invoice_type='invoice' then 1 else -1 end * (select coalesce(sum(amount),0) from invoice_lines l where l.invoice_id=i.id and l.kind in ('labor','stage_labor')))::text labor,
      sum(case when invoice_type='invoice' then 1 else -1 end * (select coalesce(sum(amount),0) from invoice_lines l where l.invoice_id=i.id and l.kind not in ('labor','stage_labor')))::text other,
      sum(case when invoice_type='invoice' then vat_amount else -vat_amount end)::text vat,
      sum(case when invoice_type='invoice' then total else -total end)::text total
    from invoices i where status='issued' and issue_date >= $1::date and issue_date < $2::date + 1 group by 1 order by 1`, [from, to]);
  const expenses = await many(`select to_char(date_trunc('month', expense_date),'YYYY-MM') m, sum(amount)::text amount, sum(vat_amount)::text vat
    from expenses where expense_date between $1::date and $2::date group by 1 order by 1`, [from, to]);
  const collected = await many(`select to_char(date_trunc('month', received_at),'YYYY-MM') m, sum(case when kind='refund' then -amount else amount end)::text amount
    from payments where received_at >= $1::date and received_at < $2::date + 1 group by 1 order by 1`, [from, to]);
  res.json({ monthly, expenses, collected });
});

r.get('/reports/receivables', requirePerm('finance.view'), async (_req, res) => {
  res.json(await many(`select c.id, c.shop_name,
      coalesce((select sum(case when invoice_type='invoice' then total else -total end) from invoices i where i.customer_id=c.id and i.status='issued'),0)::text as invoiced,
      coalesce((select sum(case when kind='refund' then -amount else amount end) from payments p where p.customer_id=c.id),0)::text as paid
    from customers c order by c.shop_name`));
});

r.get('/reports/revenue.xlsx', requirePerm('reports.view', 'finance.view'), async (req, res) => {
  const rows = await many(`select i.invoice_no, i.invoice_type, i.issue_date, c.shop_name, c.vat_number, i.subtotal::text, i.vat_amount::text, i.total::text
    from invoices i join customers c on c.id=i.customer_id where i.status='issued' order by i.id`);
  await sendXlsx(res, 'الفواتير', [['رقم الفاتورة', 'invoice_no'], ['النوع', (x) => (x.invoice_type === 'invoice' ? 'فاتورة' : 'إشعار دائن')], ['التاريخ', (x) => new Date(x.issue_date).toISOString().slice(0, 10)],
    ['العميل', 'shop_name'], ['الرقم الضريبي', 'vat_number'], ['أجور قبل الضريبة', (x) => Number(x.subtotal)], ['الضريبة', (x) => Number(x.vat_amount)], ['الإجمالي', (x) => Number(x.total)]], rows, 'invoices.xlsx');
});

export default r;
