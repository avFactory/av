// لوحة الإدارة: الإحصائيات، الموظفون، الأدوار، العملاء، المراحل ونسب العجز، المسارات، الإعدادات، التدقيق
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm, hashPassword } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyCustomer } from '../lib/notify.js';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { sendXlsx } from '../lib/xlsx.js';
import { listBranches, createBranch, updateBranch } from '../lib/branches.js';

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
  res.json(await many(`select u.id, u.username, u.full_name, u.role_code, u.kind, ro.name as role_name, u.employee_no, u.department_id, d.name as department,
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

// ------------------------------------------------------------------ استيراد الموظفين من Excel
const empUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => (/\.(xlsx|csv)$/i.test(f.originalname) ? cb(null, true) : cb(bad('ارفع ملف Excel (xlsx) أو CSV'))) });
const HEADERS = [
  ['employee_no', /رقم|الرقم الوظيفي|no/i], ['full_name', /اسم العامل|اسم الموظف|الاسم الكامل|^الاسم$/], ['username', /اسم المستخدم|username|user/i],
  ['password', /كلمة المرور|كلمه المرور|password/i], ['kind', /النوع|type|kind/i], ['specialty', /مهمة|مهمه|المهمة|التخصص|العمل/], ['phone', /جوال|هاتف|phone/i],
];
const cellText = (v) => { if (v && typeof v === 'object') v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : ''); return v == null ? '' : String(v).trim(); };

/** المكينة تُعرف من اسمها: مكينة / ماكينة / machine */
const isMachine = (r) => r.kind === 'machine' || /(^|\s)(م|ما|مل)?كين[ةه]|machine/i.test(`${r.full_name || ''} ${r.kind || ''}`);
const STAGE_HINTS = [[/polish|بوليش/i, 'التلميع'], [/cast|صب/i, 'الصب'], [/setting|تركيب/i, 'تركيب'], [/wash|غسيل/i, 'الغسيل'], [/assembl|تشبيك/i, 'التشبيك']];

async function checkEmployeeRows(db, rows) {
  const names = rows.map((r) => String(r.username || '').toLowerCase());
  const existingU = new Set((await db.query('select lower(username) u from users where lower(username) = any($1)', [names])).rows.map((x) => x.u));
  const nos = rows.map((r) => r.employee_no).filter(Boolean);
  const existingN = new Set((await db.query('select employee_no n from users where employee_no = any($1)', [nos])).rows.map((x) => x.n));
  const seen = new Set();
  return rows.map((r) => {
    const errors = [];
    const u = String(r.username || '').trim();
    if (!r.full_name) errors.push('الاسم مفقود');
    if (!u) errors.push('اسم المستخدم مفقود');
    else if (/\s/.test(u)) errors.push('اسم المستخدم لا يقبل المسافات');
    if (String(r.password || '').length < 8) errors.push('كلمة المرور أقل من 8 أحرف');
    let status = errors.length ? 'error' : 'new';
    if (!errors.length && existingU.has(u.toLowerCase())) status = 'exists';
    else if (!errors.length && r.employee_no && existingN.has(r.employee_no)) { status = 'error'; errors.push('الرقم الوظيفي مستخدم لموظف آخر'); }
    if (seen.has(u.toLowerCase())) { status = 'error'; errors.push('اسم مستخدم مكرر في الملف'); }
    seen.add(u.toLowerCase());
    return { ...r, username: u, status, errors };
  });
}

r.post('/employees/import/parse', requirePerm('employees.manage'), empUpload.single('file'), async (req, res) => {
  if (!req.file) throw bad('اختر الملف');
  let table = [];
  if (/\.csv$/i.test(req.file.originalname)) table = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((x) => x.trim()));
  else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    wb.worksheets[0].eachRow({ includeEmpty: false }, (row) => { const cells = []; row.eachCell({ includeEmpty: true }, (c, i) => { cells[i - 1] = cellText(c.value); }); table.push(cells); });
  }
  const hIdx = table.findIndex((cells) => cells.some((c) => /اسم المستخدم|username/i.test(c || '')));
  if (hIdx < 0) throw bad('لم يتم العثور على صف العناوين (يجب أن يحتوي عمود "اسم المستخدم")');
  const map = {};
  table[hIdx].forEach((h, i) => { const k = HEADERS.find(([key, re]) => !map[key] && re.test(h || '')); if (k) map[k[0]] = i; });
  // "اسم العامل" قد يطابق نمط "رقم"؟ لا - لكن تأكد أن الاسم ليس هو اسم المستخدم
  const rows = table.slice(hIdx + 1).map((c) => ({
    employee_no: c[map.employee_no] || null, full_name: c[map.full_name] || '', username: c[map.username] || '',
    password: c[map.password] || '', specialty: c[map.specialty] || null, phone: c[map.phone] || null,
  })).filter((r) => r.full_name || r.username).map((r) => ({ ...r, kind: isMachine(r) ? 'machine' : 'person' }));
  if (!rows.length) throw bad('لا توجد بيانات تحت صف العناوين');
  res.json({ columns: map, rows: await checkEmployeeRows(pool, rows) });
});

/** إنشاء العمال الجدد (الموجودون مسبقاً يُتجاوزون ولا تُغيّر بياناتهم) */
r.post('/employees/import/commit', requirePerm('employees.manage'), async (req, res) => {
  const role = String(req.body.role_code || 'worker');
  if (role === 'customer' || role === 'admin') throw bad('دور غير مسموح في الاستيراد');
  const mustChange = req.body.must_change_password !== false;
  const input = (Array.isArray(req.body.rows) ? req.body.rows : []).map((r) => ({
    employee_no: str(r.employee_no, 'الرقم', { max: 40 }), full_name: str(r.full_name, 'الاسم', { max: 120 }) || '', username: str(r.username, 'اسم المستخدم', { max: 60 }) || '',
    password: String(r.password || ''), specialty: str(r.specialty, 'المهمة', { max: 80 }), phone: str(r.phone, 'الجوال', { max: 30 }),
  })).map((r, i) => ({ ...r, kind: isMachine({ ...r, kind: req.body.rows[i]?.kind }) ? 'machine' : 'person' }));
  if (!input.length) throw bad('لا توجد بيانات');
  res.json(await tx(async (db) => {
    if (!(await db.query('select 1 from roles where code=$1', [role])).rowCount) throw bad('الدور غير موجود');
    const rows = await checkEmployeeRows(db, input);
    const bad1 = rows.filter((r) => r.status === 'error');
    if (bad1.length) throw bad(`يوجد ${bad1.length} صف به أخطاء - صححها في الملف أولاً`, { rows: bad1 });
    const stages = (await db.query('select id, name from stages where active')).rows;
    let created = 0;
    const skipped = [];
    for (const r of rows) {
      if (r.status === 'exists') { skipped.push(r.username); continue; }
      let deptId = null;
      const deptName = r.kind === 'machine' ? 'المكائن' : r.specialty;
      if (deptName) {
        deptId = (await db.query('select id from departments where name=$1', [deptName])).rows[0]?.id
          ?? (await db.query('insert into departments(name) values ($1) on conflict (name) do update set name=excluded.name returning id', [deptName])).rows[0].id;
      }
      const u = (await db.query(`insert into users(username, password_hash, full_name, role_code, employee_no, department_id, specialty, phone, must_change_password, kind)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [r.username, hashPassword(r.password), r.full_name, role, r.employee_no, deptId, r.specialty, r.phone, mustChange, r.kind])).rows[0];
      // ربط العامل بالمرحلة المطابقة لمهمته (مثل تشبيك ← التشبيك، تركيب ← تركيب الأحجار)
      // للمكائن فقط: استنتاج المرحلة من اسمها (Polishing ← التلميع)
      const hint = r.kind === 'machine' ? STAGE_HINTS.find(([re]) => re.test(`${r.username} ${r.full_name}`))?.[1] : null;
      const sp = (r.specialty || hint || '').replace(/^ال/, '');
      if (role === 'worker' && sp) {
        for (const st of stages.filter((x) => x.name.replace(/^ال/, '').startsWith(sp) || x.name.includes(sp))) {
          await db.query('insert into stage_workers values ($1,$2) on conflict do nothing', [st.id, u.id]);
        }
      }
      created++;
    }
    await audit(db, req, 'employee.import', 'user', null, { role, created, skipped, must_change_password: mustChange });
    return { created, skipped };
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
      await db.query('update users set password_hash=$2, must_change_password=$3 where id=$1', [id, hashPassword(String(b.password)), id !== req.user.id && b.must_change_password !== false]);
      await db.query('delete from sessions where user_id=$1', [id]);
    }
    if (b.active === false || (b.role_code && b.role_code !== u.role_code)) await db.query('delete from sessions where user_id=$1', [id]);
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
r.get('/tiers', requirePerm('customers.view', 'labor.manage'), async (_req, res) => res.json(await many(`select t.*, (select count(*) from customers c where c.tier_id=t.id)::int as customers from customer_tiers t order by t.sort_order, t.name`)));
r.post('/tiers', requirePerm('customers.manage'), async (req, res) => {
  const t = await one('insert into customer_tiers(name, description, color) values ($1,$2,$3) returning *', [str(req.body.name, 'اسم الفئة', { required: true }), str(req.body.description, 'الوصف'), oneOf(req.body.color || 'other', ['gold', 'silver', 'normal', 'other'], 'اللون')]).catch((e) => { if (e.code === '23505') throw bad('التصنيف موجود مسبقاً'); throw e; });
  await audit(pool, req, 'tier.create', 'tier', t.id, t);
  res.json(t);
});

// ------------------------------------------------------------------ العملاء
r.get('/customers', requirePerm('customers.view'), async (req, res) => {
  res.json(await many(`select c.*, t.name as tier_name, t.color as tier_color,
      (select count(*) from orders o where o.customer_id=c.id)::int as orders_count,
      (select coalesce(sum(case when invoice_type='invoice' then total else -total end),0) from invoices i where i.customer_id=c.id and i.status='issued')
        - (select coalesce(sum(case when kind='refund' then -amount else amount end),0) from payments p where p.customer_id=c.id) as balance
    from customers c left join customer_tiers t on t.id=c.tier_id
    where ($1::text is null or c.status=$1) order by (c.status='pending') desc, c.id desc`, [req.query.status || null]));
});

// ------------------------------------------------------------------ استيراد العملاء من Excel
// الترتيب مهم: الأعمدة الأكثر تحديداً أولاً (مثل "جوال المحل" هو جوال وليس اسم المحل)
const CUST_HEADERS = [
  ['phone2', /جوال ?2|جوال آخر|هاتف ?2|phone ?2/i], ['phone', /جوال|هاتف|رقم التواصل|موبايل|phone|mobile/i], ['email', /بريد|ايميل|إيميل|email/i],
  ['vat_number', /ضريب|vat/i], ['cr_number', /سجل|^cr\b/i], ['username', /اسم المستخدم|username/i], ['password', /كلمة المرور|كلمه المرور|password/i],
  ['shop_name', /اسم المحل|اسم العميل|المحل|اسم المنشأة|المنشأة|shop|customer/i], ['owner_name', /المالك|صاحب|owner/i],
  ['city', /مدينة|المدينة|city/i], ['address', /عنوان|address/i], ['tier', /فئة|تصنيف|tier/i], ['notes', /ملاحظ|notes/i],
];
const SHOP_HEADER = /اسم المحل|اسم العميل|المحل|اسم المنشأة|المنشأة|shop|customer/i;
const digits = (v) => String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d+]/g, '');

async function readTable(file) {
  if (/\.csv$/i.test(file.originalname)) return file.buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((x) => x.trim()));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const table = [];
  wb.worksheets[0].eachRow({ includeEmpty: false }, (row) => { const cells = []; row.eachCell({ includeEmpty: true }, (c, i) => { cells[i - 1] = cellText(c.value); }); table.push(cells); });
  return table;
}

async function checkCustomerRows(db, rows) {
  const existing = (await db.query('select id, shop_name, phone, vat_number, cr_number from customers')).rows;
  const users = new Set((await db.query('select lower(username) u from users')).rows.map((x) => x.u));
  const seen = new Set();
  return rows.map((r) => {
    const errors = [];
    if (!r.shop_name) errors.push('اسم المحل مفقود');
    if (r.vat_number && !/^\d{15}$/.test(digits(r.vat_number))) errors.push('الرقم الضريبي يجب أن يكون 15 رقماً');
    if (r.username && !/^[A-Za-z0-9_.@-]{3,60}$/.test(r.username)) errors.push('اسم المستخدم بالإنجليزية بدون مسافات');
    if (r.username && String(r.password || '').length < 8) errors.push('كلمة المرور أقل من 8 أحرف');
    if (r.username && users.has(r.username.toLowerCase())) errors.push('اسم المستخدم مستخدم مسبقاً');
    const ph = digits(r.phone).slice(-9);
    const dup = existing.find((c) => (r.vat_number && digits(c.vat_number) === digits(r.vat_number)) || (r.cr_number && digits(c.cr_number) === digits(r.cr_number))
      || (ph.length >= 9 && digits(c.phone).slice(-9) === ph) || c.shop_name.trim() === String(r.shop_name || '').trim());
    const key = `${String(r.shop_name || '').trim()}|${digits(r.vat_number)}`;
    if (seen.has(key)) errors.push('مكرر في الملف');
    seen.add(key);
    const status = errors.length ? 'error' : dup ? 'exists' : 'new';
    return { ...r, status, errors, existing_id: dup?.id ?? null, existing_name: dup?.shop_name ?? null };
  });
}

r.post('/customers/import/parse', requirePerm('customers.manage'), empUpload.single('file'), async (req, res) => {
  if (!req.file) throw bad('اختر الملف');
  const table = await readTable(req.file);
  const hIdx = table.findIndex((cells) => cells.some((c) => SHOP_HEADER.test(c || '')));
  if (hIdx < 0) throw bad('لم يتم العثور على صف العناوين (يجب أن يحتوي عموداً باسم "اسم المحل" أو "اسم العميل")');
  const map = {};
  table[hIdx].forEach((h, i) => { const k = CUST_HEADERS.find(([key, re]) => map[key] === undefined && re.test(h || '')); if (k) map[k[0]] = i; });
  const get = (c, k) => (map[k] === undefined ? null : (c[map[k]] || '').trim() || null);
  const rows = table.slice(hIdx + 1).map((c) => Object.fromEntries(CUST_HEADERS.map(([k]) => [k, get(c, k)]))).filter((r) => Object.values(r).some(Boolean));
  if (!rows.length) throw bad('لا توجد بيانات تحت صف العناوين');
  res.json({ columns: Object.keys(map), rows: await checkCustomerRows(pool, rows) });
});

/** إضافة العملاء الجدد (معتمدين مباشرة لأن المصنع هو من أدخلهم). الموجودون مسبقاً يُتجاوزون ولا تُعدّل بياناتهم. */
r.post('/customers/import/commit', requirePerm('customers.manage'), async (req, res) => {
  const input = (Array.isArray(req.body.rows) ? req.body.rows : []).map((r) => Object.fromEntries(CUST_HEADERS.map(([k]) => [k, str(r[k], k, { max: 300 })])));
  if (!input.length) throw bad('لا توجد بيانات');
  res.json(await tx(async (db) => {
    const rows = await checkCustomerRows(db, input);
    const errs = rows.filter((r) => r.status === 'error');
    if (errs.length) throw bad(`يوجد ${errs.length} صف به أخطاء - صححها أو استبعدها`, { rows: errs });
    let created = 0;
    let logins = 0;
    const skipped = [];
    for (const r of rows) {
      if (r.status === 'exists') { skipped.push(r.shop_name); continue; }
      let tierId = null;
      if (r.tier) {
        // "ذهبي" / "فضي" / "عادي" تُطابق التصنيفات الأساسية بدلاً من إنشاء تصنيف مكرر
        const t = /ذهب|gold/i.test(r.tier) ? 'عميل ذهبي' : /فض|silver/i.test(r.tier) ? 'عميل فضي' : /عادي|normal|regular/i.test(r.tier) ? 'عميل عادي' : r.tier;
        tierId = (await db.query('insert into customer_tiers(name) values ($1) on conflict (name) do update set name=excluded.name returning id', [t])).rows[0].id;
      }
      const c = (await db.query(`insert into customers(shop_name, owner_name, phone, phone2, email, city, address, vat_number, cr_number, tier_id, notes, status, approved_by, approved_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12,now()) returning id`,
        [r.shop_name, r.owner_name, r.phone, r.phone2, r.email, r.city, r.address, r.vat_number ? digits(r.vat_number) : null, r.cr_number, tierId, r.notes, req.user.id])).rows[0];
      if (r.username) {
        await db.query("insert into users(username, password_hash, full_name, role_code, customer_id, phone, must_change_password) values ($1,$2,$3,'customer',$4,$5,true)",
          [r.username, hashPassword(String(r.password)), r.owner_name || r.shop_name, c.id, r.phone]);
        logins++;
      }
      created++;
    }
    await audit(db, req, 'customer.import', 'customer', null, { created, logins, skipped });
    return { created, logins, skipped };
  }));
});

/** تصدير العملاء إلى Excel */
r.get('/customers.xlsx', requirePerm('customers.view'), async (_req, res) => {
  const rows = await many(`select c.*, t.name as tier_name, (select count(*) from orders o where o.customer_id=c.id)::int as orders_count,
      (select coalesce(sum(case when invoice_type='invoice' then total else -total end),0) from invoices i where i.customer_id=c.id and i.status='issued')
        - (select coalesce(sum(case when kind='refund' then -amount else amount end),0) from payments p where p.customer_id=c.id) as balance
    from customers c left join customer_tiers t on t.id=c.tier_id order by c.shop_name`);
  const ST = { pending: 'بانتظار الموافقة', approved: 'معتمد', rejected: 'مرفوض', suspended: 'موقوف' };
  await sendXlsx(res, 'العملاء', [['اسم المحل', 'shop_name'], ['المالك', 'owner_name'], ['الجوال', 'phone'], ['جوال 2', 'phone2'], ['البريد', 'email'], ['المدينة', 'city'], ['العنوان', 'address'],
    ['الرقم الضريبي', 'vat_number'], ['السجل التجاري', 'cr_number'], ['الفئة', 'tier_name'], ['الحالة', (x) => ST[x.status]], ['عدد الطلبات', 'orders_count'], ['الرصيد المستحق', (x) => Number(x.balance)], ['ملاحظات', 'notes']], rows, 'customers.xlsx');
});

r.get('/customers/:id', requirePerm('customers.view'), async (req, res) => {
  const id = int(req.params.id);
  const c = await one('select c.*, t.name as tier_name, t.color as tier_color from customers c left join customer_tiers t on t.id=c.tier_id where c.id=$1', [id]);
  if (!c) throw notFound();
  const users = await many('select id, username, full_name, active from users where customer_id=$1 and branch_id is null', [id]);
  const docs = await many('select * from customer_documents where customer_id=$1', [id]);
  const orders = await many(`select o.id, o.order_no, o.title, o.status, o.created_at, s.name as stage_name, br.name as branch_name from orders o left join stages s on s.id=o.current_stage_id left join customer_branches br on br.id=o.branch_id where o.customer_id=$1 order by o.id desc`, [id]);
  const invoices = await many('select id, invoice_no, invoice_type, total::text, status, issue_date from invoices where customer_id=$1 order by id desc', [id]);
  const payments = await many('select id, payment_no, kind, amount::text, method, received_at, invoice_id from payments where customer_id=$1 order by id desc', [id]);
  const rates = await many('select * from labor_rates where customer_id=$1 order by id desc', [id]);
  const branches = await listBranches(pool, id);
  res.json({ customer: c, users, docs, orders, invoices, payments, rates, branches });
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

r.post('/customers/:id/branches', requirePerm('customers.manage'), async (req, res) => {
  res.json(await tx((db) => createBranch(db, req, int(req.params.id), req.body)));
});
r.put('/customers/:id/branches/:bid', requirePerm('customers.manage'), async (req, res) => {
  res.json(await tx((db) => updateBranch(db, req, int(req.params.id), req.params.bid, req.body)));
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
