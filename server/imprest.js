// Imprest flow: Out -> Imprest In (quantity taken back, entered on Imprest In Pending) -> Consumption (remainder, entered manually from Consumption Pending, with bill).
// Every In / Consumption carries the Imprest Ref of its Out, so each Out has a complete trail. Statuses: Pending Return / Pending Consumption / Closed.
import { TABLE_BY_SLUG } from '../shared/registry.js';
import { assertCan, inScope, parseLines } from './access.js';
import { audit } from './audit.js';
import { createRecord, hospitalSet, imprestLinked } from './crud.js';
import { keyOf, loadStock } from './stock.js';
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
  const hasIn = ins.some((r) => sstr(r['Imprest Ref']) === ref) || /^yes$/i.test(sstr(out['Return Closed']));
  return { ref, date: normDate(out.Date), hospital: sstr(out['To Warehouse']), customer: sstr(out['Customer Account']), deliveryDate: normDate(out['Delivery Date']), lines, dispatched: total('dispatched'), returned: total('returned'), consumed: total('consumed'), balance, hasIn, status: balance <= 0 ? 'Closed' : 'Open' };
}
const mine = (ctx, p) => p.lines.some((l) => !l.warehouse || inScope(ctx, l.warehouse));

// Imprest In / Consumption are entered manually against an Imprest Out voucher: the voucher must exist, belong to that hospital,
// and each item / batch may not exceed what is still open on it. Nothing is consumed automatically.
export async function validateVoucher(ctx, kind, header, lines) {
  const ref = sstr(header['Imprest Ref']);
  const hospital = sstr(kind === 'in' ? header['To Warehouse'] : header.Warehouse);
  if (!ref) { if (kind === 'cons' && (await hospitalSet(ctx.store)).has(hospital.toUpperCase())) throw unprocessable('Select the Imprest Out voucher this consumption belongs to'); return; }
  const { outs, ins, cons } = await load(ctx);
  const out = outs.find((o) => sstr(o.DocNo) === ref); if (!out) throw unprocessable(`Imprest voucher ${ref} was not found`);
  const p = position(out, ins, cons);
  if (hospital && hospital.toUpperCase() !== p.hospital.toUpperCase()) throw unprocessable(`Voucher ${ref} belongs to ${p.hospital}, not ${hospital}`);
  const used = new Map();
  for (const l of lines) { const k = gkey(l['Item Code'], l.Batch); used.set(k, rq((used.get(k) || 0) + toNum(l.Quantity))); }
  for (const [k, q] of used) {
    const [code, batch] = k.split('|');
    const open = p.lines.filter((g) => g.code === code && (!batch || g.batch === batch));
    if (!open.length) throw unprocessable(`${code}${batch ? ` (batch ${batch})` : ''} is not on voucher ${ref}`);
    const bal = rq(open.reduce((s, g) => s + g.balance, 0));
    if (q > bal + 1e-9) throw unprocessable(`${code}${batch ? ` (batch ${batch})` : ''}: ${q} is more than the ${bal} still open on voucher ${ref}`);
  }
}

export async function pending(ctx) {
  assertCan(ctx, TABLE_BY_SLUG[OUT], 'view');
  const { outs, ins, cons } = await load(ctx);
  const rows = outs.filter((o) => sstr(o.DocNo)).map((o) => position(o, ins, cons)).filter((p) => p.balance > 0 && mine(ctx, p));
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ref.localeCompare(b.ref));
  return { rows };
}

// Imprest Outs whose stock was taken back (Imprest In done) and whose remainder still has to be entered as consumption.
export async function consumptionQueue(ctx) {
  assertCan(ctx, TABLE_BY_SLUG[CONS], 'view');
  const { outs, ins, cons } = await load(ctx);
  const rows = outs.filter((o) => sstr(o.DocNo)).map((o) => position(o, ins, cons)).filter((p) => p.balance > 0 && mine(ctx, p));
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ref.localeCompare(b.ref));
  // stock actually at the hospital now: lower than the balance if it was consumed through a document not linked to this Imprest
  const { balances, ledger } = await loadStock(ctx.store, { fresh: true });
  for (const p of rows) for (const l of p.lines) {
    l.onHand = balances.get(keyOf(p.hospital, l.code, l.batch))?.qty || 0;
    if (l.onHand < l.balance) l.movements = ledger.filter((r) => keyOf(r.Warehouse, r['Item Code'], r['Batch Number']) === keyOf(p.hospital, l.code, l.batch)).map((r) => ({ date: normDate(r.Date), type: sstr(r.Type), doc: sstr(r.Doc), qty: toNum(r.Quantity) }));
  }
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

// Imprest In: body { ref, date?, narration?, lines: [{ key, returned }] } - the quantity TAKEN BACK per item/batch.
// Can be entered several times (part returns or one lump sum) until the Imprest Out has no balance; consumption is entered separately.
export async function receive(ctx, body, idem) {
  const ref = sstr(body?.ref); if (!ref) throw bad('Choose the Imprest Out');
  const { outs, ins, cons } = await load(ctx);
  const out = outs.find((o) => sstr(o.DocNo) === ref); if (!out) throw notFound('Imprest Out not found');
  const p = position(out, ins, cons); if (!mine(ctx, p)) throw new HttpError(403, 'This imprest was not dispatched from your warehouse');
  if (p.balance <= 0) throw unprocessable(`${ref} is already closed`);
  const want = new Map((Array.isArray(body.lines) ? body.lines : []).map((l) => [sstr(l.key), toNum(l.returned)]));
  const back = [];
  for (const g of p.lines) {
    if (g.balance <= 0) continue;
    const r = want.get(g.key) || 0;
    if (r < 0 || !Number.isFinite(r)) throw bad(`${g.code}: returned quantity is not valid`);
    if (r > g.balance + 1e-9) throw unprocessable(`${g.code} (batch ${g.batch}): returned ${r} is more than the ${g.balance} dispatched`);
    if (r > 0) back.push({ Warehouse: g.warehouse, 'Item Code': g.code, Quantity: r, Batch: g.batch });
  }
  const date = normDate(body.date) || today(); const result = { ref, inDoc: null };
  {
    if (!back.length) throw unprocessable('Enter the quantity taken back');
    const key = idem ? `${String(idem).replace(/[^A-Za-z0-9-]/g, '').slice(0, 56)}-in` : undefined;
    const r = await createRecord(ctx, TABLE_BY_SLUG[IN], { header: { Date: date, 'To Warehouse': p.hospital, 'Imprest Ref': ref, 'Narration / Notes': sstr(body.narration) || `Return against ${ref}` }, lines: back }, key);
    result.inDoc = r.id;
  }
  return { ...result, summary: { returned: rq(back.reduce((s, l) => s + l.Quantity, 0)), toConsume: rq(p.balance - back.reduce((s, l) => s + l.Quantity, 0)) }, trail: await trail(ctx, ref) };
}

// Consumption entry: body { ref, billNo?, billDate?, narration?, lines: [{ key, consumed }] } - entered manually per item/batch.
export async function consume(ctx, body, idem) {
  const ref = sstr(body?.ref); if (!ref) throw bad('Choose the Imprest Out');
  const { outs, ins, cons } = await load(ctx);
  const out = outs.find((o) => sstr(o.DocNo) === ref); if (!out) throw notFound('Imprest Out not found');
  const p = position(out, ins, cons); if (!mine(ctx, p)) throw new HttpError(403, 'This imprest was not dispatched from your warehouse');
  if (p.balance <= 0) throw unprocessable(`${ref} is already closed`);
  const want = new Map((Array.isArray(body.lines) ? body.lines : []).map((l) => [sstr(l.key), toNum(l.consumed)]));
  const used = [];
  for (const g of p.lines) {
    if (g.balance <= 0) continue;
    const c = want.get(g.key) || 0;
    if (c < 0 || !Number.isFinite(c)) throw bad(`${g.code}: consumed quantity is not valid`);
    if (c > g.balance + 1e-9) throw unprocessable(`${g.code} (batch ${g.batch}): consumed ${c} is more than the ${g.balance} remaining`);
    if (c > 0) used.push({ 'Consumption Type': 'Consumption as Against PO', 'Item Code': g.code, Quantity: c, Batch: g.batch });
  }
  if (!used.length) throw unprocessable('Enter the consumed quantity');
  const billNo = sstr(body.billNo);
  const key = idem ? `${String(idem).replace(/[^A-Za-z0-9-]/g, '').slice(0, 56)}-cons` : undefined;
  const r = await createRecord(ctx, TABLE_BY_SLUG[CONS], { header: { Warehouse: p.hospital, 'Imprest Ref': ref, 'Bill Status': billNo ? 'Billed' : 'Pending Bill', ...(billNo ? { 'Bill No': billNo } : {}), ...(sstr(body.billDate) ? { 'Bill Date': normDate(body.billDate) } : {}), 'Narration / Notes': sstr(body.narration) || `Consumed against ${ref}` }, lines: used }, key);
  return { ref, consumptionDoc: r.id, consumed: rq(used.reduce((s, l) => s + l.Quantity, 0)), trail: await trail(ctx, ref) };
}

// Imprest In and Consumption in one go: per item/batch the user enters what was taken back and what the hospital used;
// both are checked together first (back + used <= open balance), then posted as an Imprest In and a Consumption against the same Imprest Out.
export async function settle(ctx, body, idem) {
  const ref = sstr(body?.ref); if (!ref) throw bad('Choose the Imprest Out');
  const { outs, ins, cons } = await load(ctx);
  const out = outs.find((o) => sstr(o.DocNo) === ref); if (!out) throw notFound('Imprest Out not found');
  const p = position(out, ins, cons); if (!mine(ctx, p)) throw new HttpError(403, 'This imprest was not dispatched from your warehouse');
  if (p.balance <= 0) throw unprocessable(`${ref} is already closed`);
  const rows = Array.isArray(body.lines) ? body.lines : []; const get = (k) => rows.find((l) => sstr(l.key) === k) || {};
  let anyBack = false, anyUsed = false;
  for (const g of p.lines) {
    const r = toNum(get(g.key).returned), c = toNum(get(g.key).consumed);
    if (r < 0 || c < 0 || !Number.isFinite(r) || !Number.isFinite(c)) throw bad(`${g.code}: quantity is not valid`);
    if (r + c > g.balance + 1e-9) throw unprocessable(`${g.code} (batch ${g.batch}): taken back ${r} + consumed ${c} is more than the ${g.balance} open`);
    if (r > 0) anyBack = true; if (c > 0) anyUsed = true;
  }
  if (!anyBack && !anyUsed) throw unprocessable('Enter the quantity taken back and/or consumed');
  const out2 = { ref, inDoc: null, consumptionDoc: null };
  if (anyBack) out2.inDoc = (await receive(ctx, { ref, date: body.date, narration: body.narration, lines: rows.map((l) => ({ key: l.key, returned: l.returned })) }, idem)).inDoc;
  if (anyUsed) { const r = await consume(ctx, { ref, narration: body.narration, lines: rows.map((l) => ({ key: l.key, consumed: l.consumed })) }, idem); out2.consumptionDoc = r.consumptionDoc; }
  return { ...out2, trail: await trail(ctx, ref) };
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

// ---- Imprest Out / Imprest In / Consumption registers (one row per item line, columns as in the Focus register export) ----
export const REGISTER_COLUMNS = ['DocNo', 'Date', 'Customer A/c Name', 'Issues/Receipts', 'Doctor Name', 'Warehouse 1', 'Warehouse 2', 'Item Code', 'Item Name', 'Unit Name', 'Narration', 'Quantity', 'Item Brand', 'Batch', 'Net Amount', 'Authorize Status', 'Base Link Status', 'Expiry Date', 'Location Name', 'Manufacturing Date', 'Base Link Doc Date', 'Base Link Doc No', 'Link Status', 'Created User', 'Item HSN/SAC', 'Rate'];
export async function register(ctx, type) {
  assertCan(ctx, TABLE_BY_SLUG[type === 'cons' ? CONS : type === 'in' ? IN : OUT], 'view');
  const { outs, ins, cons, ledger } = await load(ctx);
  const items = (await ctx.store.read('Item Master')).rows;
  const brand = (code) => sstr(items.find((r) => sstr(r.Code) === code)?.Brand);
  const led = (no) => ledger.find((r) => sstr(r.Doc) === no);
  const outOf = (ref) => outs.find((o) => sstr(o.DocNo) === ref);
  const rows = [];
  const line = (h, no, date, kind, hospital, l, base) => {
    const qty = toNum(l.Quantity), rate = toNum(l.Rate);
    const tax = toNum(l.CGST) + toNum(l.SGST) + toNum(l.CESS) + toNum(l.IGST);
    const code = sstr(l['Item Code']);
    return { no, date, 'Customer A/c Name': sstr(h['Customer Account']), 'Issues/Receipts': kind, 'Doctor Name': sstr(h.Doctor), 'Warehouse 1': sstr(l.Warehouse), 'Warehouse 2': hospital, 'Item Code': code,
      'Item Name': sstr(l.Items || l.Item || l.Description), 'Unit Name': sstr(l.Units || l.Unit), Narration: sstr(h['Narration / Notes']), Quantity: qty, 'Item Brand': brand(code), Batch: sstr(l.Batch),
      'Net Amount': Math.round((qty * rate + tax) * 100) / 100, 'Authorize Status': 'Authorized', 'Base Link Status': base ? 'Linked' : '', 'Expiry Date': normDate(l['Expiry Date']) || '', 'Location Name': sstr(h['Place of Supply'] || h.Location),
      'Manufacturing Date': normDate(l['Manufacturing Date']) || '', 'Base Link Doc Date': base ? normDate(base.Date) : '', 'Base Link Doc No': base ? sstr(base.DocNo) : '', 'Link Status': '', 'Created User': sstr(led(no)?.User),
      'Item HSN/SAC': sstr(l.HSN), Rate: rate, hospital, status: '', ref: base ? sstr(base.DocNo) : '', warehouse: sstr(l.Warehouse) };
  };
  if (type === 'out') {
    for (const o of outs.filter((x) => sstr(x.DocNo))) {
      const p = position(o, ins, cons); if (!mine(ctx, p)) continue;
      for (const l of parseLines(o.Lines)) rows.push({ ...line(o, p.ref, p.date, 'Issues', p.hospital, l, null), 'Link Status': p.status === 'Open' ? 'Pending' : 'Closed', status: p.status });
    }
  } else if (type === 'in') {
    for (const d of ins.filter((x) => sstr(x.DocNo))) {
      const ls = parseLines(d.Lines); if (!ls.some((l) => !sstr(l.Warehouse) || inScope(ctx, l.Warehouse))) continue;
      const base = outOf(sstr(d['Imprest Ref'])); const ps = base ? position(base, ins, cons) : null;
      for (const l of ls) rows.push({ ...line(d, sstr(d.DocNo), normDate(d.Date), 'Receipts', sstr(d['To Warehouse']), l, base), 'Link Status': ps ? (ps.status === 'Open' ? 'Pending' : 'Closed') : '' });
    }
  } else {
    for (const d of cons.filter((x) => sstr(x['Document No']))) {
      const no = sstr(d['Document No']); const ls = parseLines(d.Lines);
      if (!(await imprestLinked(ctx, d.Warehouse, ledger)) && !ls.some((l) => inScope(ctx, l.Warehouse))) continue;
      const base = outOf(sstr(d['Imprest Ref'])); const ps = base ? position(base, ins, cons) : null;
      for (const l of ls) rows.push({ ...line(d, no, normDate(led(no)?.Date) || '', 'Consumption', sstr(d.Warehouse), l, base), 'Link Status': ps ? (ps.status === 'Open' ? 'Pending' : 'Closed') : sstr(d['Bill Status']) });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.no.localeCompare(a.no));
  return { rows, columns: REGISTER_COLUMNS };
}
