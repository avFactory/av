-- شركة بفروع فقط: لا يوجد دخول للحساب الرئيسي، كل فرع يدخل باسم مستخدم الشركة + اختيار الفرع + كلمة مروره
alter table customers add column if not exists branches_only boolean not null default false;
