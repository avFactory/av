-- قبول العامل إلكترونياً بدلاً من التوقيع اليدوي، مع إمكانية الرفض بسبب
alter table custodies add column worker_rejected_at timestamptz;
alter table custodies add column worker_reject_reason text;
alter table custodies add column ack_ip text;
alter table custody_work_log drop constraint custody_work_log_event_check;
alter table custody_work_log add constraint custody_work_log_event_check
  check (event in ('ack','reject','start','pause','resume','declare','finish','note','clarification'));
