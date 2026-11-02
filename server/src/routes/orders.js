// إدارة الطلبات وأوامر الإنتاج (الإدارة / مدير الإنتاج / المشرف)
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm, has } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, weight as W, money, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyCustomer, notifyPerm } from '../lib/notify.js';
import { upload, registerFiles } from '../lib/uploads.js';
import * as ledger from '../lib/ledger.js';
import * as prod from '../lib/production.js';
import { resolveLabor, laborAmount } from '../lib/labor.js';

const r = Router();

export async function materialFor(db, karat, color) {
  const m = (await db.query("select id from materials where metal='gold' and karat=$1 and (color=$2 or (karat=24)) and active order by (color=$2) desc limit 1", [int(karat, 'العيار'), color || 'yellow'])).rows[0];
  if (!m) throw bad('العيار/اللون غير معرّف في المواد');
  return m.id;
}

/** إنشاء طلب تصنيع (داخلي أو نيابة عن عميل) */
r.post('/', requirePerm('orders.manage'), async (req, res) => {
  const b = req.body;
  const out = await tx(async (db) => {
    const materialId = b.material_id ? int(b.material_id) : await materialFor(db, b.karat, b.color);
    const customerId = b.customer_id ? int(b.customer_id) : null;
    const productId = b.product_id ? int(b.product_id) : null;
    const product = productId ? (await db.query('select * from products where id=$1', [productId])).rows[0] : null;
    const productType = str(b.product_type, 'نوع القطعة') || product?.product_type || null;
    const labor = b.labor_method
      ? { method: oneOf(b.labor_method, ['per_gram', 'per_piece', 'fixed', 'manual'], 'طريقة الأجرة'), rate: money(b.labor_rate ?? 0, 'الأجرة', { allowZero: true }) }
      : await resolveLabor(db, { customer_id: customerId, product_id: productId, product_type: productType });
    const qty = int(b.quantity ?? 1, 'الكمية', { min: 1 });
    const approx = b.approx_weight ? W(b.approx_weight, 'الوزن التقريبي') : product?.approx_weight || null;
    const o = (await db.query(
      `insert into orders(order_no, customer_id, source, product_id, product_type, title, material_id, approx_weight, size, quantity, due_date, notes,
         status, route_id, design_approval_required, labor_method, labor_rate, labor_estimate, created_by)
       values (next_doc_no('ORD'),$1,'internal',$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$12,$13,$14,$15,$16) returning *`,
      [customerId, productId, productType, str(b.title, 'وصف الطلب') || product?.name || productType || 'طلب تصنيع', materialId, approx,
       str(b.size, 'المقاس'), qty, b.due_date || null, str(b.notes, 'ملاحظات'),
       b.route_id ? int(b.route_id) : await prod.pickRoute(db, productType, product?.route_id), !!b.design_approval_required,
       labor?.method || null, labor?.rate || null, labor && labor.method !== 'manual' ? laborAmount(labor.method, labor.rate, approx, qty) : (b.labor_rate || null), req.user.id]
    )).rows[0];
    await prod.logStage(db, o.id, null, 'created', req.user.id, 'إنشاء الطلب', true);
    if (b.start !== false) await prod.startProduction(db, o, req.user.id);
    await audit(db, req, 'order.create', 'order', o.id, { order_no: o.order_no });
    return o;
  });
  res.json(out);
});

r.get('/', requirePerm('orders.view'), async (req, res) => {
  const f = req.query;
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (f.status) add('o.status = ?', String(f.status));
  if (f.stage_id) add('o.current_stage_id = ?', int(f.stage_id));
  if (f.customer_id) add('o.customer_id = ?', int(f.customer_id));
  if (f.q) add('(o.order_no ilike ? or o.title ilike ? or c.shop_name ilike ?)', `%${f.q}%`);
  if (f.late) where.push("o.due_date < current_date and o.status not in ('delivered','cancelled','rejected')");
  res.json(await many(`
    select o.id, o.order_no, o.title, o.status, o.quantity, o.due_date, o.created_at, o.source, o.design_status, o.stage_state,
           o.final_weight::text, o.approx_weight::text, o.labor_estimate::text,
           c.shop_name, s.name as stage_name, m.name as material_name, w.full_name as worker_name,
           (o.due_date < current_date and o.status not in ('delivered','cancelled','rejected')) as late
    from orders o left join customers c on c.id=o.customer_id left join stages s on s.id=o.current_stage_id
    join materials m on m.id=o.material_id left join users w on w.id=o.assigned_worker_id
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by o.id desc limit 500`, params));
});

export async function orderDetail(db, id) {
  const o = (await db.query(`select o.*, o.approx_weight::text, o.final_weight::text, o.final_gold_weight::text, o.labor_rate::text, o.labor_estimate::text,
      c.shop_name, c.owner_name, s.name as stage_name, s.kind as stage_kind, s.handles_gold, m.name as material_name, m.karat, m.color,
      w.full_name as worker_name, r.name as route_name, p.name as product_name, p.sku
    from orders o left join customers c on c.id=o.customer_id left join stages s on s.id=o.current_stage_id join materials m on m.id=o.material_id
    left join users w on w.id=o.assigned_worker_id left join routes r on r.id=o.route_id left join products p on p.id=o.product_id where o.id=$1`, [id])).rows[0];
  return o;
}

r.get('/:id', requirePerm('orders.view'), async (req, res) => {
  const id = int(req.params.id);
  const o = await orderDetail(pool, id);
  if (!o) throw notFound('الطلب غير موجود');
  const stages = o.route_id ? await prod.routeStages(pool, o.route_id) : [];
  const log = await many(`select l.*, s.name as stage_name, u.full_name as user_name, w.full_name as worker_name from order_stage_log l
                          left join stages s on s.id=l.stage_id left join users u on u.id=l.user_id left join users w on w.id=l.worker_id
                          where l.order_id=$1 order by l.id desc`, [id]);
  const files = await many('select f.*, u.full_name as uploaded_by_name from order_files f left join users u on u.id=f.uploaded_by where order_id=$1 order by id', [id]);
  const custodies = await many(`select c.id, c.worker_id, c.custody_no, c.status, c.work_state, c.weight_issued::text, c.issued_at, c.closed_at, c.loss_rate_snapshot::text,
      u.full_name as worker_name, s.name as stage_name, st.settlement_no, st.returned_weight::text, st.scrap_weight::text, st.actual_loss::text,
      st.normal_loss::text, st.abnormal_loss::text, st.status as settlement_status, st.id as settlement_id
    from custodies c join users u on u.id=c.worker_id join stages s on s.id=c.stage_id
    left join settlements st on st.custody_id=c.id and st.status <> 'reversed' where c.order_id=$1 order by c.id`, [id]);
  const gold = await many(`select b.loc_type, b.material_id, m.name, b.balance::text from gold_balances b join materials m on m.id=b.material_id
    where b.balance <> 0 and ((b.loc_type in ('order','delivered') and b.loc_ref=$1))`, [id]);
  const goldFlow = await one(`select
      coalesce(sum(weight) filter (where kind in ('allocate','customer_gold_in','from_finished_stock')),0)::text as allocated,
      coalesce(sum(weight) filter (where kind='normal_loss'),0)::text as normal_loss,
      coalesce(sum(weight) filter (where kind in ('abnormal_loss','abnormal_loss_approved')),0)::text as abnormal_loss,
      coalesce(sum(weight) filter (where kind='abnormal_pending'),0)::text as abnormal_pending,
      coalesce(sum(weight) filter (where kind='scrap_return'),0)::text as scrap,
      coalesce(sum(weight) filter (where kind='loss_recovered'),0)::text as recovered,
      coalesce(sum(weight) filter (where kind='final_excess'),0)::text as final_excess
    from gold_ledger g where order_id=$1 and reverses_id is null and not exists (select 1 from gold_ledger r where r.reverses_id=g.id)`, [id]);
  const designs = await many('select d.*, u.full_name as sent_by_name from design_reviews d left join users u on u.id=d.sent_by where order_id=$1 order by id desc', [id]);
  const stones = await many(`select m.id, m.kind, m.carats::text, m.count, m.created_at, l.lot_no, l.stone_type, w.full_name as worker_name
    from stone_movements m join stone_lots l on l.id=m.lot_id left join users w on w.id=m.worker_id where m.order_id=$1 order by m.id`, [id]);
  const invoices = await many(`select distinct i.id, i.invoice_no, i.total::text, i.status, i.invoice_type from invoice_lines l join invoices i on i.id=l.invoice_id where l.order_id=$1`, [id]);
  const stonesG = await prod.embeddedStonesGrams(pool, id);
  const labor = await resolveLabor(pool, { customer_id: o.customer_id, product_id: o.product_id, product_type: o.product_type });
  res.json({ order: o, stages, log, files, custodies, gold, goldFlow, designs, stones, invoices, stonesGrams: stonesG, suggestedLabor: labor });
});

r.put('/:id', requirePerm('orders.manage'), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (['delivered', 'cancelled'].includes(o.status)) throw conflict('لا يمكن تعديل طلب مغلق');
    const custodyCount = (await db.query('select count(*)::int n from custodies where order_id=$1', [o.id])).rows[0].n;
    let materialId = o.material_id;
    if (b.karat || b.material_id) {
      const m = b.material_id ? int(b.material_id) : await materialFor(db, b.karat, b.color);
      if (m !== o.material_id && custodyCount) throw conflict('لا يمكن تغيير العيار/اللون بعد بدء حركات الذهب - التحويل بين المواد يتم عبر تحويل موثق في المخزون');
      materialId = m;
    }
    if (b.route_id && int(b.route_id) !== o.route_id && o.status === 'in_production') throw conflict('لا يمكن تغيير المسار أثناء التصنيع');
    if (b.labor_method === 'manual' && !has(req, 'labor.approve_manual')) {
      // الأجرة اليدوية تحتاج اعتماد الإدارة
      await notifyPerm(db, 'labor.approve_manual', { kind: 'labor', title: `أجرة يدوية بانتظار الاعتماد - ${o.order_no}`, link: `/orders/${o.id}` });
    }
    const upd = {
      title: b.title !== undefined ? str(b.title, 'الوصف', { required: true }) : o.title,
      size: b.size !== undefined ? str(b.size, 'المقاس') : o.size,
      quantity: b.quantity !== undefined ? int(b.quantity, 'الكمية', { min: 1 }) : o.quantity,
      due_date: b.due_date !== undefined ? b.due_date || null : o.due_date,
      notes: b.notes !== undefined ? str(b.notes, 'ملاحظات') : o.notes,
      approx_weight: b.approx_weight !== undefined ? (b.approx_weight ? W(b.approx_weight, 'الوزن التقريبي') : null) : o.approx_weight,
      route_id: b.route_id ? int(b.route_id) : o.route_id,
      design_approval_required: b.design_approval_required !== undefined ? !!b.design_approval_required : o.design_approval_required,
      labor_method: b.labor_method !== undefined ? (b.labor_method ? oneOf(b.labor_method, ['per_gram', 'per_piece', 'fixed', 'manual'], 'طريقة الأجرة') : null) : o.labor_method,
      labor_rate: b.labor_rate !== undefined ? (b.labor_rate === '' || b.labor_rate == null ? null : money(b.labor_rate, 'الأجرة', { allowZero: true })) : o.labor_rate,
      customer_id: b.customer_id !== undefined ? (b.customer_id ? int(b.customer_id) : null) : o.customer_id,
    };
    const manualChanged = upd.labor_method === 'manual' && (o.labor_method !== 'manual' || String(upd.labor_rate) !== String(o.labor_rate));
    await db.query(
      `update orders set title=$2, size=$3, quantity=$4, due_date=$5, notes=$6, approx_weight=$7, route_id=$8, design_approval_required=$9,
         labor_method=$10, labor_rate=$11, material_id=$12, customer_id=$13, updated_at=now(),
         labor_manual_approved_by = case when $14 then $15 else labor_manual_approved_by end,
         design_status = case when $9 and design_status='not_required' and status='in_production' then 'pending_upload'
                              when not $9 then 'not_required' else design_status end
       where id=$1`,
      [o.id, upd.title, upd.size, upd.quantity, upd.due_date, upd.notes, upd.approx_weight, upd.route_id, upd.design_approval_required,
       upd.labor_method, upd.labor_rate, materialId, upd.customer_id, manualChanged, has(req, 'labor.approve_manual') ? req.user.id : null]
    );
    await audit(db, req, 'order.update', 'order', o.id, { before: { title: o.title, labor_method: o.labor_method, labor_rate: o.labor_rate, due_date: o.due_date }, after: upd });
    return { ok: true };
  }));
});

r.post('/:id/approve-manual-labor', requirePerm('labor.approve_manual'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (o.labor_method !== 'manual') throw bad('الطلب لا يستخدم أجرة يدوية');
    await db.query('update orders set labor_manual_approved_by=$2 where id=$1', [o.id, req.user.id]);
    await audit(db, req, 'labor.approve_manual', 'order', o.id, { rate: o.labor_rate });
    return { ok: true };
  }));
});

/** عرض أجور التصنيع للعميل (للتصميم حسب الطلب) */
r.post('/:id/quote', requirePerm('orders.quote'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (!['pending_review', 'quoted'].includes(o.status)) throw conflict('لا يمكن إرسال عرض لهذا الطلب');
    const method = oneOf(req.body.labor_method, ['per_gram', 'per_piece', 'fixed'], 'طريقة الأجرة');
    const rate = money(req.body.labor_rate, 'الأجرة', { allowZero: true });
    const approx = req.body.approx_weight ? W(req.body.approx_weight, 'الوزن التقريبي') : o.approx_weight;
    const estimate = laborAmount(method, rate, approx, o.quantity);
    await db.query(`update orders set status='quoted', labor_method=$2, labor_rate=$3, approx_weight=$4, labor_estimate=$5, quote_note=$6,
                    quote_sent_at=now(), due_date=coalesce($7, due_date), design_approval_required=$8, updated_at=now() where id=$1`,
      [o.id, method, rate, approx, estimate, str(req.body.note, 'ملاحظات العرض'), req.body.due_date || null, req.body.design_approval_required !== false]);
    await prod.logStage(db, o.id, null, 'quote', req.user.id, `عرض أجور: ${estimate} ر.س`, true);
    await notifyCustomer(db, o.customer_id, { kind: 'quote', title: `عرض أجور التصنيع للطلب ${o.order_no}`, body: `${estimate} ر.س (أجور تصنيع فقط)`, link: `/store/orders/${o.id}` });
    await audit(db, req, 'order.quote', 'order', o.id, { method, rate, estimate });
    return { ok: true, estimate };
  }));
});

r.post('/:id/reject', requirePerm('orders.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (!['pending_review', 'quoted', 'approved'].includes(o.status)) throw conflict('لا يمكن رفض الطلب في حالته الحالية');
    const reason = str(req.body.reason, 'السبب', { required: true });
    await db.query("update orders set status='rejected', updated_at=now() where id=$1", [o.id]);
    await prod.logStage(db, o.id, null, 'status', req.user.id, `رفض الطلب: ${reason}`, true);
    await notifyCustomer(db, o.customer_id, { kind: 'order', title: `تعذر قبول الطلب ${o.order_no}`, body: reason, link: `/store/orders/${o.id}` });
    await audit(db, req, 'order.reject', 'order', o.id, { reason });
    return { ok: true };
  }));
});

r.post('/:id/start', requirePerm('orders.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (o.status === 'quoted' && o.customer_id && !o.customer_accepted_at) throw conflict('بانتظار موافقة العميل على العرض');
    await prod.startProduction(db, o, req.user.id);
    await audit(db, req, 'order.start', 'order', o.id);
    return { ok: true };
  }));
});

r.post('/:id/cancel', requirePerm('orders.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (['delivered', 'cancelled'].includes(o.status)) throw conflict('الطلب مغلق');
    const reason = str(req.body.reason, 'سبب الإلغاء', { required: true });
    const open = (await db.query("select count(*)::int n from custodies where order_id=$1 and status in ('open','under_review')", [o.id])).rows[0].n;
    if (open) throw conflict('يجب استلام جميع عهد الطلب قبل إلغائه');
    // إعادة رصيد ذهب الطلب للخزنة
    const bals = await db.query("select material_id, balance::text from gold_balances where loc_type='order' and loc_ref=$1 and balance > 0", [o.id]);
    for (const b of bals.rows) await ledger.post(db, { kind: 'dealloc', material_id: b.material_id, weight: b.balance, from: ['order', o.id], to: ['vault', null], order_id: o.id, reason: `إلغاء الطلب: ${reason}`, user_id: req.user.id });
    await db.query("update orders set status='cancelled', updated_at=now() where id=$1", [o.id]);
    await prod.logStage(db, o.id, o.current_stage_id, 'status', req.user.id, `إلغاء: ${reason}`, true);
    await audit(db, req, 'order.cancel', 'order', o.id, { reason });
    return { ok: true };
  }));
});

/** تسجيل ذهب على الطلب (من الخزنة أو ذهب مستلم من العميل) */
r.post('/:id/allocate', requirePerm('custody.issue', 'inventory.manage', 'orders.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (!['in_production', 'approved'].includes(o.status)) throw conflict('الطلب ليس قيد التصنيع');
    const w = W(req.body.weight, 'الوزن');
    const source = oneOf(req.body.source || 'vault', ['vault', 'customer'], 'المصدر');
    const note = str(req.body.note, 'ملاحظات');
    if (source === 'vault') {
      await ledger.requireBalance(db, 'vault', null, o.material_id, w, 'رصيد الخزنة غير كافٍ');
      await ledger.post(db, { kind: 'allocate', material_id: o.material_id, weight: w, from: ['vault', null], to: ['order', o.id], order_id: o.id, stage_id: o.current_stage_id, reason: note, user_id: req.user.id });
    } else {
      await ledger.post(db, { kind: 'customer_gold_in', material_id: o.material_id, weight: w, from: ['external', o.customer_id], to: ['order', o.id], order_id: o.id, stage_id: o.current_stage_id, reason: note || 'ذهب مستلم من العميل', user_id: req.user.id });
    }
    await prod.logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `تسجيل ${w} جم ذهب على الطلب (${source === 'vault' ? 'من الخزنة' : 'من العميل'})`);
    await audit(db, req, 'order.allocate', 'order', o.id, { weight: w, source });
    return { ok: true, balance: await ledger.balance(db, 'order', o.id, o.material_id) };
  }));
});

/** إرجاع فائض ذهب الطلب للخزنة */
r.post('/:id/deallocate', requirePerm('custody.issue', 'inventory.manage', 'orders.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const w = W(req.body.weight, 'الوزن');
    await ledger.requireBalance(db, 'order', o.id, o.material_id, w, 'رصيد الطلب غير كافٍ');
    await ledger.post(db, { kind: 'dealloc', material_id: o.material_id, weight: w, from: ['order', o.id], to: ['vault', null], order_id: o.id, reason: str(req.body.note, 'ملاحظات'), user_id: req.user.id });
    await audit(db, req, 'order.deallocate', 'order', o.id, { weight: w });
    return { ok: true };
  }));
});

r.post('/:id/advance', requirePerm('orders.advance'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const force = !!req.body.force;
    if (force && !has(req, 'orders.manage')) throw bad('التجاوز يتطلب صلاحية إدارة الطلبات');
    if (force && !req.body.reason) throw bad('سبب التجاوز مطلوب');
    const r2 = await prod.advance(db, o, req.user.id, { force, reason: req.body.reason });
    await audit(db, req, 'order.advance', 'order', o.id, { from: o.current_stage_id, force, reason: req.body.reason });
    return r2;
  }));
});

r.post('/:id/assign', requirePerm('orders.advance'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const wid = req.body.worker_id ? int(req.body.worker_id) : null;
    if (wid) {
      const w = (await db.query("select id from users where id=$1 and role_code='worker' and active", [wid])).rows[0];
      if (!w) throw bad('العامل غير موجود');
    }
    await db.query("update orders set assigned_worker_id=$2, stage_state='waiting', updated_at=now() where id=$1", [o.id, wid]);
    await prod.logStage(db, o.id, o.current_stage_id, 'assigned', req.user.id, null, false, wid);
    if (wid) await prod.notifyWorkerAssigned(db, o, wid);
    await audit(db, req, 'order.assign', 'order', o.id, { worker_id: wid });
    return { ok: true };
  }));
});

r.post('/:id/final-weight', requirePerm('orders.advance'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const st = (await db.query('select kind from stages where id=$1', [o.current_stage_id])).rows[0];
    if (st?.kind !== 'final_weight') throw conflict('الطلب ليس في مرحلة الوزن النهائي');
    return prod.setFinalWeight(db, req, o, W(req.body.weight, 'الوزن النهائي'), str(req.body.note, 'السبب'));
  }));
});

r.post('/:id/deliver', requirePerm('orders.manage', 'orders.advance'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    await prod.deliver(db, req, o, str(req.body.note, 'ملاحظات'));
    return { ok: true };
  }));
});

r.post('/:id/files', requirePerm('orders.manage', 'design.manage', 'orders.advance'), upload.array('files', 10), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const kind = oneOf(req.body.kind || 'other', ['reference', 'sketch', 'model3d', 'design', 'execution', 'other'], 'نوع الملف');
    const files = await registerFiles(db, req.files, req.user.id);
    if (!files.length) throw bad('لم يتم اختيار ملفات');
    const ids = [];
    for (const f of files) {
      ids.push((await db.query('insert into order_files(order_id, kind, path, original_name, mime, uploaded_by, customer_visible) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [o.id, kind, f.path, f.original_name, f.mime, req.user.id, req.body.customer_visible === 'true'])).rows[0].id);
    }
    if (kind === 'design' && o.design_status === 'pending_upload') await db.query("update orders set design_status='pending_upload' where id=$1", [o.id]);
    await audit(db, req, 'order.files', 'order', o.id, { count: files.length, kind });
    return { ok: true, ids };
  }));
});

/** إرسال التصميم للعميل للاعتماد الإلكتروني */
r.post('/:id/design/send', requirePerm('design.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const fileIds = (req.body.file_ids || []).map((x) => int(x));
    if (!fileIds.length) throw bad('اختر ملفات التصميم المرسلة');
    const f = await db.query('select count(*)::int n from order_files where order_id=$1 and id = any($2::int[])', [o.id, fileIds]);
    if (f.rows[0].n !== fileIds.length) throw bad('ملفات غير صالحة');
    await db.query('update order_files set customer_visible=true where id = any($1::int[])', [fileIds]);
    await db.query("update design_reviews set status='rejected', customer_note=coalesce(customer_note,'استبدل بتصميم أحدث') where order_id=$1 and status='pending'", [o.id]);
    const d = (await db.query('insert into design_reviews(order_id, file_ids, message, sent_by) values ($1,$2,$3,$4) returning id', [o.id, fileIds, str(req.body.message, 'الرسالة'), req.user.id])).rows[0];
    await db.query("update orders set design_status='sent', design_approval_required=true, updated_at=now() where id=$1", [o.id]);
    await prod.logStage(db, o.id, o.current_stage_id, 'design', req.user.id, 'إرسال التصميم للعميل للاعتماد', true);
    await notifyCustomer(db, o.customer_id, { kind: 'design', title: `التصميم جاهز لاعتمادك - ${o.order_no}`, link: `/store/orders/${o.id}` });
    await audit(db, req, 'design.send', 'order', o.id, { review: d.id, files: fileIds });
    return { ok: true };
  }));
});

/** تسجيل اعتماد التصميم نيابة عن العميل (موافقة هاتفية/حضورية موثقة) */
r.post('/:id/design/record', requirePerm('design.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    const decision = oneOf(req.body.decision, ['approved', 'changes_requested', 'rejected'], 'القرار');
    const note = str(req.body.note, 'الملاحظة', { required: true });
    const d = (await db.query("select * from design_reviews where order_id=$1 and status='pending' order by id desc limit 1", [o.id])).rows[0];
    if (!d) throw conflict('لا يوجد تصميم مرسل بانتظار القرار');
    await db.query('update design_reviews set status=$2, customer_note=$3, decided_by=$4, decided_at=now() where id=$1', [d.id, decision, `مسجل بواسطة المصنع: ${note}`, req.user.id]);
    await db.query(`update orders set design_status=$2, design_approved_at=case when $2='approved' then now() else design_approved_at end where id=$1`, [o.id, decision]);
    await prod.logStage(db, o.id, o.current_stage_id, 'design', req.user.id, `قرار التصميم: ${decision} - ${note}`, true);
    await audit(db, req, 'design.record', 'order', o.id, { decision, note });
    return { ok: true };
  }));
});

/** تلبية طلب منتج جاهز من المخزون الجاهز (بدون تصنيع) */
r.post('/:id/from-stock', requirePerm('orders.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await prod.lockOrder(db, int(req.params.id));
    if (!['pending_review', 'approved'].includes(o.status) || !o.product_id) throw conflict('الطلب غير قابل للتلبية من المخزون');
    const p = (await db.query('select * from products where id=$1 for update', [o.product_id])).rows[0];
    if (p.stock_qty < o.quantity) throw conflict(`المخزون الجاهز غير كافٍ (المتوفر ${p.stock_qty})`);
    const bal = await ledger.balance(db, 'finished', p.id, o.material_id);
    if (Number(bal) <= 0) throw conflict('لا يوجد رصيد ذهب للمنتج الجاهز من نفس العيار واللون');
    const w = (await db.query('select round($1::numeric * $2 / $3, 4)::text v', [bal, o.quantity, p.stock_qty])).rows[0].v;
    await ledger.post(db, { kind: 'from_finished_stock', material_id: o.material_id, weight: w, from: ['finished', p.id], to: ['order', o.id], order_id: o.id, reason: 'صرف من المخزون الجاهز', user_id: req.user.id });
    await db.query('update products set stock_qty = stock_qty - $2 where id=$1', [p.id, o.quantity]);
    const route = (await db.query("select id from routes where product_type='__stock__' and active order by id limit 1")).rows[0];
    if (!route) throw bad('لا يوجد مسار "بيع من المخزون الجاهز"');
    await db.query('update orders set from_stock=true, route_id=$2, final_weight=$3, final_gold_weight=$3, design_approval_required=false where id=$1', [o.id, route.id, w]);
    await prod.startProduction(db, { ...o, route_id: route.id, design_approval_required: false }, req.user.id);
    await audit(db, req, 'order.from_stock', 'order', o.id, { weight: w, qty: o.quantity });
    return { ok: true, weight: w };
  }));
});

r.get('/:id/labor', requirePerm('orders.view'), async (req, res) => {
  const o = await one('select * from orders where id=$1', [int(req.params.id)]);
  if (!o) throw notFound();
  res.json(await resolveLabor(pool, { customer_id: o.customer_id, product_id: o.product_id, product_type: o.product_type }));
});

export default r;
