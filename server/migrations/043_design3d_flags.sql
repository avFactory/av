-- مرحلة 3D: موظف الـ3D يحدد لكل قطعة في الطلب هل تحتاج تصميم أو طباعة
alter table orders add column if not exists needs_3d_design boolean;
alter table orders add column if not exists needs_3d_print boolean;
alter table orders add column if not exists d3_checked_at timestamptz;
alter table orders add column if not exists d3_checked_by int references users(id);
