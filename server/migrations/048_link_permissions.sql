-- صلاحيات الروابط الخارجية: عرض/نسخ/إيقاف وتجديد كل رابط على حدة
insert into permissions(code, name, grp) values
  ('links.pricing', 'رابط التسعيرة', 'الروابط الخارجية'),
  ('links.pricing_short', 'رابط التسعيرة المختصرة', 'الروابط الخارجية'),
  ('links.stones', 'رابط مخزن الألماس', 'الروابط الخارجية')
on conflict (code) do nothing;
-- الحفاظ على الوضع الحالي: من يدير التسعيرة يملك روابطها، ومن يدير الألماس يملك رابطه
insert into role_permissions(role_code, perm_code)
  select distinct rp.role_code, x.p from role_permissions rp
  join (values ('pricing.manage', 'links.pricing'), ('pricing.manage', 'links.pricing_short'), ('stones.manage', 'links.stones')) x(src, p) on x.src = rp.perm_code
on conflict do nothing;
insert into role_permissions(role_code, perm_code)
  select 'admin', p from unnest(array['links.pricing', 'links.pricing_short', 'links.stones']) p where exists (select 1 from roles where code = 'admin')
on conflict do nothing;
