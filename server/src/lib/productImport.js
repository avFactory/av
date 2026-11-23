// استيراد منتجات المتجر كمسودات (مخفية عن المتجر) من ملف ZIP للصور:
//   - كل صورة منتج، أو صور بنفس البادئة (r0050_0، r0050_1) لنفس المنتج
//   - ملف products.json اختياري: [{ images: [...], name, product_type, approx_weight, note }]
// المنتجات تُنشأ «مخفية» حتى يكمل المدير التفاصيل ثم يظهرها في المتجر.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { bad } from './http.js';
import { UPLOAD_DIR, relPath } from './uploads.js';
import { nextSku, PRODUCT_TYPES } from './sku.js';

const MAX_ENTRIES = 800, MAX_IMG = 15 * 1024 * 1024, MAX_TOTAL = 600 * 1024 * 1024;
const IMG = /\.(jpe?g|png|webp)$/i;
// التحقق من محتوى الصورة نفسها (لا يُقبل ملف آخر باسم صورة)
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.slice(0, 4).toString('hex') === '89504e47' ? 'image/png'
  : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : null);
const stem = (n) => path.basename(n).replace(/\.[^.]+$/, '').replace(/[_-]\d{1,2}$/, '');

export async function importDraftZip(db, req, zipFile, opts = {}) {
  let zip;
  try { zip = await JSZip.loadAsync(fs.readFileSync(zipFile)); } catch { throw bad('ملف ZIP غير صالح'); }
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name));
  if (entries.length > MAX_ENTRIES) throw bad(`الملف يحتوي ${entries.length} ملفاً — الحد ${MAX_ENTRIES}`);
  const byName = new Map(entries.map((f) => [path.basename(f.name), f]));
  let list = null;
  const manifest = entries.find((f) => /(^|\/)products\.json$/i.test(f.name));
  if (manifest) {
    try { list = JSON.parse(await manifest.async('string')); } catch { throw bad('ملف products.json غير صالح'); }
    if (!Array.isArray(list)) throw bad('ملف products.json يجب أن يكون قائمة');
  } else {
    const groups = new Map();
    for (const f of entries.filter((x) => IMG.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      const k = stem(f.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(path.basename(f.name));
    }
    list = [...groups.values()].map((images) => ({ images }));
  }
  if (!list.length) throw bad('لا توجد صور في الملف');
  const type0 = String(opts.product_type || 'تعليقة').trim();
  const karats = (Array.isArray(opts.karats) && opts.karats.length ? opts.karats : [21]).map(Number).filter((k) => [18, 21, 24].includes(k));
  const prefix = String(opts.name_prefix || '').trim();
  const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  let total = 0, n = 0;
  const created = [], skipped = [];
  const used = new Set((await db.query('select name from products where deleted_at is null')).rows.map((r) => r.name));
  for (const it of list) {
    const imgs = [];
    for (const name of (it.images || []).slice(0, 20)) {
      const f = byName.get(path.basename(String(name)));
      if (!f || !IMG.test(f.name)) continue;
      const buf = await f.async('nodebuffer');
      if (buf.length > MAX_IMG) { skipped.push({ image: name, reason: 'الصورة أكبر من 15MB' }); continue; }
      total += buf.length; if (total > MAX_TOTAL) throw bad('حجم الصور كبير جداً');
      const mime = sniff(buf);
      if (!mime) { skipped.push({ image: name, reason: 'ليست صورة صالحة' }); continue; }
      imgs.push({ buf, mime, name: path.basename(f.name) });
    }
    if (!imgs.length) { skipped.push({ image: (it.images || []).join('، '), reason: 'لا توجد صورة صالحة' }); continue; }
    const type = String(it.product_type || type0).trim() || type0;
    const known = PRODUCT_TYPES.some(([t, , re]) => t === type || re.test(type));
    // اسم مؤقت فريد (المدير يعدّله عند إكمال التفاصيل)
    let name = String(it.name || '').trim();
    if (!name) { do { n++; name = `${prefix || type} ${String(n).padStart(3, '0')}`; } while (used.has(name)); }
    else if (used.has(name)) { let k = 2; while (used.has(`${name} (${k})`)) k++; name = `${name} (${k})`; }
    used.add(name);
    const sku = await nextSku(db, known ? type : type0, { lock: true });
    const w = Number(it.approx_weight) > 0 && Number(it.approx_weight) < 10000 ? Number(it.approx_weight).toFixed(4) : null;
    const desc = ['مسودة مستوردة — أكمل التفاصيل ثم أظهر المنتج في المتجر.', it.note ? String(it.note).slice(0, 300) : null].filter(Boolean).join('\n');
    const p = (await db.query(`insert into products(sku, name, product_type, description, karats, colors, approx_weight, availability, active)
      values ($1,$2,$3,$4,$5,'{yellow}',$6,'made_to_order',false) returning id, sku, name`, [sku, name, known ? type : type0, desc, karats.length ? karats : [21], w])).rows[0];
    for (const [i, im] of imgs.entries()) {
      const fn = crypto.randomBytes(16).toString('hex') + (im.mime === 'image/png' ? '.png' : im.mime === 'image/webp' ? '.webp' : '.jpg');
      const abs = path.join(dir, fn);
      fs.writeFileSync(abs, im.buf);
      const rel = relPath(abs);
      await db.query('insert into files(path, original_name, mime, size, uploaded_by) values ($1,$2,$3,$4,$5)', [rel, im.name, im.mime, im.buf.length, req.user.id]);
      await db.query("insert into product_media(product_id, path, kind, sort, sha256, hash_v) values ($1,$2,'image',$3,$4,2)", [p.id, rel, i, crypto.createHash('sha256').update(im.buf).digest('hex')]);
    }
    created.push({ ...p, images: imgs.length });
  }
  return { created: created.length, products: created, skipped };
}
