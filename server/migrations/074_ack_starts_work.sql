-- قبول العهدة = بدء العمل فعلياً (لا زر "بدء العمل" ولا "إيقاف مؤقت")
create or replace function custody_ack_starts_work() returns trigger language plpgsql as $$
begin
  if new.worker_ack_at is not null and new.work_state in ('not_started','paused')
     and (tg_op = 'INSERT' or old.worker_ack_at is null or old.work_state = 'paused') then
    new.work_state := 'in_progress';
    new.started_at := coalesce(new.started_at, new.worker_ack_at, now());
  end if;
  return new;
end $$;
-- الاسم يبدأ بـ zz حتى يعمل بعد قبول المكائن التلقائي (المشغلات تعمل بالترتيب الأبجدي)
drop trigger if exists zz_custody_ack_starts_work on custodies;
create trigger zz_custody_ack_starts_work before insert or update of worker_ack_at, work_state on custodies
  for each row execute function custody_ack_starts_work();

-- حالة الطلب لدى العامل: قيد العمل بمجرد القبول
create or replace function custody_ack_order_state() returns trigger language plpgsql as $$
begin
  if new.order_id is not null and new.status = 'open' and new.worker_ack_at is not null and new.work_state = 'in_progress'
     and (tg_op = 'INSERT' or old.worker_ack_at is null) then
    update orders set stage_state = 'in_progress', updated_at = now()
      where id = new.order_id and assigned_worker_id = new.worker_id and stage_state in ('waiting','paused');
  end if;
  return new;
end $$;
drop trigger if exists custody_ack_order_state on custodies;
create trigger custody_ack_order_state after insert or update of worker_ack_at on custodies
  for each row execute function custody_ack_order_state();

-- العهد الحالية: المقبولة التي لم يضغط عاملها "بدء" أو أوقفها مؤقتاً تصبح قيد العمل
update custodies set work_state = 'in_progress', started_at = coalesce(started_at, worker_ack_at, now())
  where status = 'open' and worker_ack_at is not null and work_state in ('not_started','paused');
update orders o set stage_state = 'in_progress', updated_at = now()
  where o.stage_state in ('waiting','paused') and exists (select 1 from custodies c where c.order_id = o.id and c.status = 'open'
    and c.worker_id = o.assigned_worker_id and c.worker_ack_at is not null);
