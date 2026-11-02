-- عهدة عامة: ذهب يُحوَّل من الخزنة إلى العامل كرصيد في عهدته بدون طلب تصنيع
alter table custodies alter column order_id drop not null;
alter table custodies alter column stage_id drop not null;
alter table custodies add column kind text not null default 'order' check (kind in ('order','general'));
alter table custodies add column purpose text;
alter table custodies add constraint custodies_kind_refs check (kind = 'general' or (order_id is not null and stage_id is not null));

create or replace function custody_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE: لا يسمح بحذف عهدة' using errcode = 'P0001';
  end if;
  if new.weight_issued <> old.weight_issued or new.worker_id <> old.worker_id or new.order_id is distinct from old.order_id
     or new.material_id <> old.material_id or new.loss_rate_snapshot <> old.loss_rate_snapshot
     or new.stage_id is distinct from old.stage_id or new.issued_at <> old.issued_at or new.kind <> old.kind then
    raise exception 'IMMUTABLE: بيانات العهدة الأساسية لا تعدل - استخدم التصحيح' using errcode = 'P0001';
  end if;
  if old.status = 'reversed' then
    raise exception 'IMMUTABLE: العهدة ملغاة بحركة عكسية' using errcode = 'P0001';
  end if;
  return new;
end $$;
