-- عند فصل البند القائد (حامل ذهب الطلب) للنواقص تنتقل عهدته المفتوحة للبند التالي في نفس الطلب.
-- يُسمح بتغيير الطلب فقط بإذن صريح داخل المعاملة (av.allow_relink)، وتبقى بقية بيانات العهدة غير قابلة للتعديل.
create or replace function custody_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE: لا يسمح بحذف عهدة' using errcode = 'P0001';
  end if;
  if new.weight_issued <> old.weight_issued or new.worker_id <> old.worker_id
     or (new.order_id is distinct from old.order_id and coalesce(current_setting('av.allow_relink', true), '') <> 'on')
     or new.material_id <> old.material_id or new.loss_rate_snapshot <> old.loss_rate_snapshot
     or new.stage_id is distinct from old.stage_id or new.issued_at <> old.issued_at or new.kind <> old.kind then
    raise exception 'IMMUTABLE: بيانات العهدة الأساسية لا تعدل - استخدم التصحيح' using errcode = 'P0001';
  end if;
  if old.status = 'reversed' then
    raise exception 'IMMUTABLE: العهدة ملغاة بحركة عكسية' using errcode = 'P0001';
  end if;
  return new;
end $$;
