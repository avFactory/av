-- إلزام المستخدم بتغيير كلمة المرور عند أول دخول (للحسابات المنشأة بكلمة مرور موحدة أو المعاد تعيينها من الإدارة)
alter table users add column must_change_password boolean not null default false;
