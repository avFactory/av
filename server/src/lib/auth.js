import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { HttpError, forbidden } from './http.js';

export const COOKIE = 'gf_session';
const TTL_HOURS = Number(process.env.SESSION_HOURS || 12);
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const currentTokenHash = (req) => (req.cookies?.[COOKIE] ? hash(req.cookies[COOKIE]) : null);

export async function createSession(res, user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `insert into sessions(token_hash, user_id, expires_at, ip, user_agent) values ($1,$2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [hash(token), user.id, String(TTL_HOURS), req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_HOURS * 3600 * 1000, path: '/',
  });
}

export async function destroySession(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) await pool.query('delete from sessions where token_hash=$1', [hash(t)]);
  res.clearCookie(COOKIE, { path: '/' });
}

export async function loadPermissions(user) {
  const r = await pool.query('select perm_code from role_permissions where role_code=$1', [user.role_code]);
  const set = new Set(r.rows.map((x) => x.perm_code));
  for (const p of user.extra_perms || []) set.add(p);
  for (const p of user.denied_perms || []) set.delete(p);
  return set;
}

export async function sessionMiddleware(req, _res, next) {
  const t = req.cookies?.[COOKIE];
  if (!t) return next();
  const r = await pool.query(
    `select u.*, c.status as customer_status, c.shop_name, br.name as branch_name, dp.name as department_name
     from sessions s join users u on u.id = s.user_id left join customers c on c.id = u.customer_id left join customer_branches br on br.id = u.branch_id left join departments dp on dp.id = u.department_id
     where s.token_hash=$1 and s.expires_at > now() and u.active`,
    [hash(t)]
  );
  if (r.rows[0]) {
    const u = r.rows[0];
    delete u.password_hash;
    u.perms = await loadPermissions(u);
    req.user = u;
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'يجب تسجيل الدخول');
  next();
}

/** يتطلب صلاحية واحدة على الأقل من القائمة */
export const requirePerm = (...codes) => (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'يجب تسجيل الدخول');
  if (!codes.some((c) => req.user.perms.has(c))) throw forbidden();
  next();
};

export const has = (req, code) => !!req.user?.perms?.has(code);

const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);
export async function verifyLogin(username, password, branchId = null) {
  const r = await pool.query('select * from users where lower(username)=lower($1) and active', [username]);
  const main = r.rows[0];
  // حسابات الفروع لا تدخل باسمها الداخلي مباشرة
  if (!main || main.branch_id) { bcrypt.compareSync(password, DUMMY_HASH); return null; }
  let u = main;
  // شركة بفروع فقط: الحساب الرئيسي معرّف للشركة ولا يُستخدم للدخول
  if (!branchId && main.role_code === 'customer' && main.customer_id
    && (await pool.query('select branches_only from customers where id=$1', [main.customer_id])).rows[0]?.branches_only) {
    bcrypt.compareSync(password, DUMMY_HASH); return null;
  }
  if (branchId) {
    if (main.role_code !== 'customer') return null;
    u = (await pool.query(`select u.* from users u join customer_branches b on b.id=u.branch_id
      where u.branch_id=$1 and u.customer_id=$2 and u.active and b.active`, [branchId, main.customer_id])).rows[0];
    if (!u) { bcrypt.compareSync(password, DUMMY_HASH); return null; }
  }
  if (!bcrypt.compareSync(password, u.password_hash)) return null;
  return u;
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);

// حماية من محاولات التخمين: حد لكل (عنوان + مستخدم)، وحد لكل عنوان، وحد لكل مستخدم من كل العناوين
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
function hit(key, max) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < WINDOW);
  if (a.length >= max) { attempts.set(key, a); return false; }
  a.push(now);
  attempts.set(key, a);
  return true;
}
export function loginThrottle(key, max = 10) {
  if (!hit(key, max)) throw new HttpError(429, 'محاولات كثيرة، حاول بعد 15 دقيقة');
}
/** تسجيل الدخول: تُحسب المحاولات الفاشلة فقط — 10 لكل عنوان+مستخدم، 50 لكل عنوان، 30 لكل مستخدم من كل العناوين */
const LOGIN_LIMITS = (ip, u) => [[`${ip}:${u}`, 10], [`ip:${ip}`, 50], [`user:${u}`, 30]];
export function loginGuard(ip, username) {
  const u = String(username || '').toLowerCase();
  const now = Date.now();
  for (const [k, max] of LOGIN_LIMITS(ip, u)) {
    if ((attempts.get(k) || []).filter((t) => now - t < WINDOW).length >= max) throw new HttpError(429, 'محاولات دخول خاطئة كثيرة، حاول بعد 15 دقيقة');
  }
}
export function loginFailed(ip, username) {
  const u = String(username || '').toLowerCase();
  for (const [k] of LOGIN_LIMITS(ip, u)) hit(k, Infinity);
}
export const loginReset = (key) => attempts.delete(key);
// تنظيف دوري حتى لا تكبر الذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (!a.some((t) => now - t < WINDOW)) attempts.delete(k);
}, 5 * 60 * 1000).unref();
// حذف الجلسات المنتهية
setInterval(() => { pool.query('delete from sessions where expires_at < now()').catch(() => {}); }, 60 * 60 * 1000).unref();
