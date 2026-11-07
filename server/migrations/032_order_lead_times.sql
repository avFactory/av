-- مدة تنفيذ الطلب بالأيام: حسب نوع الطلب (حسب الطلب من المتجر / تصميم خاص) × الفئة (ألماس مخبري / ذهب مع اللؤلؤ والأحجار والزركون) × تصنيف العميل
-- tier_id فارغ = المدة الافتراضية لمن ليس له مدة خاصة بتصنيفه. المنتجات المتوفرة في المخزون لا تحتاج مدة.
create table if not exists order_lead_times (
  id        serial primary key,
  kind      text not null check (kind in ('catalog', 'custom')),
  category  text not null check (category in ('diamond', 'gold')),
  tier_id   int references customer_tiers(id) on delete cascade,
  days      int not null check (days between 0 and 365),
  updated_at timestamptz not null default now()
);
create unique index if not exists order_lead_times_key on order_lead_times(kind, category, coalesce(tier_id, 0));
insert into order_lead_times(kind, category, tier_id, days) values
  ('catalog', 'gold', null, 14), ('catalog', 'diamond', null, 21), ('custom', 'gold', null, 21), ('custom', 'diamond', null, 30)
on conflict do nothing;
-- الموعد محسوب تلقائياً (يُعاد حسابه عند بدء الإنتاج) أم أدخله العميل/الموظف يدوياً
alter table orders add column if not exists due_auto boolean not null default false;
