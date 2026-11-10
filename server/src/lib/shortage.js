// سحب الطلب من العامل (غياب...) ومرحلة النواقص:
// قطع من الطلب لا يتوفر لها ألماس أو خامات تُسحب من العامل (بوزن مؤكد) وتُفصل في طلب جديد برقم وباركود جديدين،
// وتنتظر في "النواقص" حتى التوفر، والطلب الأصلي يكمل مراحله.
import { bad, conflict, notFound, int, str, oneOf, weight as W } from './http.js';
import * as ledger from './ledger.js';
import { audit } from './audit.js';
import { notifyCustomer, notifyUsers } from './notify.js';
import { lockOrder, logStage } from './production.js';
import { groupInfo, newGroupNo, orderCopyColumns } from './orderGroups.js';
import { receive } from './custody.js';

export const SHORTAGE_KINDS = { diamond: 'ألماس', chain: 'سلاسل / روبتشن', findings: 'خامات (أقفال، كور...)', stones: 'أحجار / زركون / لؤلؤ', gold: 'ذهب', other: 'أخرى' };

/** سحب العهدة من العامل (غياب أو ضرورة): المشرف يزن القطع ويستلمها، والطلب يبقى في مرحلته لتسليمه لعامل آخر */
export async function withdrawCustody(db, req, custodyId, body) {
  const c = (await db.query('select c.*, u.full_name from custodies c join users u on u.id=c.worker_id where c.id=$1', [int(custodyId)])).rows[0];
  if (!c) throw notFound('العهدة غير موجودة');
  if (c.status !== 'open') throw conflict('العهدة ليست مفتوحة');
  const reason = str(body.reason, 'سبب السحب', { required: true });
  const r = await receive(db, req, {
    worker_id: c.worker_id, note: `سحب من العامل: ${reason}`,
    items: [{ custody_id: c.id, returned_weight: body.returned_weight, scrap_weight: body.scrap_weight || '0', stones_weight: body.stones_weight, advance: false, notes: `سحب: ${reason}`, reason: body.review ? reason : undefined, review: !!body.review }],
  });
  if (c.order_id) {
    await db.query("update orders set assigned_worker_id=null, stage_state='waiting', updated_at=now() where id=$1 and assigned_worker_id=$2", [c.order_id, c.worker_id]);
    await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `سحب الطلب من العامل ${c.full_name}: ${reason}`, false, c.worker_id);
  }
  await notifyUsers(db, [c.worker_id], { kind: 'custody', title: `سحب المشرف العهدة ${c.custody_no} منك`, body: reason, link: '/w' });
  await audit(db, req, 'custody.withdraw', 'custody', c.id, { reason, returned: body.returned_weight });
  return r;
}

/**
 * نقل قطع من الطلب لمرحلة النواقص.
 * body: quantity (افتراضياً كامل البند)، weight (الوزن المؤكد للقطع على الميزان)، kind، reason (بيان إلزامي)
 */
export async function moveToShortage(db, req, orderId, body) {
  const item = await lockOrder(db, int(orderId));
  if (item.status !== 'in_production') throw conflict('النواقص للطلبات قيد التصنيع فقط');
  if (item.stage_state === 'shortage') throw conflict('البند في النواقص مسبقاً');
  const qty = body.quantity != null && body.quantity !== '' ? int(body.quantity, 'عدد القطع', { min: 1 }) : item.quantity;
  if (qty > item.quantity) throw bad(`عدد القطع أكبر من كمية البند (${item.quantity})`);
  const kind = oneOf(body.kind, Object.keys(SHORTAGE_KINDS), 'نوع النواقص');
  const reason = str(body.reason, 'بيان النواقص', { required: true });
  const weight = body.weight == null || body.weight === '' ? '0' : W(body.weight, 'الوزن', { allowZero: true });
  const g = await groupInfo(db, item.id);
  const whole = qty === item.quantity;
  const goldOrderId = g?.isGroup ? g.lead : item.id;
  const openC = (await db.query("select * from custodies where order_id=$1 and status in ('open','under_review') for update", [goldOrderId])).rows;
  if (openC.some((c) => c.status === 'under_review')) throw conflict('على الطلب تسوية تحت المراجعة - أنهِها أولاً');
  const custody = openC[0] || null;

  // طلب بند واحد بالكامل: يبقى بنفس رقمه وينتقل للنواقص (ذهبه معه)
  if (!g?.isGroup && whole) {
    if (custody) throw conflict(`الطلب لدى العامل - اسحبه منه أولاً (سحب من العامل) ثم انقله للنواقص`);
    await mark(db, req, item, { kind, reason, from: null });
    await audit(db, req, 'order.shortage', 'order', item.id, { quantity: qty, kind, reason });
    return { order_id: item.id, order_no: item.order_no, same: true };
  }

  const newRef = await newGroupNo(db);
  const newNo = `${newRef}-1`;
  let target;
  let src = goldOrderId;
  if (whole) {
    // البند كله يخرج من الطلب برقم وباركود جديدين
    if (g.lead === item.id) {
      // البند القائد يحمل ذهب الطلب: ينتقل الذهب والعهدة للبند التالي
      const newLead = g.ids.find((x) => x !== item.id);
      const bal = await ledger.balance(db, 'order', item.id, item.material_id);
      if (Number(bal) > 0) await ledger.post(db, { kind: 'group_merge', material_id: item.material_id, weight: bal, from: ['order', item.id], to: ['order', newLead], order_id: newLead, reason: `نقل ذهب الطلب عند فصل ${item.order_no} للنواقص`, user_id: req.user.id });
      await db.query("select set_config('av.allow_relink', 'on', true)");
      await db.query("update custodies set order_id=$2 where order_id=$1 and status in ('open','under_review')", [item.id, newLead]);
      await db.query("select set_config('av.allow_relink', 'off', true)");
      src = newLead;
    }
    await db.query(`update orders set order_no=$2, cart_ref=$3, qr_token=encode(gen_random_bytes(10), 'hex'), updated_at=now() where id=$1`, [item.id, newNo, newRef]);
    target = { ...item, order_no: newNo, cart_ref: newRef };
  } else {
    // جزء من الكمية: بند جديد بالقطع الناقصة، ويُخفض البند الأصلي
    const ratio = qty / item.quantity;
    const r4 = (x) => (x == null ? null : Math.round(Number(x) * ratio * 10000) / 10000);
    const r2 = (x) => (x == null ? null : Math.round(Number(x) * ratio * 100) / 100);
    const newW = r4(item.approx_weight);
    const newEst = item.labor_method === 'fixed' ? null : r2(item.labor_estimate);
    const cols = (await orderCopyColumns(db)).filter((c) => !['final_weight', 'final_gold_weight'].includes(c));
    const n = (await db.query(
      `insert into orders(${cols.join(', ')}, order_no, quantity, approx_weight, labor_estimate, route_id)
       select ${cols.map((c) => (c === 'cart_ref' ? '$2' : c)).join(', ')}, $3, $4, $5, $6, route_id from orders where id=$1 returning *`,
      [item.id, newRef, newNo, qty, newW, newEst])).rows[0];
    await db.query(`update orders set quantity=quantity-$2, approx_weight=case when approx_weight is null then null else approx_weight-$3 end,
        labor_estimate=case when labor_estimate is null or $4::numeric is null then labor_estimate else labor_estimate-$4 end, updated_at=now() where id=$1`,
      [item.id, qty, newW || 0, newEst]);
    await db.query(`insert into order_files(order_id, kind, path, original_name, mime, uploaded_by, customer_visible)
      select $2, kind, path, original_name, mime, uploaded_by, customer_visible from order_files where order_id=$1 order by id`, [item.id, n.id]);
    await logStage(db, n.id, item.current_stage_id, 'created', req.user.id, `فُصل من ${item.order_no} (${qty} قطعة) للنواقص`, true);
    target = n;
  }

  // الذهب: القطع الناقصة تُسحب من العامل (إن كانت لديه) أو من رصيد الطلب، بالوزن المؤكد على الميزان
  if (Number(weight) > 0) {
    const srcOrder = (await db.query('select id, order_no, material_id from orders where id=$1', [src])).rows[0];
    if (srcOrder.material_id !== target.material_id) throw bad('عيار القطع يختلف عن عيار الطلب');
    if (custody) {
      const avail = Number(custody.weight_issued) - Number(custody.weight_used);
      if (Number(weight) > avail + 1e-9) throw bad(`الوزن أكبر من المتبقي في عهدة العامل (${avail.toFixed(3)} جم)`);
      await db.query('update custodies set weight_used = weight_used + $2, pieces = greatest(0, pieces - $3) where id=$1', [custody.id, weight, qty]);
      await ledger.post(db, { kind: 'shortage_return', material_id: target.material_id, weight, from: ['worker', custody.worker_id], to: ['order', target.id], order_id: target.id, custody_id: custody.id, worker_id: custody.worker_id, stage_id: custody.stage_id, reason: `سحب ${qty} قطعة للنواقص: ${reason}`, user_id: req.user.id });
      await logStage(db, src, custody.stage_id, 'note', req.user.id, `سحب ${qty} قطعة (${weight} جم) من عهدة العامل للنواقص → ${newNo}`, false, custody.worker_id);
      await notifyUsers(db, [custody.worker_id], { kind: 'custody', title: `سحب ${qty} قطعة (${weight} جم) من عهدتك للنواقص`, body: `${item.order_no}: ${reason}`, link: '/w' });
    } else {
      await ledger.requireBalance(db, 'order', src, target.material_id, weight, 'رصيد ذهب الطلب أقل من وزن القطع');
      await ledger.post(db, { kind: 'shortage_split', material_id: target.material_id, weight, from: ['order', src], to: ['order', target.id], order_id: target.id, reason: `فصل ${qty} قطعة للنواقص: ${reason}`, user_id: req.user.id });
    }
  }
  await mark(db, req, target, { kind, reason, from: g?.cart_ref || item.order_no });
  await logStage(db, src, item.current_stage_id, 'note', req.user.id, `فصل ${qty} قطعة (${item.product_type || item.title}) للنواقص → ${newNo}: ${SHORTAGE_KINDS[kind]} - ${reason}`, true);
  await audit(db, req, 'order.shortage', 'order', target.id, { from: item.order_no, quantity: qty, weight, kind, reason, custody: custody?.custody_no });
  return { order_id: target.id, order_no: newNo, same: false };
}

async function mark(db, req, o, { kind, reason, from }) {
  await db.query(`update orders set stage_state='shortage', shortage_kind=$2, shortage_reason=$3, shortage_at=now(), shortage_by=$4,
      shortage_from=coalesce($5, shortage_from), assigned_worker_id=null, updated_at=now() where id=$1`, [o.id, kind, reason, req.user.id, from]);
  await logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `النواقص: ${SHORTAGE_KINDS[kind]} - ${reason}`, true);
  if (o.customer_id) await notifyCustomer(db, o.customer_id, { kind: 'stage', title: `قطع من طلبكم في النواقص - ${o.order_no}`, body: `${o.quantity ?? ''} ${o.product_type || o.title}: بانتظار توفر ${SHORTAGE_KINDS[kind]}`, link: `/store/orders/${o.id}` });
}

/** توفرت النواقص: يعود البند لمرحلته ويكمل الإنتاج كطلب مستقل */
export async function resumeShortage(db, req, orderId, body) {
  const o = await lockOrder(db, int(orderId));
  if (o.stage_state !== 'shortage') throw conflict('البند ليس في النواقص');
  await db.query("update orders set stage_state='waiting', updated_at=now() where id=$1", [o.id]);
  await logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `توفرت النواقص - استئناف الإنتاج${body?.note ? `: ${str(body.note, 'ملاحظة')}` : ''}`, true);
  await audit(db, req, 'order.shortage_resume', 'order', o.id, {});
  return { ok: true };
}
