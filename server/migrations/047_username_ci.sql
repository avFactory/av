-- اسم المستخدم فريد بدون اعتبار لحالة الأحرف (Ali = ali) - يُنشأ الفهرس فقط إن لم توجد تكرارات قائمة
do $$
begin
  if not exists (select lower(username) from users group by lower(username) having count(*) > 1) then
    create unique index if not exists users_username_lower_uniq on users (lower(username));
  end if;
end $$;
