-- إلغاء عيار 22 من النظام: يُوقف كمادة (لا يظهر في القوائم ولا يمكن الطلب أو الصرف به)
-- ويُحذف من عيارات المنتجات. الطلبات والحركات القديمة (إن وجدت) تبقى كما هي في السجلات.
update materials set active = false where karat = 22;
update products set karats = array_remove(karats, 22) where 22 = any(karats);
update products set karats = '{21}' where karats = '{}' or karats is null;
