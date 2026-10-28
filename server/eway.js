// E-Way Bill queue: dispatches (Imprest Out, Stock Transfer) that have no E-Way Bill yet. A dispatch is "covered" once an
// E-Way Bill (outward) carries its document number in Ref. Doc.
import { TABLE_BY_SLUG } from '../shared/registry.js';
import { assertCan, inScope, parseLines } from './access.js';
import { normDate, sstr, toNum } from './util.js';

const EWB = 'e-way-bill-outward';

export async function pending(ctx) {
  assertCan(ctx, TABLE_BY_SLUG[EWB], 'view');
  const t = (slug) => TABLE_BY_SLUG[slug];
  const [ewb, outs, trs] = await Promise.all([ctx.store.read(t(EWB).tab, { fresh: true }), ctx.store.read(t('imprest-out-new').tab, { fresh: true }), ctx.store.read(t('stock-transfer').tab, { fresh: true })]);
  const covered = new Set(ewb.rows.map((r) => sstr(r['Ref. Doc']).toUpperCase()).filter(Boolean));
  const rows = [];
  for (const o of outs.rows) {
    const doc = sstr(o.DocNo); if (!doc || covered.has(doc.toUpperCase())) continue;
    const ls = parseLines(o.Lines); if (ls.length && !ls.some((l) => !l.Warehouse || inScope(ctx, l.Warehouse))) continue;
    rows.push({ doc, type: 'Imprest Out', slug: 'imprest-out-new', date: normDate(o.Date), from: [...new Set(ls.map((l) => sstr(l.Warehouse)).filter(Boolean))].join(', '), to: sstr(o['To Warehouse']), party: sstr(o['Customer Account']), qty: ls.reduce((s, l) => s + toNum(l.Quantity), 0) });
  }
  for (const r of trs.rows) {
    const doc = sstr(r[t('stock-transfer').idCol]); if (!doc || covered.has(doc.toUpperCase())) continue;
    if (!inScope(ctx, r['From Warehouse']) && !inScope(ctx, r['To Warehouse'])) continue;
    rows.push({ doc, type: 'Stock Transfer', slug: 'stock-transfer', date: normDate(r.Date), from: sstr(r['From Warehouse']), to: sstr(r['To Warehouse']), party: '', qty: parseLines(r.Lines).reduce((s, l) => s + toNum(l.Quantity), 0) });
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.doc.localeCompare(b.doc));
  return { rows };
}
