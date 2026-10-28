// Imprest settlement: an Imprest Out stays "pending" until it is settled. Lines marked as consumed become a Consumption
// (against a bill); everything else is returned as an Imprest In. Every In / Consumption carries the Imprest Ref of the Out it settles,
// so each Imprest Out has a complete trail: Out -> In(s) -> Consumption(s).
import { TABLE_BY_SLUG } from '../shared/registry.js';
import { assertCan, inScope, parseLines } from './access.js';
import { audit } from './audit.js';
import { createRecord, imprestLinked } from './crud.js';
import { HttpError, bad, notFound, normDate, sstr, today, toNum, unprocessable } from './util.js';

const OUT = 'imprest-out-new', IN = 'imprest-in-new', CONS = 'material-consumption';
const gkey = (code, batch) => `${sstr(code)}|${sstr(batch)}`;
const rq = (n) => Math.round(n * 1e6) / 1e6;

async function load(ctx) {
  const t = (slug) => TABLE_BY_SLUG[slug];
  const [outs, ins, cons, led] = await Promise.all([ctx.store.read(t(OUT).tab, { fresh: true }), ctx.store.read(t(IN).tab, { fresh: true }), ctx.store.read(t(CONS).tab, { fresh: true }), ctx.store.read('Stock Ledger', { fresh: true })]);
  return { outs: outs.rows, ins: ins.rows, cons: cons.rows, ledger: led.rows };
}

// Dispatched / settled / balance per item+batch of one Imprest Out.
function position(out, ins, cons) {
  const ref = sstr(out.DocNo);
  const groups = new Map();
  for (const l of parseLines(out.Lines)) {
    const k = gkey(l['Item Code'], l.Batch); const g = groups.get(k) || { key: k, code: sstr(l['Item Code']), name: sstr(l.Items || l.Item || l.Description), batch: sstr(l.Batch), expiry: normDate(l['Expiry Date']) || '', warehouse: sstr(l.Warehouse), dispatched: 0, returned: 0, consumed: 0 };
    g.dispatched = rq(g.dispatched + toNum(l.Quantity)); groups.set(k, g);
  }
  for (const d of ins.filter((r) => sstr(r['Imprest Ref']) === ref)) for (const l of parseLines(d.Lines)) { const g = groups.get(gkey(l['Item Code'], l.Batch)); if (g) g.returned = rq(g.returned + toNum(l.Quantity)); }
  for (const d of cons.filter((r) => sstr(r['Imprest Ref']) === ref)) for (const l of parseLines(d.Lines)) { const g = groups.get(gkey(l['Item Code'], l.Batch)); if (g) g.consumed = rq(g.consumed + toNum(l.Quantity)); }
  const lines = [...groups.values()].map((g) => ({ ...g, balance: rq(g.dispatched - g.returned - g.consumed) }));
  const total = (k) => rq(lines.reduce((s, g) => s + g[k], 0));
  const balance = total('balance');
  return { ref, date: normDate(out.Date), hospital: sstr(out['To Warehouse']), customer: sstr(out['Customer Account']), deliveryDate: normDate(out['Delivery Date']), lines, dispatched: total('dispatched'), returned: total('returned'), consumed: total('consumed'), balance, status: balance <= 0 ? 'Settled' : (total('returned') + total('consumed') > 0 ? 'Partly settled' : 'Pending') };
}
const mine = (ctx, p) => p.lines.some((l) => !l.warehouse || inScope(ctx, l.warehouse));

export async function pending(ctx) {
  assertCan(ctx, TABLE_BY_SLUG[OUT], 'view');
  const { outs, ins, cons } = await load(ctx);
  const rows = outs.filter((o) => sstr(o.DocNo)).map((o) => position(o, ins, cons)).filter((p) => p.balance > 0 && mine(ctx, p));
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ref.localeCompare(b.ref));
  return { rows };
}

export async function trail(ctx, ref) {
  assertCan(ctx, TABLE_BY_SLUG[OUT], 'view');
  const { outs, ins, cons, ledger } = await load(ctx);
  const out = outs.find((o) => sstr(o.DocNo) === sstr(ref)); if (!out) throw notFound('Imprest Out not found');
  const p = position(out, ins, cons); if (!mine(ctx, p)) throw new HttpError(403, 'Not your imprest');
  const who = (no) => sstr(ledger.find((r) => sstr(r.Doc) === no)?.User);
  const when = (no) => normDate(ledger.find((r) => sstr(r.Doc) === no)?.Date) || '';
  const sum = (d) => parseLines(d.Lines).reduce((s, l) => s + toNum(l.Quantity), 0);
  const events = [
    { type: 'Imprest Out', no: p.ref, date: p.date, qty: p.dispatched, by: who(p.ref), note: `Dispatched to ${p.hospital}` },
    ...ins.filter((d) => sstr(d['Imprest Ref']) === p.ref).map((d) => ({ type: 'Imprest In', no: sstr(d.DocNo), date: normDate(d.Date), qty: rq(sum(d)), by: who(sstr(d.DocNo)), note: 'Returned to warehouse' })),
    ...cons.filter((d) => sstr(d['Imprest Ref']) === p.ref).map((d) => ({ type: 'Consumption', no: sstr(d['Document No']), date: normDate(d.Date) || when(sstr(d['Document No'])), qty: rq(sum(d)), by: who(sstr(d['Document No'])), note: `Against bill ${sstr(d['Bill No'])}`.trim() })),
  ];
  return { position: p, events };
}

// body: { ref, date?, narration?, lines: [{ key, returned }] }  - the quantity TAKEN BACK per item/batch; the remainder is consumed (posted as a
// Consumption that waits for its bill: it shows in Consumption Pending until Bill No / Bill Date are updated).
export async function settle(ctx, body, idem) {
  const ref = sstr(body?.ref); if (!ref) throw bad('Choose the Imprest Out to settle');
  const { outs, ins, cons } = await load(ctx);
  const out = outs.find((o) => sstr(o.DocNo) === ref); if (!out) throw notFound('Imprest Out not found');
  const p = position(out, ins, cons); if (!mine(ctx, p)) throw new HttpError(403, 'This imprest was not dispatched from your warehouse');
  if (p.balance <= 0) throw unprocessable(`${ref} is already fully settled`);
  const want = new Map((Array.isArray(body.lines) ? body.lines : []).map((l) => [sstr(l.key), toNum(l.returned)]));
  const back = [], used = [];
  for (const g of p.lines) {
    if (g.balance <= 0) continue;
    const r = want.get(g.key) || 0;
    if (r < 0 || !Number.isFinite(r)) throw bad(`${g.code}: returned quantity is not valid`);
    if (r > g.balance + 1e-9) throw unprocessable(`${g.code} (batch ${g.batch}): returned ${r} is more than the ${g.balance} pending`);
    const c = rq(g.balance - r);
    if (c > 0) used.push({ 'Consumption Type': 'Against Bill', 'Item Code': g.code, Quantity: c, Batch: g.batch });
    if (r > 0) back.push({ Warehouse: g.warehouse, 'Item Code': g.code, Quantity: r, Batch: g.batch });
  }
  const billNo = sstr(body.billNo);
  const key = (sfx) => (idem ? `${String(idem).replace(/[^A-Za-z0-9-]/g, '').slice(0, 56)}-${sfx}` : undefined);
  const date = normDate(body.date) || today(); const result = { ref, inDoc: null, consumptionDoc: null };
  if (back.length) {
    const r = await createRecord(ctx, TABLE_BY_SLUG[IN], { header: { Date: date, 'To Warehouse': p.hospital, 'Imprest Ref': ref, 'Narration / Notes': sstr(body.narration) || `Return against ${ref}` }, lines: back }, key('in'));
    result.inDoc = r.id;
  }
  if (used.length) {
    try {
      const r = await createRecord(ctx, TABLE_BY_SLUG[CONS], { header: { Warehouse: p.hospital, 'Imprest Ref': ref, 'Bill Status': billNo ? 'Billed' : 'Pending Bill', ...(billNo ? { 'Bill No': billNo } : {}), ...(sstr(body.billDate) ? { 'Bill Date': normDate(body.billDate) } : {}), 'Narration / Notes': sstr(body.narration) || `Consumed against ${ref}` }, lines: used }, key('cons'));
      result.consumptionDoc = r.id;
    } catch (e) { e.message = `${result.inDoc ? `Return ${result.inDoc} was posted, but the consumption failed: ` : ''}${e.message}`; throw e; }
  }
  return { ...result, summary: { returned: rq(back.reduce((s, l) => s + l.Quantity, 0)), consumed: rq(used.reduce((s, l) => s + l.Quantity, 0)) }, trail: await trail(ctx, ref) };
}

// ---- Consumption pending (bill not yet updated) / register (billed) ------------------------------------------------
const billStatus = (r) => sstr(r['Bill Status']) || (sstr(r['Bill No']) ? 'Billed' : 'Pending Bill');
export async function consumptionList(ctx, status) {
  assertCan(ctx, TABLE_BY_SLUG[CONS], 'view');
  const { cons, ledger } = await load(ctx);
  const rows = [];
  for (const d of cons) {
    const no = sstr(d['Document No']); if (!no) continue;
    const st = billStatus(d); if (status === 'pending' ? st !== 'Pending Bill' : st === 'Pending Bill') continue;
    if (!(await imprestLinked(ctx, d.Warehouse, ledger))) continue;
    const ls = parseLines(d.Lines);
    rows.push({ no, ref: sstr(d['Imprest Ref']), hospital: sstr(d.Warehouse), date: normDate(ledger.find((r) => sstr(r.Doc) === no)?.Date) || '', by: sstr(ledger.find((r) => sstr(r.Doc) === no)?.User), items: ls.map((l) => `${sstr(l['Item Code'])} ${sstr(l.Items || l.Item || l.Description)} (batch ${sstr(l.Batch)}) x ${toNum(l.Quantity)}`.replace('  ', ' ')), qty: rq(ls.reduce((s, l) => s + toNum(l.Quantity), 0)), billNo: sstr(d['Bill No']), billDate: normDate(d['Bill Date']) || '', status: st });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.no.localeCompare(a.no));
  return { rows };
}

export async function updateBill(ctx, body) {
  const table = TABLE_BY_SLUG[CONS]; assertCan(ctx, table, 'edit');
  const no = sstr(body?.doc), billNo = sstr(body?.billNo);
  if (!billNo) throw bad('Bill No is required');
  const { cons, ledger } = await load(ctx);
  const row = cons.find((d) => sstr(d['Document No']) === no); if (!row) throw notFound('Consumption not found');
  if (!(await imprestLinked(ctx, row.Warehouse, ledger))) throw new HttpError(403, 'Not your warehouse');
  const patch = { 'Bill No': billNo, 'Bill Date': normDate(body.billDate) || today(), 'Bill Status': 'Billed' };
  await ctx.store.updateRow(table.tab, row.__row, patch, { col: table.idCol, val: no });
  await audit(ctx.store, { user: ctx.user, module: table.tab, doc: no, action: 'Update', prev: { 'Bill No': sstr(row['Bill No']), 'Bill Status': billStatus(row) }, next: patch });
  return { ok: true, doc: no, ...patch };
}

// ---- Imprest Out / Imprest In registers (one row per item line) ---------------------------------------------------
export async function register(ctx, type) {
  assertCan(ctx, TABLE_BY_SLUG[OUT], 'view');
  const { outs, ins, cons, ledger } = await load(ctx);
  const who = (no) => sstr(ledger.find((r) => sstr(r.Doc) === no)?.User);
  const rows = [];
  if (type === 'out') {
    for (const o of outs.filter((x) => sstr(x.DocNo))) {
      const p = position(o, ins, cons); if (!mine(ctx, p)) continue;
      for (const l of parseLines(o.Lines)) rows.push({ no: p.ref, date: p.date, hospital: p.hospital, deliveryDate: p.deliveryDate || '', code: sstr(l['Item Code']), name: sstr(l.Items || l.Item || l.Description), batch: sstr(l.Batch), expiry: normDate(l['Expiry Date']) || '', qty: toNum(l.Quantity), status: p.status, by: who(p.ref) });
    }
  } else {
    for (const d of ins.filter((x) => sstr(x.DocNo))) {
      const ls = parseLines(d.Lines); if (!ls.some((l) => !sstr(l.Warehouse) || inScope(ctx, l.Warehouse))) continue;
      for (const l of ls) rows.push({ no: sstr(d.DocNo), date: normDate(d.Date), hospital: sstr(d['To Warehouse']), ref: sstr(d['Imprest Ref']), code: sstr(l['Item Code']), name: sstr(l.Items || l.Item || l.Description), batch: sstr(l.Batch), expiry: normDate(l['Expiry Date']) || '', qty: toNum(l.Quantity), warehouse: sstr(l.Warehouse), by: who(sstr(d.DocNo)) });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.no.localeCompare(a.no));
  return { rows };
}
