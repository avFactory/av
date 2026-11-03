-- مرحلة "المختبر لإصدار الشهادة" قبل مرحلة التشييك والجودة في كل المسارات
do $$
declare
  qc_id int; lab_id int; rt record; qc_seq int;
begin
  select id into qc_id from stages where code='qc';
  if qc_id is null or exists (select 1 from stages where code='lab') then return; end if;

  update stages set sort_order = sort_order + 1 where sort_order >= (select sort_order from stages where id=qc_id);
  insert into stages(code, name, sort_order, kind, handles_gold, requires_approval, requires_weight, customer_visible)
    values ('lab', 'المختبر لإصدار الشهادة', (select sort_order from stages where id=qc_id) - 1, 'normal', false, false, false, true)
    returning id into lab_id;

  for rt in select route_id, seq from route_stages where stage_id=qc_id loop
    qc_seq := rt.seq;
    -- إزاحة المراحل من الجودة فما بعد خطوة للأمام (على مرحلتين لتفادي تعارض المفتاح)
    update route_stages set seq = -(seq + 1) where route_id=rt.route_id and seq >= qc_seq;
    update route_stages set seq = -seq where route_id=rt.route_id and seq < 0;
    insert into route_stages(route_id, seq, stage_id) values (rt.route_id, qc_seq, lab_id);
    -- الطلبات الجارية تبقى في مرحلتها الحالية مع تحديث ترتيبها
    update orders set stage_seq = stage_seq + 1 where route_id=rt.route_id and stage_seq >= qc_seq;
  end loop;
end $$;
