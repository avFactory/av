// منع تكرار المنتجات: نفس الاسم (بعد توحيد الكتابة العربية) أو نفس الصورة
// الصورة: بصمة الملف (sha256) للتطابق التام + بصمة بصرية (dHash 64-bit) لنفس الصورة بعد إعادة الحفظ/تغيير الحجم.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { conflict, HttpError } from './http.js';
import { UPLOAD_DIR } from './uploads.js';

/** توحيد الاسم: الهمزات، التاء المربوطة، الألف المقصورة، التشكيل، التطويل، المسافات */
export function normName(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

// البصمة البصرية: تُقص الخلفية (صور المنتجات على خلفية بيضاء) ثم بصمة فروق 16×16 = 256 بت.
// تُعتبر الصورتان متشابهتين إذا اختلف أقل من 10 بت من 256 — وصورة المنتج المختلف فعلاً تختلف بعشرات البتات.
const SIMILAR = 10;
const MIN_BITS = 24; // بصمة شبه فارغة (صورة بلا تفاصيل) لا يُعتمد عليها
const V = 'v2:';

export async function imageHashes(absPath) {
  const buf = await fs.promises.readFile(absPath);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  let dhash = null;
  try {
    const base = sharp(buf, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).grayscale();
    // قص الخلفية ثم تنعيم وتصغير إلى 17×16 — حتى لا تؤثر دقة الصورة أو ضغطها على البصمة
    const fp = (img) => img.resize(68, 64, { fit: 'fill' }).blur(2).resize(17, 16, { fit: 'fill', kernel: 'linear' }).raw().toBuffer();
    let px;
    try { px = await fp(base.clone().trim({ threshold: 18 })); } catch { px = await fp(base.clone()); }
    let bits = 0n, ones = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const b = px[y * 17 + x] > px[y * 17 + x + 1] ? 1n : 0n;
      bits = (bits << 1n) | b; ones += Number(b);
    }
    if (ones >= MIN_BITS && ones <= 256 - MIN_BITS) dhash = V + bits.toString(16).padStart(64, '0');
  } catch { /* ليست صورة (فيديو): بصمة الملف فقط */ }
  return { sha, dhash };
}

/** تشابه بصري (وليس نفس الملف): يمكن للموظف التأكيد والحفظ */
function similar(msg) { return new HttpError(409, `${msg} — إذا كان منتجاً مختلفاً اختر «حفظ رغم التشابه»`, { similar_image: true }); }

const hamming = (a, b) => { if (!a?.startsWith(V) || !b?.startsWith(V)) return 999; let x = BigInt(`0x${a.slice(V.length)}`) ^ BigInt(`0x${b.slice(V.length)}`); let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/** حساب البصمات للصور القديمة التي لم تُحسب (مرة واحدة، في الخلفية) */
export async function backfillMediaHashes(db) {
  const rows = (await db.query("select id, path from product_media where sha256 is null or (sha256 <> 'missing' and (dhash is null or dhash not like 'v2:%') and coalesce(hash_v,0) < 2) order by id limit 5000")).rows;
  for (const r of rows) {
    const abs = path.join(UPLOAD_DIR, r.path);
    if (!fs.existsSync(abs)) { await db.query("update product_media set sha256='missing' where id=$1", [r.id]); continue; }
    try { const h = await imageHashes(abs); await db.query('update product_media set sha256=$2, dhash=$3, hash_v=2 where id=$1', [r.id, h.sha, h.dhash]); } catch { /* تجاوز */ }
  }
  return rows.length;
}

/**
 * يرفض حفظ منتج اسمه أو إحدى صوره مكررة مع منتج آخر (غير محذوف).
 * files: ملفات multer المرفوعة الآن. يعيد بصمات الملفات لحفظها مع الصور.
 */
export async function assertNoDuplicate(db, { name, files = [], excludeId = null, allowSimilar = false }) {
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
    if (hashes[i].sha === hashes[j].sha) throw conflict('رفعت نفس الصورة أكثر من مرة');
    if (!allowSimilar && hamming(hashes[i].dhash, hashes[j].dhash) <= SIMILAR) throw similar('صورتان من المرفوعة متشابهتان جداً');
  }
  if (hashes.length) {
    await backfillMediaHashes(db);
    const media = (await db.query(`select m.sha256, m.dhash, p.sku, p.name from product_media m join products p on p.id=m.product_id
      where p.deleted_at is null and ($1::int is null or p.id <> $1) and m.sha256 is not null and m.sha256 <> 'missing'`, [excludeId])).rows;
    for (const h of hashes) {
      const same = media.find((m) => m.sha256 === h.sha);
      if (same) throw conflict(`هذه الصورة مستخدمة في منتج آخر: ${same.name} (${same.sku}) — تأكد أنك لا تضيف منتجاً مكرراً`);
      const near = allowSimilar ? null : media.find((m) => hamming(h.dhash, m.dhash) <= SIMILAR);
      if (near) throw similar(`الصورة تشبه صورة المنتج ${near.name} (${near.sku})`);
    }
  }
  return hashes;
}
