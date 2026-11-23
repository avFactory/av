-- فريق 3D: تصميم وطباعة كل منتج (بند) مستقل عن الطلب كاملاً
alter table orders add column if not exists d3_design_done_at timestamptz;
alter table orders add column if not exists d3_design_by int references users(id);
alter table orders add column if not exists d3_print_done_at timestamptz;
alter table orders add column if not exists d3_print_by int references users(id);
