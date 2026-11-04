-- ملاحظات العميل على طلباته أثناء التصنيع
alter table order_stage_log drop constraint if exists order_stage_log_event_check;
alter table order_stage_log add constraint order_stage_log_event_check
  check (event in ('created','entered','started','paused','resumed','completed','note','clarification','status','design','quote','assigned','customer_note'));
