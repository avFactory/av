-- صلاحية مستقلة لصفحة التسعيرة (كانت تُفتح لكل من يدير المنتجات، مثل مدير المتجر)
insert into permissions(code, name, grp) values ('pricing.manage', 'التسعيرة (عرض وتعديل)', 'المتجر') on conflict (code) do nothing;
insert into role_permissions(role_code, perm_code)
  select distinct role_code, 'pricing.manage' from role_permissions where perm_code = 'settings.manage'
  union select 'admin', 'pricing.manage'
on conflict do nothing;
