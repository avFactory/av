import { bad, conflict, notFound } from './http.js';
import { reserveDiamonds } from './stoneReserve.js';
import { notifyCustomer, notifyPerm, notifyUsers } from './notify.js';
import * as ledger from './ledger.js';
import { audit } from './audit.js';
import { applyDueDate } from './leadTime.js';
import { groupInfo } from './orderGroups.js';

export async function lockOrder(db, id) {
  const r = await db.query('select * from orders where id=$1 for update', [id]);
  if (!r.rows[0]) throw notFound('الطلب غير موجود');
  return r.rows[0];
}

export async function routeStages(db, routeId) {
  const r = await db.query(
    `select rs.seq, s.* from route_stages rs join stages s on s.id = rs.stage_id where rs.route_id=$1 order by rs.seq`,
    [routeId]
  );
  return r.rows;
}

export async function pickRoute(db, productType, productRouteId) {
  if (productRouteId) return productRouteId;
  const r = await db.query(
    `select id from routes where active and (product_type = $1 or is_default) order by (product_type = $1) desc nulls last, is_default desc, id limit 1`,
    [productType || null]
  );
  if (!r.rows[0]) throw bad('لا يوجد مسار إنتاج معرّف');
  return r.rows[0].id;
}

/** وزن الأحجار المركبة في الطلب بالجرام (1 قيراط = 0.2 جرام) */
/** هل الطلب طلب ألماس؟ (ألماس صُرف/رُكّب عليه من المخزون، أو ذُكر الألماس في وصفه أو نوعه) */
export async function hasDiamonds(db, orderId) {
  const r = await db.query(`select exists (
      select 1 from stone_movements m join stone_lots l on l.id=m.lot_id
      where m.order_id=$1 and m.kind in ('issue','used') and (l.stone_type ~ '(ألماس|الماس|diamond)')
        and not exists (select 1 from stone_movements x where x.reverses_id=m.id))
    or exists (select 1 from orders o where o.id=$1 and concat_ws(' ', o.title, o.product_type, o.notes) ~ '(ألماس|الماس|سولتير|solitaire|diamond)') as d`, [orderId]);
  return r.rows[0].d;
}

export async function embeddedStonesGrams(db, orderId, workerId = null) {
  return stonesGramsFor(db, [orderId], workerId);
}

/** أحجار الطلب كاملاً (عند التسليم والاستلام للعامل: الطلب متعدد المنتجات قطعة واحدة على البند القائد) */
export async function goldStonesGrams(db, orderId, workerId = null) {
  const g = await groupInfo(db, orderId);
  return stonesGramsFor(db, g && g.isGroup && g.lead === orderId ? g.ids : [orderId], workerId);
}

async function stonesGramsFor(db, ids, workerId) {
  const r = await db.query(
    `select coalesce(sum(carats) filter (where kind='used'), 0) * 0.2 as used_g,
            coalesce(sum(case when worker_id = $2 then
                 case kind when 'issue' then carats when 'return' then -carats when 'used' then -carats when 'lost' then -carats else 0 end
               else 0 end), 0) * 0.2 as out_g
     from stone_movements m
     where order_id = any($1::int[]) and kind <> 'reversal' and not exists (select 1 from stone_movements r where r.reverses_id = m.id)`,
    [ids, workerId]
  );
  // أحجار وزركون ولؤلؤ مؤكدة الوزن في الطلب (بدون مخزون): تُعامل كأحجار مركبة
  const c = (await db.query(`select sum(coalesce(set_pearl_weight,0) + coalesce(set_stone_weight,0) + coalesce(set_zircon_weight,0)) as g from orders where id = any($1::int[])`, [ids])).rows[0];
  const confirmed = Number(c?.g || 0);
  const used = Number(r.rows[0].used_g) + confirmed, out = Number(r.rows[0].out_g);
  return { total: (used + Math.max(0, out)).toFixed(4), used: used.toFixed(4), confirmed: confirmed.toFixed(4) };
}
async function logStage(db, orderId, stageId, event, userId, note, customerVisible = false, workerId = null) {
  if (!orderId) return; // العهدة العامة لا ترتبط بطلب
  await db.query(
    'insert into order_stage_log(order_id, stage_id, event, user_id, note, customer_visible, worker_id) values ($1,$2,$3,$4,$5,$6,$7)',
    [orderId, stageId, event, userId, note, customerVisible, workerId]
  );
}
export { logStage };

/** تحويل الطلب إلى أمر إنتاج ودخوله المرحلة الأولى */
export async function startProduction(db, order, userId) {
  if (!['approved', 'pending_review', 'quoted'].includes(order.status)) throw conflict('لا يمكن بدء الإنتاج لهذا الطلب في حالته الحالية');
  // اعتماد الطلب يحجز ألماس المنتج من المخزون (اللؤلؤ والحجر والزركون للعرض فقط)
  await reserveDiamonds(db, order, userId);
  const routeId = order.route_id || (await pickRoute(db, order.product_type, null));
  const stages = await routeStages(db, routeId);
  if (!stages.length) throw bad('مسار الإنتاج لا يحتوي مراحل');
  await db.query(
    `update orders set status='in_production', route_id=$2, production_started_at=now(), updated_at=now(),
       design_status = case when design_approval_required and design_status='not_required' then 'pending_upload' else design_status end
     where id=$1`,
    [order.id, routeId]
  );
  // الموعد التلقائي يُحسب من يوم بدء الإنتاج (اعتماد الطلب)، والموعد اليدوي لا يتغير
  await applyDueDate(db, order.id, { recalc: true });
  await enterStage(db, { ...order, route_id: routeId, status: 'in_production' }, stages[0], userId);
  await notifyPerm(db, 'orders.advance', { kind: 'order', title: `أمر إنتاج جديد ${order.order_no}`, body: order.title, link: `/orders/${order.id}` });
}

async function enterStage(db, order, stage, userId) {
  await db.query(
    `update orders set current_stage_id=$2, stage_seq=$3, stage_state='waiting', assigned_worker_id=null, updated_at=now() where id=$1`,
    [order.id, stage.id, stage.seq]
  );
  await logStage(db, order.id, stage.id, 'entered', userId, null, stage.customer_visible);
  if (stage.kind === 'delivery_ready') {
    await db.query("update orders set status='ready', ready_at=now() where id=$1", [order.id]);
    await notifyCustomer(db, order.customer_id, { kind: 'ready', title: `طلبك ${order.order_no} جاهز للتسليم`, link: `/store/orders/${order.id}` });
    await notifyPerm(db, 'orders.manage', { kind: 'ready', title: `الطلب ${order.order_no} جاهز للتسليم`, link: `/orders/${order.id}` });
  }
  if (stage.handles_gold) {
    await notifyPerm(db, 'custody.issue', { kind: 'issue', title: `الطلب ${order.order_no} بانتظار تسليم الذهب`, body: stage.name, link: `/sup/issue?order=${order.id}` });
    const w = await db.query('select user_id from stage_workers where stage_id=$1', [stage.id]);
    if (w.rows.length === 1) await db.query('update orders set assigned_worker_id=$2 where id=$1', [order.id, w.rows[0].user_id]);
  }
  // مرحلة المختبر لإصدار الشهادة لطلبات الألماس فقط: تُتخطى تلقائياً إذا لم يكن في الطلب ألماس
  if (stage.code === 'lab' && !(await hasDiamonds(db, order.id))) {
    await logStage(db, order.id, stage.id, 'completed', userId, 'تخطي تلقائي: الطلب بدون ألماس مخبري', false);
    const fresh = (await db.query('select * from orders where id=$1', [order.id])).rows[0];
    await advance(db, fresh, userId, { auto: true });
    return;
  }
  // تخطي مرحلة اعتماد التصميم تلقائياً إذا لم تكن مطلوبة
  if (stage.kind === 'design_approval' && !order.design_approval_required) {
    await logStage(db, order.id, stage.id, 'completed', userId, 'تخطي تلقائي: لا يتطلب اعتماد تصميم', false);
    const fresh = (await db.query('select * from orders where id=$1', [order.id])).rows[0];
    await advance(db, fresh, userId, { auto: true });
  }
}

/**
 * نقل الطلب للمرحلة التالية مع التحقق من شروط الخروج من المرحلة الحالية.
 * opts: { force, reason, auto, byWorker }
 */
export async function advance(db, order, userId, opts = {}) {
  if (order.status !== 'in_production' && order.status !== 'ready') throw conflict('الطلب ليس قيد التصنيع');
  const stages = await routeStages(db, order.route_id);
  const idx = stages.findIndex((s) => s.seq === order.stage_seq);
  const cur = stages[idx];
  if (!cur) throw bad('مرحلة الطلب الحالية غير معروفة');

  const grp = await groupInfo(db, order.id);
  const goldIds = grp?.isGroup ? [...new Set([order.id, grp.lead])] : [order.id];
  const open = await db.query("select count(*)::int n from custodies where order_id = any($1::int[]) and status in ('open','under_review')", [goldIds]);
  if (open.rows[0].n > 0) throw conflict('توجد عهدة مفتوحة أو تسوية تحت المراجعة على هذا الطلب - يجب استلامها وإقفالها أولاً');

  if (cur.kind === 'design_approval' && order.design_approval_required && order.design_status !== 'approved')
    throw conflict('لا يمكن المتابعة قبل اعتماد العميل للتصميم');
  if (cur.kind === 'design' && order.design_approval_required && !['sent', 'approved'].includes(order.design_status) && !opts.force)
    throw conflict('يجب رفع التصميم وإرساله للعميل قبل إنهاء مرحلة التصميم');
  if (cur.handles_gold && cur.requires_weight && !opts.force) {
    const c = await db.query("select count(*)::int n from custodies where order_id = any($1::int[]) and stage_id=$2 and status='closed'", [goldIds, cur.id]);
    if (!c.rows[0].n) throw conflict(`مرحلة "${cur.name}" تتطلب تسليم واستلام ذهب موزون قبل الانتقال`);
  }
  if (cur.kind === 'final_weight' && !order.final_weight) throw conflict('يجب تسجيل الوزن النهائي أولاً');
  if (cur.kind === 'invoicing' && order.customer_id) {
    const inv = await db.query(
      `select 1 from invoice_lines l join invoices i on i.id=l.invoice_id
       where l.order_id=$1 and i.status='issued' and i.invoice_type='invoice' limit 1`, [order.id]);
    if (!inv.rowCount && !opts.force) throw conflict('يجب إصدار فاتورة أجور التصنيع قبل المتابعة');
  }
  if (cur.kind === 'delivery_ready') throw conflict('استخدم إجراء "تسليم الطلب للعميل" لإتمام التسليم');
  if (cur.requires_approval && opts.byWorker) {
    await db.query("update orders set stage_state='pending_approval', updated_at=now() where id=$1", [order.id]);
    await logStage(db, order.id, cur.id, 'completed', userId, 'بانتظار اعتماد المشرف', false);
    await notifyPerm(db, 'orders.advance', { kind: 'approval', title: `الطلب ${order.order_no} بانتظار اعتماد المشرف`, body: cur.name, link: `/orders/${order.id}` });
    return { pending_approval: true };
  }
  const next = stages[idx + 1];
  await logStage(db, order.id, cur.id, 'completed', userId, opts.force ? `تجاوز: ${opts.reason || ''}` : null, cur.customer_visible);
  if (!next) {
    await db.query("update orders set stage_state='done', updated_at=now() where id=$1", [order.id]);
    return { finished: true };
  }
  if (next.kind === 'delivered') throw conflict('استخدم إجراء "تسليم الطلب للعميل"');
  await enterStage(db, order, next, userId);
  await notifyPerm(db, 'orders.advance', { kind: 'stage', title: `انتهت مرحلة ${cur.name} للطلب ${order.order_no}`, link: `/orders/${order.id}` });
  return { stage: next };
}

/** تسجيل الوزن النهائي ومطابقته مع رصيد الذهب في الطلب */
export async function setFinalWeight(db, req, order, grossWeight, note) {
  const stones = await embeddedStonesGrams(db, order.id);
  const goldNet = (await db.query('select round($1::numeric - $2::numeric, 4)::text v', [grossWeight, stones.used])).rows[0].v;
  if (Number(goldNet) <= 0) throw bad('الوزن النهائي أقل من وزن الأحجار المركبة');
  const bal = await ledger.balance(db, 'order', order.id, order.material_id);
  const diff = (await db.query('select round($1::numeric - $2::numeric, 4)::text v', [goldNet, bal])).rows[0].v;
  if (Number(diff) !== 0) {
    if (!note) throw bad(`صافي الذهب (${goldNet}) يختلف عن رصيد الطلب (${Number(bal).toFixed(4)}) بفارق ${diff} جم - يجب تسجيل السبب`, { diff, balance: bal, goldNet });
    if (Number(diff) < 0) {
      await ledger.post(db, { kind: 'final_excess', material_id: order.material_id, weight: String(-Number(diff)), from: ['order', order.id], to: ['scrap', null], order_id: order.id, reason: note, user_id: req.user.id });
    } else {
      await ledger.post(db, { kind: 'final_gain', material_id: order.material_id, weight: diff, from: ['variance', null], to: ['order', order.id], order_id: order.id, reason: note, user_id: req.user.id });
    }
  }
  await db.query('update orders set final_weight=$2, final_gold_weight=$3, updated_at=now() where id=$1', [order.id, grossWeight, goldNet]);
  await logStage(db, order.id, order.current_stage_id, 'note', req.user.id, `الوزن النهائي ${grossWeight} جم (صافي ذهب ${goldNet})${note ? ' - ' + note : ''}`);
  await audit(db, req, 'final_weight', 'order', order.id, { grossWeight, goldNet, balance: bal, diff, note });
  return { goldNet, diff, balance: bal, stones: stones.used };
}

/**
 * الوزن النهائي للطلب متعدد المنتجات: وزن كل منتج (للفاتورة)، والمطابقة مع رصيد ذهب الطلب كاملاً (على البند القائد)،
 * والفرق يُسجَّل مرة واحدة على البند القائد.
 */
export async function setGroupFinalWeights(db, req, anyOrderId, weights, note) {
  const g = await groupInfo(db, anyOrderId);
  if (!g?.isGroup) throw bad('الطلب ليس متعدد المنتجات');
  const orders = [];
  for (const id of g.ids) orders.push(await lockOrder(db, id));
  const lead = orders.find((o) => o.id === g.lead);
  let netSum = 0, balSum = 0;
  const rows = [];
  for (const o of orders) {
    const raw = weights[o.id] ?? weights[String(o.id)];
    if (raw == null || raw === '') throw bad(`أدخل الوزن النهائي للبند ${o.order_no}`);
    const gross = Number(raw);
    if (!(gross > 0)) throw bad(`وزن غير صالح للبند ${o.order_no}`);
    const stones = Number((await embeddedStonesGrams(db, o.id)).used);
    const net = +(gross - stones).toFixed(4);
    if (net <= 0) throw bad(`الوزن النهائي للبند ${o.order_no} أقل من وزن الأحجار المركبة`);
    netSum += net;
    balSum += Number(await ledger.balance(db, 'order', o.id, o.material_id));
    rows.push({ o, gross: gross.toFixed(4), net: net.toFixed(4) });
  }
  const diff = +(netSum - balSum).toFixed(4);
  if (diff !== 0) {
    if (!note) throw bad(`صافي ذهب الطلب (${netSum.toFixed(4)}) يختلف عن رصيد الطلب (${balSum.toFixed(4)}) بفارق ${diff} جم - يجب تسجيل السبب`, { diff, balance: balSum, goldNet: netSum });
    if (diff < 0) await ledger.post(db, { kind: 'final_excess', material_id: lead.material_id, weight: String(-diff), from: ['order', lead.id], to: ['scrap', null], order_id: lead.id, reason: note, user_id: req.user.id });
    else await ledger.post(db, { kind: 'final_gain', material_id: lead.material_id, weight: String(diff), from: ['variance', null], to: ['order', lead.id], order_id: lead.id, reason: note, user_id: req.user.id });
  }
  for (const { o, gross, net } of rows) {
    await db.query('update orders set final_weight=$2, final_gold_weight=$3, updated_at=now() where id=$1', [o.id, gross, net]);
    await logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `الوزن النهائي ${gross} جم (صافي ذهب ${net})${note ? ' - ' + note : ''}`);
  }
  await audit(db, req, 'final_weight_group', 'order', lead.id, { weights: rows.map((r) => ({ order: r.o.order_no, gross: r.gross, net: r.net })), balance: balSum, diff, note });
  return { goldNet: netSum.toFixed(4), balance: balSum.toFixed(4), diff };
}

/** تسليم الطلب للعميل: خروج الذهب من المصنع وإقفال الطلب */
export async function deliver(db, req, order, note) {
  const stages = await routeStages(db, order.route_id);
  const cur = stages.find((s) => s.seq === order.stage_seq);
  if (order.status !== 'ready' || cur?.kind !== 'delivery_ready') throw conflict('الطلب ليس في مرحلة جاهز للتسليم');
  const bals = await db.query("select material_id, balance::text from gold_balances where loc_type='order' and loc_ref=$1 and balance <> 0", [order.id]);
  for (const b of bals.rows) {
    if (Number(b.balance) < 0) throw conflict('رصيد الطلب سالب - راجع الحركات');
    // طلب داخلي لمنتج كتالوج: يدخل المخزون الجاهز بدلاً من الخروج من المصنع
    const toStock = !order.customer_id && order.product_id;
    await ledger.post(db, {
      kind: toStock ? 'to_finished_stock' : 'delivery', material_id: b.material_id, weight: b.balance,
      from: ['order', order.id], to: toStock ? ['finished', order.product_id] : ['delivered', order.id],
      order_id: order.id, reason: note, user_id: req.user.id,
    });
  }
  if (!order.customer_id && order.product_id) {
    await db.query('update products set stock_qty = stock_qty + $2 where id=$1', [order.product_id, order.quantity]);
  }
  const last = stages.find((s) => s.kind === 'delivered');
  await logStage(db, order.id, cur.id, 'completed', req.user.id, note, true);
  if (last) {
    await db.query('update orders set current_stage_id=$2, stage_seq=$3 where id=$1', [order.id, last.id, last.seq]);
    await logStage(db, order.id, last.id, 'entered', req.user.id, null, true);
  }
  await db.query("update orders set status='delivered', stage_state='done', delivered_at=now(), updated_at=now() where id=$1", [order.id]);
  await notifyCustomer(db, order.customer_id, { kind: 'delivered', title: `تم تسليم الطلب ${order.order_no}`, link: `/store/orders/${order.id}` });
  await audit(db, req, 'deliver', 'order', order.id, { note });
}

export async function notifyWorkerAssigned(db, order, workerId) {
  await notifyUsers(db, [workerId], { kind: 'assigned', title: `تم إسناد الطلب ${order.order_no} إليك`, body: order.title, link: `/w/orders/${order.id}` });
}
