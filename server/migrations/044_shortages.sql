-- مرحلة النواقص: قطع من الطلب لا تتوفر لها خامات/ألماس تُفصل في طلب جديد وتنتظر التوفر
alter table orders drop constraint if exists orders_stage_state_check;
alter table orders add constraint orders_stage_state_check check (stage_state in ('waiting','in_progress','paused','pending_approval','done','shortage'));
alter table orders add column if not exists shortage_kind text;
alter table orders add column if not exists shortage_reason text;
alter table orders add column if not exists shortage_at timestamptz;
alter table orders add column if not exists shortage_by int references users(id);
alter table orders add column if not exists shortage_from text;
create index if not exists orders_shortage_idx on orders(stage_state) where stage_state = 'shortage';
