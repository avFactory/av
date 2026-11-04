-- فهارس للأداء مع آلاف المنتجات والصور
create index if not exists product_media_product_idx on product_media(product_id, sort, id);
create index if not exists product_media_path_idx on product_media(path);
create index if not exists order_files_path_idx on order_files(path);
create index if not exists order_files_order_idx on order_files(order_id);
create index if not exists customer_documents_path_idx on customer_documents(path);
create index if not exists products_active_idx on products(id desc) where active;
create index if not exists labor_rates_active_idx on labor_rates(active) where active;
create index if not exists orders_cart_ref_idx on orders(cart_ref) where cart_ref is not null;
