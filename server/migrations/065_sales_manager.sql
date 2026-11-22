-- مدير المبيعات: يطلب من المتجر نيابة عن العملاء (يضيف للسلة ثم يختار العميل)
insert into permissions(code, name, grp) values ('store.sales', 'الطلب من المتجر نيابة عن العملاء (مدير المبيعات)', 'العميل')
  on conflict (code) do nothing;
insert into roles(code, name, is_system) values ('sales_manager', 'مدير المبيعات', false) on conflict (code) do nothing;
insert into role_permissions(role_code, perm_code) values ('sales_manager', 'store.sales'), ('sales_manager', 'orders.view')
  on conflict do nothing;
-- مدير النظام يملك الصلاحية أيضاً (كل الصلاحيات عدا واجهات العامل والعميل)
insert into role_permissions(role_code, perm_code) values ('admin', 'store.sales') on conflict do nothing;
