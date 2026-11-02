export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'ليست لديك صلاحية لتنفيذ هذه العملية') => new HttpError(403, msg);
export const notFound = (msg = 'غير موجود') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

const WEIGHT_RE = /^\d{1,10}(\.\d{1,4})?$/;

/** وزن بالجرام كنص عشري (حتى 4 خانات) - لا نستخدم الأعداد العشرية الثنائية */
export function weight(v, name = 'الوزن', { allowZero = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (allowZero) return '0';
    throw bad(`${name} مطلوب`);
  }
  const s = String(v).trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.');
  if (!WEIGHT_RE.test(s)) throw bad(`${name} غير صالح (حتى 4 خانات عشرية)`);
  if (!allowZero && Number(s) <= 0) throw bad(`${name} يجب أن يكون أكبر من صفر`);
  return s;
}

export function money(v, name = 'المبلغ', { allowZero = false } = {}) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(s)) throw bad(`${name} غير صالح`);
  if (!allowZero && Number(s) <= 0) throw bad(`${name} يجب أن يكون أكبر من صفر`);
  return s;
}

export function int(v, name = 'الرقم', { min = null, optional = false } = {}) {
  if ((v === undefined || v === null || v === '') && optional) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} غير صالح`);
  if (min !== null && n < min) throw bad(`${name} غير صالح`);
  return n;
}

export function str(v, name, { required = false, max = 2000 } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw bad(`${name} مطلوب`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw bad(`${name} طويل جداً`);
  return s;
}

export function oneOf(v, list, name) {
  if (!list.includes(v)) throw bad(`${name} غير صالح`);
  return v;
}
