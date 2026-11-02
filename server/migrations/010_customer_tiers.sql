-- تصنيفات العملاء: ذهبي، فضي، عادي (الافتراضي للعملاء الجدد)
alter table customer_tiers add column color text not null default 'normal' check (color in ('gold','silver','normal','other'));
alter table customer_tiers add column sort_order int not null default 50;
alter table customer_tiers add column is_default boolean not null default false;

insert into customer_tiers(name, description, color, sort_order) values
 ('عميل ذهبي', 'أعلى تصنيف - أولوية وأسعار مصنعية خاصة', 'gold', 1),
 ('عميل فضي', 'تصنيف متوسط', 'silver', 2),
 ('عميل عادي', 'التصنيف الافتراضي للعملاء الجدد', 'normal', 3)
on conflict (name) do update set color = excluded.color, sort_order = excluded.sort_order;
update customer_tiers set is_default = (name = 'عميل عادي');
create unique index customer_tiers_one_default on customer_tiers (is_default) where is_default;

-- كل عميل بدون تصنيف يصبح "عميل عادي"، والعملاء الجدد يأخذونه تلقائياً
update customers set tier_id = (select id from customer_tiers where is_default) where tier_id is null;
create or replace function customer_default_tier() returns trigger language plpgsql as $$
begin
  if new.tier_id is null then new.tier_id := (select id from customer_tiers where is_default limit 1); end if;
  return new;
end $$;
create trigger customers_default_tier before insert on customers for each row execute function customer_default_tier();
