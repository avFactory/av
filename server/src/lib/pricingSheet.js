// صفحة التسعيرة (مطابقة لورقة "التسعيرة" في ملف Excel):
// المخزَّن هنا فقط: سعر الذهب عيار 24، تاريخ آخر تحديث، الرمز السري للرابط الخارجي، وتعديلات الثوابت.
// المعادلات نفسها في الواجهة (web/src/pricingSheet.js) وتُحسب على جهاز المستخدم.
import crypto from 'node:crypto';
import { bad } from './http.js';
import { SECTIONS, COLUMNS, SHORT_COLUMNS, calc, withOverrides } from './pricingFormulas.js';

const KEY = 'pricing_sheet';
const DEFAULT = { gold24: 467, updated_at: '2026-10-15', rows: {} };
const FIELDS = ['c', 'e', 'g', 'ct', 'cost', 'profit', 'base', 'step', 'pp'];

export async function getPricing(db, { withToken = false } = {}) {
  let v = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value;
  if (!v || !v.token || !v.token_short) {
    v = { ...DEFAULT, ...(v || {}) };
    if (!v.token) v.token = crypto.randomBytes(16).toString('hex');
    if (!v.token_short) v.token_short = crypto.randomBytes(16).toString('hex');
    await db.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=$2', [KEY, JSON.stringify(v)]);
  }
  const vat = Number((await db.query("select value::text v from settings where key='vat_rate'")).rows[0]?.v ?? 15);
  const out = { gold24: v.gold24, updated_at: v.updated_at, rows: v.rows || {}, vat };
  if (withToken) { out.token = v.token; out.token_short = v.token_short; }
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

export async function rotateToken(db, which = 'full') {
  const cur = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value || DEFAULT;
  const field = which === 'short' ? 'token_short' : 'token';
  const next = { ...cur, [field]: crypto.randomBytes(16).toString('hex') };
  await db.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=$2', [KEY, JSON.stringify(next)]);
  return next[field];
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** نوع الرابط: 'full' للتسعيرة الكاملة، 'short' للمختصرة، أو null */
export async function checkToken(db, token) {
  const v = (await db.query('select value from settings where key=$1', [KEY])).rows[0]?.value;
  if (!v) return null;
  if (same(token, v.token)) return 'full';
  if (same(token, v.token_short)) return 'short';
  return null;
}

/**
 * التسعيرة المختصرة محسوبة على الخادم: يُرسل للزائر المنتج والأوزان والسعر الشامل للقطاعي فقط
 * (وتكاليف المصنع للتصاميم الذهب كما في الملف) — بدون المصنعية أو الفائدة أو أي تكلفة أخرى.
 */
export function shortView(p, weights = {}) {
  const w = (id, k, def) => {
    const x = weights?.[id]?.[k];
    if (x === undefined || x === null || x === '') return def;
    const n = Number(String(x).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : def;
  };
  return SECTIONS.map((s) => {
    const keys = SHORT_COLUMNS[s.kind];
    const columns = COLUMNS[s.kind].filter(([k]) => keys.includes(k)).map(([k, label, type]) => [k, label, type === 'input' ? 'input' : null]);
    return {
      id: s.id, title: s.title, kind: s.kind, columns,
      rows: s.rows.map((r0) => {
        const r = withOverrides(r0, p.rows);
        const inputs = Object.fromEntries(columns.filter((c) => c[2] === 'input').map(([k]) => [k, w(r.id, k, Number(r[k]) || 0)]));
        const v = calc(s.kind, { ...r, ...inputs }, p.gold24, p.vat ?? 15);
        const values = Object.fromEntries(columns.filter(([k, , t]) => k !== 'name' && t !== 'input').map(([k]) => [k, Math.round(v[k] * 100) / 100]));
        return { id: r.id, name: r.name, defaults: Object.fromEntries(Object.keys(inputs).map((k) => [k, Number(r[k]) || 0])), values };
      }),
    };
  });
}
