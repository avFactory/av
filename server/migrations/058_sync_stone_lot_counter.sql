-- إصلاح: تصفير التشغيل أعاد ترقيم أصناف الألماس (STN) من 1 بينما الأصناف باقية ← تعارض «العملية مكررة» عند إضافة صنف جديد.
-- يُضبط العداد على أعلى رقم موجود لكل سنة.
insert into doc_counters(prefix, year, last)
select 'STN', (regexp_match(lot_no, '^STN-(\d{4})-(\d+)$'))[1]::int, max((regexp_match(lot_no, '^STN-(\d{4})-(\d+)$'))[2]::bigint)
from stone_lots where lot_no ~ '^STN-\d{4}-\d+$'
group by 2
on conflict (prefix, year) do update set last = greatest(doc_counters.last, excluded.last);
