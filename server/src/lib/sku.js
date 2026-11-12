// ترقيم المنتجات تلقائياً حسب نوع القطعة: بادئة + 6 أرقام (مثل RIN000001)
export const PRODUCT_TYPES = [
  ['طقم', 'TKM', /طقم|[أا]طقم|طقوم/], // قبل العقد والحلق: "طقم عقد وحلق" طقم
  ['خاتم', 'RIN', /خات?م|خواتم|دبل/],
  ['أسورة', 'SW', /[اأإ]?سو[اآ]?ر|اساور|أساور|غوائش|غويش/],
  ['عقد', 'NK', /عقد|عقود/],
  ['كف', 'HAN', /^كف|كفوف/],
  ['حلق', 'EAR', /حلق|اقراط|أقراط|قرط/],
  ['سبحة', 'SP', /سبح|مسبح/],
  ['تعليقة', 'PR', /تعليق|دلا[يى]|دلاية|بنتيف/],
  ['خلخال', 'KHL', /خلخال|خلاخيل/],
];

export function skuPrefix(type) {
  const t = String(type || '').trim();
  return PRODUCT_TYPES.find(([name, , re]) => t === name || re.test(t))?.[1] || 'GEN';
}

/** الرقم التالي للبادئة (داخل معاملة مع قفل لمنع التكرار عند الإضافة المتزامنة) */
export async function nextSku(db, type, { lock = false } = {}) {
  const prefix = skuPrefix(type);
  if (lock) await db.query('select pg_advisory_xact_lock(hashtext($1))', [`sku:${prefix}`]);
  const r = await db.query(`select coalesce(max(substring(sku from $2::int)::int), 0) + 1 as n from products where sku ~ ('^' || $1 || '[0-9]+$')`, [prefix, prefix.length + 1]);
  return prefix + String(r.rows[0].n).padStart(6, '0');
}
