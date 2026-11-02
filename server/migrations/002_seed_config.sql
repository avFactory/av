-- بيانات التهيئة الأساسية (إعدادات وأدوار ومراحل فقط - بدون بيانات تشغيلية وهمية)

insert into roles(code, name, is_system) values
 ('admin','مدير النظام',true),
 ('production_manager','مدير الإنتاج',true),
 ('supervisor','المشرف',true),
 ('worker','العامل',true),
 ('accountant','المحاسب',true),
 ('inventory_officer','مسؤول المخزون',true),
 ('customer','العميل',true);

insert into permissions(code, name, grp) values
 ('dashboard.view','عرض لوحة الإحصائيات','عام'),
 ('scan.use','استخدام مسح QR','عام'),
 ('custody.issue','تسليم ذهب للعمال','العهدة'),
 ('custody.receive','استلام ذهب من العمال','العهدة'),
 ('custody.view_all','عرض عهد جميع العمال','العهدة'),
 ('custody.reverse','تصحيح الحركات بحركة عكسية','العهدة'),
 ('loss.review','مراجعة العجز وإحالته','العجز'),
 ('loss.approve','اعتماد العجز غير الطبيعي','العجز'),
 ('loss.investigate','تسجيل نتيجة التحقيق','العجز'),
 ('loss_rates.manage','إدارة نسب العجز','العجز'),
 ('orders.view','عرض الطلبات','الطلبات'),
 ('orders.manage','إنشاء وتعديل الطلبات','الطلبات'),
 ('orders.advance','نقل الطلب بين المراحل','الطلبات'),
 ('orders.quote','إرسال عروض الأجور','الطلبات'),
 ('design.manage','إدارة التصاميم واعتمادها','الطلبات'),
 ('workers.view','عرض ملفات العمال','الموظفون'),
 ('employees.manage','إدارة الموظفين','الموظفون'),
 ('roles.manage','إدارة الأدوار والصلاحيات','الموظفون'),
 ('customers.view','عرض العملاء','العملاء'),
 ('customers.manage','إدارة العملاء واعتمادهم','العملاء'),
 ('stages.manage','إدارة المراحل والمسارات','الإنتاج'),
 ('products.manage','إدارة المنتجات','المتجر'),
 ('labor.manage','إدارة أجور التصنيع','المالية'),
 ('labor.approve_manual','اعتماد الأجرة اليدوية','المالية'),
 ('inventory.view','عرض المخزون','المخزون'),
 ('inventory.manage','حركات المخزون','المخزون'),
 ('stocktake.approve','اعتماد فروقات الجرد والتحويل','المخزون'),
 ('stones.view','عرض الأحجار','الألماس'),
 ('stones.manage','إدارة الأحجار وحركاتها','الألماس'),
 ('finance.view','عرض المالية','المالية'),
 ('invoices.manage','إصدار الفواتير','المالية'),
 ('payments.manage','تسجيل المدفوعات','المالية'),
 ('expenses.manage','تسجيل المصروفات','المالية'),
 ('reports.view','عرض التقارير','التقارير'),
 ('audit.view','عرض سجل التدقيق','النظام'),
 ('settings.manage','إعدادات النظام','النظام'),
 ('worker.self','واجهة العامل','العامل'),
 ('store.access','المتجر الإلكتروني','العميل');

-- مدير النظام: كل الصلاحيات عدا واجهات العامل والعميل
insert into role_permissions select 'admin', code from permissions where code not in ('worker.self','store.access');

insert into role_permissions(role_code, perm_code) values
 ('production_manager','dashboard.view'),('production_manager','scan.use'),('production_manager','custody.issue'),
 ('production_manager','custody.receive'),('production_manager','custody.view_all'),('production_manager','custody.reverse'),
 ('production_manager','loss.review'),('production_manager','loss.approve'),('production_manager','loss.investigate'),
 ('production_manager','loss_rates.manage'),('production_manager','orders.view'),('production_manager','orders.manage'),
 ('production_manager','orders.advance'),('production_manager','orders.quote'),('production_manager','design.manage'),
 ('production_manager','workers.view'),('production_manager','customers.view'),('production_manager','stages.manage'),
 ('production_manager','products.manage'),('production_manager','inventory.view'),('production_manager','stones.view'),
 ('production_manager','stones.manage'),('production_manager','reports.view'),

 ('supervisor','scan.use'),('supervisor','custody.issue'),('supervisor','custody.receive'),('supervisor','custody.view_all'),
 ('supervisor','loss.review'),('supervisor','loss.approve'),('supervisor','orders.view'),('supervisor','orders.advance'),
 ('supervisor','workers.view'),('supervisor','stones.view'),('supervisor','stones.manage'),

 ('worker','worker.self'),('worker','scan.use'),

 ('accountant','dashboard.view'),('accountant','finance.view'),('accountant','invoices.manage'),('accountant','payments.manage'),
 ('accountant','expenses.manage'),('accountant','customers.view'),('accountant','orders.view'),('accountant','reports.view'),
 ('accountant','labor.manage'),

 ('inventory_officer','inventory.view'),('inventory_officer','inventory.manage'),('inventory_officer','stones.view'),
 ('inventory_officer','stones.manage'),('inventory_officer','orders.view'),('inventory_officer','scan.use'),

 ('customer','store.access');

-- المواد: الذهب حسب العيار واللون (كل مادة تحاسب منفصلة)
insert into materials(metal, karat, color, name) values
 ('gold',18,'yellow','ذهب عيار 18 أصفر'),('gold',18,'white','ذهب عيار 18 أبيض'),('gold',18,'rose','ذهب عيار 18 روز'),
 ('gold',21,'yellow','ذهب عيار 21 أصفر'),('gold',21,'white','ذهب عيار 21 أبيض'),('gold',21,'rose','ذهب عيار 21 روز'),
 ('gold',22,'yellow','ذهب عيار 22 أصفر'),('gold',22,'white','ذهب عيار 22 أبيض'),('gold',22,'rose','ذهب عيار 22 روز'),
 ('gold',24,'yellow','ذهب عيار 24');

-- المراحل الافتراضية - نسب العجز تبدأ بصفر حتى يحددها مدير المصنع
insert into stages(code, name, sort_order, kind, handles_gold, requires_approval, requires_weight, expected_hours) values
 ('intake','استلام الطلب',1,'intake',false,false,false,null),
 ('review','مراجعة الطلب',2,'normal',false,false,false,null),
 ('design3d','التصميم 3D',3,'design',false,false,false,null),
 ('design_approval','اعتماد التصميم من العميل',4,'design_approval',false,false,false,null),
 ('prep','تجهيز الذهب والألماس',5,'normal',true,false,true,null),
 ('casting','الصب',6,'normal',true,true,true,null),
 ('assembly','التشبيك',7,'normal',true,false,true,null),
 ('setting','تركيب الأحجار والألماس',8,'normal',true,false,true,null),
 ('polishing','التلميع',9,'normal',true,false,true,null),
 ('washing','الغسيل',10,'normal',true,false,true,null),
 ('qc','التشييك والجودة',11,'normal',true,true,true,null),
 ('final_weight','الوزن النهائي',12,'final_weight',false,false,true,null),
 ('invoicing','الفوترة',13,'invoicing',false,false,false,null),
 ('packaging','التغليف',14,'normal',false,false,false,null),
 ('ready','جاهز للتسليم',15,'delivery_ready',false,false,false,null),
 ('delivered','تم التسليم',16,'delivered',false,false,false,null);

insert into routes(name, product_type, is_default) values ('المسار الكامل (افتراضي)', null, true);
insert into route_stages(route_id, seq, stage_id)
  select 1, row_number() over (order by sort_order), id from stages order by sort_order;

insert into routes(name, product_type, is_default) values ('منتج بدون أحجار وبدون تصميم', null, false);
insert into route_stages(route_id, seq, stage_id)
  select 2, row_number() over (order by sort_order), id from stages
  where code not in ('design3d','design_approval','setting') order by sort_order;

insert into routes(name, product_type, is_default) values ('بيع من المخزون الجاهز', '__stock__', false);
insert into route_stages(route_id, seq, stage_id)
  select 3, row_number() over (order by sort_order), id from stages
  where code in ('invoicing','packaging','ready','delivered') order by sort_order;

insert into departments(name) values ('التصميم'),('الصب'),('التشبيك'),('تركيب الأحجار'),('التلميع'),('الجودة'),('الإدارة'),('المخزون'),('المالية');

insert into settings(key, value) values
 ('company', '{"name":"مصنع الذهب والمجوهرات","vat_number":"","cr_number":"","address":"","phone":""}'),
 ('vat_rate', '15'),
 ('weight_decimals', '3'),
 ('abnormal_threshold', '0'),
 ('currency', '"ر.س"'),
 ('notify_channels', '{"whatsapp":false,"sms":false,"email":false}');
