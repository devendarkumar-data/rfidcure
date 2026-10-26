// One-time: load data/opening_stock.json into the "Opening Stock" tab of your Google Sheet.
// Usage: copy .env.example to .env, fill it, then:  npm i && node -r dotenv/config scripts/seed.js   (or export the 3 variables and run: node scripts/seed.js)
const { google } = require('googleapis');
const data = require('../data/opening_stock.json');
const { GOOGLE_SHEET_ID: ID, GOOGLE_CLIENT_EMAIL: EMAIL } = process.env;
const KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
(async () => {
  if (!ID || !EMAIL || !KEY) throw new Error('Set GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY');
  const sh = google.sheets({ version: 'v4', auth: new google.auth.JWT(EMAIL, null, KEY, ['https://www.googleapis.com/auth/spreadsheets']) });
  const tab = 'Opening Stock';
  const meta = await sh.spreadsheets.get({ spreadsheetId: ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some(s => s.properties.title === tab))
    await sh.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
  await sh.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${tab}'!A:ZZ` });
  const head = ['Warehouse', 'Item Code', 'Item Name', 'Item Category Type Name', 'Batch Number', 'Quantity', 'Expiry Date', 'Brand Name', 'Stock Value'];
  const rows = Object.entries(data).flatMap(([w, d]) => d.map(([c, n, cat, b, q, ex, br, v]) => [w, c, n, cat, b, q, ex, br, v]));
  await sh.spreadsheets.values.update({ spreadsheetId: ID, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [head, ...rows.slice(0, 1000)] } });
  for (let i = 1000; i < rows.length; i += 1000)
    await sh.spreadsheets.values.append({ spreadsheetId: ID, range: `'${tab}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows.slice(i, i + 1000) } });
  console.log('Loaded', rows.length, 'opening-stock rows into tab "' + tab + '"');
})().catch(e => { console.error(e.message); process.exit(1); });
