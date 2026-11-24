import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO = [path.resolve(here, '../../../web/dist/logo.png'), path.resolve(here, '../../../web/public/logo.png')].find((p) => fs.existsSync(p));

/** تصدير Excel (xlsx) باتجاه من اليمين لليسار مع شعار واسم المصنع */
/**
 * opts.info: أسطر معلومات تحت الترويسة [[العنوان، القيمة]...] (مثل اسم العامل والفترة والرصيد)
 * opts.widths: عرض الأعمدة، opts.downloadName: اسم الملف بالعربي عند التنزيل
 */
export async function sendXlsx(res, sheetName, columns, rows, filename, opts = {}) {
  const company = (await pool.query("select value->>'name' n from settings where key='company'")).rows[0]?.n || 'مصنع AV للمجوهرات';
  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true }] });
  // ترويسة: الشعار + اسم المصنع + عنوان التقرير وتاريخه
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  ws.getRow(1).height = 26; ws.getRow(2).height = 22;
  ws.getCell('A1').value = company;
  ws.getCell('A1').font = { bold: true, size: 15 };
  ws.getCell('A2').value = `${sheetName} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF6E6B66' } };
  if (LOGO) {
    const img = wb.addImage({ buffer: fs.readFileSync(LOGO), extension: 'png' });
    ws.addImage(img, { tl: { col: Math.max(columns.length - 1, 1), row: 0 }, ext: { width: 70, height: 50 } });
  }
  for (const [k, [label, value]] of (opts.info || []).entries()) {
    const r = ws.addRow([label, safeCell(value ?? '')]);
    // السطر الأول (اسم العامل/العميل) بخط كبير
    r.getCell(1).font = { bold: true, color: { argb: 'FF6E6B66' }, size: k === 0 ? 13 : 11 };
    r.getCell(2).font = { bold: true, size: k === 0 ? 20 : 13 };
    if (k === 0) r.height = 32;
    ws.mergeCells(r.number, 2, r.number, Math.max(columns.length, 2));
  }
  if (opts.info?.length) ws.addRow([]);
  const head = ws.addRow(columns.map((c) => c[0]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA8844A' } }; });
  for (const r of rows) ws.addRow(columns.map(([, k]) => safeCell(typeof k === 'function' ? k(r) : r[k] ?? '')));
  ws.columns.forEach((c, i) => { c.width = opts.widths?.[i] || 18; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"${opts.downloadName ? `; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}` : ''}`);
  await wb.xlsx.write(res);
  res.end();
}

/** حماية من حقن المعادلات في Excel: نص يبدأ بـ = + - @ يُعرض كنص لا كمعادلة (أسماء العملاء والملاحظات من المستخدمين) */
export function safeCell(v) {
  if (typeof v !== 'string') return v;
  return /^[=+@\t\r]/.test(v) || /^-(?!\d+(\.\d+)?$)/.test(v) ? `'${v}` : v;
}
