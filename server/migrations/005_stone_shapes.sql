-- تصنيفات الألماس حسب القصّة، وكل صنف (دفعة) ينتمي لتصنيف وله مقاس
create table stone_shapes (
  id         serial primary key,
  name       text not null unique,
  icon       text not null default 'round' check (icon in ('round','oval','pear','heart','marquise','square','emerald','baguette','other')),
  sort_order int not null default 0,
  active     boolean not null default true
);

insert into stone_shapes(name, icon, sort_order) values
 ('راوند','round',1), ('اوفال','oval',2), ('دمعة','pear',3), ('قلب','heart',4),
 ('ماركيز','marquise',5), ('مربع','square',6), ('باجيت','baguette',7), ('أخرى','other',99);

alter table stone_lots add column shape_id int references stone_shapes(id);
alter table stone_lots add column size_label text;         -- المقاس كما يستخدمه المصنع: 1.1 mm، 0.25، 3 ...
alter table stone_lots add column size_unit text check (size_unit in ('mm','ct','other'));
alter table stone_lots add column size_value numeric(10,4); -- للترتيب الرقمي
alter table stone_lots add column min_carats numeric(12,4); -- حد التنبيه بانخفاض المخزون
alter table stone_lots add column active boolean not null default true;

update stone_lots l set shape_id = s.id from stone_shapes s where l.cut_shape = s.name;
update stone_lots set shape_id = (select id from stone_shapes where name='أخرى') where shape_id is null;
alter table stone_lots alter column shape_id set not null;

create unique index stone_lots_item_unique on stone_lots (shape_id, coalesce(size_label,''), stone_type, coalesce(color,''), coalesce(clarity,'')) where active;
