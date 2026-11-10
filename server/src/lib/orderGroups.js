// طلب العميل الواحد (من السلة) برقم واحد، وبنوده أوامر إنتاج مستقلة: ORD-2026-000005-1، -2 …
// cart_ref يحمل رقم الطلب الرئيسي ويربط البنود ببعضها.

/** رقم طلب رئيسي جديد */
export async function newGroupNo(db) {
  return (await db.query("select next_doc_no('ORD') v")).rows[0].v;
}

/** رقم البند التالي داخل الطلب (min: أقل رقم مسموح، مثلاً 2 عند فصل جزء من طلب بدون بنود) */
export async function nextItemNo(db, ref, min = 1) {
  const r = await db.query(
    `select coalesce(max((regexp_match(order_no, '-([0-9]+)$'))[1]::int) filter (where order_no like $1 || '-%'), 0) as n
     from orders where cart_ref = $1 or order_no = $1`,
    [ref]
  );
  return `${ref}-${Math.max(Number(r.rows[0].n) + 1, min)}`;
}

/** أعمدة الطلب التي تُنسخ عند فصل جزء من الكمية لبند جديد */
let copyCols = null;
export async function orderCopyColumns(db) {
  if (copyCols) return copyCols;
  const skip = new Set(['id', 'order_no', 'qr_token', 'quantity', 'approx_weight', 'labor_estimate', 'route_id', 'created_at', 'updated_at']);
  const rows = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='orders' and is_generated='NEVER' order by ordinal_position")).rows;
  copyCols = rows.map((r) => r.column_name).filter((c) => !skip.has(c));
  return copyCols;
}

/**
 * الطلب متعدد المنتجات يُعامل كقطعة واحدة في الذهب: ذهب الطلب كله على "البند القائد" (أول بند غير ملغى)،
 * والتسليم والاستلام للعامل بوزن واحد للطلب كاملاً.
 */
export async function groupInfo(db, orderId) {
  const o = (await db.query('select id, cart_ref, status from orders where id=$1', [orderId])).rows[0];
  if (!o) return null;
  if (!o.cart_ref) return { lead: o.id, ids: [o.id], cart_ref: null, isGroup: false };
  const rows = (await db.query(`select id, status from orders where cart_ref=$1 order by id`, [o.cart_ref])).rows;
  const live = rows.filter((x) => !['cancelled', 'rejected'].includes(x.status));
  const list = live.length ? live : rows;
  if (list.length < 2) return { lead: o.id, ids: [o.id], cart_ref: o.cart_ref, isGroup: false };
  return { lead: list[0].id, ids: list.map((x) => x.id), cart_ref: o.cart_ref, isGroup: true };
}
