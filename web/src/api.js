// عميل الواجهة الخلفية - كل البيانات من قاعدة البيانات عبر API
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + url, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, data?.error || 'حدث خطأ', data?.details);
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
};

/** رابط ملف محمي؛ w (200/400/800) يعيد صورة مصغّرة خفيفة للقوائم */
export const fileUrl = (p, w) => (p ? `/api/files/${p}${w ? `?w=${w}` : ''}` : null);
export const qrUrl = (text) => `/api/qr?text=${encodeURIComponent(text)}`;

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** معرّف فريد لكل عملية لمنع التسجيل المزدوج عند تكرار الضغط أو انقطاع الشبكة */
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
