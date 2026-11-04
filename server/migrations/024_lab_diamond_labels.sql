-- تسمية "الألماس" في كل مكان: ألماس مخبري (الألماس الطبيعي يبقى كما هو)
update stages set name = replace(name, 'والألماس', 'والألماس المخبري') where name like '%والألماس%' and name not like '%مخبري%' and name not like '%طبيعي%';
update stages set name = replace(name, 'الألماس', 'الألماس المخبري') where name like '%الألماس%' and name not like '%مخبري%' and name not like '%طبيعي%';
update permissions set grp = 'الألماس المخبري' where grp = 'الألماس';
update stone_lots set stone_type = 'ألماس مخبري' where stone_type in ('ألماس', 'الماس', 'الألماس');
