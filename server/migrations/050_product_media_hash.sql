-- بصمات صور المنتجات لمنع التكرار: بصمة الملف وبصمة بصرية
alter table product_media add column if not exists sha256 text;
alter table product_media add column if not exists dhash text;
create index if not exists product_media_sha_idx on product_media(sha256);
