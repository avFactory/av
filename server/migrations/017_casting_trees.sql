-- صفحة "الصب" (مطابقة لورقة "صب" في ملف Excel): أشجار الشمع وحساب الذهب المستحق والخلطة وعجز الصب
create table if not exists casting_trees (
  id           serial primary key,
  tree_no      text not null,                       -- رقم الشجرة (أو نص مثل "كسر")
  color        text,                                -- لون الشجرة
  karat        int not null default 18 check (karat in (18, 21)),
  zircon       numeric(12,3),                       -- الزركون
  wax          numeric(12,3),                       -- شجرة شمع
  gold_before  numeric(12,3),                       -- الذهب الفعلي قبل
  gold_after   numeric(12,3),                       -- الذهب الفعلي بعد
  issued_at    timestamptz,                         -- تاريخ التسليم (عند إدخال "قبل")
  received_at  timestamptz,                         -- تاريخ الاستلام (عند إدخال "بعد")
  notes        text,
  created_by   int references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists casting_trees_created on casting_trees(created_at desc);

-- الطلبات المركبة على كل شجرة
create table if not exists casting_tree_orders (
  tree_id  int not null references casting_trees(id) on delete cascade,
  order_id int not null references orders(id),
  primary key (tree_id, order_id)
);
create index if not exists casting_tree_orders_order on casting_tree_orders(order_id);
