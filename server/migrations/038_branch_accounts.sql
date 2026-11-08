-- حساب منفصل لكل فرع: الفواتير والمدفوعات والقيود مرتبطة بالفرع (فارغ = الحساب الرئيسي للمحل)
alter table invoices add column if not exists branch_id int references customer_branches(id);
alter table payments add column if not exists branch_id int references customer_branches(id);
alter table customer_entries add column if not exists branch_id int references customer_branches(id);
-- الفواتير السابقة: فرع طلباتها
update invoices i set branch_id = x.b from (
  select l.invoice_id, min(o.branch_id) b from invoice_lines l join orders o on o.id=l.order_id group by l.invoice_id having min(o.branch_id) is not null
) x where x.invoice_id = i.id and i.branch_id is null;
-- مدفوعات مرتبطة بفاتورة: فرع الفاتورة
update payments p set branch_id = i.branch_id from invoices i where i.id = p.invoice_id and p.branch_id is null and i.branch_id is not null;
-- مستندات السداد المعتمدة: فرع المستند
update payments p set branch_id = s.branch_id from customer_submissions s where s.payment_id = p.id and p.branch_id is null and s.branch_id is not null;
update customer_entries e set branch_id = s.branch_id from customer_submissions s where s.entry_id = e.id and e.branch_id is null and s.branch_id is not null;
create index if not exists invoices_branch_idx on invoices(customer_id, branch_id);
create index if not exists payments_branch_idx on payments(customer_id, branch_id);
