// صور مصغّرة تُنشأ عند أول طلب وتُحفظ على القرص (المتجر والقوائم لا تُحمّل الصور الأصلية الكبيرة)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { UPLOAD_DIR } from './uploads.js';

const SIZES = new Set([200, 400, 800]);
const IMG = /\.(jpe?g|png|webp|gif|heic)$/i;
const THUMB_DIR = path.join(UPLOAD_DIR, '.thumbs');
const pending = new Map();
sharp.cache(false);
sharp.concurrency(2);

/** يعيد مسار الصورة المصغّرة، أو null (يُرسل الأصل) إن لم تكن صورة أو تعذر التصغير */
export async function thumbnail(abs, rel, w) {
  if (!SIZES.has(w) || !IMG.test(abs)) return null;
  const out = path.join(THUMB_DIR, String(w), `${rel}.webp`);
  if (fs.existsSync(out)) return out;
  // طلبات متزامنة لنفس الصورة تنتظر نفس العملية
  if (pending.has(out)) return pending.get(out);
  const job = (async () => {
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = `${out}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await sharp(abs, { failOn: 'none', limitInputPixels: 100_000_000 })
        .rotate() // اتجاه الصورة حسب الكاميرا
        .resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(tmp);
      fs.renameSync(tmp, out);
      return out;
    } catch {
      return null; // صيغة غير مدعومة (مثل بعض صور HEIC) → الأصل
    } finally {
      pending.delete(out);
    }
  })();
  pending.set(out, job);
  return job;
}
