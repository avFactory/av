-- حذف المنتجات: المنتج غير المرتبط بأي طلب/حركة يُحذف نهائياً، والمرتبط يُؤرشف (يختفي من القوائم والمتجر ويبقى في السجلات)
alter table products add column if not exists deleted_at timestamptz;
