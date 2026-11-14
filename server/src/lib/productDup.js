// منع تكرار المنتجات: نفس الاسم (بعد توحيد الكتابة العربية) أو نفس الصورة
// الصورة: بصمة الملف (sha256) للتطابق التام + بصمة بصرية (dHash 64-bit) لنفس الصورة بعد إعادة الحفظ/تغيير الحجم.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { conflict } from './http.js';
import { UPLOAD_DIR } from './uploads.js';

/** توحيد الاسم: الهمزات، التاء المربوطة، الألف المقصورة، التشكيل، التطويل، المسافات */
export function normName(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

const SIMILAR = 4; // أقصى فرق في البصمة البصرية (من 64) لاعتبار الصورتين نفس الصورة

export async function imageHashes(absPath) {
  const buf = await fs.promises.readFile(absPath);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  let dhash = null;
  try {
    const px = await sharp(buf, { failOn: 'none' }).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    // صورة شبه فارغة (لون واحد): بلا بصمة بصرية حتى لا تتشابه كل الصور الفارغة — بصمة الملف فقط
    const mean = px.reduce((a, v) => a + v, 0) / px.length;
    const sd = Math.sqrt(px.reduce((a, v) => a + (v - mean) ** 2, 0) / px.length);
    if (sd < 4) return { sha, dhash: null };
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    dhash = bits.toString(16).padStart(16, '0');
  } catch { /* ليست صورة (فيديو): بصمة الملف فقط */ }
  return { sha, dhash };
}

const hamming = (a, b) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/** حساب البصمات للصور القديمة التي لم تُحسب (مرة واحدة، في الخلفية) */
export async function backfillMediaHashes(db) {
  const rows = (await db.query('select id, path from product_media where sha256 is null order by id limit 5000')).rows;
  for (const r of rows) {
    const abs = path.join(UPLOAD_DIR, r.path);
    if (!fs.existsSync(abs)) { await db.query("update product_media set sha256='missing' where id=$1", [r.id]); continue; }
    try { const h = await imageHashes(abs); await db.query('update product_media set sha256=$2, dhash=$3 where id=$1', [r.id, h.sha, h.dhash]); } catch { /* تجاوز */ }
  }
  return rows.length;
}

/**
 * يرفض حفظ منتج اسمه أو إحدى صوره مكررة مع منتج آخر (غير محذوف).
 * files: ملفات multer المرفوعة الآن. يعيد بصمات الملفات لحفظها مع الصور.
 */
export async function assertNoDuplicate(db, { name, files = [], excludeId = null }) {
  const n = normName(name);
  if (n) {
    const others = (await db.query('select id, sku, name from products where deleted_at is null and ($1::int is null or id <> $1)', [excludeId])).rows;
    const same = others.find((p) => normName(p.name) === n);
    if (same) throw conflict(`يوجد منتج بنفس الاسم: ${same.name} (${same.sku}) — غيّر الاسم أو عدّل المنتج الموجود`);
  }
  const hashes = [];
  for (const f of files) hashes.push(await imageHashes(f.path));
  // تكرار داخل نفس الرفع
  for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) {
    if (hashes[i].sha === hashes[j].sha || (hashes[i].dhash && hashes[j].dhash && hamming(hashes[i].dhash, hashes[j].dhash) <= SIMILAR)) throw conflict('رفعت نفس الصورة أكثر من مرة');
  }
  if (hashes.length) {
    await backfillMediaHashes(db);
    const media = (await db.query(`select m.sha256, m.dhash, p.sku, p.name from product_media m join products p on p.id=m.product_id
      where p.deleted_at is null and ($1::int is null or p.id <> $1) and m.sha256 is not null and m.sha256 <> 'missing'`, [excludeId])).rows;
    for (const h of hashes) {
      const hit = media.find((m) => m.sha256 === h.sha || (h.dhash && m.dhash && hamming(h.dhash, m.dhash) <= SIMILAR));
      if (hit) throw conflict(`هذه الصورة مستخدمة في منتج آخر: ${hit.name} (${hit.sku}) — تأكد أنك لا تضيف منتجاً مكرراً`);
    }
  }
  return hashes;
}
