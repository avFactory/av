// أجور التصنيع فقط - لا يوجد أي ربط بسعر الذهب
export async function resolveLabor(db, { customer_id, product_id, product_type }) {
  const cust = customer_id ? (await db.query('select tier_id from customers where id=$1', [customer_id])).rows[0] : null;
  const tier = cust?.tier_id ?? null;
  const rules = (await db.query(
    `select *, (case when customer_id is not null then 100 else 0 end + case when tier_id is not null then 50 else 0 end
              + case when product_id is not null then 20 else 0 end + case when product_type is not null then 10 else 0 end) as score
     from labor_rates
     where active and scope <> 'stage'
       and (customer_id is null or customer_id = $1)
       and (tier_id is null or tier_id = $2)
       and (product_id is null or product_id = $3)
       and (product_type is null or product_type = $4)
     order by score desc, id desc`,
    [customer_id ?? null, tier, product_id ?? null, product_type ?? null]
  )).rows;
  let best = rules[0] || null;
  if (product_id) {
    const p = (await db.query('select labor_method, labor_rate from products where id=$1', [product_id])).rows[0];
    if (p?.labor_method && p.labor_rate != null && (!best || best.score < 20)) {
      best = { method: p.labor_method, rate: p.labor_rate, name: 'أجرة المنتج', score: 20 };
    }
  }
  if (!best) return null;
  return { method: best.method, rate: String(best.rate), rule: best.name, rule_id: best.id ?? null };
}

export function laborAmount(method, rate, weight, qty) {
  const r = Number(rate || 0);
  if (method === 'per_gram') return round2(r * Number(weight || 0));
  if (method === 'per_piece') return round2(r * Number(qty || 1));
  return round2(r);
}
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const METHOD_LABELS = { per_gram: 'لكل جرام', per_piece: 'لكل قطعة', fixed: 'ثابتة للطلب', manual: 'يدوية معتمدة' };
