-- طرق السداد: المبالغ (كاش، تحويل بنكي) والذهب (تسليم ذهب، ديوان الذهب، الجنيه العربي)
alter table customer_submissions drop constraint if exists customer_submissions_method_check;
alter table customer_submissions add constraint customer_submissions_method_check
  check (method is null or method in ('cash','transfer','card','cheque','other','gold','diwan','coin'));
