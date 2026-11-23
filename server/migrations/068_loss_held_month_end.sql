-- العجز يبقى في حساب العامل/الماكينة حتى إقفال الشهر:
--   عند الاستلام يُحسب العجز في التسوية لكن الذهب لا يخرج من رصيد العامل (loss_held)،
--   والزيادة تُغطى من عهده الأخرى ثم من عجز الشهر المعلق في حسابه (held_offset)،
--   وفي نهاية الشهر يُثبَّت العجز (حركة من رصيد العامل للعجز الطبيعي/غير الطبيعي) ويُقفل الشهر.
alter table settlements add column if not exists loss_held boolean not null default false;
alter table settlements add column if not exists held_offset numeric(16,4) not null default 0 check (held_offset >= 0);
alter table settlements add column if not exists loss_fixed_at timestamptz;

create table if not exists worker_loss_closings (
  id          serial primary key,
  worker_id   int not null references users(id),
  month       date not null,
  material_id int not null references materials(id),
  actual      numeric(16,4) not null,   -- العجز الفعلي بعد خصم الزيادات المغطاة
  allowed     numeric(16,4) not null,   -- المسموح حسب النسب
  normal      numeric(16,4) not null,   -- ما ثُبّت عجزاً طبيعياً
  abnormal    numeric(16,4) not null,   -- ما ثُبّت عجزاً غير طبيعي
  settlements int not null default 0,
  note        text,
  created_by  int references users(id),
  created_at  timestamptz not null default now(),
  unique (worker_id, month, material_id)
);
