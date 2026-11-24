-- تصفير التشغيل للبدء الفعلي: حذف كل الطلبات والعهد وحركات الذهب والفواتير والمدفوعات وحركات المخزون التجريبية.
-- يبقى كما هو: المستخدمون والعمال والعملاء وفروعهم ومستنداتهم، المنتجات وصورها، المراحل والمسارات ونسب العجز،
-- المواد والعيارات، أنواع الألماس والأحجار، الخامات (التعريف)، الموردون وجمل الصافي (الأسماء)، الأجور والإعدادات وسجل التدقيق.
\set ON_ERROR_STOP on
begin;

truncate table
  casting_tree_orders, casting_trees,
  custody_additions, custody_transfers, custody_work_log, settlements, custodies, custody_batches,
  finding_moves, gold_ledger, gold_balance_totals,
  invoice_lines, invoices, payments,
  gold_dealer_entries, customer_submissions, customer_entries,
  design_reviews, order_files, order_stage_log, orders,
  stone_movements, gold_supplier_entries,
  expenses, worker_advances, worker_loss_closings, casting_daily_checks,
  inventory_movements, stock_counts,
  notifications, outbound_messages
restart identity;

-- الترقيم يبدأ من جديد للطلبات والعهد والحركات، ويبقى ترقيم أصناف الألماس (STN) لأن الأصناف نفسها باقية
delete from doc_counters where prefix <> 'STN';

insert into audit_log(action, entity, details)
values ('system.reset_operations', 'system', '{"note":"تصفير الطلبات والعهد وحركات الذهب والفواتير للبدء الفعلي"}');

commit;

-- التحقق
select 'الطلبات' as "البند", count(*) as "العدد" from orders
union all select 'العهد', count(*) from custodies
union all select 'حركات الذهب', count(*) from gold_ledger
union all select 'الفواتير', count(*) from invoices
union all select 'المدفوعات', count(*) from payments
union all select 'حركات الألماس', count(*) from stone_movements
union all select 'العملاء (باقون)', count(*) from customers
union all select 'المنتجات (باقية)', count(*) from products where deleted_at is null
union all select 'المستخدمون (باقون)', count(*) from users;
