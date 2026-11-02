// لوحة الإدارة: الإحصائيات، الموظفون، الأدوار، العملاء، المراحل ونسب العجز، المسارات، الإعدادات، التدقيق
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm, hashPassword } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyCustomer } from '../lib/notify.js';
import { sendXlsx } from '../lib/xlsx.js';

const r = Router();

/** الإحصائيات - كلها محسوبة من قاعدة البيانات */
r.get('/stats', requirePerm('dashboard.view'), async (_req, res) => {
  const s = await one(`
    select
      (select count(*) from orders where status in ('pending_review','quoted'))::int as new_orders,
      (select count(*) from orders where status='in_production')::int as in_production,
      (select count(*) from orders where due_date < current_date and status not in ('delivered','cancelled','rejected'))::int as late_orders,
      (select count(*) from orders where status in ('ready','delivered'))::int as completed_orders,
      (select count(*) from orders where status='ready')::int as ready_orders,
      (select coalesce(sum(balance),0) from gold_balances where loc_type in ('vault','order','worker','scrap','finished','loss_suspense'))::text as gold_in_factory,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='worker')::text as gold_with_workers,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='vault')::text as gold_in_vault,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='order')::text as gold_in_orders,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='scrap')::text as gold_scrap,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='finished')::text as gold_finished,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='loss_normal')::text as normal_loss,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='loss_abnormal')::text as abnormal_loss,
      (select coalesce(sum(balance),0) from gold_balances where loc_type='loss_suspense')::text as pending_loss,
      (select coalesce(sum(case when invoice_type='invoice' then subtotal else -subtotal end),0) from invoices where status='issued')::text as labor_revenue,
      (select coalesce(sum(case when invoice_type='invoice' then total else -total end),0) from invoices where status='issued')::text as invoiced_total,
      (select coalesce(sum(case when kind='refund' then -amount else amount end),0) from payments)::text as collected,
      (select count(*) from users where role_code='worker' and active)::int as workers,
      (select count(*) from customers where status='pending')::int as pending_customers,
      (select count(*) from settlements where status in ('pending_review','investigating'))::int as open_reviews`);
  s.receivables = (Number(s.invoiced_total) - Number(s.collected)).toFixed(2);
  const byStage = await many(`select s.name, count(o.id)::int n from stages s left join orders o on o.current_stage_id=s.id and o.status='in_production'
                              where s.active group by s.id order by s.sort_order`);
  const byMaterial = await many(`select m.name, b.loc_type, b.balance::text from gold_balances b join materials m on m.id=b.material_id
                                 where b.balance <> 0 and b.loc_type in ('vault','order','worker','scrap','finished','loss_suspense') order by m.id`);
  const lossTrend = await many(`select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d,
      sum(weight) filter (where kind='normal_loss')::text normal, sum(weight) filter (where kind in ('abnormal_pending','abnormal_loss'))::text abnormal
    from gold_ledger where created_at > now() - interval '30 days' and kind in ('normal_loss','abnormal_pending','abnormal_loss') group by 1 order by 1`);
  res.json({ ...s, byStage, byMaterial, lossTrend });
});

// ------------------------------------------------------------------ الموظفون
r.get('/employees', requirePerm('employees.manage', 'workers.view'), async (req, res) => {
  res.json(await many(`select u.id, u.username, u.full_name, u.role_code, ro.name as role_name, u.employee_no, u.department_id, d.name as department,
      u.specialty, u.phone, u.active, u.extra_perms, u.denied_perms, u.created_at,
      (select count(*) from custodies c where c.worker_id=u.id and c.status='open')::int as open_custodies,
      (select array_agg(stage_id) from stage_workers sw where sw.user_id=u.id) as stage_ids
    from users u join roles ro on ro.code=u.role_code left join departments d on d.id=u.department_id
    where u.role_code <> 'customer' ${req.query.all ? '' : 'and u.active'} order by u.role_code, u.full_name`));
});

r.post('/employees', requirePerm('employees.manage'), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const role = str(b.role_code, 'الدور', { required: true });
    if (role === 'customer') throw bad('حسابات العملاء تنشأ من صفحة العملاء');
    if (String(b.password || '').length < 8) throw bad('كلمة المرور يجب ألا تقل عن 8 أحرف');
    const u = (await db.query(
      `insert into users(username, password_hash, full_name, role_code, employee_no, department_id, specialty, phone)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [str(b.username, 'اسم المستخدم', { required: true }), hashPassword(String(b.password)), str(b.full_name, 'الاسم', { required: true }), role,
       str(b.employee_no, 'الرقم الوظيفي'), b.department_id ? int(b.department_id) : null, str(b.specialty, 'التخصص'), str(b.phone, 'الجوال')]
    ).catch((e) => { if (e.code === '23505') throw bad('اسم المستخدم أو الرقم الوظيفي مستخدم مسبقاً'); throw e; })).rows[0];
    if (Array.isArray(b.stage_ids)) for (const sid of b.stage_ids) await db.query('insert into stage_workers values ($1,$2) on conflict do nothing', [int(sid), u.id]);
    await audit(db, req, 'employee.create', 'user', u.id, { username: b.username, role });
    return u;
  }));
});

r.put('/employees/:id', requirePerm('employees.manage'), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const u = (await db.query('select * from users where id=$1 for update', [id])).rows[0];
    if (!u || u.role_code === 'customer') throw notFound();
    if (u.id === req.user.id && b.active === false) throw bad('لا يمكنك تعطيل حسابك');
    const role = b.role_code ?? u.role_code;
    if (role === 'customer') throw bad('دور غير صالح');
    if (b.active === false) {
      const open = (await db.query("select count(*)::int n from custodies where worker_id=$1 and status in ('open','under_review')", [id])).rows[0].n;
      if (open) throw conflict('لا يمكن تعطيل/حذف عامل لديه عهدة مفتوحة - استلم العهد أولاً');
    }
    await db.query(
      `update users set full_name=$2, role_code=$3, employee_no=$4, department_id=$5, specialty=$6, phone=$7, active=$8,
         extra_perms=$9, denied_perms=$10 where id=$1`,
      [id, str(b.full_name ?? u.full_name, 'الاسم', { required: true }), role, b.employee_no !== undefined ? str(b.employee_no, 'الرقم') : u.employee_no,
       b.department_id !== undefined ? (b.department_id ? int(b.department_id) : null) : u.department_id,
       b.specialty !== undefined ? str(b.specialty, 'التخصص') : u.specialty, b.phone !== undefined ? str(b.phone, 'الجوال') : u.phone,
       b.active !== undefined ? !!b.active : u.active, b.extra_perms ?? u.extra_perms, b.denied_perms ?? u.denied_perms]
    );
    if (b.password) {
      if (String(b.password).length < 8) throw bad('كلمة المرور يجب ألا تقل عن 8 أحرف');
      await db.query('update users set password_hash=$2 where id=$1', [id, hashPassword(String(b.password))]);
      await db.query('delete from sessions where user_id=$1', [id]);
    }
    if (b.active === false || b.role_code !== u.role_code) await db.query('delete from sessions where user_id=$1', [id]);
    if (Array.isArray(b.stage_ids)) {
      await db.query('delete from stage_workers where user_id=$1', [id]);
      for (const sid of b.stage_ids) await db.query('insert into stage_workers values ($1,$2) on conflict do nothing', [int(sid), id]);
    }
    await audit(db, req, b.active === false ? 'employee.deactivate' : 'employee.update', 'user', id,
      { before: { role: u.role_code, active: u.active, name: u.full_name }, after: { role, active: b.active, name: b.full_name }, password_changed: !!b.password });
    return { ok: true };
  }));
});

/** الحذف = تعطيل دائم (السجلات التاريخية للعهد مرتبطة بالموظف ولا تحذف) */
r.delete('/employees/:id', requirePerm('employees.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    if (id === req.user.id) throw bad('لا يمكنك حذف حسابك');
    const open = (await db.query("select count(*)::int n from custodies where worker_id=$1 and status in ('open','under_review')", [id])).rows[0].n;
    if (open) throw conflict('لا يمكن حذف عامل لديه عهدة مفتوحة');
    const used = (await db.query('select exists(select 1 from gold_ledger where worker_id=$1 or created_by=$1) or exists(select 1 from custodies where worker_id=$1 or supervisor_id=$1) as u', [id])).rows[0].u;
    if (used) {
      await db.query('update users set active=false where id=$1', [id]);
      await db.query('delete from sessions where user_id=$1', [id]);
      await audit(db, req, 'employee.archive', 'user', id, { reason: 'مرتبط بحركات - تم التعطيل بدلاً من الحذف' });
      return { archived: true };
    }
    await db.query('delete from sessions where user_id=$1', [id]);
    await db.query('delete from stage_workers where user_id=$1', [id]);
    await db.query('delete from notifications where user_id=$1', [id]);
    await db.query('delete from users where id=$1', [id]);
    await audit(db, req, 'employee.delete', 'user', id);
    return { deleted: true };
  }));
});

r.get('/employees/:id/performance', requirePerm('employees.manage', 'workers.view', 'reports.view'), async (req, res) => {
  const id = int(req.params.id);
  res.json(await one(`select
      count(*) filter (where c.status='closed')::int as completed,
      count(*) filter (where c.status='open')::int as open,
      coalesce(sum(c.weight_issued) filter (where c.status='closed'),0)::text as weight_processed,
      coalesce(sum(st.actual_loss),0)::text as total_loss,
      coalesce(sum(st.abnormal_loss),0)::text as abnormal_loss,
      round(avg(extract(epoch from (st.received_at - c.issued_at))/3600)::numeric, 1)::text as avg_hours,
      case when sum(c.weight_issued) filter (where st.id is not null) > 0
        then round(100 * sum(st.actual_loss) / sum(c.weight_issued) filter (where st.id is not null), 4)::text end as loss_pct
    from custodies c left join settlements st on st.custody_id=c.id and st.status <> 'reversed' where c.worker_id=$1 and c.status <> 'reversed'`, [id]));
});

// ------------------------------------------------------------------ الأدوار والصلاحيات
r.get('/roles', requirePerm('roles.manage', 'employees.manage'), async (_req, res) => {
  const roles = await many(`select r.*, coalesce(array_agg(rp.perm_code) filter (where rp.perm_code is not null), '{}') as perms
                            from roles r left join role_permissions rp on rp.role_code=r.code group by r.code order by r.is_system desc, r.code`);
  const perms = await many('select * from permissions order by grp, code');
  res.json({ roles, perms });
});

r.put('/roles/:code', requirePerm('roles.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const code = String(req.params.code);
    const exists = (await db.query('select * from roles where code=$1', [code])).rows[0];
    if (!exists) {
      if (!/^[a-z_]{3,30}$/.test(code)) throw bad('رمز الدور بالأحرف الإنجليزية الصغيرة');
      await db.query('insert into roles(code, name) values ($1,$2)', [code, str(req.body.name, 'اسم الدور', { required: true })]);
    } else if (req.body.name) await db.query('update roles set name=$2 where code=$1', [code, str(req.body.name, 'اسم الدور')]);
    if (code === 'admin' && !(req.body.perms || []).includes('roles.manage')) throw bad('لا يمكن إزالة صلاحية إدارة الأدوار من مدير النظام');
    const before = (await db.query('select perm_code from role_permissions where role_code=$1', [code])).rows.map((x) => x.perm_code);
    await db.query('delete from role_permissions where role_code=$1', [code]);
    for (const p of req.body.perms || []) await db.query('insert into role_permissions values ($1,$2)', [code, p]);
    await audit(db, req, 'role.update', 'role', code, { before, after: req.body.perms });
    return { ok: true };
  }));
});

// ------------------------------------------------------------------ الأقسام والفئات
r.get('/departments', async (_req, res) => res.json(await many('select * from departments order by name')));
r.post('/departments', requirePerm('employees.manage'), async (req, res) => {
  const d = await one('insert into departments(name) values ($1) returning *', [str(req.body.name, 'اسم القسم', { required: true })]);
  await audit(pool, req, 'department.create', 'department', d.id, d);
  res.json(d);
});
r.get('/tiers', requirePerm('customers.view', 'labor.manage'), async (_req, res) => res.json(await many('select * from customer_tiers order by name')));
r.post('/tiers', requirePerm('customers.manage'), async (req, res) => {
  const t = await one('insert into customer_tiers(name, description) values ($1,$2) returning *', [str(req.body.name, 'اسم الفئة', { required: true }), str(req.body.description, 'الوصف')]);
  await audit(pool, req, 'tier.create', 'tier', t.id, t);
  res.json(t);
});

// ------------------------------------------------------------------ العملاء
r.get('/customers', requirePerm('customers.view'), async (req, res) => {
  res.json(await many(`select c.*, t.name as tier_name,
      (select count(*) from orders o where o.customer_id=c.id)::int as orders_count,
      (select coalesce(sum(case when invoice_type='invoice' then total else -total end),0) from invoices i where i.customer_id=c.id and i.status='issued')
        - (select coalesce(sum(case when kind='refund' then -amount else amount end),0) from payments p where p.customer_id=c.id) as balance
    from customers c left join customer_tiers t on t.id=c.tier_id
    where ($1::text is null or c.status=$1) order by (c.status='pending') desc, c.id desc`, [req.query.status || null]));
});

r.get('/customers/:id', requirePerm('customers.view'), async (req, res) => {
  const id = int(req.params.id);
  const c = await one('select c.*, t.name as tier_name from customers c left join customer_tiers t on t.id=c.tier_id where c.id=$1', [id]);
  if (!c) throw notFound();
  const users = await many('select id, username, full_name, active from users where customer_id=$1', [id]);
  const docs = await many('select * from customer_documents where customer_id=$1', [id]);
  const orders = await many(`select o.id, o.order_no, o.title, o.status, o.created_at, s.name as stage_name from orders o left join stages s on s.id=o.current_stage_id where customer_id=$1 order by id desc`, [id]);
  const invoices = await many('select id, invoice_no, invoice_type, total::text, status, issue_date from invoices where customer_id=$1 order by id desc', [id]);
  const payments = await many('select id, payment_no, kind, amount::text, method, received_at, invoice_id from payments where customer_id=$1 order by id desc', [id]);
  const rates = await many('select * from labor_rates where customer_id=$1 order by id desc', [id]);
  res.json({ customer: c, users, docs, orders, invoices, payments, rates });
});

r.post('/customers', requirePerm('customers.manage'), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const c = (await db.query(`insert into customers(shop_name, owner_name, phone, phone2, email, city, address, vat_number, cr_number, status, tier_id, notes, approved_by, approved_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,$11,$12,now()) returning *`,
      [str(b.shop_name, 'اسم المحل', { required: true }), str(b.owner_name, 'المالك'), str(b.phone, 'الجوال'), str(b.phone2, 'جوال 2'), str(b.email, 'البريد'),
       str(b.city, 'المدينة'), str(b.address, 'العنوان'), str(b.vat_number, 'الرقم الضريبي'), str(b.cr_number, 'السجل'), b.tier_id ? int(b.tier_id) : null, str(b.notes, 'ملاحظات'), req.user.id])).rows[0];
    if (b.username && b.password) {
      if (String(b.password).length < 8) throw bad('كلمة المرور يجب ألا تقل عن 8 أحرف');
      await db.query("insert into users(username, password_hash, full_name, role_code, customer_id, phone) values ($1,$2,$3,'customer',$4,$5)",
        [String(b.username), hashPassword(String(b.password)), c.owner_name || c.shop_name, c.id, c.phone]).catch((e) => { if (e.code === '23505') throw bad('اسم المستخدم مستخدم'); throw e; });
    }
    await audit(db, req, 'customer.create', 'customer', c.id, { shop: c.shop_name });
    return c;
  }));
});

r.put('/customers/:id', requirePerm('customers.manage'), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const c = (await db.query('select * from customers where id=$1 for update', [id])).rows[0];
    if (!c) throw notFound();
    const fields = ['shop_name', 'owner_name', 'phone', 'phone2', 'email', 'city', 'address', 'vat_number', 'cr_number', 'notes'];
    const vals = fields.map((f) => (b[f] !== undefined ? str(b[f], f) : c[f]));
    await db.query(`update customers set ${fields.map((f, i) => `${f}=$${i + 2}`).join(', ')}, tier_id=$${fields.length + 2} where id=$1`,
      [id, ...vals, b.tier_id !== undefined ? (b.tier_id ? int(b.tier_id) : null) : c.tier_id]);
    if (b.status && b.status !== c.status) {
      const st = oneOf(b.status, ['pending', 'approved', 'rejected', 'suspended'], 'الحالة');
      await db.query('update customers set status=$2, approved_by=$3, approved_at=case when $2=\'approved\' then now() else approved_at end where id=$1', [id, st, req.user.id]);
      if (st === 'approved') await notifyCustomer(db, id, { kind: 'account', title: 'تمت الموافقة على حساب محلكم', body: 'يمكنكم الآن الطلب من المتجر', link: '/store' });
      if (st !== 'approved') await db.query('delete from sessions where user_id in (select id from users where customer_id=$1)', [id]);
    }
    await audit(db, req, 'customer.update', 'customer', id, { before: c, after: b });
    return { ok: true };
  }));
});

// ------------------------------------------------------------------ المراحل ونسب العجز
r.get('/stages', async (_req, res) => {
  res.json(await many(`select s.*, scr.rate_percent::text as loss_rate,
      (select array_agg(user_id) from stage_workers w where w.stage_id=s.id) as worker_ids,
      (select count(*) from route_stages rs where rs.stage_id=s.id)::int as routes_count
    from stages s join stage_current_rates scr on scr.stage_id=s.id order by s.active desc, s.sort_order`));
});

const STAGE_KINDS = ['normal', 'intake', 'design', 'design_approval', 'final_weight', 'invoicing', 'delivery_ready', 'delivered'];
function stageVals(b, s = {}) {
  return [
    str(b.name ?? s.name, 'اسم المرحلة', { required: true }),
    oneOf(b.kind ?? s.kind ?? 'normal', STAGE_KINDS, 'نوع المرحلة'),
    b.handles_gold ?? s.handles_gold ?? false, b.requires_approval ?? s.requires_approval ?? false, b.requires_weight ?? s.requires_weight ?? false,
    JSON.stringify(b.required_fields ?? s.required_fields ?? []),
    b.expected_hours === '' ? null : b.expected_hours ?? s.expected_hours ?? null,
    b.customer_visible ?? s.customer_visible ?? true, b.active ?? s.active ?? true,
  ];
}

r.post('/stages', requirePerm('stages.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const max = (await db.query('select coalesce(max(sort_order),0)+1 n from stages')).rows[0].n;
    const s = (await db.query(`insert into stages(name, kind, handles_gold, requires_approval, requires_weight, required_fields, expected_hours, customer_visible, active, sort_order)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [...stageVals(req.body), max])).rows[0];
    await audit(db, req, 'stage.create', 'stage', s.id, s);
    return s;
  }));
});

r.put('/stages/:id', requirePerm('stages.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const s = (await db.query('select * from stages where id=$1 for update', [id])).rows[0];
    if (!s) throw notFound();
    await db.query(`update stages set name=$2, kind=$3, handles_gold=$4, requires_approval=$5, requires_weight=$6, required_fields=$7, expected_hours=$8,
      customer_visible=$9, active=$10 where id=$1`, [id, ...stageVals(req.body, s)]);
    if (Array.isArray(req.body.worker_ids)) {
      await db.query('delete from stage_workers where stage_id=$1', [id]);
      for (const w of req.body.worker_ids) await db.query('insert into stage_workers values ($1,$2) on conflict do nothing', [id, int(w)]);
    }
    await audit(db, req, 'stage.update', 'stage', id, { before: s, after: req.body });
    return { ok: true };
  }));
});

r.delete('/stages/:id', requirePerm('stages.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const used = (await db.query(`select exists(select 1 from orders where current_stage_id=$1 and status in ('in_production','ready'))
      or exists(select 1 from custodies where stage_id=$1 and status in ('open','under_review')) as u`, [id])).rows[0].u;
    if (used) throw conflict('المرحلة مستخدمة في طلبات قيد التصنيع - لا يمكن حذفها الآن');
    const hist = (await db.query('select exists(select 1 from custodies where stage_id=$1) or exists(select 1 from order_stage_log where stage_id=$1) as h', [id])).rows[0].h;
    await db.query('delete from route_stages where stage_id=$1', [id]);
    // إعادة ترقيم تسلسل المسارات
    await db.query(`update route_stages rs set seq = x.n + 100000 from (select route_id, seq, row_number() over (partition by route_id order by seq) n from route_stages) x
                    where rs.route_id=x.route_id and rs.seq=x.seq`);
    await db.query('update route_stages set seq = seq - 100000 where seq > 100000');
    if (hist) await db.query('update stages set active=false where id=$1', [id]);
    else { await db.query('delete from stage_workers where stage_id=$1', [id]); await db.query('delete from stages where id=$1', [id]).catch(async () => db.query('update stages set active=false where id=$1', [id])); }
    await audit(db, req, 'stage.delete', 'stage', id, { archived: hist });
    return { ok: true, archived: hist };
  }));
});

r.put('/stages-order', requirePerm('stages.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const ids = (req.body.ids || []).map((x) => int(x));
    for (let i = 0; i < ids.length; i++) await db.query('update stages set sort_order=$2 where id=$1', [ids[i], i + 1]);
    await audit(db, req, 'stage.reorder', 'stage', null, { ids });
    return { ok: true };
  }));
});

/** تعديل نسبة العجز الطبيعي: صف جديد في السجل، لا يؤثر على العهد القائمة (لقطة النسبة محفوظة في كل عهدة) */
r.post('/stages/:id/rate', requirePerm('loss_rates.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const rate = String(req.body.rate_percent ?? '').trim();
    if (!/^\d{1,2}(\.\d{1,5})?$/.test(rate)) throw bad('النسبة غير صالحة (مثال 0.2)');
    const before = (await db.query('select rate_percent::text r from stage_current_rates where stage_id=$1', [id])).rows[0]?.r;
    const row = (await db.query('insert into stage_loss_rates(stage_id, rate_percent, set_by, note) values ($1,$2,$3,$4) returning *', [id, rate, req.user.id, str(req.body.note, 'ملاحظة')])).rows[0];
    await audit(db, req, 'loss_rate.change', 'stage', id, { before, after: rate, note: req.body.note });
    return row;
  }));
});

r.get('/stages/:id/rates', requirePerm('stages.manage', 'loss_rates.manage', 'reports.view'), async (req, res) => {
  res.json(await many('select r.*, r.rate_percent::text, u.full_name as set_by_name from stage_loss_rates r left join users u on u.id=r.set_by where stage_id=$1 order by effective_from desc, id desc', [int(req.params.id)]));
});

// ------------------------------------------------------------------ مسارات الإنتاج
r.get('/routes', async (_req, res) => {
  res.json(await many(`select r.*, coalesce(json_agg(json_build_object('seq', rs.seq, 'stage_id', rs.stage_id, 'name', s.name) order by rs.seq) filter (where rs.seq is not null), '[]') as stages
                       from routes r left join route_stages rs on rs.route_id=r.id left join stages s on s.id=rs.stage_id group by r.id order by r.id`));
});

async function saveRoute(db, id, b) {
  const stageIds = (b.stage_ids || []).map((x) => int(x));
  if (!stageIds.length) throw bad('اختر مراحل المسار');
  if (b.is_default) await db.query('update routes set is_default=false');
  const used = id ? (await db.query("select count(*)::int n from orders where route_id=$1 and status='in_production'", [id])).rows[0].n : 0;
  if (used && id) {
    const before = (await db.query('select stage_id from route_stages where route_id=$1 order by seq', [id])).rows.map((x) => x.stage_id);
    if (JSON.stringify(before) !== JSON.stringify(stageIds)) throw conflict('المسار مستخدم في طلبات قيد التصنيع - أنشئ مساراً جديداً بدلاً من تعديل المراحل');
  }
  if (!id) id = (await db.query('insert into routes(name, product_type, is_default, active) values ($1,$2,$3,$4) returning id', [str(b.name, 'اسم المسار', { required: true }), str(b.product_type, 'نوع المنتج'), !!b.is_default, b.active !== false])).rows[0].id;
  else await db.query('update routes set name=$2, product_type=$3, is_default=$4, active=$5 where id=$1', [id, str(b.name, 'اسم المسار', { required: true }), str(b.product_type, 'نوع المنتج'), !!b.is_default, b.active !== false]);
  if (!used) {
    await db.query('delete from route_stages where route_id=$1', [id]);
    for (let i = 0; i < stageIds.length; i++) await db.query('insert into route_stages values ($1,$2,$3)', [id, i + 1, stageIds[i]]);
  }
  return id;
}
r.post('/routes', requirePerm('stages.manage'), async (req, res) => {
  res.json(await tx(async (db) => { const id = await saveRoute(db, null, req.body); await audit(db, req, 'route.create', 'route', id, req.body); return { id }; }));
});
r.put('/routes/:id', requirePerm('stages.manage'), async (req, res) => {
  res.json(await tx(async (db) => { const id = await saveRoute(db, int(req.params.id), req.body); await audit(db, req, 'route.update', 'route', id, req.body); return { id }; }));
});

// ------------------------------------------------------------------ الإعدادات
r.get('/settings', requirePerm('settings.manage', 'finance.view'), async (_req, res) => {
  const rows = await many('select key, value from settings');
  res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
});
r.put('/settings', requirePerm('settings.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const allowed = ['company', 'vat_rate', 'weight_decimals', 'abnormal_threshold', 'currency', 'notify_channels'];
    for (const [k, v] of Object.entries(req.body)) {
      if (!allowed.includes(k)) continue;
      if (k === 'weight_decimals' && ![3, 4].includes(Number(v))) throw bad('دقة الوزن 3 أو 4 خانات');
      if (k === 'vat_rate' && !(Number(v) >= 0 && Number(v) < 100)) throw bad('نسبة الضريبة غير صالحة');
      const before = (await db.query('select value from settings where key=$1', [k])).rows[0]?.value;
      await db.query('insert into settings(key, value, updated_by, updated_at) values ($1,$2,$3,now()) on conflict (key) do update set value=$2, updated_by=$3, updated_at=now()', [k, JSON.stringify(v), req.user.id]);
      await audit(db, req, 'settings.update', 'settings', k, { before, after: v });
    }
    return { ok: true };
  }));
});

// ------------------------------------------------------------------ سجل التدقيق
async function auditQuery(q) {
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (q.entity) add('a.entity = ?', String(q.entity));
  if (q.entity_id) add('a.entity_id = ?', String(q.entity_id));
  if (q.user_id) add('a.user_id = ?', int(q.user_id));
  if (q.action) add('a.action ilike ?', `%${q.action}%`);
  if (q.from) add('a.created_at >= ?::date', String(q.from));
  if (q.to) add("a.created_at < ?::date + interval '1 day'", String(q.to));
  return many(`select a.*, u.full_name as user_name from audit_log a left join users u on u.id=a.user_id
               ${where.length ? 'where ' + where.join(' and ') : ''} order by a.id desc limit 1000`, params);
}
r.get('/audit', requirePerm('audit.view'), async (req, res) => res.json(await auditQuery(req.query)));
r.get('/audit.xlsx', requirePerm('audit.view'), async (req, res) => {
  await sendXlsx(res, 'سجل التدقيق', [['التاريخ', (x) => new Date(x.created_at).toISOString()], ['المستخدم', 'user_name'], ['الإجراء', 'action'], ['الكيان', 'entity'], ['المعرف', 'entity_id'], ['التفاصيل', (x) => JSON.stringify(x.details)], ['IP', 'ip']],
    await auditQuery(req.query), 'audit.xlsx');
});

export default r;
