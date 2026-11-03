-- العمال الذين يظهرون في شاشة صرف الألماس (حسب الرقم الوظيفي) - يُعدّل من الإعدادات
insert into settings(key, value) values ('diamond_worker_nos', '["16","17","18","19"]') on conflict (key) do nothing;
