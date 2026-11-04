import { Router } from 'express';
import { pool, tx } from '../db.js';
import { createSession, destroySession, verifyLogin, hashPassword, loginThrottle, loginReset, requireAuth, currentTokenHash } from '../lib/auth.js';
import { bad, str, int } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyPerm } from '../lib/notify.js';
import bcrypt from 'bcryptjs';
import { upload, registerFiles } from '../lib/uploads.js';

// مستندات تسجيل المحل الإلزامية (صورة أو PDF لكل منها)
export const REG_DOCS = [['cr_doc', 'cr', 'السجل التجاري'], ['vat_doc', 'vat', 'الشهادة الضريبية'], ['address_doc', 'national_address', 'العنوان الوطني']];
const regUpload = upload.fields(REG_DOCS.map(([f]) => ({ name: f, maxCount: 1 })));

const r = Router();

r.post('/login', async (req, res) => {
  const username = str(req.body.username, 'اسم المستخدم', { required: true, max: 100 });
  const password = String(req.body.password || '');
  const key = `${req.ip}:${username.toLowerCase()}`;
  loginThrottle(key);
  const branchId = req.body.branch_id ? int(req.body.branch_id, 'الفرع') : null;
  const u = await verifyLogin(username, password, branchId);
  if (!u) throw bad('اسم المستخدم أو كلمة المرور غير صحيحة');
  loginReset(key);
  await createSession(res, u, req);
  await audit(pool, { user: u, ip: req.ip }, 'login', 'user', u.id);
  res.json({ ok: true });
});

/** خيارات الدخول: إن كان للمحل فروع تُعرض لاختيار الفرع قبل كلمة المرور */
r.post('/login-options', async (req, res) => {
  const username = str(req.body.username, 'اسم المستخدم', { required: true, max: 100 });
  loginThrottle(`opts:${req.ip}`, 60);
  const branches = (await pool.query(`select b.id, b.name from users u join customer_branches b on b.customer_id=u.customer_id and b.active
      join users bu on bu.branch_id=b.id and bu.active
    where lower(u.username)=lower($1) and u.active and u.role_code='customer' and u.branch_id is null order by b.name`, [username])).rows;
  res.json({ branches });
});

r.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  const u = req.user;
  const unread = (await pool.query('select count(*)::int n from notifications where user_id=$1 and read_at is null', [u.id])).rows[0].n;
  res.json({
    id: u.id, username: u.username, full_name: u.full_name, role_code: u.role_code, employee_no: u.employee_no,
    customer_id: u.customer_id, customer_status: u.customer_status, shop_name: u.shop_name, branch_id: u.branch_id, branch_name: u.branch_name,
    perms: [...u.perms], unread, must_change_password: u.must_change_password,
  });
});

r.post('/change-password', requireAuth, async (req, res) => {
  const cur = String(req.body.current || '');
  const next = String(req.body.next || '');
  if (next.length < 8) throw bad('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
  const u = (await pool.query('select password_hash from users where id=$1', [req.user.id])).rows[0];
  if (!bcrypt.compareSync(cur, u.password_hash)) throw bad('كلمة المرور الحالية غير صحيحة');
  if (cur === next) throw bad('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
  await pool.query('update users set password_hash=$2, must_change_password=false where id=$1', [req.user.id, hashPassword(next)]);
  // إنهاء الجلسات الأخرى والإبقاء على الجلسة الحالية
  await pool.query('delete from sessions where user_id=$1 and token_hash <> $2', [req.user.id, currentTokenHash(req) || '']);
  await audit(pool, req, 'change_password', 'user', req.user.id);
  res.json({ ok: true });
});

/** تسجيل حساب محل ذهب جديد (يتطلب موافقة إدارة المصنع) */
r.post('/register-customer', regUpload, async (req, res) => {
  loginThrottle(`reg:${req.ip}`);
  const b = req.body;
  for (const [field, , label] of REG_DOCS) {
    const f = req.files?.[field]?.[0];
    if (!f) throw bad(`أرفق صورة ${label}`);
    if (!/^(image\/|application\/pdf)/.test(f.mimetype)) throw bad(`${label}: الملف يجب أن يكون صورة أو PDF`);
  }
  const username = str(b.username, 'اسم المستخدم', { required: true, max: 60 });
  if (!/^[A-Za-z0-9_.@-]{3,60}$/.test(username)) throw bad('اسم المستخدم يجب أن يكون بالأحرف الإنجليزية أو الأرقام');
  if (String(b.password || '').length < 8) throw bad('كلمة المرور يجب ألا تقل عن 8 أحرف');
  const out = await tx(async (db) => {
    const exists = await db.query('select 1 from users where lower(username)=lower($1)', [username]);
    if (exists.rowCount) throw bad('اسم المستخدم مستخدم مسبقاً');
    const c = (await db.query(
      `insert into customers(shop_name, owner_name, phone, email, city, address, vat_number, cr_number)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [str(b.shop_name, 'اسم المحل', { required: true }), str(b.owner_name, 'اسم المالك', { required: true }), str(b.phone, 'الجوال', { required: true }),
       str(b.email, 'البريد'), str(b.city, 'المدينة'), str(b.address, 'العنوان'), str(b.vat_number, 'الرقم الضريبي'), str(b.cr_number, 'السجل التجاري')]
    )).rows[0];
    const u = (await db.query(
      "insert into users(username, password_hash, full_name, role_code, customer_id, phone) values ($1,$2,$3,'customer',$4,$5) returning *",
      [username, hashPassword(String(b.password)), str(b.owner_name, 'اسم المالك'), c.id, str(b.phone, 'الجوال')]
    )).rows[0];
    for (const [field, type] of REG_DOCS) {
      const [f] = await registerFiles(db, req.files[field], u.id);
      await db.query('insert into customer_documents(customer_id, path, original_name, mime, doc_type) values ($1,$2,$3,$4,$5)', [c.id, f.path, f.original_name, f.mime, type]);
    }
    await notifyPerm(db, 'customers.manage', { kind: 'customer', title: 'طلب تسجيل محل جديد', body: b.shop_name, link: `/admin/customers/${c.id}` });
    await audit(db, { user: u, ip: req.ip }, 'register', 'customer', c.id);
    return u;
  });
  await createSession(res, out, req);
  res.json({ ok: true });
});

export default r;
