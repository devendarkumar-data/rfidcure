// Builds .xlsx downloads (reports, exports, templates) in memory.
import ExcelJS from 'exceljs';

export async function toXlsx(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Cure ERP';
  const ws = wb.addWorksheet(String(sheetName).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.addRow(columns);
  const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4A8F' } }; });
  for (const r of rows) ws.addRow(columns.map((c) => { const v = r[c]; return typeof v === 'string' && /^[=+@-]/.test(v) ? `'${v}` : v ?? ''; }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(50, Math.max(12, String(c).length + 4)); });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
