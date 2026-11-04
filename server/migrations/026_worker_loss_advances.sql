-- العجز الزائد عن النسبة المسموحة يبقى على حساب العامل حتى نهاية الشهر، ثم يُسجَّل سلفة تُخصم من الراتب
create table if not exists worker_advances (
  id             serial primary key,
  worker_id      int not null references users(id),
  month          date not null,                 -- أول يوم في الشهر
  grams          numeric(16,4) not null,        -- العجز المحمّل على العامل (مجموع كل العيارات)
  pure_grams     numeric(16,4) not null,        -- ما يعادله عيار 24
  price_per_gram numeric(14,2) not null,        -- سعر جرام الذهب عيار 24 المعتمد للتقييم
  amount         numeric(14,2) not null,        -- قيمة السلفة (ر.س)
  details        jsonb not null default '[]',   -- تفاصيل الطلبات
  notes          text,
  created_by     int references users(id),
  created_at     timestamptz not null default now(),
  unique (worker_id, month)
);

insert into permissions(code, name, grp) values ('loss.advances', 'تسجيل سلف العجز على العمال', 'العجز') on conflict (code) do nothing;
insert into role_permissions(role_code, perm_code)
  select r, 'loss.advances' from unnest(array['admin', 'production_manager', 'accountant']) r
  where exists (select 1 from roles where code = r) on conflict do nothing;
