-- تخصيص المنتج لعملاء معيّنين أو فئات عملاء. الافتراضي (القائمتان فارغتان) = متاح لكل العملاء
alter table products add column if not exists allowed_customer_ids int[] not null default '{}';
alter table products add column if not exists allowed_tier_ids int[] not null default '{}';
