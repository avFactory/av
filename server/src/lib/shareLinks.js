// روابط مشاركة خارجية بدون تسجيل دخول (عرض فقط) — رمز عشوائي سري لكل رابط، يمكن إيقافه وإنشاء غيره
import crypto from 'node:crypto';

const newToken = () => crypto.randomBytes(16).toString('hex');

export async function getShareToken(db, key) {
  const v = (await db.query('select value from settings where key=$1', [key])).rows[0]?.value;
  if (v?.token) return v.token;
  const token = newToken();
  await db.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=$2', [key, JSON.stringify({ token })]);
  return token;
}

export async function rotateShareToken(db, key) {
  const token = newToken();
  await db.query('insert into settings(key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value=$2, updated_at=now()', [key, JSON.stringify({ token })]);
  return token;
}

export async function checkShareToken(db, key, token) {
  const v = (await db.query('select value from settings where key=$1', [key])).rows[0]?.value;
  const t = String(token || '');
  return !!(v?.token && t.length === v.token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(v.token)));
}
