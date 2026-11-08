// تخصيص المنتجات: منتج بقائمتين فارغتين متاح للجميع، وإلا فقط للعملاء المحددين بالاسم أو من الفئات المحددة.
// $n = رقم العميل (null للموظفين: يرون كل المنتجات)
export const visibleTo = (n) => `($${n}::int is null
  or (cardinality(p.allowed_customer_ids) = 0 and cardinality(p.allowed_tier_ids) = 0)
  or $${n}::int = any(p.allowed_customer_ids)
  or exists (select 1 from customers vc where vc.id = $${n}::int and vc.tier_id = any(p.allowed_tier_ids)))`;
