// مدة تنفيذ الطلبات بالأيام (لوحة التحكم ← الإعدادات): حسب الفئة وتصنيف العميل
const DIAMOND_TEXT = /(ألماس|الماس|سوليتير|سولتير|solitaire|diamond)/i;

/** الفئة: ألماس مخبري، أو ذهب (يشمل اللؤلؤ والأحجار والزركون) */
export function orderCategory(o) {
  let d = o?.diamonds;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = []; } }
  if (Array.isArray(d) && d.length) return 'diamond';
  return DIAMOND_TEXT.test([o?.title, o?.product_type, o?.name].filter(Boolean).join(' ')) ? 'diamond' : 'gold';
}

/** عدد الأيام لعميل (حسب تصنيفه، وإلا المدة الافتراضية) */
export async function leadDays(db, { kind, category, customerId }) {
  const tier = customerId ? (await db.query('select tier_id from customers where id=$1', [customerId])).rows[0]?.tier_id ?? null : null;
  const r = (await db.query(
    `select days from order_lead_times where kind=$1 and category=$2 and (tier_id=$3 or tier_id is null)
     order by (tier_id is null) limit 1`, [kind, category, tier])).rows[0];
  return r ? Number(r.days) : null;
}

/** تحديد موعد التسليم تلقائياً لطلب ليس له موعد (من اليوم أو من بدء الإنتاج) */
export async function applyDueDate(db, orderId, { recalc = false } = {}) {
  const o = (await db.query('select * from orders where id=$1', [orderId])).rows[0];
  if (!o || o.from_stock) return null;
  if (o.due_date && !(recalc && o.due_auto)) return o.due_date;
  const days = await leadDays(db, { kind: o.source === 'store_custom' || (!o.product_id && o.source !== 'store_catalog') ? 'custom' : 'catalog', category: orderCategory(o), customerId: o.customer_id });
  if (days == null) return null;
  const r = (await db.query(`update orders set due_date = (now() at time zone 'Asia/Riyadh')::date + $2::int, due_auto = true where id=$1 returning due_date`, [orderId, days])).rows[0];
  return r.due_date;
}
