-- أولوية المنتج (البند): 0 ليس مستعجلاً، 1 مستعجل، 2 مستعجل جداً — تُرتب بها قوائم 3D والتصاميم والطباعة
alter table orders add column if not exists priority smallint not null default 0 check (priority between 0 and 2);
