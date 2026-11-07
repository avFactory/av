-- خامات المصنع (سلاسل، أقفال، كور سحب...): ذهب بعيار محدد يُخزن كقطع ووزن.
-- تُصرف للعامل كعهدة عامة (تتحول لذهب لدى العامل)، وعند إضافتها على طلب يُخصم وزنها من عهدة الخامات ويدخل في وزن الطلب.

-- موقع جديد في دفتر الذهب: findings (loc_ref = رقم الخامة)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'gold_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%ANY (ARRAY%'
  loop
    execute format('alter table gold_ledger drop constraint %I', c.conname);
  end loop;
end $$;
alter table gold_ledger add constraint gold_ledger_from_type_check check (from_type in
  ('external','vault','order','worker','scrap','loss_normal','loss_suspense','loss_abnormal','delivered','variance','finished','findings'));
alter table gold_ledger add constraint gold_ledger_to_type_check check (to_type in
  ('external','vault','order','worker','scrap','loss_normal','loss_suspense','loss_abnormal','delivered','variance','finished','findings'));

create table if not exists findings (
  id           serial primary key,
  name         text not null,
  category     text not null,                       -- سلسلة، قفل، كور سحب، حلقة، أخرى
  material_id  int not null references materials(id),
  unit_weight  numeric(16,4) check (unit_weight is null or unit_weight > 0),
  sku          text,
  notes        text,
  active       boolean not null default true,
  created_by   int references users(id),
  created_at   timestamptz not null default now()
);

-- حركات القطع (الوزن في دفتر الذهب)
create table if not exists finding_moves (
  id          bigserial primary key,
  finding_id  int not null references findings(id),
  kind        text not null check (kind in ('in','issue','return','used','out','reversal')),
  pieces      int not null default 0,               -- موجب يدخل المخزون، سالب يخرج
  weight      numeric(16,4) not null default 0,
  custody_id  int references custodies(id),
  order_id    int references orders(id),
  note        text,
  created_by  int references users(id),
  created_at  timestamptz not null default now()
);
create index if not exists finding_moves_finding_idx on finding_moves(finding_id);

-- عهدة الخامات لدى العامل، والوزن المستهلك منها في الطلبات
alter table custodies add column if not exists finding_id int references findings(id);
alter table custodies add column if not exists weight_used numeric(16,4) not null default 0 check (weight_used >= 0);

-- خامات أضافها العامل على طلب (تُسجل عند استلام المشرف)
create table if not exists custody_additions (
  id                serial primary key,
  custody_id        int not null references custodies(id),       -- عهدة الطلب
  source_custody_id int not null references custodies(id),       -- عهدة الخامات العامة
  finding_id        int references findings(id),
  order_id          int references orders(id),
  weight            numeric(16,4) not null check (weight > 0),
  pieces            int not null default 0,
  settlement_id     int references settlements(id),
  reversed          boolean not null default false,
  created_by        int references users(id),
  created_at        timestamptz not null default now()
);
create index if not exists custody_additions_custody_idx on custody_additions(custody_id);
create index if not exists custody_additions_source_idx on custody_additions(source_custody_id);

insert into permissions(code, name, grp) values ('findings.manage', 'خامات المصنع (إضافة وتعديل ومخزون)', 'المخزون') on conflict (code) do nothing;
insert into role_permissions(role_code, perm_code)
  select distinct role_code, 'findings.manage' from role_permissions where perm_code = 'inventory.manage'
  union select 'admin', 'findings.manage'
on conflict do nothing;
