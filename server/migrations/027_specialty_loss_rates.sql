-- نسب العجز الطبيعي حسب مهنة العامل (مثل دالة Excel):
--   العجز المسموح = الوزن المستلم من العامل × نسبة مهنته
--   تشبيك 0.1% ، تفنيش 0.7% ، أسماء 1.2% ، تركيب 0.5%
-- إذا لم تكن لمهنة العامل نسبة هنا تُستخدم نسبة المرحلة.
create table if not exists specialty_loss_rates (
  specialty    text primary key,
  rate_percent numeric(9,5) not null check (rate_percent >= 0 and rate_percent < 100),
  updated_by   int references users(id),
  updated_at   timestamptz not null default now()
);
insert into specialty_loss_rates(specialty, rate_percent) values
  ('تشبيك', 0.1), ('تفنيش', 0.7), ('اسماء', 1.2), ('تركيب', 0.5)
on conflict (specialty) do nothing;

-- العجز المسموح يُحسب من الوزن المستلم من العامل (وليس الوزن المسلَّم له)
create or replace function calc_loss(p_issued numeric, p_returned numeric, p_scrap numeric, p_rate numeric,
  out actual_loss numeric, out allowed_loss numeric, out normal_loss numeric, out abnormal_loss numeric, out gain_weight numeric)
language sql immutable as $$
  select a, al, greatest(0, least(a, al)), greatest(0, a - al), greatest(0, -a)
  from (select round(p_issued - p_returned - p_scrap, 4) as a,
               round(p_returned * p_rate / 100.0, 4) as al) t
$$;
