-- الاسم المختصر للعميل (حتى 3 كلمات) يظهر على ملصقات الطلبات
alter table customers add column if not exists short_name text;
