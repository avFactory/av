-- التحويل: كامل العهدة (الفرق عجز على المرسل) أو جزء منها فقط (الباقي يبقى لدى المرسل بلا عجز)
alter table custody_transfers add column if not exists portion text not null default 'full';
alter table custody_transfers drop constraint if exists custody_transfers_portion_check;
alter table custody_transfers add constraint custody_transfers_portion_check check (portion in ('full','part'));
