-- السبائك والجنيهات: نوعها (سبيكة / جنيه) ووزن القطعة الواحدة — للمنتجات والطلبات (عرض وتصنيف في المتجر)
alter table products add column if not exists bullion_type text check (bullion_type in ('bar', 'coin'));
alter table products add column if not exists bullion_weight numeric(16,4) check (bullion_weight is null or bullion_weight > 0);
alter table orders add column if not exists bullion_type text check (bullion_type in ('bar', 'coin'));
alter table orders add column if not exists bullion_weight numeric(16,4) check (bullion_weight is null or bullion_weight > 0);
