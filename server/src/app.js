import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionMiddleware } from './lib/auth.js';
import { HttpError } from './lib/http.js';
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

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
  app.use(cookieParser());
  // حماية CSRF: الطلبات المعدِّلة يجب أن تأتي من نفس المصدر (إضافة لملف تعريف الارتباط SameSite=Strict)
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host && !process.env.ALLOWED_ORIGINS?.split(',').includes(origin))
        throw new HttpError(403, 'مصدر الطلب غير مسموح');
    }
    next();
  });
  app.use('/api', sessionMiddleware);

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
  app.use('/api', miscRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'المسار غير موجود')));

  // الواجهة الأمامية المبنية
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
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
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'بيانات غير صالحة'; }
    if (status >= 500) {
      console.error(req.method, req.originalUrl, err);
      message = 'حدث خطأ في الخادم';
    }
    res.status(status).json({ error: message, ...(err.extra ? { details: err.extra } : {}) });
  });
  return app;
}
