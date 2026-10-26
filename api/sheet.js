// Vercel serverless function: reads/appends rows in a Google Sheet. One tab per ERP screen / master / ledger.
const { google } = require('googleapis');
const ID = process.env.GOOGLE_SHEET_ID;
const clean = t => String(t || '').replace(/[\\\/\?\*\[\]:']/g, '').slice(0, 90);
const client = () => {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL, null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']);
  return google.sheets({ version: 'v4', auth });
};
module.exports = async (req, res) => {
  if (!ID || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY)
    return res.status(503).json({ error: 'Google Sheets not configured' });
  try {
    const sh = client();
    if (req.method === 'GET') {
      const tab = clean(req.query.tab);
      let values = [];
      try { values = (await sh.spreadsheets.values.get({ spreadsheetId: ID, range: `'${tab}'!A:ZZ` })).data.values || []; } catch (e) {}
      const [head = [], ...body] = values;
      return res.status(200).json({ rows: body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) });
    }
    if (req.method === 'POST') {
      const { tab: t, row, rows, replace } = req.body || {};
      const tab = clean(t), list = Array.isArray(rows) ? rows : row ? [row] : null;
      if (!tab || !list || !list.length || typeof list[0] !== 'object') return res.status(400).json({ error: 'tab and row(s) required' });
      const meta = await sh.spreadsheets.get({ spreadsheetId: ID, fields: 'sheets.properties.title' });
      if (!meta.data.sheets.some(s => s.properties.title === tab))
        await sh.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
      let head = [];
      if (replace) await sh.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${tab}'!A:ZZ` });
      else { try { head = ((await sh.spreadsheets.values.get({ spreadsheetId: ID, range: `'${tab}'!1:1` })).data.values || [[]])[0] || []; } catch (e) {} }
      if (!head.length) {
        head = Object.keys(list[0]);
        await sh.spreadsheets.values.update({ spreadsheetId: ID, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [head] } });
      }
      const cell = v => (v === false ? 'No' : v === true ? 'Yes' : v ?? '');
      await sh.spreadsheets.values.append({ spreadsheetId: ID, range: `'${tab}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
        requestBody: { values: list.map(r => head.map(h => cell(r[h]))) } });
      return res.status(200).json({ ok: true, rows: list.length });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
