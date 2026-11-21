-- لغة واجهة المستخدم (للعمال خاصة): ar / en / bn / hi / ur — تُختار مرة واحدة وتُحفظ على الحساب
alter table users add column if not exists lang text check (lang is null or lang in ('ar','en','bn','hi','ur'));
