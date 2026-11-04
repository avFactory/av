-- المخزون بدون ألوان: ذهب عيار 18، ذهب عيار 21، ذهب عيار 24، وسبائك عيار 24.
-- لون القطعة (أصفر/أبيض/روز) صار خاصية للطلب نفسه (orders.color) وليس مادة مخزون مستقلة.
-- الأرصدة الموجودة في المواد الملونة تُنقل للمادة الموحّدة بحركات تحويل موثقة في دفتر الذهب (لا تعديل على القيود القديمة).

alter table orders add column if not exists color text;
update orders o set color = m.color from materials m where m.id = o.material_id and o.color is null;

do $$
declare
  k int; canon int; r record; old_ids int[];
begin
  foreach k in array array[18, 21, 24] loop
    select id into canon from materials where metal = 'gold' and karat = k
      order by (color = 'yellow') desc nulls last, active desc, id limit 1;
    if canon is null then
      insert into materials(metal, karat, color, name) values ('gold', k, null, 'ذهب عيار ' || k) returning id into canon;
    end if;
    update materials set color = null, name = 'ذهب عيار ' || k, active = true where id = canon;
    select coalesce(array_agg(id), '{}') into old_ids from materials where metal = 'gold' and karat = k and id <> canon;
    if array_length(old_ids, 1) is null then continue; end if;

    -- نقل كل رصيد (في أي موقع) من المادة الملونة إلى المادة الموحّدة
    for r in
      select b.loc_type, b.loc_ref, b.material_id, b.balance from gold_balances b
      where b.material_id = any(old_ids) and b.balance <> 0 and b.loc_type <> 'variance'
    loop
      if r.balance > 0 then
        insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref, reason)
          values (next_doc_no('MV'), 'convert_out', r.material_id, r.balance, r.loc_type, r.loc_ref, 'variance', null, 'توحيد مواد المخزون بدون ألوان');
        insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref, reason)
          values (next_doc_no('MV'), 'convert_in', canon, r.balance, 'variance', null, r.loc_type, r.loc_ref, 'توحيد مواد المخزون بدون ألوان');
      else
        insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref, reason)
          values (next_doc_no('MV'), 'convert_out', r.material_id, -r.balance, 'variance', null, r.loc_type, r.loc_ref, 'توحيد مواد المخزون بدون ألوان');
        insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref, reason)
          values (next_doc_no('MV'), 'convert_in', canon, -r.balance, r.loc_type, r.loc_ref, 'variance', null, 'توحيد مواد المخزون بدون ألوان');
      end if;
    end loop;

    update orders set material_id = canon where material_id = any(old_ids);
    -- العهد الجارية تتبع المادة الموحّدة حتى يُحسب استلامها على نفس الرصيد
    execute 'alter table custodies disable trigger custodies_guard';
    update custodies set material_id = canon where material_id = any(old_ids) and status in ('open', 'under_review');
    execute 'alter table custodies enable trigger custodies_guard';
    update inventory_items set material_id = canon where material_id = any(old_ids);
    update materials set active = false where id = any(old_ids);
  end loop;

  -- صنف جديد: سبائك عيار 24
  if not exists (select 1 from materials where metal = 'bullion' and karat = 24) then
    insert into materials(metal, karat, color, name) values ('bullion', 24, null, 'سبائك عيار 24');
  end if;
end $$;
