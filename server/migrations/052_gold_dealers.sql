-- جمل الصافي (تجار بيع الذهب الصافي): ديوان الذهب، الجنيه العربي…
-- رصيد المصنع عندهم بالذهب الصافي عيار 24: يزيد بسداد العملاء عن طريقهم، وينقص عند سحبه للخزنة
create table if not exists gold_dealers (
  id         serial primary key,
  code       text unique,
  name       text not null unique,
  phone      text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into gold_dealers(code, name) values ('diwan', 'ديوان الذهب'), ('coin', 'الجنيه العربي') on conflict do nothing;

create table if not exists gold_dealer_entries (
  id                serial primary key,
  entry_no          text not null unique,
  dealer_id         int not null references gold_dealers(id),
  kind              text not null check (kind in ('deposit', 'withdraw')),
  weight            numeric(16,4) not null check (weight > 0),   -- صافي عيار 24
  customer_id       int references customers(id),
  customer_entry_id int references customer_entries(id),
  ledger_id         bigint,
  note              text,
  reversed          boolean not null default false,
  created_by        int references users(id),
  created_at        timestamptz not null default now()
);
create index if not exists gold_dealer_entries_dealer on gold_dealer_entries(dealer_id) where not reversed;
