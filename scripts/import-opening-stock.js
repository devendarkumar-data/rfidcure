// Loads an APPROVED opening-stock workbook (sheet "Opening Stock", template headers) into the Google Sheet.
//   npm run import-opening-stock -- path/to/Opening_Stock.xlsx --confirm
// Safety: refuses to replace opening stock once the Stock Ledger has postings (unless --force), because balances would shift.
import ExcelJS from 'exceljs';
import { sheetsStore, flag } from './_env.js';
import { HEADERS_BY_TAB } from '../shared/registry.js';
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('Usage: npm run import-opening-stock -- <file.xlsx> --confirm'); process.exit(1); }
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
const ws = wb.getWorksheet('Opening Stock'); if (!ws) { console.error('Sheet "Opening Stock" not found in the workbook'); process.exit(1); }
const want = HEADERS_BY_TAB['Opening Stock'];
const head = ws.getRow(1).values.slice(1).map(String);
if (head.join('|') !== want.join('|')) { console.error(`Header mismatch.\n expected: ${want.join(' | ')}\n found   : ${head.join(' | ')}`); process.exit(1); }
const rows = []; const bad = [];
ws.eachRow((r, n) => {
  if (n === 1) return; const v = r.values.slice(1); if (!v[0]) return;
  const o = Object.fromEntries(want.map((h, i) => [h, v[i] instanceof Date ? v[i].toISOString().slice(0, 10) : (v[i]?.result ?? v[i] ?? '')]));
  if (typeof o.Quantity !== 'number') bad.push(`row ${n}: Quantity is not a number`);
  if (o.Quantity < 0) bad.push(`row ${n}: negative quantity (${o['Item Code']} / ${o['Batch Number']})`);
  rows.push(o);
});
console.log(`${rows.length} rows read; ${bad.length} problem(s).`); bad.slice(0, 20).forEach((b) => console.log('  ' + b));
if (bad.length && !flag('force')) { console.error('Fix the file or pass --force to import anyway.'); process.exit(1); }
if (!flag('confirm')) { console.log('Dry run only. Add --confirm to write to the sheet.'); process.exit(0); }
const store = await sheetsStore();
const ledger = await store.read('Stock Ledger');
if (ledger.rows.length && !flag('force')) { console.error(`Stock Ledger has ${ledger.rows.length} postings; replacing opening stock would change balances. Use --force only if you understand this.`); process.exit(1); }
await store.clearData('Opening Stock');
for (let i = 0; i < rows.length; i += 500) { await store.append('Opening Stock', rows.slice(i, i + 500)); process.stdout.write(`\r${Math.min(i + 500, rows.length)}/${rows.length}`); }
console.log('\nOpening stock imported.');
