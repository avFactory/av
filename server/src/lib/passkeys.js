// الدخول بالبصمة أو الوجه عبر Passkeys (WebAuthn): التحقق الحيوي يتم في الجهاز نفسه،
// والسيرفر يتحقق من توقيع رقمي بالمفتاح العام المسجل — لا تُرسل البصمة أو صورة الوجه أبداً.
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { bad, notFound } from './http.js';
import { pool } from '../db.js';

const RP_NAME = 'مصنع AV للمجوهرات';

/** النطاق والمصدر المتوقعان (من الإعداد أو من عنوان الموقع نفسه) */
export function rpOf(req) {
  const host = String(process.env.RP_HOST || req.headers.host || '').toLowerCase();
  const rpID = host.replace(/:\d+$/, '');
  const local = /^(localhost|127\.0\.0\.1)$/.test(rpID);
  return { rpID, origin: `${local ? 'http' : 'https'}://${host}` };
}

async function saveChallenge(db, kind, challenge, userId = null) {
  await db.query("delete from webauthn_challenges where expires_at < now()");
  return (await db.query('insert into webauthn_challenges(user_id, kind, challenge) values ($1,$2,$3) returning id', [userId, kind, challenge])).rows[0].id;
}
// يُستهلك التحدي فوراً خارج المعاملة (لا يعود صالحاً حتى لو فشل التحقق بعده)
async function takeChallenge(_db, id, kind, userId = null) {
  const c = (await pool.query('delete from webauthn_challenges where id=$1 and kind=$2 and expires_at > now() returning *', [String(id || ''), kind]).catch(() => ({ rows: [] }))).rows[0];
  if (!c || (userId && c.user_id !== userId)) throw bad('انتهت مهلة التحقق — حاول مرة أخرى');
  return c.challenge;
}

export async function registerOptions(db, req) {
  const { rpID } = rpOf(req);
  const existing = (await db.query('select credential_id, transports from user_passkeys where user_id=$1', [req.user.id])).rows;
  const opts = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userName: req.user.username, userDisplayName: req.user.full_name || req.user.username,
    userID: new TextEncoder().encode(`av-user-${req.user.id}`),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { options: opts, challenge_id: await saveChallenge(db, 'register', opts.challenge, req.user.id) };
}

export async function registerVerify(db, req, body) {
  const expectedChallenge = await takeChallenge(db, body.challenge_id, 'register', req.user.id);
  const { rpID, origin } = rpOf(req);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch (e) { throw bad(`تعذر التحقق من البصمة: ${e.message}`); }
  if (!v.verified || !v.registrationInfo) throw bad('تعذر تسجيل البصمة');
  const c = v.registrationInfo.credential;
  const name = String(body.device_name || '').slice(0, 80) || 'جهاز';
  const row = (await db.query(`insert into user_passkeys(user_id, credential_id, public_key, counter, transports, device_name) values ($1,$2,$3,$4,$5,$6)
    on conflict (credential_id) do nothing returning id`, [req.user.id, c.id, Buffer.from(c.publicKey), c.counter || 0, c.transports || [], name])).rows[0];
  if (!row) throw bad('هذه البصمة مسجلة مسبقاً');
  return { ok: true, id: row.id };
}

export async function loginOptions(db, req) {
  const { rpID } = rpOf(req);
  const opts = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
  return { options: opts, challenge_id: await saveChallenge(db, 'login', opts.challenge) };
}

/** يعيد المستخدم بعد التحقق من التوقيع (أو يرمي خطأ) */
export async function loginVerify(db, req, body) {
  const expectedChallenge = await takeChallenge(db, body.challenge_id, 'login');
  const credId = String(body.response?.id || '');
  const pk = (await db.query('select * from user_passkeys where credential_id=$1', [credId])).rows[0];
  if (!pk) throw notFound('هذه البصمة غير مسجلة في النظام — سجّل الدخول بكلمة المرور ثم فعّل البصمة من «حسابي»');
  const { rpID, origin } = rpOf(req);
  let v;
  try {
    v = await verifyAuthenticationResponse({ response: body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports } });
  } catch (e) { throw bad(`تعذر التحقق من البصمة: ${e.message}`); }
  if (!v.verified) throw bad('تعذر التحقق من البصمة');
  await db.query('update user_passkeys set counter=$2, last_used_at=now() where id=$1', [pk.id, v.authenticationInfo.newCounter]);
  const u = (await db.query('select * from users where id=$1 and active', [pk.user_id])).rows[0];
  if (!u) throw bad('الحساب موقوف');
  return u;
}
