import ExcelJS from 'exceljs';

/** تصدير Excel (xlsx) باتجاه من اليمين لليسار */
export async function sendXlsx(res, sheetName, columns, rows, filename) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true }] });
  ws.addRow(columns.map((c) => c[0])).font = { bold: true };
  for (const r of rows) ws.addRow(columns.map(([, k]) => (typeof k === 'function' ? k(r) : r[k] ?? '')));
  ws.columns.forEach((c) => { c.width = 18; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}
