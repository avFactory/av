-- كشف حساب العميل: مبالغ (ريال) وذهب (جرام بعيار) — مدين/دائن ورصيد
-- المصادر التلقائية: الفواتير والإشعارات الدائنة، المدفوعات، تسليم الطلبات (ذهب مباع)، الذهب المستلم من العميل.
-- قيود يدوية: الرصيد الافتتاحي، سداد ذهب، تسويات.
create table if not exists customer_entries (
  id            serial primary key,
  entry_no      text not null unique,
  customer_id   int not null references customers(id),
  entry_date    date not null default (now() at time zone 'Asia/Riyadh')::date,
  kind          text not null check (kind in ('opening', 'gold_payment', 'money_adjust', 'gold_adjust')),
  money_debit   numeric(14,2) not null default 0 check (money_debit >= 0),
  money_credit  numeric(14,2) not null default 0 check (money_credit >= 0),
  gold_debit    numeric(16,4) not null default 0 check (gold_debit >= 0),
  gold_credit   numeric(16,4) not null default 0 check (gold_credit >= 0),
  karat         int check (karat in (18, 21, 22, 24)),
  description   text,
  document_path text,
  submission_id int,
  ledger_id     bigint references gold_ledger(id),
  created_by    int references users(id),
  created_at    timestamptz not null default now(),
  reversed      boolean not null default false,
  reversed_by   int references users(id),
  reversed_at   timestamptz,
  reversal_reason text,
  check ((gold_debit = 0 and gold_credit = 0) or karat is not null)
);
create index if not exists customer_entries_customer_idx on customer_entries(customer_id, entry_date);

-- مستندات سداد يرفعها العميل (تحويل مبلغ أو تسليم ذهب) — تُضاف لحسابه بعد موافقة المصنع
create table if not exists customer_submissions (
  id            serial primary key,
  submission_no text not null unique,
  customer_id   int not null references customers(id),
  branch_id     int references customer_branches(id),
  kind          text not null check (kind in ('money', 'gold')),
  amount        numeric(14,2) check (amount is null or amount > 0),
  weight        numeric(16,4) check (weight is null or weight > 0),
  karat         int check (karat in (18, 21, 22, 24)),
  method        text check (method in ('cash','transfer','card','cheque','other')),
  reference     text,
  paid_at       date,
  note          text,
  document_path text not null,
  original_name text,
  mime          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note   text,
  reviewed_by   int references users(id),
  reviewed_at   timestamptz,
  payment_id    int references payments(id),
  entry_id      int references customer_entries(id),
  created_by    int references users(id),
  created_at    timestamptz not null default now(),
  check ((kind = 'money' and amount is not null) or (kind = 'gold' and weight is not null and karat is not null))
);
create index if not exists customer_submissions_status_idx on customer_submissions(status, customer_id);
