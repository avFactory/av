-- تفاصيل أحجار المنتج: الألماس (من مخزون الألماس) واللؤلؤ والحجر والزركون (للعرض فقط)
alter table products add column if not exists diamonds jsonb not null default '[]';   -- [{lot_id, carats, count}] لكل قطعة
alter table products add column if not exists pearl_weight numeric(12,3);
alter table products add column if not exists stone_weight numeric(12,3);
alter table products add column if not exists zircon_weight numeric(12,3);

-- حجز ألماس الطلب عند اعتماده: allocate يخصم من المخزن لصالح الطلب، وdeallocate يعيده (عند الإلغاء أو عند صرفه للعامل)
alter table stone_movements drop constraint if exists stone_movements_kind_check;
alter table stone_movements add constraint stone_movements_kind_check
  check (kind in ('in','issue','return','used','lost','adjust_in','adjust_out','reversal','allocate','deallocate'));

create or replace view stone_lot_balances as
select l.id as lot_id,
  coalesce(sum(case m.kind when 'in' then m.carats when 'adjust_in' then m.carats when 'adjust_out' then -m.carats
                           when 'issue' then -m.carats when 'return' then m.carats
                           when 'allocate' then -m.carats when 'deallocate' then m.carats else 0 end),0) as stock_carats,
  coalesce(sum(case m.kind when 'in' then m.count when 'adjust_in' then m.count when 'adjust_out' then -m.count
                           when 'issue' then -m.count when 'return' then m.count
                           when 'allocate' then -m.count when 'deallocate' then m.count else 0 end),0) as stock_count,
  coalesce(sum(case m.kind when 'issue' then m.carats when 'return' then -m.carats when 'used' then -m.carats when 'lost' then -m.carats else 0 end),0) as with_workers_carats,
  coalesce(sum(case m.kind when 'issue' then m.count when 'return' then -m.count when 'used' then -m.count when 'lost' then -m.count else 0 end),0) as with_workers_count,
  coalesce(sum(m.carats) filter (where m.kind='used'),0) as used_carats,
  coalesce(sum(m.count) filter (where m.kind='used'),0) as used_count,
  coalesce(sum(m.carats) filter (where m.kind='lost'),0) as lost_carats,
  coalesce(sum(m.carats) filter (where m.kind='in'),0) as total_in_carats,
  coalesce(sum(m.count) filter (where m.kind='in'),0) as total_in_count,
  coalesce(sum(case m.kind when 'allocate' then m.carats when 'deallocate' then -m.carats else 0 end),0) as reserved_carats,
  coalesce(sum(case m.kind when 'allocate' then m.count when 'deallocate' then -m.count else 0 end),0) as reserved_count
from stone_lots l
left join stone_movements m on m.lot_id = l.id and m.kind <> 'reversal'
  and not exists (select 1 from stone_movements r where r.reverses_id = m.id)
group by l.id;
