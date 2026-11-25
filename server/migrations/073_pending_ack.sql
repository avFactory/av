-- الذهب المسلَّم للعامل لا يدخل حسابه إلا بعد قبوله:
-- يبقى في موقع وسيط "transit" (بانتظار قبول العامل، loc_ref = رقم العامل) حتى يقبل،
-- ولحظة تسجيل القبول (من أي مسار: زر القبول، توقيع التسليم، قبول التحويل، المكائن) يُنقل تلقائياً لحسابه.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='gold_ledger'::regclass and conname in ('gold_ledger_from_type_check','gold_ledger_to_type_check')
  loop
    execute format('alter table gold_ledger drop constraint %I', c.conname);
  end loop;
end $$;
alter table gold_ledger add constraint gold_ledger_from_type_check check (from_type in
  ('external','vault','order','worker','scrap','loss_normal','loss_suspense','loss_abnormal','delivered','variance','finished','findings','transit'));
alter table gold_ledger add constraint gold_ledger_to_type_check check (to_type in
  ('external','vault','order','worker','scrap','loss_normal','loss_suspense','loss_abnormal','delivered','variance','finished','findings','transit'));

-- رصيد العهدة في موقع الانتظار
create or replace function custody_transit_balance(cid int) returns numeric language sql stable as $$
  select coalesce(sum(case when to_type='transit' then weight else 0 end) - sum(case when from_type='transit' then weight else 0 end), 0)
  from gold_ledger where custody_id = cid and (to_type='transit' or from_type='transit')
$$;

-- عند القبول: ما ينتظر من هذه العهدة يدخل حساب العامل
create or replace function custody_ack_to_worker() returns trigger language plpgsql as $$
declare b numeric; begin
  if old.worker_ack_at is null and new.worker_ack_at is not null then
    b := custody_transit_balance(new.id);
    if b > 0 then
        insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref, order_id, custody_id, worker_id, stage_id, reason, created_by)
        values (next_doc_no('MV'), 'custody_accept', new.material_id, b, 'transit', new.worker_id, 'worker', new.worker_id,
                new.order_id, new.id, new.worker_id, new.stage_id, 'قبول العامل لاستلام العهدة ' || new.custody_no, new.worker_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists custody_ack_to_worker on custodies;
create trigger custody_ack_to_worker after update of worker_ack_at on custodies for each row execute function custody_ack_to_worker();

-- العهد المفتوحة الحالية التي لم يقبلها العامل: يُنقل المتبقي منها من حسابه إلى الانتظار
insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref, order_id, custody_id, worker_id, stage_id, reason)
select next_doc_no('MV'), 'custody_pending', c.material_id, c.weight_issued - c.weight_used, 'worker', c.worker_id, 'transit', c.worker_id,
       c.order_id, c.id, c.worker_id, c.stage_id, 'عهدة لم يقبلها العامل بعد - تنتظر قبوله'
from custodies c where c.status = 'open' and c.worker_ack_at is null and c.weight_issued > c.weight_used order by c.id;
