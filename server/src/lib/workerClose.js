// مرحلة يديرها عاملها (مثل الجودة والوزن النهائي): العامل يعتمد الوزن النهائي وينهي المرحلة فينتقل الطلب للفوترة بدون المشرف
import { bad, conflict, weight as W, str } from './http.js';
import { receive } from './custody.js';
import { lockOrder, advance, setFinalWeight, setGroupFinalWeights, logStage } from './production.js';
import { groupInfo } from './orderGroups.js';
import { notifyPerm } from './notify.js';
import { audit } from './audit.js';

/** قبول العهدة: العامل يزن على ميزانه ويطابق وزن التسليم */
export function checkAckWeight(c, stage, body) {
  if (!stage?.worker_closes) return null;
  const w = W(body.weight, 'الوزن على ميزانك');
  const expected = Number(c.gross_weight ?? c.weight_issued);
  if (Math.abs(Number(w) - expected) > 0.01) {
    throw bad(`وزنك ${Number(w).toFixed(3)} جم يختلف عن وزن التسليم ${expected.toFixed(3)} جم — اضغط «رفض» واكتب الوزن الصحيح ليراجعه المشرف`);
  }
  return w;
}

/**
 * إنهاء المرحلة من العامل: استلام العهدة بالوزن النهائي (العجز يُحسب عليه تلقائياً)، تسجيل الوزن النهائي،
 * ثم نقل الطلب كاملاً للمرحلة التالية (الفوترة) وإشعار المحاسب.
 */
export async function workerCloseStage(db, req, c, stage, body) {
  if (!c.order_id) throw bad('العهدة العامة لا تُغلق من هنا');
  const g = await groupInfo(db, c.order_id);
  const ids = g?.isGroup ? g.ids : [c.order_id];
  const note = str(body.note, 'ملاحظة', { max: 300 });
  // الوزن النهائي: للطلب متعدد المنتجات وزن لكل منتج، وإلا وزن واحد
  let total = 0;
  const weights = {};
  if (g?.isGroup) {
    for (const id of ids) {
      const v = body.weights?.[id] ?? body.weights?.[String(id)];
      const w = Number(W(v, 'الوزن النهائي لكل منتج'));
      weights[id] = w; total += w;
    }
  } else {
    total = Number(W(body.weight, 'الوزن النهائي'));
  }
  const scrap = body.scrap ? W(body.scrap, 'البقايا', { allowZero: true }) : '0';

  // 1) استلام العهدة بالوزن النهائي (العامل هو من يزن)
  const r = await receive(db, req, {
    worker_id: req.user.id,
    items: [{ custody_id: c.id, returned_weight: total.toFixed(4), scrap_weight: scrap, reason: note, advance: false, notes: 'إنهاء المرحلة من عامل الجودة' }],
  });
  const st = r.results[0].settlement;
  if (st.status !== 'approved') {
    return { review: true, message: 'الوزن أكبر من المسلَّم — أُحيلت للمشرف للمراجعة قبل النقل للفوترة' };
  }
  // 2) الوزن النهائي (الفرق مع رصيد الطلب إن وُجد يُسجَّل بسبب واضح)
  const why = note || `وزن ${req.user.full_name} (${stage.name})`;
  if (g?.isGroup) await setGroupFinalWeights(db, req, c.order_id, weights, why);
  else await setFinalWeight(db, req, await lockOrder(db, c.order_id), total.toFixed(4), why);

  // 3) النقل للمرحلة التالية بدون اعتماد المشرف (المرحلة مفوضة لعاملها)
  let next = null;
  for (const id of [g?.isGroup ? g.lead : c.order_id, ...ids.filter((x) => x !== (g?.isGroup ? g.lead : c.order_id))]) {
    const o = await lockOrder(db, id);
    if (o.status !== 'in_production' || o.current_stage_id !== stage.id) continue;
    const a = await advance(db, o, req.user.id);
    next ||= a?.stage || null;
  }
  const o = (await db.query('select order_no, cart_ref from orders where id=$1', [c.order_id])).rows[0];
  const label = g?.isGroup ? o.cart_ref : o.order_no;
  if (next) {
    await logStage(db, c.order_id, stage.id, 'note', req.user.id, `اعتمد ${req.user.full_name} الوزن النهائي ${total.toFixed(3)} جم ونقل الطلب إلى ${next.name}`);
    if (next.kind === 'invoicing') await notifyPerm(db, 'invoices.manage', { kind: 'invoice', title: `الطلب ${label} جاهز للفوترة`, body: `الوزن النهائي ${total.toFixed(3)} جم`, link: `/orders/${c.order_id}` });
  }
  await audit(db, req, 'stage.worker_close', 'order', c.order_id, { stage: stage.name, total, settlement: st.settlement_no, next: next?.name || null });
  if (!next) throw conflict('تعذر نقل الطلب للمرحلة التالية');
  return { ok: true, next: next.name, loss: st.actual_loss };
}
