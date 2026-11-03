// صفحة التسعيرة (مطابقة لورقة "التسعيرة" في ملف Excel):
// المخزَّن هنا فقط: سعر الذهب عيار 24، تاريخ آخر تحديث، الرمز السري للرابط الخارجي، وتعديلات الثوابت.
// المعادلات نفسها في الواجهة (web/src/pricingSheet.js) وتُحسب على جهاز المستخدم.
import crypto from 'node:crypto';
import { bad } from './http.js';

const KEY = 'pricing_sheet';
const DEFAULT = { gold24: 467, updated_at: '2026-10-15', rows: {} };
const FIELDS = ['c', 'e', 'g', 'ct', 'cost', 'profit', 'base', 'step', 'pp'];

export async function getPricing(db, { withToken = false } = {}) {
  let v = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value;
  if (!v || !v.token) {
    v = { ...DEFAULT, ...(v || {}), token: crypto.randomBytes(16).toString('hex') };
    await db.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=$2', [KEY, JSON.stringify(v)]);
  }
  const vat = Number((await db.query("select value::text v from settings where key='vat_rate'")).rows[0]?.v ?? 15);
  const out = { gold24: v.gold24, updated_at: v.updated_at, rows: v.rows || {}, vat };
  if (withToken) out.token = v.token;
  return out;
}

const num = (x, name) => {
  const n = Number(String(x).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw bad(`قيمة غير صالحة: ${name}`);
  return n;
};

export async function savePricing(db, body) {
  const cur = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value || DEFAULT;
  const next = { ...cur };
  if (body.gold24 !== undefined) {
    const g = num(body.gold24, 'سعر الذهب');
    if (g <= 0) throw bad('سعر الذهب مطلوب');
    if (g !== Number(cur.gold24)) next.updated_at = new Date().toISOString().slice(0, 10);
    next.gold24 = g;
  }
  if (body.updated_at) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.updated_at))) throw bad('تاريخ غير صالح');
    next.updated_at = String(body.updated_at);
  }
  if (body.rows && typeof body.rows === 'object') {
    const rows = {};
    for (const [id, r] of Object.entries(body.rows)) {
      if (!/^[a-z0-9_]{1,30}$/.test(id) || !r || typeof r !== 'object') continue;
      const clean = {};
      for (const f of FIELDS) if (r[f] !== undefined && r[f] !== null && r[f] !== '') clean[f] = num(r[f], f);
      if (Object.keys(clean).length) rows[id] = clean;
    }
    next.rows = rows;
  }
  await db.query('insert into settings(key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value=$2, updated_at=now()', [KEY, JSON.stringify(next)]);
  return next;
}

export async function rotateToken(db) {
  const cur = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value || DEFAULT;
  const next = { ...cur, token: crypto.randomBytes(16).toString('hex') };
  await db.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=$2', [KEY, JSON.stringify(next)]);
  return next.token;
}

export async function checkToken(db, token) {
  const v = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value;
  if (!v?.token || typeof token !== 'string' || token.length !== v.token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(v.token));
}
