-- فروع العملاء: كل فرع له حساب دخول وكلمة مرور خاصة، ويُختار عند تسجيل الدخول باسم مستخدم المحل الرئيسي
create table customer_branches (
  id          serial primary key,
  customer_id int not null references customers(id),
  name        text not null,
  city        text,
  address     text,
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (customer_id, name)
);
alter table users add column branch_id int references customer_branches(id);
create unique index users_one_per_branch on users (branch_id) where branch_id is not null;
alter table orders add column branch_id int references customer_branches(id);
create index on orders(branch_id);
