-- مرحلة يديرها عاملها بالكامل (مثل الجودة والوزن النهائي):
-- تُسلَّم له تلقائياً عند دخول الطلب المرحلة، يقبلها بوزن ميزانه، ثم يسجل الوزن النهائي وينهيها فينتقل الطلب للفوترة بدون المشرف
alter table stages add column if not exists worker_closes boolean not null default false;
alter table custodies add column if not exists ack_weight numeric(16,4);
