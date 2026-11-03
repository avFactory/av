-- دمج مرحلة "الوزن النهائي" داخل مرحلة "التشييك والجودة":
-- بعد استلام الذهب من عامل الجودة يسجّل المشرف الوزن النهائي في نفس المرحلة ثم ينقل الطلب للفوترة.
do $$
declare
  qc_id int; fw_id int; rt record; fw_seq int; qc_seq int;
begin
  select id into qc_id from stages where code='qc';
  select id into fw_id from stages where code='final_weight';
  if qc_id is null or fw_id is null then return; end if;

  update stages set kind='final_weight', requires_weight=true where id=qc_id;
  update stages set name='التشييك والجودة والوزن النهائي' where id=qc_id and name='التشييك والجودة';

  for rt in select distinct route_id from route_stages where stage_id=fw_id loop
    select seq into fw_seq from route_stages where route_id=rt.route_id and stage_id=fw_id;
    select seq into qc_seq from route_stages where route_id=rt.route_id and stage_id=qc_id;
    if qc_seq is null then
      -- مسار بدون جودة: تبقى المرحلة كما هي
      continue;
    end if;
    -- الطلبات الواقفة على مرحلة الوزن النهائي تعود لمرحلة الجودة (الذهب في الطلب والعهدة مقفلة) لتسجيل الوزن والمتابعة
    update orders set current_stage_id=qc_id, stage_seq=qc_seq, stage_state='waiting', assigned_worker_id=null
      where route_id=rt.route_id and stage_seq=fw_seq;
    update orders set stage_seq=stage_seq-1 where route_id=rt.route_id and stage_seq>fw_seq;
    delete from route_stages where route_id=rt.route_id and stage_id=fw_id;
    update route_stages set seq=-(seq-1) where route_id=rt.route_id and seq>fw_seq;
    update route_stages set seq=-seq where route_id=rt.route_id and seq<0;
  end loop;

  if not exists (select 1 from route_stages where stage_id=fw_id) then
    update stages set active=false where id=fw_id;
  end if;
end $$;
