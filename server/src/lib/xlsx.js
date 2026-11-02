import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO = [path.resolve(here, '../../../web/dist/logo.png'), path.resolve(here, '../../../web/public/logo.png')].find((p) => fs.existsSync(p));

/** تصدير Excel (xlsx) باتجاه من اليمين لليسار مع شعار واسم المصنع */
export async function sendXlsx(res, sheetName, columns, rows, filename) {
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
  const head = ws.addRow(columns.map((c) => c[0]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA8844A' } }; });
  for (const r of rows) ws.addRow(columns.map(([, k]) => (typeof k === 'function' ? k(r) : r[k] ?? '')));
  ws.columns.forEach((c) => { c.width = 18; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}
