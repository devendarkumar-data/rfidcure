// Vendor-wise PO numbering. Everything is read from the masters (Vendor Master, PO Series Config, Currency Master); nothing is hardcoded.
//   number = PREFIX/FY/SEQ(5)/SUFFIX   prefix = vendor's Custom PO Prefix, else PO (DEFAULT series shared by all such vendors)
import { CURRENCIES } from '../shared/po-options.js';
import { HttpError, bad, fyOf, sstr, toNum, unprocessable, withLock } from './util.js';
import { nextMasterId } from './crud.js';

const VENDOR = 'Vendor Master', SERIES = 'PO Series Config', CURR = 'Currency Master';
const SUFFIX = { domestic: 'DOM', import: 'IMP' }; const TYPE = { domestic: 'Domestic', import: 'Import' };
const active = (v) => !sstr(v) || /^active$/i.test(sstr(v));
const list = (v) => sstr(v).split(/[,;/|]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

export async function currencies(store) {
  let { rows } = await store.read(CURR);
  if (!rows.some((r) => sstr(r['Currency Code']))) { // first use: seed the Currency Master from the standard list (editable afterwards)
    const seed = [['INR', 'Indian Rupee', '₹'], ['USD', 'US Dollar', '$'], ['EUR', 'Euro', '€'], ['GBP', 'British Pound', '£'], ...CURRENCIES.filter(([c]) => !['USD', 'EUR', 'GBP'].includes(c)).map(([c, n]) => [c, n, ''])];
    for (const [c, n, sym] of seed) await store.append(CURR, [{ 'Master Id': await nextMasterId(store, { tab: CURR }), 'Currency Code': c, 'Currency Name': n, Symbol: sym, Status: 'Active' }]);
    rows = (await store.read(CURR, { fresh: true })).rows;
  }
  return rows.filter((r) => sstr(r['Currency Code']) && active(r.Status)).map((r) => ({ code: sstr(r['Currency Code']).toUpperCase(), name: sstr(r['Currency Name']), symbol: sstr(r.Symbol) }));
}

export async function vendorInfo(ctx, name) {
  const { rows } = await ctx.store.read(VENDOR, { fresh: true });
  const v = rows.find((r) => sstr(r['Vendor Name']).toLowerCase() === sstr(name).toLowerCase());
  const all = await currencies(ctx.store);
  if (!v) return { id: '', name: sstr(name), active: true, prefix: '', types: { domestic: true, import: true }, defaultCurrency: 'INR', currencies: all, unlisted: true }; // not in the master: default series, no restrictions const codes = new Set(all.map((c) => c.code));
  const codes = new Set(all.map((c) => c.code)); const allowedRaw = list(v['Allowed Currency']); const def = sstr(v['Default Currency']).toUpperCase();
  const allowed = (allowedRaw.length ? allowedRaw : (def ? [def] : [...codes])).filter((c) => codes.has(c));
  const pt = sstr(v['Allowed Purchase Type']).toLowerCase();
  return {
    id: sstr(v['Sup ID']) || sstr(v['Master Id']), name: sstr(v['Vendor Name']), active: active(v.Status), prefix: sstr(v['Custom PO Prefix']).toUpperCase(),
    types: { domestic: !pt || /domestic|both/.test(pt), import: !pt || /import|both/.test(pt) },
    defaultCurrency: codes.has(def) ? def : (allowed[0] || 'INR'), currencies: all.filter((c) => allowed.includes(c.code)),
  };
}

const fmt = (prefix, fy, seq, type) => `${prefix}/${fy}/${String(seq).padStart(5, '0')}/${SUFFIX[type]}`;

// Preview only (nothing is reserved).
export async function preview(ctx, name, type, date) {
  const v = await vendorInfo(ctx, name); checkVendor(v, type);
  const fy = fyOf(date); const { series } = await findSeries(ctx.store, v, type, fy);
  return { vendor: v, financialYear: fy, prefix: v.prefix || 'PO', next: fmt(v.prefix || 'PO', fy, (series ? toNum(series['Last Sequence']) : 0) + 1, type) };
}

function checkVendor(v, type) {
  if (!v.active) throw unprocessable(`Vendor ${v.name} is inactive and cannot be used for a new PO`);
  if (!v.types[type]) throw unprocessable(`Vendor ${v.name} is not set up for ${TYPE[type]} purchases (Allowed Purchase Type in Vendor Master)`);
}
async function findSeries(store, v, type, fy) {
  const { rows } = await store.read(SERIES, { fresh: true });
  const vid = v.prefix ? (v.id || v.name) : 'DEFAULT';
  const mine = rows.filter((r) => sstr(r['Vendor ID']).toUpperCase() === vid.toUpperCase() && sstr(r['Purchase Type']).toLowerCase() === TYPE[type].toLowerCase() && sstr(r['Financial Year']) === fy);
  return { vid, rows, series: mine.find((r) => active(r.Status)) || null, inactive: mine.length > 0 && !mine.some((r) => active(r.Status)) };
}

// Allocate the next number atomically (one lock for all series). The counter lives in the PO Series Config sheet row.
export function allocate(ctx, { vendor, type, date, existingNos }) {
  return withLock('po-series', async () => {
    const v = await vendorInfo(ctx, vendor); checkVendor(v, type);
    const fy = fyOf(date); const prefix = v.prefix || 'PO';
    const { vid, series, inactive } = await findSeries(ctx.store, v, type, fy);
    if (inactive) throw unprocessable(`PO series ${prefix}/${fy}/${SUFFIX[type]} is inactive - activate it in PO Series Config`);
    const taken = new Set(existingNos.map((n) => sstr(n).toUpperCase()));
    let last = series ? toNum(series['Last Sequence']) : 0;
    // a new series continues after numbers already issued with the same prefix / year / suffix (never reuses a number)
    const head = `${prefix}/${fy}/`.toUpperCase(); const tail = `/${SUFFIX[type]}`;
    for (const n of taken) if (n.startsWith(head) && n.endsWith(tail)) last = Math.max(last, parseInt(n.slice(head.length), 10) || 0);
    let seq = last + 1; while (taken.has(fmt(prefix, fy, seq, type).toUpperCase())) seq += 1;
    const no = fmt(prefix, fy, seq, type);
    const store = ctx.store;
    if (series) await store.updateRow(SERIES, series.__row, { 'Last Sequence': seq }, { col: 'Series ID', val: series['Series ID'] });
    else await store.append(SERIES, [{ 'Master Id': await nextMasterId(store, { tab: SERIES }), 'Series ID': `${vid}-${SUFFIX[type]}-${fy}`, 'Vendor ID': vid, 'PO Prefix': prefix, 'Purchase Type': TYPE[type], 'Financial Year': fy, 'Last Sequence': seq, Suffix: SUFFIX[type], Status: 'Active' }]);
    return { no, prefix, fy, seq, seriesVendorId: vid, vendor: v };
  });
}
