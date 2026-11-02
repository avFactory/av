import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { HttpError, forbidden } from './http.js';

export const COOKIE = 'gf_session';
const TTL_HOURS = Number(process.env.SESSION_HOURS || 12);
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

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
    `select u.*, c.status as customer_status, c.shop_name
     from sessions s join users u on u.id = s.user_id left join customers c on c.id = u.customer_id
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

export async function verifyLogin(username, password) {
  const r = await pool.query('select * from users where lower(username)=lower($1) and active', [username]);
  const u = r.rows[0];
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return null;
  return u;
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);

// حماية بسيطة من محاولات التخمين
const attempts = new Map();
export function loginThrottle(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (a.length >= 10) throw new HttpError(429, 'محاولات كثيرة، حاول بعد قليل');
  a.push(now);
  attempts.set(key, a);
}
export const loginReset = (key) => attempts.delete(key);
