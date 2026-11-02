-- الهوية: مصنع AV للمجوهرات (لا يغير الاسم إن عدّله المدير مسبقاً)
update settings set value = jsonb_set(value, '{name}', '"مصنع AV للمجوهرات"')
where key = 'company' and (value->>'name' is null or value->>'name' in ('', 'مصنع الذهب والمجوهرات'));
