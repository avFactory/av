-- صور داخلية على الطلب: يرفعها فريق 3D فقط، ولا تظهر للعميل أبداً
alter table order_files drop constraint if exists order_files_kind_check;
alter table order_files add constraint order_files_kind_check check (kind in ('reference','sketch','model3d','design','execution','other','internal'));
