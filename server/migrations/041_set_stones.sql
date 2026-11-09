-- تأكيد وزن الأحجار والزركون واللؤلؤ المركبة في الطلب (بدون مخزون):
-- يُخصم من وزن الميزان عند الاستلام والوزن النهائي، ولا يؤثر على رصيد الذهب
alter table orders add column if not exists set_pearl_weight numeric(12,4);
alter table orders add column if not exists set_stone_weight numeric(12,4);   -- بالقيراط
alter table orders add column if not exists set_zircon_weight numeric(12,4);
alter table orders add column if not exists stones_confirmed_at timestamptz;
alter table orders add column if not exists stones_confirmed_by int references users(id);
