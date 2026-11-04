-- تفاصيل أحجار الطلب (من المنتج أو يحددها العميل في "اطلب تصميمك"): الألماس يُحجز من المخزون عند اعتماد الطلب
alter table orders add column if not exists diamonds jsonb not null default '[]';
alter table orders add column if not exists pearl_weight numeric(12,3);
alter table orders add column if not exists stone_weight numeric(12,3);
alter table orders add column if not exists zircon_weight numeric(12,3);
-- الطلبات الحالية المرتبطة بمنتجات تأخذ تفاصيل أحجار المنتج
update orders o set diamonds = p.diamonds, pearl_weight = p.pearl_weight, stone_weight = p.stone_weight, zircon_weight = p.zircon_weight
  from products p where p.id = o.product_id and o.diamonds = '[]' and p.diamonds <> '[]';
