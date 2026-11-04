import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { bad } from './http.js';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = /\.(jpe?g|png|webp|gif|heic|mp4|mov|webm|pdf|stl|obj|3dm|step|stp|glb|gltf|zip)$/i;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const d = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
});

export const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => (ALLOWED.test(file.originalname) ? cb(null, true) : cb(bad('نوع الملف غير مسموح'))),
});

export const relPath = (abs) => path.relative(UPLOAD_DIR, abs).split(path.sep).join('/');

export async function registerFiles(db, files, userId) {
  const out = [];
  for (const f of files || []) {
    const p = relPath(f.path);
    const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
    await db.query('insert into files(path, original_name, mime, size, uploaded_by) values ($1,$2,$3,$4,$5)', [p, originalName, f.mimetype, f.size, userId]);
    out.push({ path: p, original_name: originalName, mime: f.mimetype });
  }
  return out;
}

/** حفظ توقيع إلكتروني (PNG data URL) */
export async function saveSignature(db, dataUrl, userId) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw bad('صيغة التوقيع غير صالحة');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 600 * 1024) throw bad('التوقيع كبير جداً');
  const d = path.join(UPLOAD_DIR, 'signatures');
  fs.mkdirSync(d, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + '.png';
  fs.writeFileSync(path.join(d, name), buf);
  const p = `signatures/${name}`;
  await db.query('insert into files(path, original_name, mime, size, uploaded_by) values ($1,$2,$3,$4,$5)', [p, 'signature.png', 'image/png', buf.length, userId]);
  return p;
}
