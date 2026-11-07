-- جدول الطلبات حسب موعد التسليم (يومي/أسبوعي/شهري/سنوي)
insert into permissions(code, name, grp) values ('schedule.view', 'جدول الطلبات (يومي/أسبوعي/شهري/سنوي)', 'الطلبات') on conflict (code) do nothing;
insert into role_permissions(role_code, perm_code)
  select r, 'schedule.view' from unnest(array['admin', 'supervisor', 'production_manager']) r where exists (select 1 from roles where code = r)
on conflict do nothing;
