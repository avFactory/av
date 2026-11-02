-- صلاحيات على مستوى قاعدة البيانات للإنتاج:
-- يتصل التطبيق بمستخدم محدود لا يملك حذف/تعديل الجداول الحساسة ولا تغيير المخطط.
-- التشغيل (كمالك قاعدة البيانات بعد تطبيق migrations):
--   psql "$OWNER_DATABASE_URL" -v app_password="'StrongPass'" -f server/sql/app_role.sql
-- ثم اضبط DATABASE_URL للتطبيق على المستخدم goldapp.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'goldapp') then
    create role goldapp login;
  end if;
end $$;
alter role goldapp password :app_password;
-- grant connect on database <db_name> to goldapp;  -- نفّذها يدوياً باسم قاعدة البيانات
grant usage on schema public to goldapp;
grant select, insert, update, delete on all tables in schema public to goldapp;
grant usage, select on all sequences in schema public to goldapp;
grant execute on all functions in schema public to goldapp;
-- الدفاتر وسجلات التدقيق: إضافة وقراءة فقط (إضافة لمشغلات قاعدة البيانات التي تمنع التعديل)
revoke update, delete, truncate on gold_ledger, stone_movements, inventory_movements, audit_log, stage_loss_rates, payments, invoice_lines from goldapp;
revoke delete, truncate on custodies, settlements, invoices, orders from goldapp;
