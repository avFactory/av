-- الاستعداد لحجم كبير (آلاف الطلبات وعشرات آلاف حركات الذهب):
-- 1) أرصدة الذهب في جدول يُحدَّث مع كل حركة (بدل جمع دفتر الحركات كاملاً في كل طلب)
create table if not exists gold_balance_totals (
  loc_type    text not null,
  loc_ref     int,
  material_id int not null references materials(id),
  balance     numeric(18,4) not null default 0
);
create unique index if not exists gold_balance_totals_key on gold_balance_totals (loc_type, (coalesce(loc_ref, -1)), material_id);
create index if not exists gold_balance_totals_ref on gold_balance_totals (loc_type, loc_ref);

create or replace function gold_balance_apply() returns trigger language plpgsql as $$
begin
  insert into gold_balance_totals(loc_type, loc_ref, material_id, balance) values (new.to_type, new.to_ref, new.material_id, new.weight)
    on conflict (loc_type, (coalesce(loc_ref, -1)), material_id) do update set balance = gold_balance_totals.balance + excluded.balance;
  insert into gold_balance_totals(loc_type, loc_ref, material_id, balance) values (new.from_type, new.from_ref, new.material_id, -new.weight)
    on conflict (loc_type, (coalesce(loc_ref, -1)), material_id) do update set balance = gold_balance_totals.balance + excluded.balance;
  return new;
end $$;

-- تعبئة الأرصدة الحالية مرة واحدة (داخل قفل الجدول حتى لا تضيع حركة أثناء التعبئة)
lock table gold_ledger in share row exclusive mode;
truncate gold_balance_totals;
insert into gold_balance_totals(loc_type, loc_ref, material_id, balance)
  select loc_type, loc_ref, material_id, sum(w) from (
    select to_type as loc_type, to_ref as loc_ref, material_id, weight as w from gold_ledger
    union all select from_type, from_ref, material_id, -weight from gold_ledger) x
  group by 1, 2, 3;
drop trigger if exists gold_balance_apply on gold_ledger;
create trigger gold_balance_apply after insert on gold_ledger for each row execute function gold_balance_apply();

-- العرض بنفس الاسم والأعمدة (كل الاستعلامات الحالية تعمل كما هي) لكن من الجدول الجاهز
create or replace view gold_balances as
  select loc_type, loc_ref, material_id, balance::numeric as balance from gold_balance_totals;

-- 2) فهارس للاستعلامات الأكثر استخداماً مع كثرة البيانات
create index if not exists gold_ledger_to_idx on gold_ledger (to_type, to_ref);
create index if not exists gold_ledger_from_idx on gold_ledger (from_type, from_ref);
create index if not exists gold_ledger_settlement_idx on gold_ledger (settlement_id) where settlement_id is not null;
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_due_idx on orders (due_date) where status not in ('delivered','cancelled','rejected');
create index if not exists orders_product_idx on orders (product_id) where product_id is not null;
create index if not exists orders_assigned_idx on orders (assigned_worker_id) where assigned_worker_id is not null;
create index if not exists custodies_open_idx on custodies (worker_id, material_id) where status = 'open';
create index if not exists custodies_issued_idx on custodies (issued_at desc);
create index if not exists settlements_received_idx on settlements (received_at desc);
create index if not exists settlements_held_idx on settlements (custody_id) where loss_held and loss_fixed_at is null;
create index if not exists custody_transfers_from_idx on custody_transfers (from_worker, status);
create index if not exists stone_movements_order_idx on stone_movements (order_id) where order_id is not null;
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
analyze gold_ledger; analyze orders; analyze custodies; analyze settlements;
