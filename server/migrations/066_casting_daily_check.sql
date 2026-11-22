-- المطابقة اليومية (تحت الصب): الوزن القائم ناقص الأكياس والمعالق والعلب وأي وزن آخر = الوزن الباقي
create table if not exists casting_daily_checks (
  id           serial primary key,
  check_date   date not null default current_date,
  gross        numeric(14,3) not null check (gross >= 0),
  bags         int not null default 0 check (bags >= 0),
  bag_weight   numeric(10,3) not null default 0.383 check (bag_weight >= 0),
  spoons       int not null default 0 check (spoons >= 0),
  spoon_weight numeric(10,3) not null default 0.75 check (spoon_weight >= 0),
  boxes_weight numeric(14,3) not null default 0 check (boxes_weight >= 0),
  other_weight numeric(14,3) not null default 0 check (other_weight >= 0),
  other_note   text,
  net          numeric(14,3) not null,
  note         text,
  created_by   int references users(id),
  created_at   timestamptz not null default now()
);
create index if not exists casting_daily_checks_date on casting_daily_checks(check_date);
