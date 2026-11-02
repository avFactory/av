-- =====================================================================
-- نظام إدارة مصنع الذهب والمجوهرات - المخطط الأساسي لقاعدة البيانات
-- جميع الأوزان بالجرام numeric(16,4) (دقة 4 خانات، العرض حسب الإعدادات)
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- الإعدادات والترقيم
-- ---------------------------------------------------------------------
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by int
);

create table doc_counters (
  prefix text not null,
  year   int  not null,
  last   bigint not null default 0,
  primary key (prefix, year)
);

-- رقم مستند متسلسل آمن مع التزامن: ORD-2026-000001
create or replace function next_doc_no(p_prefix text) returns text language plpgsql as $$
declare y int := extract(year from now())::int; n bigint;
begin
  insert into doc_counters(prefix, year, last) values (p_prefix, y, 1)
  on conflict (prefix, year) do update set last = doc_counters.last + 1
  returning last into n;
  return p_prefix || '-' || y || '-' || lpad(n::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------
-- الأدوار والصلاحيات والمستخدمين
-- ---------------------------------------------------------------------
create table roles (
  code      text primary key,
  name      text not null,
  is_system boolean not null default false
);

create table permissions (
  code text primary key,
  name text not null,
  grp  text not null
);

create table role_permissions (
  role_code text references roles(code) on delete cascade,
  perm_code text references permissions(code) on delete cascade,
  primary key (role_code, perm_code)
);

create table departments (
  id     serial primary key,
  name   text not null unique,
  active boolean not null default true
);

create table customer_tiers (
  id          serial primary key,
  name        text not null unique,
  description text
);

create table customers (
  id           serial primary key,
  shop_name    text not null,
  owner_name   text,
  phone        text,
  phone2       text,
  email        text,
  city         text,
  address      text,
  vat_number   text,
  cr_number    text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  tier_id      int references customer_tiers(id),
  notes        text,
  approved_by  int,
  approved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table users (
  id            serial primary key,
  username      text not null unique,
  password_hash text not null,
  full_name     text not null,
  role_code     text not null references roles(code),
  employee_no   text unique,
  department_id int references departments(id),
  specialty     text,
  phone         text,
  customer_id   int references customers(id),
  extra_perms   text[] not null default '{}',
  denied_perms  text[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on users(role_code);

create table sessions (
  token_hash text primary key,
  user_id    int not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip         text,
  user_agent text
);

create table customer_documents (
  id          serial primary key,
  customer_id int not null references customers(id),
  path        text not null,
  original_name text,
  mime        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- المواد (المعدن + العيار + اللون) - كل مادة تُحاسَب بشكل منفصل
-- ---------------------------------------------------------------------
create table materials (
  id     serial primary key,
  metal  text not null default 'gold',
  karat  int,
  color  text,
  name   text not null,
  active boolean not null default true,
  unique (metal, karat, color)
);

-- ---------------------------------------------------------------------
-- مراحل الإنتاج ونسب العجز ومسارات الإنتاج
-- ---------------------------------------------------------------------
create table stages (
  id                  serial primary key,
  code                text unique,
  name                text not null,
  sort_order          int not null default 0,
  kind                text not null default 'normal'
                       check (kind in ('normal','intake','design','design_approval','final_weight','invoicing','delivery_ready','delivered')),
  handles_gold        boolean not null default false,   -- هل تتضمن عهدة ذهب مع عامل
  requires_approval   boolean not null default false,   -- تحتاج اعتماد المشرف لإنهائها
  requires_weight     boolean not null default false,   -- وزن إلزامي
  required_fields     jsonb not null default '[]',      -- حقول إضافية مطلوبة من العامل
  expected_hours      numeric(8,2),
  customer_visible    boolean not null default true,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- سجل نسب العجز الطبيعي لكل مرحلة (لا يُعدَّل - كل تغيير صف جديد)
create table stage_loss_rates (
  id             serial primary key,
  stage_id       int not null references stages(id),
  rate_percent   numeric(9,5) not null check (rate_percent >= 0 and rate_percent < 100),
  effective_from timestamptz not null default now(),
  set_by         int references users(id),
  note           text
);
create index on stage_loss_rates(stage_id, effective_from desc);

create or replace view stage_current_rates as
select s.id as stage_id,
       coalesce((select r.rate_percent from stage_loss_rates r
                 where r.stage_id = s.id and r.effective_from <= now()
                 order by r.effective_from desc, r.id desc limit 1), 0) as rate_percent
from stages s;

create table stage_workers (
  stage_id int references stages(id) on delete cascade,
  user_id  int references users(id) on delete cascade,
  primary key (stage_id, user_id)
);

create table routes (
  id           serial primary key,
  name         text not null,
  product_type text,
  is_default   boolean not null default false,
  active       boolean not null default true
);

create table route_stages (
  route_id int not null references routes(id) on delete cascade,
  seq      int not null,
  stage_id int not null references stages(id),
  primary key (route_id, seq)
);

-- ---------------------------------------------------------------------
-- المنتجات وأجور التصنيع
-- ---------------------------------------------------------------------
create table products (
  id            serial primary key,
  sku           text not null unique,
  name          text not null,
  product_type  text not null,
  description   text,
  karats        int[]  not null default '{21}',
  colors        text[] not null default '{yellow}',
  approx_weight numeric(16,4),
  final_weight  numeric(16,4),
  sizes         text[] not null default '{}',
  stock_qty     int not null default 0 check (stock_qty >= 0),
  labor_method  text check (labor_method in ('per_gram','per_piece','fixed')),
  labor_rate    numeric(14,2),
  availability  text not null default 'made_to_order' check (availability in ('available','made_to_order','unavailable')),
  route_id      int references routes(id),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table product_media (
  id         serial primary key,
  product_id int not null references products(id) on delete cascade,
  path       text not null,
  kind       text not null default 'image' check (kind in ('image','video')),
  sort       int not null default 0
);

-- قواعد أجور التصنيع (أجور فقط - لا علاقة لسعر الذهب)
create table labor_rates (
  id           serial primary key,
  name         text not null,
  scope        text not null check (scope in ('default','product_type','product','tier','customer','stage')),
  product_type text,
  product_id   int references products(id),
  tier_id      int references customer_tiers(id),
  customer_id  int references customers(id),
  stage_id     int references stages(id),
  method       text not null check (method in ('per_gram','per_piece','fixed')),
  rate         numeric(14,2) not null check (rate >= 0),
  active       boolean not null default true,
  created_by   int references users(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- الطلبات
-- ---------------------------------------------------------------------
create table orders (
  id                      serial primary key,
  order_no                text not null unique,
  qr_token                text not null unique default encode(gen_random_bytes(10), 'hex'),
  customer_id             int references customers(id),
  source                  text not null default 'internal' check (source in ('internal','store_catalog','store_custom')),
  cart_ref                text,
  product_id              int references products(id),
  product_type            text,
  title                   text not null,
  material_id             int not null references materials(id),
  approx_weight           numeric(16,4),
  final_weight            numeric(16,4),     -- الوزن النهائي الإجمالي (ذهب + أحجار)
  final_gold_weight       numeric(16,4),     -- صافي الذهب في المنتج النهائي
  size                    text,
  quantity                int not null default 1 check (quantity > 0),
  due_date                date,
  notes                   text,
  status                  text not null default 'pending_review'
                           check (status in ('pending_review','quoted','approved','in_production','ready','delivered','cancelled','rejected')),
  route_id                int references routes(id),
  current_stage_id        int references stages(id),
  stage_seq               int,
  stage_state             text not null default 'waiting' check (stage_state in ('waiting','in_progress','paused','pending_approval','done')),
  assigned_worker_id      int references users(id),
  design_approval_required boolean not null default false,
  design_status           text not null default 'not_required'
                           check (design_status in ('not_required','pending_upload','sent','approved','changes_requested','rejected')),
  design_approved_at      timestamptz,
  labor_method            text check (labor_method in ('per_gram','per_piece','fixed','manual')),
  labor_rate              numeric(14,2),
  labor_estimate          numeric(14,2),
  labor_manual_approved_by int references users(id),
  quote_note              text,
  quote_sent_at           timestamptz,
  customer_accepted_at    timestamptz,
  from_stock              boolean not null default false,
  delay_notified_at       timestamptz,
  created_by              int references users(id),
  created_at              timestamptz not null default now(),
  production_started_at   timestamptz,
  ready_at                timestamptz,
  delivered_at            timestamptz,
  updated_at              timestamptz not null default now()
);
create index on orders(status);
create index on orders(customer_id);
create index on orders(current_stage_id);

create table order_stage_log (
  id         bigserial primary key,
  order_id   int not null references orders(id),
  stage_id   int references stages(id),
  event      text not null check (event in ('created','entered','started','paused','resumed','completed','note','clarification','status','design','quote','assigned')),
  worker_id  int references users(id),
  user_id    int references users(id),
  note       text,
  customer_visible boolean not null default false,
  created_at timestamptz not null default now()
);
create index on order_stage_log(order_id, created_at);

create table order_files (
  id               serial primary key,
  order_id         int not null references orders(id),
  kind             text not null check (kind in ('reference','sketch','model3d','design','execution','other')),
  path             text not null,
  original_name    text,
  mime             text,
  uploaded_by      int references users(id),
  customer_visible boolean not null default false,
  created_at       timestamptz not null default now()
);

create table design_reviews (
  id            serial primary key,
  order_id      int not null references orders(id),
  file_ids      int[] not null default '{}',
  message       text,
  sent_by       int references users(id),
  sent_at       timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending','approved','changes_requested','rejected')),
  customer_note text,
  decided_by    int references users(id),
  decided_at    timestamptz
);

-- ---------------------------------------------------------------------
-- العهدة: الجلسات الجماعية، العهد، التسويات
-- ---------------------------------------------------------------------
create table custody_batches (
  id             serial primary key,
  batch_no       text not null unique,
  kind           text not null check (kind in ('issue','receive')),
  worker_id      int not null references users(id),
  supervisor_id  int not null references users(id),
  signature_path text,
  signed_at      timestamptz,
  note           text,
  created_at     timestamptz not null default now()
);

create table custodies (
  id                        serial primary key,
  custody_no                text not null unique,
  order_id                  int not null references orders(id),
  worker_id                 int not null references users(id),
  supervisor_id             int not null references users(id),
  stage_id                  int not null references stages(id),
  material_id               int not null references materials(id),
  weight_issued             numeric(16,4) not null check (weight_issued > 0),  -- صافي الذهب
  gross_weight              numeric(16,4),                                      -- الوزن على الميزان
  stones_weight             numeric(16,4) not null default 0,                   -- وزن الأحجار المركبة بالجرام
  pieces                    int not null default 1 check (pieces >= 0),
  loss_rate_snapshot        numeric(9,5) not null,   -- النسبة المعتمدة لحظة بدء العمل
  issue_batch_id            int references custody_batches(id),
  notes                     text,
  status                    text not null default 'open' check (status in ('open','under_review','closed','reversed')),
  worker_ack_at             timestamptz,
  work_state                text not null default 'not_started' check (work_state in ('not_started','in_progress','paused','finished')),
  started_at                timestamptz,
  finished_at               timestamptz,
  worker_declared_returned  numeric(16,4),
  worker_declared_scrap     numeric(16,4),
  worker_declared_used      numeric(16,4),
  worker_declared_at        timestamptz,
  idempotency_key           text unique,
  issued_at                 timestamptz not null default now(),
  closed_at                 timestamptz,
  reversed_by               int references users(id),
  reversed_at               timestamptz,
  reversal_reason           text
);
create index on custodies(worker_id, status);
create index on custodies(order_id);

create table custody_work_log (
  id         bigserial primary key,
  custody_id int not null references custodies(id),
  event      text not null check (event in ('ack','start','pause','resume','declare','finish','note','clarification')),
  reason     text,
  user_id    int references users(id),
  created_at timestamptz not null default now()
);

create table settlements (
  id                   serial primary key,
  settlement_no        text not null unique,
  custody_id           int not null references custodies(id),
  receive_batch_id     int references custody_batches(id),
  weight_issued        numeric(16,4) not null,
  returned_weight      numeric(16,4) not null check (returned_weight >= 0),   -- صافي الذهب المرتجع
  gross_returned       numeric(16,4),
  stones_weight        numeric(16,4) not null default 0,
  scrap_weight         numeric(16,4) not null default 0 check (scrap_weight >= 0),
  actual_loss          numeric(16,4) not null,
  allowed_loss         numeric(16,4) not null,
  normal_loss          numeric(16,4) not null,
  abnormal_loss        numeric(16,4) not null,
  gain_weight          numeric(16,4) not null default 0,
  rate_snapshot        numeric(9,5) not null,
  pieces_returned      int,
  status               text not null check (status in ('approved','pending_review','investigating','resolved','reversed')),
  reason               text,
  notes                text,
  received_by          int not null references users(id),
  received_at          timestamptz not null default now(),
  reviewed_by          int references users(id),
  reviewed_at          timestamptz,
  review_notes         text,
  review_decision      text check (review_decision in ('accept_loss','recovered','worker_responsible','no_fault')),
  investigation_result text,
  recovered_weight     numeric(16,4) not null default 0,
  resolved_by          int references users(id),
  resolved_at          timestamptz,
  reversed_by          int references users(id),
  reversed_at          timestamptz,
  reversal_reason      text,
  idempotency_key      text unique,
  check (returned_weight + scrap_weight + actual_loss = weight_issued)
);
-- يمنع تكرار تسجيل الوزن: تسوية فعالة واحدة فقط لكل عهدة
create unique index settlements_one_active on settlements(custody_id) where status <> 'reversed';

-- حساب العجز (دالة نقية بالأرقام العشرية الدقيقة)
-- العجز الفعلي = المستلم - المرتجع - البقايا
-- المسموح = المستلم × النسبة
-- غير الطبيعي = max(0, الفعلي - المسموح)
create or replace function calc_loss(p_issued numeric, p_returned numeric, p_scrap numeric, p_rate numeric,
  out actual_loss numeric, out allowed_loss numeric, out normal_loss numeric, out abnormal_loss numeric, out gain_weight numeric)
language sql immutable as $$
  select a, al, greatest(0, least(a, al)), greatest(0, a - al), greatest(0, -a)
  from (select round(p_issued - p_returned - p_scrap, 4) as a,
               round(p_issued * p_rate / 100.0, 4) as al) t
$$;

-- ---------------------------------------------------------------------
-- دفتر حركات الذهب (قيد مزدوج للوزن، غير قابل للتعديل أو الحذف)
-- أنواع المواقع: external, vault, order, worker, scrap, loss_normal,
--   loss_suspense, loss_abnormal, delivered, variance, finished(منتج جاهز بالمخزون - ref=product)
-- ---------------------------------------------------------------------
create table gold_ledger (
  id            bigserial primary key,
  movement_no   text not null unique,
  kind          text not null,
  material_id   int not null references materials(id),
  weight        numeric(16,4) not null check (weight > 0),
  from_type     text not null,
  from_ref      int,
  to_type       text not null,
  to_ref        int,
  order_id      int references orders(id),
  custody_id    int references custodies(id),
  settlement_id int references settlements(id),
  worker_id     int references users(id),
  stage_id      int references stages(id),
  batch_id      int references custody_batches(id),
  reverses_id   bigint references gold_ledger(id),
  reason        text,
  created_by    int references users(id),
  created_at    timestamptz not null default now(),
  check (from_type in ('external','vault','order','worker','scrap','loss_normal','loss_suspense','loss_abnormal','delivered','variance','finished')),
  check (to_type   in ('external','vault','order','worker','scrap','loss_normal','loss_suspense','loss_abnormal','delivered','variance','finished')),
  check (not (from_type = to_type and coalesce(from_ref,0) = coalesce(to_ref,0)))
);
create index on gold_ledger(order_id);
create index on gold_ledger(worker_id);
create index on gold_ledger(custody_id);
create index on gold_ledger(created_at);
create unique index gold_ledger_one_reversal on gold_ledger(reverses_id) where reverses_id is not null;

create or replace view gold_balances as
select loc_type, loc_ref, material_id, sum(w) as balance
from (
  select to_type as loc_type, to_ref as loc_ref, material_id, weight as w from gold_ledger
  union all
  select from_type, from_ref, material_id, -weight from gold_ledger
) x
group by loc_type, loc_ref, material_id;

-- ---------------------------------------------------------------------
-- الألماس والأحجار
-- ---------------------------------------------------------------------
create table stone_lots (
  id              serial primary key,
  lot_no          text not null unique,
  stone_type      text not null,
  color           text,
  clarity         text,
  cut_shape       text,
  certificate_no  text,
  certificate_path text,
  unit_price      numeric(14,2),
  notes           text,
  created_by      int references users(id),
  created_at      timestamptz not null default now()
);

create table stone_media (
  id      serial primary key,
  lot_id  int not null references stone_lots(id) on delete cascade,
  path    text not null
);

create table stone_movements (
  id          bigserial primary key,
  lot_id      int not null references stone_lots(id),
  kind        text not null check (kind in ('in','issue','return','used','lost','adjust_in','adjust_out','reversal')),
  carats      numeric(12,4) not null check (carats >= 0),
  count       int not null default 0 check (count >= 0),
  order_id    int references orders(id),
  worker_id   int references users(id),
  stage_id    int references stages(id),
  reverses_id bigint references stone_movements(id),
  note        text,
  created_by  int references users(id),
  created_at  timestamptz not null default now()
);
create index on stone_movements(lot_id);

-- ---------------------------------------------------------------------
-- المخزون العام (مواد خام، نصف مصنع، جاهز، مستلزمات)
-- ---------------------------------------------------------------------
create table inventory_items (
  id         serial primary key,
  sku        text unique,
  name       text not null,
  category   text not null check (category in ('raw','semi','finished','supply','other')),
  unit       text not null default 'قطعة',
  min_qty    numeric(14,3) not null default 0,
  material_id int references materials(id),
  product_id int references products(id),
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table inventory_movements (
  id          bigserial primary key,
  item_id     int not null references inventory_items(id),
  kind        text not null check (kind in ('in','out','return','adjust_in','adjust_out','reversal')),
  qty         numeric(14,3) not null check (qty > 0),
  order_id    int references orders(id),
  reverses_id bigint references inventory_movements(id),
  note        text,
  created_by  int references users(id),
  created_at  timestamptz not null default now()
);

create table stock_counts (
  id          serial primary key,
  count_no    text not null unique,
  target      text not null check (target in ('gold','item')),
  material_id int references materials(id),
  item_id     int references inventory_items(id),
  system_qty  numeric(16,4) not null,
  counted_qty numeric(16,4) not null,
  difference  numeric(16,4) not null,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  note        text,
  counted_by  int references users(id),
  approved_by int references users(id),
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- المالية: الفواتير (أجور تصنيع فقط) والمدفوعات والمصروفات
-- ---------------------------------------------------------------------
create table invoices (
  id              serial primary key,
  invoice_no      text not null unique,
  uuid            uuid not null unique default gen_random_uuid(),
  icv             bigint not null unique,           -- عداد الفواتير (متطلبات الفوترة الإلكترونية)
  invoice_type    text not null default 'invoice' check (invoice_type in ('invoice','credit_note')),
  credit_for_id   int references invoices(id),
  customer_id     int not null references customers(id),
  issue_date      timestamptz not null default now(),
  subtotal        numeric(14,2) not null,
  vat_rate        numeric(6,3) not null,
  vat_amount      numeric(14,2) not null,
  total           numeric(14,2) not null,
  status          text not null default 'issued' check (status in ('issued','cancelled')),
  previous_hash   text,
  invoice_hash    text not null,
  qr_tlv          text not null,
  notes           text,
  created_by      int references users(id),
  created_at      timestamptz not null default now()
);
create index on invoices(customer_id);

create table invoice_lines (
  id          serial primary key,
  invoice_id  int not null references invoices(id),
  order_id    int references orders(id),
  kind        text not null check (kind in ('labor','stage_labor','stones','service','other')),
  description text not null,
  qty         numeric(14,4) not null,
  unit        text not null,
  unit_price  numeric(14,4) not null,
  amount      numeric(14,2) not null
);

create table payments (
  id          serial primary key,
  payment_no  text not null unique,
  customer_id int not null references customers(id),
  invoice_id  int references invoices(id),
  order_id    int references orders(id),
  kind        text not null check (kind in ('advance','payment','refund')),
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null check (method in ('cash','transfer','card','cheque','other')),
  reference   text,
  note        text,
  received_by int references users(id),
  received_at timestamptz not null default now(),
  reverses_id int references payments(id)
);

create table expenses (
  id           serial primary key,
  category     text not null,
  description  text,
  amount       numeric(14,2) not null check (amount > 0),
  vat_amount   numeric(14,2) not null default 0,
  expense_date date not null default current_date,
  paid_to      text,
  created_by   int references users(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- الإشعارات والرسائل الخارجية وسجل التدقيق
-- ---------------------------------------------------------------------
create table notifications (
  id         bigserial primary key,
  user_id    int not null references users(id),
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index on notifications(user_id, read_at);

create table outbound_messages (
  id         bigserial primary key,
  channel    text not null check (channel in ('whatsapp','sms','email')),
  recipient  text not null,
  body       text not null,
  status     text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

create table audit_log (
  id         bigserial primary key,
  user_id    int,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb,
  ip         text,
  created_at timestamptz not null default now()
);
create index on audit_log(entity, entity_id);
create index on audit_log(created_at);

create table files (
  id            serial primary key,
  path          text not null unique,
  original_name text,
  mime          text,
  size          int,
  uploaded_by   int,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- الحماية على مستوى قاعدة البيانات: منع التعديل/الحذف الصامت
-- ---------------------------------------------------------------------
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'IMMUTABLE: لا يسمح بتعديل أو حذف سجلات % - استخدم حركة عكسية', tg_table_name
    using errcode = 'P0001';
end $$;

create trigger gold_ledger_immutable before update or delete on gold_ledger for each row execute function forbid_change();
create trigger stone_mov_immutable  before update or delete on stone_movements for each row execute function forbid_change();
create trigger inv_mov_immutable    before update or delete on inventory_movements for each row execute function forbid_change();
create trigger audit_immutable      before update or delete on audit_log for each row execute function forbid_change();
create trigger rates_immutable      before update or delete on stage_loss_rates for each row execute function forbid_change();
create trigger payments_immutable   before update or delete on payments for each row execute function forbid_change();
create trigger inv_lines_immutable  before update or delete on invoice_lines for each row execute function forbid_change();

-- العهد: لا يمكن تغيير الوزن/العامل/الطلب/المادة/النسبة بعد التسجيل، ولا الحذف
create or replace function custody_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE: لا يسمح بحذف عهدة' using errcode = 'P0001';
  end if;
  if new.weight_issued <> old.weight_issued or new.worker_id <> old.worker_id or new.order_id <> old.order_id
     or new.material_id <> old.material_id or new.loss_rate_snapshot <> old.loss_rate_snapshot
     or new.stage_id <> old.stage_id or new.issued_at <> old.issued_at then
    raise exception 'IMMUTABLE: بيانات العهدة الأساسية لا تعدل - استخدم التصحيح' using errcode = 'P0001';
  end if;
  if old.status = 'reversed' then
    raise exception 'IMMUTABLE: العهدة ملغاة بحركة عكسية' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger custodies_guard before update or delete on custodies for each row execute function custody_guard();

create or replace function settlement_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE: لا يسمح بحذف تسوية' using errcode = 'P0001';
  end if;
  if new.returned_weight <> old.returned_weight or new.scrap_weight <> old.scrap_weight
     or new.weight_issued <> old.weight_issued or new.actual_loss <> old.actual_loss
     or new.allowed_loss <> old.allowed_loss or new.abnormal_loss <> old.abnormal_loss
     or new.rate_snapshot <> old.rate_snapshot or new.custody_id <> old.custody_id then
    raise exception 'IMMUTABLE: أوزان التسوية لا تعدل - استخدم التصحيح (حركة عكسية)' using errcode = 'P0001';
  end if;
  if old.status = 'reversed' then
    raise exception 'IMMUTABLE: التسوية ملغاة' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger settlements_guard before update or delete on settlements for each row execute function settlement_guard();

create or replace function invoice_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE: لا يسمح بحذف فاتورة صادرة - استخدم إشعار دائن' using errcode = 'P0001';
  end if;
  if new.total <> old.total or new.subtotal <> old.subtotal or new.vat_amount <> old.vat_amount
     or new.customer_id <> old.customer_id or new.invoice_hash <> old.invoice_hash or new.icv <> old.icv then
    raise exception 'IMMUTABLE: الفاتورة الصادرة لا تعدل' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger invoices_guard before update or delete on invoices for each row execute function invoice_guard();

-- إشعار فوري للتحديثات (LISTEN/NOTIFY) عند أي حركة ذهب
create or replace function notify_change() returns trigger language plpgsql as $$
begin
  perform pg_notify('app_events', json_build_object('table', tg_table_name, 'op', tg_op)::text);
  return null;
end $$;
create trigger gold_ledger_notify after insert on gold_ledger for each statement execute function notify_change();
create trigger custodies_notify after insert or update on custodies for each statement execute function notify_change();
create trigger settlements_notify after insert or update on settlements for each statement execute function notify_change();
create trigger orders_notify after insert or update on orders for each statement execute function notify_change();
create trigger notifications_notify after insert on notifications for each statement execute function notify_change();
