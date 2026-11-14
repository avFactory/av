// أقل كمية للطلب من المتجر: منتجات الذهب، ومنتجات الألماس والطلبات الخاصة (التلقائي 5 و2)
export const MIN_ORDER_DEFAULT = { gold: 5, diamond: 2 };

export async function getMinOrder(db) {
  const v = (await db.query("select value from settings where key='min_order'")).rows[0]?.value || {};
  const n = (x, d) => (Number.isInteger(Number(x)) && Number(x) >= 1 ? Number(x) : d);
  return { gold: n(v.gold, MIN_ORDER_DEFAULT.gold), diamond: n(v.diamond, MIN_ORDER_DEFAULT.diamond) };
}
