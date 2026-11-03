-- مرحلة "المختبر لإصدار الشهادة" لطلبات الألماس فقط:
-- تُحذف من المسارات التي لا تحتوي مرحلة تركيب أحجار (مثل "منتج بدون أحجار وبدون تصميم").
-- وفي باقي المسارات يتخطاها النظام تلقائياً إذا لم يكن في الطلب ألماس (في الكود).
do $$
declare
  lab_id int; rt record; lab_seq int;
begin
  select id into lab_id from stages where code='lab';
  if lab_id is null then return; end if;
  for rt in
    select rs.route_id, rs.seq from route_stages rs
    where rs.stage_id=lab_id
      and not exists (select 1 from route_stages x join stages s on s.id=x.stage_id where x.route_id=rs.route_id and s.code='setting')
  loop
    lab_seq := rt.seq;
    -- الطلبات الواقفة على المختبر في هذه المسارات تنتقل للمرحلة التالية (الجودة) التي ستأخذ نفس الترتيب
    update orders o set current_stage_id=(select stage_id from route_stages where route_id=rt.route_id and seq=lab_seq + 1),
                        stage_state='waiting', assigned_worker_id=null
      where o.route_id=rt.route_id and o.stage_seq=lab_seq;
    update orders set stage_seq = stage_seq - 1 where route_id=rt.route_id and stage_seq > lab_seq;
    delete from route_stages where route_id=rt.route_id and seq=lab_seq;
    update route_stages set seq = -(seq - 1) where route_id=rt.route_id and seq > lab_seq;
    update route_stages set seq = -seq where route_id=rt.route_id and seq < 0;
  end loop;
end $$;
