-- بصمة الصور الإصدار الثاني (قص الخلفية + 256 بت): تُعاد حساب البصمات القديمة تلقائياً
alter table product_media add column if not exists hash_v int;
alter table product_media alter column dhash type text;
