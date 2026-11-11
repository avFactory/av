-- تحويل الطلب من عامل لعامل المرحلة التالية مباشرة: الأول يحدد الوزن، والثاني يتأكد من الوزن ويقبل.
-- الفرق بين ما سُلّم للأول وما استلمه الثاني عجز على العامل الأول (طبيعي/غير طبيعي حسب نسبته).
create table if not exists custody_transfers (
  id            serial primary key,
  custody_id    int not null references custodies(id),
  order_id      int references orders(id),
  from_worker   int not null references users(id),
  to_worker     int not null references users(id),
  weight        numeric(16,4) not null check (weight > 0),
  confirmed_weight numeric(16,4),
  status        text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  note          text,
  reject_reason text,
  created_by    int references users(id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  new_custody_id int references custodies(id),
  settlement_id int references settlements(id)
);
create unique index if not exists custody_transfers_one_pending on custody_transfers(custody_id) where status = 'pending';
create index if not exists custody_transfers_to_idx on custody_transfers(to_worker) where status = 'pending';
drop trigger if exists custody_transfers_notify on custody_transfers;
create trigger custody_transfers_notify after insert or update on custody_transfers for each statement execute function notify_change();
