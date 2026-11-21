-- تحويل العهدة لعامل آخر في نفس المرحلة (إعادة إسناد)، أو للمرحلة التالية كالسابق؛ ويشمل العهدة العامة
alter table custody_transfers add column if not exists mode text not null default 'next_stage';
alter table custody_transfers drop constraint if exists custody_transfers_mode_check;
alter table custody_transfers add constraint custody_transfers_mode_check check (mode in ('next_stage','same_stage'));
