-- المكائن ليست موظفين: العهدة المسلَّمة لمكينة تُسجل عليها فوراً بدون قبول، وتبقى حتى يستلمها المشرف
create or replace function machine_custody_auto_ack() returns trigger language plpgsql as $$
begin
  if exists (select 1 from users u where u.id = new.worker_id and u.kind = 'machine') then
    new.worker_ack_at := coalesce(new.worker_ack_at, now());
    new.worker_rejected_at := null;
    new.worker_reject_reason := null;
    if new.work_state = 'not_started' then
      new.work_state := 'in_progress';
      new.started_at := coalesce(new.started_at, now());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists custodies_machine_auto_ack on custodies;
create trigger custodies_machine_auto_ack before insert on custodies for each row execute function machine_custody_auto_ack();

-- العهد المفتوحة حالياً على المكائن بانتظار القبول: تُعتبر مستلمة
update custodies c set worker_ack_at = now(), worker_rejected_at = null, worker_reject_reason = null,
  work_state = case when c.work_state = 'not_started' then 'in_progress' else c.work_state end,
  started_at = coalesce(c.started_at, now())
from users u where u.id = c.worker_id and u.kind = 'machine' and c.status = 'open' and c.worker_ack_at is null;
