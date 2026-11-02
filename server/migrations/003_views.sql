-- أرصدة أصناف المخزون
create or replace view inventory_item_balances as
select item_id,
       sum(case when kind in ('in','return','adjust_in') then qty when kind in ('out','adjust_out') then -qty else 0 end)
       - coalesce(sum(case when kind='reversal' then 0 end),0) as qty
from inventory_movements m
where not exists (select 1 from inventory_movements r where r.reverses_id = m.id)
  and kind <> 'reversal'
group by item_id;

-- أرصدة دفعات الأحجار: في المخزن، لدى العمال، مستخدمة، مفقودة
create or replace view stone_lot_balances as
select l.id as lot_id,
  coalesce(sum(case m.kind when 'in' then m.carats when 'adjust_in' then m.carats when 'adjust_out' then -m.carats
                           when 'issue' then -m.carats when 'return' then m.carats else 0 end),0) as stock_carats,
  coalesce(sum(case m.kind when 'in' then m.count when 'adjust_in' then m.count when 'adjust_out' then -m.count
                           when 'issue' then -m.count when 'return' then m.count else 0 end),0) as stock_count,
  coalesce(sum(case m.kind when 'issue' then m.carats when 'return' then -m.carats when 'used' then -m.carats when 'lost' then -m.carats else 0 end),0) as with_workers_carats,
  coalesce(sum(case m.kind when 'issue' then m.count when 'return' then -m.count when 'used' then -m.count when 'lost' then -m.count else 0 end),0) as with_workers_count,
  coalesce(sum(m.carats) filter (where m.kind='used'),0) as used_carats,
  coalesce(sum(m.count) filter (where m.kind='used'),0) as used_count,
  coalesce(sum(m.carats) filter (where m.kind='lost'),0) as lost_carats,
  coalesce(sum(m.carats) filter (where m.kind='in'),0) as total_in_carats,
  coalesce(sum(m.count) filter (where m.kind='in'),0) as total_in_count
from stone_lots l
left join stone_movements m on m.lot_id = l.id and m.kind <> 'reversal'
  and not exists (select 1 from stone_movements r where r.reverses_id = m.id)
group by l.id;
