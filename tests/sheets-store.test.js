import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetsStore } from '../server/store/sheets.js';
import { HEADERS_BY_TAB } from '../shared/registry.js';

// A tiny fake of the Google Sheets v4 client: enough to prove our A1 ranges, header checks, updates and deletes.
function fakeClient() {
  const tabs = new Map(); const ids = new Map(); const calls = [];
  const colIdx = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const parse = (range) => {
    const m = /^'(.+)'!(?:([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?|(\d+):(\d+))$/.exec(range); if (!m) throw new Error('bad range ' + range);
    return { tab: m[1], r1: m[6] ? +m[6] : m[3] ? +m[3] : 1, r2: m[7] ? +m[7] : m[5] ? +m[5] : m[3] ? +m[3] : Infinity, c2: m[4] ? colIdx(m[4]) : Infinity };
  };
  const api = { spreadsheets: {
    get: async () => ({ data: { sheets: [...tabs.keys()].map((t) => ({ properties: { title: t, sheetId: ids.get(t) } })) } }),
    batchUpdate: async ({ requestBody }) => { for (const r of requestBody.requests) {
      if (r.addSheet) { const t = r.addSheet.properties.title; tabs.set(t, []); ids.set(t, ids.size + 1); calls.push(['add', t]); }
      if (r.deleteDimension) { const t = [...ids].find(([, id]) => id === r.deleteDimension.range.sheetId)[0]; tabs.get(t).splice(r.deleteDimension.range.startIndex, 1); calls.push(['delete', t, r.deleteDimension.range.startIndex + 1]); }
    } return {}; },
    values: {
      get: async ({ range }) => { const p = parse(range); const rows = tabs.get(p.tab).slice(p.r1 - 1, p.r2 === Infinity ? undefined : p.r2); return { data: { values: rows.map((r) => r.slice(0, p.c2 === Infinity ? undefined : p.c2)) } }; },
      update: async ({ range, requestBody }) => { const p = parse(range); const t = tabs.get(p.tab); requestBody.values.forEach((v, i) => { t[p.r1 - 1 + i] = v; }); calls.push(['update', range]); return {}; },
      append: async ({ range, requestBody, valueInputOption }) => { assert.equal(valueInputOption, 'RAW'); tabs.get(parse(range).tab).push(...requestBody.values); return {}; },
      clear: async ({ range }) => { const p = parse(range); tabs.get(p.tab).splice(p.r1 - 1); return {}; },
    } } };
  return { api, tabs, calls };
}

test('SheetsStore against a fake Sheets API', async () => {
  const f = fakeClient(); const s = new SheetsStore({ sheetId: 'x', client: f.api, ttlMs: 0 });
  await s.ensure('Users');
  assert.deepEqual(f.tabs.get('Users')[0], HEADERS_BY_TAB.Users, 'missing tab is created with the exact template header');
  await s.append('Users', [{ 'User ID': 'a', 'User Name': 'A', Role: 'Admin', Branch: '', Status: 'Active' }, { 'User ID': 'b', 'User Name': 'B', Role: 'Admin', Branch: '', Status: 'Active' }]);
  let r = await s.read('Users'); assert.equal(r.rows.length, 2); assert.equal(r.rows[1].__row, 3); assert.equal(r.rows[1]['User ID'], 'b');
  await s.updateRow('Users', 3, { Status: 'Inactive' }, { col: 'User ID', val: 'b' });
  assert.equal((await s.read('Users')).rows[1].Status, 'Inactive'); assert.equal((await s.read('Users')).rows[1]['User Name'], 'B', 'other columns untouched');
  await assert.rejects(s.updateRow('Users', 2, { Status: 'x' }, { col: 'User ID', val: 'b' }), /changed by someone else/);
  await assert.rejects(s.updateRow('Users', 9, { Status: 'x' }), /no longer exists/);
  await s.deleteRow('Users', 2, { col: 'User ID', val: 'a' });
  r = await s.read('Users'); assert.equal(r.rows.length, 1); assert.equal(r.rows[0]['User ID'], 'b'); assert.equal(r.rows[0].__row, 2, 'row numbers shift, ids are looked up each time');
  await assert.rejects(s.read('Not A Registered Tab'), /not registered/);
  const bad = fakeClient(); bad.tabs.set('Users', [['User ID', 'WRONG']]); bad.api.spreadsheets.get = async () => ({ data: { sheets: [{ properties: { title: 'Users', sheetId: 1 } }] } });
  await assert.rejects(new SheetsStore({ sheetId: 'x', client: bad.api }).ensure('Users'), /does not match the approved template/);
  const chk = await new SheetsStore({ sheetId: 'x', client: bad.api }).checkAll();
  assert.equal(chk.find((c) => c.tab === 'Users').status, 'mismatch'); assert.equal(chk.find((c) => c.tab === 'Credentials').status, 'missing');
  await s.append('Users', [{ 'User ID': 'z', 'User Name': 'big', Role: 'Admin', Branch: '', Status: 'Active', 'Last Login': '' }]);
  await assert.rejects(s.append('Audit Logs', [{ Remarks: 'x'.repeat(50001) }]), /too large/);
});
