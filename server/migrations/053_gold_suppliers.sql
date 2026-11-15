-- موردو الخامات: يُصرف لهم ذهب صافي مقدماً، ونستلم منهم خامات (سلاسل، روبتشن…)
-- الرصيد المقدم (صافي 24) = الذهب المصروف لهم − الخامات المستلمة منهم
create table if not exists gold_suppliers (
  id         serial primary key,
  name       text not null unique,
  supplies   text,
  phone      text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into gold_suppliers(name, supplies) values ('مصنع لين', 'سلاسل'), ('كنوز الشرق', 'روبتشن') on conflict do nothing;

create table if not exists gold_supplier_entries (
  id          serial primary key,
  entry_no    text not null unique,
  supplier_id int not null references gold_suppliers(id),
  kind        text not null check (kind in ('gold_out', 'findings_in', 'opening')),
  weight      numeric(16,4) not null check (weight > 0),   -- الوزن الفعلي
  karat       int,
  pure        numeric(16,4) not null check (pure > 0),     -- صافي عيار 24
  material_id int references materials(id),
  finding_id  int references findings(id),
  ledger_id   bigint,
  note        text,
  created_by  int references users(id),
  created_at  timestamptz not null default now()
);
create index if not exists gold_supplier_entries_sup on gold_supplier_entries(supplier_id);
