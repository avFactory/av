-- الفوترة على الطلب كاملاً: سطر واحد للطلب (مهما كان عدد أصنافه) بمبلغ شامل الضريبة وذهب صافي عيار 24
alter table invoice_lines add column if not exists gold24 numeric(14,4);
alter table invoice_lines add column if not exists covers int[] not null default '{}';
create index if not exists invoice_lines_covers_idx on invoice_lines using gin (covers);
