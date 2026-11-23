// الطلب متعدد المنتجات كوحدة واحدة: نقل كل بنوده للمرحلة التالية معاً،
// ومرحلة 3D: موظف الـ3D يحدد لكل قطعة (تصميم / طباعة) وينقل الطلب بدون اعتماد المشرف (لا ذهب في المرحلة).
import { bad, forbidden, notFound } from './http.js';
import { has } from './auth.js';
import { is3D } from './internalImages.js';
import * as prod from './production.js';
import { audit } from './audit.js';

/** هل يستطيع المستخدم نقل بند في هذه المرحلة؟ صلاحية نقل المراحل، أو موظف 3D في مرحلة التصميم (بدون ذهب) */
export function canMove(req, stage) {
  if (has(req, 'orders.advance')) return true;
  return is3D(req.user) && stage && stage.kind === 'design' && !stage.handles_gold;
}

/** بنود الطلب في نفس مرحلة البند المرجعي (أو البند وحده إن لم يكن له طلب رئيسي) */
async function groupAtStage(db, orderId) {
  const ref = (await db.query('select id, cart_ref, current_stage_id from orders where id=$1', [orderId])).rows[0];
  if (!ref) throw notFound('الطلب غير موجود');
  const rows = (await db.query(`select o.id from orders o where o.status='in_production' and o.current_stage_id=$2
      and (o.id=$1 or ($3::text is not null and o.cart_ref=$3)) order by o.order_no`, [ref.id, ref.current_stage_id, ref.cart_ref])).rows;
  return { ref, ids: rows.map((x) => x.id) };
}

export async function advanceGroup(db, req, orderId, body = {}) {
  // النقل بنفس وزن الذهب بدون تسليم واستلام: للمشرف (صلاحية نقل الطلبات) بعد التأكيد فقط
  const skipGold = !!body.skip_gold && has(req, 'orders.advance');
  const { ref, ids } = await groupAtStage(db, orderId);
  if (!ids.length) throw bad('لا توجد بنود قيد التصنيع في هذه المرحلة');
  const stage = (await db.query('select * from stages where id=$1', [ref.current_stage_id])).rows[0];
  if (!canMove(req, stage)) throw forbidden('نقل الطلب في هذه المرحلة يتطلب صلاحية المشرف');
  const moved = [], skipped = [];
  for (const id of ids) {
    const o = await prod.lockOrder(db, id);
    try {
      await db.query('savepoint g');
      await prod.advance(db, o, req.user.id, { skipGold });
      await db.query('release savepoint g');
      moved.push(o.order_no);
    } catch (e) {
      await db.query('rollback to savepoint g');
      skipped.push({ order_no: o.order_no, reason: e.message, ...(e.extra?.needs_gold ? { needs_gold: true } : {}) });
    }
  }
  await audit(db, req, 'order.group_advance', 'order', ref.id, { stage: stage.name, moved, skipped, ...(skipGold ? { skip_gold: true } : {}) });
  return { moved, skipped, stage: stage.name };
}

/** تحديد احتياج القطعة في مرحلة 3D (تصميم / طباعة) */
export async function set3d(db, req, orderId, body) {
  const o = (await db.query('select o.id, o.order_no, o.current_stage_id, s.kind, s.handles_gold from orders o left join stages s on s.id=o.current_stage_id where o.id=$1 for update of o', [orderId])).rows[0];
  if (!o) throw notFound('الطلب غير موجود');
  if (!is3D(req.user) && !has(req, 'orders.advance')) throw forbidden('لفريق 3D فقط');
  const b = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
  const design = b(body.needs_design), print = b(body.needs_print);
  await db.query('update orders set needs_3d_design=$2, needs_3d_print=$3, d3_checked_at=now(), d3_checked_by=$4, updated_at=now() where id=$1', [o.id, design, print, req.user.id]);
  const what = [design && 'تصميم', print && 'طباعة'].filter(Boolean).join(' و') || 'لا يحتاج تصميم أو طباعة';
  await prod.logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `3D: ${what}`, false, req.user.role_code === 'worker' ? req.user.id : null);
  return { ok: true };
}

/** طابور مرحلة 3D: الطلبات (مجمعة) الموجودة في مرحلة التصميم */
export async function queue3d(db) {
  return (await db.query(`select o.id, o.order_no, coalesce(o.cart_ref, o.order_no) as grp, o.title, o.product_type, o.quantity, o.size, o.color, o.notes, o.due_date,
      o.pearl_weight::text, o.stone_weight::text, o.zircon_weight::text, o.needs_3d_design, o.needs_3d_print, o.d3_checked_at, o.d3_design_done_at, o.d3_print_done_at, o.priority,
      max(o.priority) over (partition by coalesce(o.cart_ref, o.order_no)) as grp_priority,
      s.name as stage_name, c.shop_name,
      coalesce((select f.path from order_files f where f.order_id=o.id and f.mime like 'image/%' and f.kind <> 'internal' order by f.id desc limit 1),
        (select pm.path from product_media pm where pm.product_id=o.product_id and pm.kind='image' order by pm.sort, pm.id limit 1)) as thumb
    from orders o join stages s on s.id=o.current_stage_id left join customers c on c.id=o.customer_id
    where o.status='in_production' and s.kind='design' and not s.handles_gold order by grp_priority desc, o.due_date nulls last, grp, o.priority desc, o.order_no`)).rows;
}

// ------------------------------------------------------------------ صفحتا التصاميم والطباعة لفريق 3D (لكل منتج على حدة)
const ITEM_COLS = `o.id, o.order_no, coalesce(o.cart_ref, o.order_no) as grp, o.title, o.product_type, o.quantity, o.size, o.color, o.notes, o.due_date,
  o.needs_3d_design, o.needs_3d_print, o.d3_design_done_at, o.d3_print_done_at, o.priority, s.name as stage_name, c.shop_name,
  dd.full_name as design_by_name, pp.full_name as print_by_name,
  coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'path', f.path, 'mime', f.mime, 'name', f.original_name) order by (f.kind='model3d'), f.id) from order_files f where f.order_id=o.id), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('id', 'p' || pm.id, 'kind', 'product', 'path', pm.path, 'mime', 'image/jpeg', 'name', 'صورة المنتج') order by pm.sort, pm.id) from product_media pm where pm.product_id=o.product_id and pm.kind='image'), '[]'::jsonb) as files`;
const ITEM_FROM = `orders o left join stages s on s.id=o.current_stage_id left join customers c on c.id=o.customer_id
  left join users dd on dd.id=o.d3_design_by left join users pp on pp.id=o.d3_print_by`;

/** قائمة التصاميم أو الطباعة: الحالية (لم تُنجز) أو المنجزة مؤخراً */
export async function d3List(db, kind, done = false) {
  const need = kind === 'print' ? 'o.needs_3d_print' : 'o.needs_3d_design';
  const at = kind === 'print' ? 'o.d3_print_done_at' : 'o.d3_design_done_at';
  return (await db.query(`select ${ITEM_COLS} from ${ITEM_FROM}
    where ${need} and o.status not in ('cancelled','rejected') and ${done ? `${at} > now() - interval '30 days'` : `${at} is null and o.status in ('approved','in_production','on_hold')`}
    order by ${done ? `${at} desc` : 'o.priority desc, o.due_date nulls last, o.order_no'} limit 300`)).rows;
}

/** إنجاز تصميم/طباعة منتج واحد (أو التراجع) */
export async function d3Done(db, req, orderId, body) {
  if (!is3D(req.user)) throw forbidden('لفريق 3D فقط');
  const kind = body.kind === 'print' ? 'print' : 'design';
  const o = (await db.query('select * from orders where id=$1 for update', [orderId])).rows[0];
  if (!o) throw notFound('الطلب غير موجود');
  const undo = body.undo === true;
  if (!undo) {
    if (kind === 'design' && !o.needs_3d_design) throw bad('هذا المنتج غير محدد للتصميم');
    if (kind === 'print' && !o.needs_3d_print) throw bad('هذا المنتج غير محدد للطباعة');
    if (kind === 'design' && !(await db.query("select 1 from order_files where order_id=$1 and kind='model3d' limit 1", [o.id])).rowCount)
      throw bad('ارفع صورة أو ملف التصميم 3D للمنتج أولاً');
    if (kind === 'print' && o.needs_3d_design && !o.d3_design_done_at) throw bad('التصميم لم يُنجز بعد لهذا المنتج');
  }
  const col = kind === 'print' ? 'd3_print' : 'd3_design';
  await db.query(`update orders set ${col}_done_at=$2, ${col}_by=$3, updated_at=now() where id=$1`, [o.id, undo ? null : new Date(), undo ? null : req.user.id]);
  const what = kind === 'print' ? 'الطباعة' : 'التصميم';
  await prod.logStage(db, o.id, o.current_stage_id, 'note', req.user.id, undo ? `تراجع عن إنجاز ${what} 3D` : `✓ أُنجز ${what} 3D للمنتج`, false, req.user.role_code === 'worker' ? req.user.id : null);
  await audit(db, req, `order.3d_${kind}_${undo ? 'undo' : 'done'}`, 'order', o.id, {});
  return { ok: true };
}

export const PRIORITY = ['ليس مستعجلاً', 'مستعجل', 'مستعجل جداً'];
/** أولوية منتج واحد (بند) — للمشرف/مدير الطلبات أو فريق 3D */
export async function setPriority(db, req, orderId, value) {
  const p = Number(value);
  if (![0, 1, 2].includes(p)) throw bad('الأولوية غير صالحة');
  if (!has(req, 'orders.manage') && !has(req, 'orders.advance') && !is3D(req.user)) throw forbidden();
  const o = (await db.query('select id, current_stage_id, priority from orders where id=$1 for update', [orderId])).rows[0];
  if (!o) throw notFound('الطلب غير موجود');
  if (o.priority === p) return { ok: true, priority: p };
  await db.query('update orders set priority=$2, updated_at=now() where id=$1', [o.id, p]);
  await prod.logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `الأولوية: ${PRIORITY[p]}`, false, req.user.role_code === 'worker' ? req.user.id : null);
  await audit(db, req, 'order.priority', 'order', o.id, { from: o.priority, to: p });
  return { ok: true, priority: p };
}
