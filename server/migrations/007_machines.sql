-- المكائن: محطات عمل تستلم عهدة ذهب مثل العامل (بوليش، تنفيش، برنتاج، ليزر...)
alter table users add column kind text not null default 'person' check (kind in ('person','machine'));
