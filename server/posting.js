// Stock-posting rules per document type. These mirror the posting rules in the approved prototype
// (GRN in; Imprest Out source->imprest; Imprest In imprest->main; Transfer; Material Issue; Consumption; Actual Stock variance).
// They are pure: they only add entries to a StockView; nothing is written here.
import { sstr, toNum, isBlank, unprocessable, round2 } from './util.js';

const yes = (v) => v === true || /^(yes|true|1)$/i.test(sstr(v));
const need = (v, msg) => { if (!sstr(v)) throw unprocessable(msg); return sstr(v); };

// Splits/updates lines with the batches actually used, so the stored Lines JSON matches the ledger exactly.
function expand(line, allocs) {
  return allocs.map((a) => {
    const l = { ...line, Batch: a.batch, 'Expiry Date': a.expiry || line['Expiry Date'] || '', Quantity: a.qty, Rate: a.rate };
    if ('Gross' in l || 'Gross' in line) l.Gross = round2(a.qty * a.rate);
    return l;
  });
}

export const POSTERS = {
  grn({ header, lines, view, doc, date }) {
    if (!yes(header['Update Stock'])) return { lines, posted: false };
    const wh = need(header.Warehouse, 'Select the receiving warehouse');
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      const qty = isBlank(l['Accepted Qty']) ? toNum(l.Quantity) : toNum(l['Accepted Qty']);
      if (qty <= 0) return;
      need(l.Batch, `${label}: batch number is required to update stock`);
      view.in({ wh, code: l['Item Code'], name: l._name, qty, batch: l.Batch, expiry: l['Expiry Date'], rate: toNum(l.Rate), date, type: 'GRN', doc, label });
    });
    return { lines, posted: view.entries.length > 0 };
  },

  'imprest-out'({ header, lines, view, doc, date }) {
    const dest = need(header['To Warehouse'], 'Select the To Warehouse');
    const out = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      const src = need(l.Warehouse, `${label}: select the source warehouse`);
      if (src.toUpperCase() === dest.toUpperCase()) throw unprocessable(`${label}: source and To Warehouse are the same`);
      const allocs = view.out({ wh: src, code: l['Item Code'], name: l._name, qty: toNum(l.Quantity), batch: l.Batch, date, type: 'Imprest Out', doc, label });
      for (const a of allocs) view.in({ wh: dest, code: l['Item Code'], name: l._name, qty: a.qty, batch: a.batch, expiry: a.expiry, rate: a.rate, date, type: 'Imprest Out', doc, label });
      out.push(...expand(l, allocs));
    });
    return { lines: out, posted: true };
  },

  'imprest-in'({ header, lines, view, doc, date }) {
    const src = need(header['To Warehouse'], 'Select the imprest (To) Warehouse the stock is coming back from');
    const out = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      const dest = need(l.Warehouse, `${label}: select the warehouse receiving the stock`);
      if (src.toUpperCase() === dest.toUpperCase()) throw unprocessable(`${label}: source and destination are the same`);
      const allocs = view.out({ wh: src, code: l['Item Code'], name: l._name, qty: toNum(l.Quantity), batch: l.Batch, date, type: 'Imprest In', doc, label });
      for (const a of allocs) view.in({ wh: dest, code: l['Item Code'], name: l._name, qty: a.qty, batch: a.batch, expiry: a.expiry, rate: a.rate, date, type: 'Imprest In', doc, label });
      out.push(...expand(l, allocs));
    });
    return { lines: out, posted: true };
  },

  transfer({ header, lines, view, doc, date }) {
    const from = need(header['From Warehouse'], 'Select the From Warehouse'), to = need(header['To Warehouse'], 'Select the To Warehouse');
    if (from.toUpperCase() === to.toUpperCase()) throw unprocessable('From and To warehouse must be different');
    const out = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      const allocs = view.out({ wh: from, code: l['Item Code'], name: l._name, qty: toNum(l.Quantity), batch: l.Batch, date, type: 'Stock Transfer', doc, label });
      for (const a of allocs) view.in({ wh: to, code: l['Item Code'], name: l._name, qty: a.qty, batch: a.batch, expiry: a.expiry, rate: a.rate, date, type: 'Stock Transfer', doc, label });
      out.push(...expand(l, allocs));
    });
    return { lines: out, posted: true };
  },

  issue({ lines, view, doc, date }) {
    const out = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      const wh = need(l.Warehouse, `${label}: select the warehouse`);
      out.push(...expand(l, view.out({ wh, code: l['Item Code'], name: l._name, qty: toNum(l.Quantity), batch: l.Batch, date, type: 'Material Issue', doc, label })));
    });
    return { lines: out, posted: true };
  },

  consumption({ header, lines, view, doc, date }) {
    const wh = need(header.Warehouse, 'Select the warehouse');
    if (sstr(header['Bill Status']) !== 'Pending Bill' && lines.some((l) => /against bill/i.test(sstr(l['Consumption Type']))) && !sstr(header['Bill No'])) throw unprocessable('Bill No is required for consumption against a bill');
    const out = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      out.push(...expand(l, view.out({ wh, code: l['Item Code'], name: l._name, qty: toNum(l.Quantity), batch: l.Batch, date, type: 'Consumption', doc, label })));
    });
    return { lines: out, posted: true };
  },

  // Actual Stock: Quantity on the line is the COUNTED quantity; the variance to system stock is posted.
  actual({ header, lines, view, doc, date }) {
    const wh = need(header.Warehouse, 'Select the warehouse');
    const out = [];
    lines.forEach((l, i) => {
      const label = `Line ${i + 1} (${l['Item Code']})`;
      if (isBlank(l.Quantity)) return;
      const batch = need(l.Batch, `${label}: batch is required`);
      const sys = view.qty(wh, l['Item Code'], batch), counted = toNum(l.Quantity), v = Math.round((counted - sys) * 1e6) / 1e6;
      const rate = toNum(l.Rate) || view.rate(wh, l['Item Code'], batch);
      const nl = { ...l, 'System Qty': sys, Rate: rate, Gross: round2(v * rate) };
      out.push(nl);
      if (v > 0) view.in({ wh, code: l['Item Code'], name: l._name, qty: v, batch, expiry: l['Expiry Date'], rate, date, type: 'Stock Adjustment', doc, label });
      else if (v < 0) view.out({ wh, code: l['Item Code'], name: l._name, qty: -v, batch, date, type: 'Stock Adjustment', doc, label });
    });
    return { lines: out, posted: view.entries.length > 0 };
  },
};

// Warehouses the user must be assigned to in order to create this document (source side / receiving side).
export function writeWarehouses(kind, header, lines) {
  switch (kind) {
    case 'grn': case 'consumption': case 'actual': return [header.Warehouse];
    case 'transfer': return [header['From Warehouse']];
    case 'imprest-out': case 'issue': return lines.map((l) => l.Warehouse);
    case 'imprest-in': return lines.map((l) => l.Warehouse); // receiving side; the imprest (hospital) side is checked by imprestLinked
    default: return [];
  }
}
