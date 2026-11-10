// صورة الطلب الرئيسية: التصميم ← المرجع ← الرسم ← أي صورة للطلب ← صورة المنتج
export const orderThumb = (o = 'o') => `coalesce(
  (select f.path from order_files f where f.order_id=${o}.id and f.mime like 'image/%' and f.kind <> 'internal' order by (f.kind='design') desc, (f.kind='reference') desc, (f.kind='sketch') desc, f.id desc limit 1),
  (select pm.path from product_media pm where pm.product_id=${o}.product_id and pm.kind='image' order by pm.sort, pm.id limit 1))`;
