-- العامل يطلب تحويل جزء من عهدته للمشرف؛ المشرف يزنه ويؤكد (أو يرفض)
create table if not exists custody_return_requests (
  id              serial primary key,
  custody_id      int not null references custodies(id),
  worker_id       int not null references users(id),
  weight          numeric(16,4) not null check (weight > 0),
  pieces          int not null default 0 check (pieces >= 0),
  note            text,
  status          text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  confirmed_weight numeric(16,4),
  decided_by      int references users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create unique index if not exists custody_return_requests_one_pending on custody_return_requests(custody_id) where status='pending';
