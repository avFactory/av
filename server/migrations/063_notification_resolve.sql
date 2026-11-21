-- إشعارات المشرفين المرتبطة بطلب واحد (تسليم جزء، إنهاء مرحلة، رفض تسليم، بانتظار التسليم):
-- عندما يتصرف أحدهم تُعلَّم عند الجميع بأنها عولجت ومن عالجها
alter table notifications add column if not exists ref text;
alter table notifications add column if not exists resolved_at timestamptz;
alter table notifications add column if not exists resolved_note text;
create index if not exists notifications_ref on notifications(ref) where ref is not null and resolved_at is null;
drop trigger if exists notifications_notify_upd on notifications;
create trigger notifications_notify_upd after update on notifications for each statement execute function notify_change();
drop trigger if exists return_requests_notify on custody_return_requests;
create trigger return_requests_notify after insert or update on custody_return_requests for each statement execute function notify_change();
