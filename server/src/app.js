import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { sessionMiddleware } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { cleanupFailedUploads } from './lib/uploads.js';
import authRoutes from './routes/auth.js';
import supRoutes from './routes/supervisor.js';
import workerRoutes from './routes/worker.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import invRoutes from './routes/inventory.js';
import stoneRoutes from './routes/stones.js';
import catalogRoutes from './routes/catalog.js';
import financeRoutes from './routes/finance.js';
import reportRoutes from './routes/reports.js';
import storeRoutes from './routes/store.js';
import miscRoutes from './routes/misc.js';
import publicRoutes from './routes/public.js';
import castingRoutes from './routes/casting.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  const csp = buildCsp(dist);
  const prod = process.env.NODE_ENV === 'production';
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Content-Security-Policy', req.path.startsWith('/api/') ? "default-src 'none'; frame-ancestors 'none'; sandbox" : csp);
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/') && !req.path.startsWith('/api/files/') && req.path !== '/api/qr') res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
  app.use(cookieParser());
  // حماية CSRF: الطلبات المعدِّلة يجب أن تأتي من نفس المصدر (إضافة لملف تعريف الارتباط SameSite=Strict)
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      let host = null;
      try { host = origin ? new URL(origin).host : null; } catch { host = null; }
      if (origin && host !== req.headers.host && !process.env.ALLOWED_ORIGINS?.split(',').includes(origin))
        throw new HttpError(403, 'مصدر الطلب غير مسموح');
      // نماذج من مواقع أخرى بدون Origin (متصفحات قديمة): نتحقق من Referer أيضاً
      if (!origin && req.headers.referer) {
        let rh = null;
        try { rh = new URL(req.headers.referer).host; } catch { rh = null; }
        if (rh !== req.headers.host) throw new HttpError(403, 'مصدر الطلب غير مسموح');
      }
    }
    next();
  });
  app.use('/api', cleanupFailedUploads);
  app.use('/api', sessionMiddleware);
  // من يلزمه تغيير كلمة المرور لا يستطيع استخدام النظام قبل تغييرها
  app.use('/api', (req, _res, next) => {
    if (req.user?.must_change_password && !req.path.startsWith('/auth/') && req.path !== '/lookups' && req.path !== '/events')
      throw new HttpError(403, 'يجب تغيير كلمة المرور أولاً');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/sup', supRoutes);
  app.use('/api/w', workerRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/inventory', invRoutes);
  app.use('/api/stones', stoneRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/store', storeRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/casting', castingRoutes);
  app.use('/api', miscRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'المسار غير موجود')));

  // الواجهة الأمامية المبنية
  if (fs.existsSync(dist)) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d' }));
    app.use(express.static(dist, { index: false, maxAge: '1d' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err.code === 'P0001') { status = 409; message = err.message.replace(/^IMMUTABLE:\s*/, ''); }
    else if (err.code === '23505') { status = 409; message = 'العملية مكررة أو القيمة مستخدمة مسبقاً'; }
    else if (err.code === '23503') { status = 400; message = 'مرجع غير صالح'; }
    else if (err.code === '23514') { status = 400; message = 'قيمة غير صالحة'; }
    else if (err.code === '22P02' || err.code === '22007' || err.code === '22008') { status = 400; message = 'صيغة بيانات غير صالحة'; }
    else if (err.code === 'LIMIT_FILE_SIZE') { status = 400; message = 'حجم الملف كبير جداً'; }
    else if (String(err.code || '').startsWith('LIMIT_')) { status = 400; message = 'عدد الملفات أو الحقول أكبر من المسموح'; }
    else if (err.type === 'entity.too.large') { status = 413; message = 'حجم البيانات كبير جداً'; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'بيانات غير صالحة'; }
    if (status >= 500) {
      console.error(req.method, req.originalUrl, err);
      message = 'حدث خطأ في الخادم';
    }
    res.status(status).json({ error: message, ...(err.extra ? { details: err.extra } : {}) });
  });
  return app;
}

/** سياسة أمان المحتوى: السكربتات من نفس الموقع فقط (+ بصمة السكربت المضمّن في index.html) */
function buildCsp(dist) {
  const hashes = [];
  try {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) hashes.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  } catch { /* بدون واجهة مبنية */ }
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // طابعة Zebra (Browser Print) على جهاز المستخدم
    "connect-src 'self' https://127.0.0.1:9101 http://127.0.0.1:9100 https://localhost:9101 http://localhost:9100",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
