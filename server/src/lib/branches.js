// فروع العملاء: إنشاء وتعديل الفرع وحساب دخوله (كلمة مرور مستقلة لكل فرع)
import crypto from 'node:crypto';
import { bad, conflict, notFound, int, str } from './http.js';
import { hashPassword } from './auth.js';
import { audit } from './audit.js';

export async function listBranches(db, customerId) {
  return (await db.query(`select b.*, (select count(*) from orders o where o.branch_id=b.id)::int as orders_count,
      exists (select 1 from users u where u.branch_id=b.id and u.active) as has_login
    from customer_branches b where b.customer_id=$1 order by b.active desc, b.name`, [customerId])).rows;
}

// رقم تواصل الفرع: مطلوب، ومختلف عن جوال المحل الرئيسي وعن أرقام الفروع الأخرى (مقارنة آخر 9 أرقام)
export const phoneKey = (v) => String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '').slice(-9);
async function checkBranchPhone(db, customerId, phone, exceptId = null) {
  const k = phoneKey(phone);
  if (k.length < 9) throw bad('رقم تواصل الفرع مطلوب (9 أرقام على الأقل)');
  const rows = (await db.query(`select 'main' as kind, null as name, phone from customers where id=$1
      union all select 'branch', name, phone from customer_branches where customer_id=$1 and ($2::int is null or id<>$2)`, [customerId, exceptId])).rows;
  const hit = rows.find((r) => r.phone && phoneKey(r.phone) === k);
  if (hit) throw bad(hit.kind === 'main' ? 'رقم تواصل الفرع يجب أن يختلف عن جوال المحل الرئيسي' : `رقم التواصل مستخدم لـ "${hit.name}" - لكل فرع رقم مختلف`);
  return String(phone).trim();
}

export async function createBranch(db, req, customerId, body) {
  const name = str(body.name, 'اسم الفرع', { required: true, max: 80 });
  const phone = await checkBranchPhone(db, customerId, str(body.phone, 'رقم التواصل', { max: 30 }));
  if (String(body.password || '').length < 8) throw bad('كلمة مرور الفرع يجب ألا تقل عن 8 أحرف');
  const c = (await db.query('select id, shop_name from customers where id=$1', [customerId])).rows[0];
  if (!c) throw notFound('العميل غير موجود');
  const br = (await db.query(`insert into customer_branches(customer_id, name, city, address, phone) values ($1,$2,$3,$4,$5) returning *`,
    [customerId, name, str(body.city, 'المدينة'), str(body.address, 'العنوان'), phone]).catch((e) => { if (e.code === '23505') throw bad('يوجد فرع بنفس الاسم'); throw e; })).rows[0];
  // اسم مستخدم داخلي غير قابل للدخول المباشر - الدخول يتم باسم مستخدم المحل + اختيار الفرع
  await db.query(`insert into users(username, password_hash, full_name, role_code, customer_id, branch_id, phone)
    values ($1,$2,$3,'customer',$4,$5,$6)`, [`branch-${br.id}-${crypto.randomBytes(6).toString('hex')}`, hashPassword(String(body.password)), `${c.shop_name} - ${name}`, customerId, br.id, br.phone]);
  await audit(db, req, 'branch.create', 'customer', customerId, { branch: name });
  return br;
}

export async function updateBranch(db, req, customerId, branchId, body) {
  const br = (await db.query('select * from customer_branches where id=$1 and customer_id=$2 for update', [int(branchId), customerId])).rows[0];
  if (!br) throw notFound('الفرع غير موجود');
  const active = body.active === undefined ? br.active : !!body.active;
  const phone = body.phone !== undefined && phoneKey(body.phone) !== phoneKey(br.phone) ? await checkBranchPhone(db, customerId, str(body.phone, 'رقم التواصل', { max: 30 }), br.id) : br.phone;
  await db.query('update customer_branches set name=$2, city=$3, address=$4, phone=$5, active=$6 where id=$1',
    [br.id, str(body.name ?? br.name, 'اسم الفرع', { required: true, max: 80 }), body.city !== undefined ? str(body.city, 'المدينة') : br.city,
     body.address !== undefined ? str(body.address, 'العنوان') : br.address, phone, active])
    .catch((e) => { if (e.code === '23505') throw bad('يوجد فرع بنفس الاسم'); throw e; });
  await db.query('update users set phone=$3, active=$2, full_name=(select c.shop_name || \' - \' || b.name from customer_branches b join customers c on c.id=b.customer_id where b.id=$1) where branch_id=$1', [br.id, active, phone]);
  if (body.password) {
    if (String(body.password).length < 8) throw bad('كلمة مرور الفرع يجب ألا تقل عن 8 أحرف');
    await db.query('update users set password_hash=$2 where branch_id=$1', [br.id, hashPassword(String(body.password))]);
  }
  if (!active || body.password) await db.query('delete from sessions where user_id in (select id from users where branch_id=$1)', [br.id]);
  await audit(db, req, 'branch.update', 'customer', customerId, { branch: br.id, active, password_changed: !!body.password });
  return { ok: true };
}

export const assertMainAccount = (req) => { if (req.user.branch_id) throw conflict('هذا الإجراء متاح للحساب الرئيسي للمحل فقط'); };
