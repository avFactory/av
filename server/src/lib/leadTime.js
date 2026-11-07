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
export async function leadDays(db, { category, customerId }) {
  // حسب الطلب والتصميم الخاص نفس المدة
  const kind = 'catalog';
  const tier = customerId ? (await db.query('select tier_id from customers where id=$1', [customerId])).rows[0]?.tier_id ?? null : null;
  const r = (await db.query(
    `select days from order_lead_times where kind=$1 and category=$2 and (tier_id=$3 or tier_id is null)
     order by (tier_id is null) limit 1`, [kind, category, tier])).rows[0];
  return r ? Number(r.days) : null;
}

/** عدد الأيام التقويمية من اليوم لتغطية n يوم عمل (الجمعة عطلة) — بتوقيت الرياض */
export function calendarDays(n, today = new Date(Date.now() + 3 * 3600e3)) {
  let dow = today.getUTCDay();
  let cal = 0;
  let work = 0;
  while (work < n) { cal++; dow = (dow + 1) % 7; if (dow !== 5) work++; }
  while (dow === 5) { cal++; dow = (dow + 1) % 7; } // لا يقع الموعد يوم جمعة
  return cal;
}

/** تحديد موعد التسليم تلقائياً لطلب ليس له موعد (من اليوم أو من بدء الإنتاج) */
export async function applyDueDate(db, orderId, { recalc = false } = {}) {
  const o = (await db.query('select * from orders where id=$1', [orderId])).rows[0];
  if (!o || o.from_stock) return null;
  if (o.due_date && !(recalc && o.due_auto)) return o.due_date;
  const days = await leadDays(db, { category: orderCategory(o), customerId: o.customer_id });
  if (days == null) return null;
  // مدة التنفيذ بأيام العمل: الجمعة عطلة لا تُحسب، والموعد لا يقع يوم جمعة
  let due = (await db.query(`select to_char((now() at time zone 'Asia/Riyadh')::date + $1::int, 'YYYY-MM-DD') d`, [calendarDays(days)])).rows[0].d;
  // الطاقة الإنتاجية اليومية: إن امتلأ يوم الموعد يُؤجَّل ليوم العمل التالي (يوم لكل يوم مشغول)
  due = await firstFreeDay(db, o, due);
  const r = (await db.query('update orders set due_date = $2::date, due_auto = true where id=$1 returning due_date', [orderId, due])).rows[0];
  return r.due_date;
}

/** حدود الطاقة الإنتاجية اليومية من الإعدادات (فارغ = بدون حد) */
export async function capacity(db) {
  const v = (await db.query("select value from settings where key='capacity'")).rows[0]?.value || {};
  const n = (x) => (x === '' || x == null || !(Number(x) > 0) ? null : Number(x));
  return { orders: n(v.orders), grams: n(v.grams), pieces: n(v.pieces) };
}

/** الحمل على يوم تسليم: عدد الطلبات (الطلب الواحد من السلة يُحسب مرة)، والجرامات، والقطع */
export async function dayLoad(db, day, exceptId = null) {
  return (await db.query(`select count(distinct coalesce(cart_ref, order_no))::int as orders,
      coalesce(sum(coalesce(final_weight, approx_weight)), 0)::float as grams, coalesce(sum(quantity), 0)::int as pieces
    from orders where due_date = $1::date and status not in ('cancelled','rejected') and ($2::int is null or id <> $2)`, [day, exceptId])).rows[0];
}

const nextWorkDay = (iso) => { const d = new Date(`${iso}T00:00:00Z`); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 5); return d.toISOString().slice(0, 10); };

/** أول يوم عمل من يوم الموعد يتسع لهذا الطلب حسب حدود الطاقة اليومية */
export async function firstFreeDay(db, o, day) {
  const cap = await capacity(db);
  if (!cap.orders && !cap.grams && !cap.pieces) return day;
  const grams = Number(o.final_weight || o.approx_weight || 0);
  const pieces = Number(o.quantity || 1);
  for (let i = 0; i < 120; i++) {
    const load = await dayLoad(db, day, o.id);
    // طلب من نفس السلة موجود في هذا اليوم: لا يُعد طلباً جديداً
    const sameCart = o.cart_ref ? (await db.query('select 1 from orders where cart_ref=$1 and due_date=$2::date and id<>$3 and status not in (\'cancelled\',\'rejected\') limit 1', [o.cart_ref, day, o.id])).rowCount > 0 : false;
    const fits = (!cap.orders || load.orders + (sameCart ? 0 : 1) <= cap.orders)
      && (!cap.grams || load.grams + grams <= cap.grams || load.grams === 0)
      && (!cap.pieces || load.pieces + pieces <= cap.pieces || load.pieces === 0);
    if (fits) return day;
    day = nextWorkDay(day);
  }
  return day;
}
