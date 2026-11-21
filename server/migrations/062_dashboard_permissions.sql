-- لوحة الإحصائيات: مجموعة صلاحيات مستقلة، مقسمة حسب الأقسام
update permissions set grp='لوحة الإحصائيات', name='فتح لوحة الإحصائيات (قسم الطلبات)' where code='dashboard.view';
insert into permissions(code, name, grp) values
  ('dashboard.gold', 'قسم الذهب (أرصدة المصنع والعمال والخزنة والجملة والموردين)', 'لوحة الإحصائيات'),
  ('dashboard.org', 'ذهب المؤسسة ومخزون الفروع والذهب الجاهز للتسليم', 'لوحة الإحصائيات'),
  ('dashboard.finance', 'قسم المالية (الأجور والفواتير والتحصيل)', 'لوحة الإحصائيات')
on conflict (code) do nothing;
-- من يملك اللوحة حالياً يبقى يرى كل أقسامها كما هي، والمدير يملك الكل
insert into role_permissions(role_code, perm_code)
select rp.role_code, p.code from role_permissions rp cross join (values ('dashboard.gold'), ('dashboard.org'), ('dashboard.finance')) p(code)
where rp.perm_code = 'dashboard.view'
on conflict do nothing;
insert into role_permissions(role_code, perm_code)
select 'admin', code from permissions where code like 'dashboard.%' on conflict do nothing;
-- صلاحيات إضافية لموظفين بعينهم (extra_perms) تبقى كما هي: من لديه dashboard.view يحصل على الأقسام
update users set extra_perms = (select array_agg(distinct x) from unnest(extra_perms || array['dashboard.gold','dashboard.org','dashboard.finance']) x)
where 'dashboard.view' = any(extra_perms);
