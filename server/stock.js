// Stock engine. Balance = Opening Stock + signed Stock Ledger postings, by warehouse / item / batch.
import { normDate, toNum, sstr, round2, unprocessable, isBlank } from './util.js';

const rq = (n) => Math.round(n * 1e6) / 1e6;
export const keyOf = (wh, code, batch) => `${sstr(wh).toUpperCase()}|${sstr(code)}|${sstr(batch)}`;

export function computeBalances(openingRows, ledgerRows) {
  const m = new Map();
  const touch = (wh, code, batch) => {
    const k = keyOf(wh, code, batch);
    if (!m.has(k)) m.set(k, { key: k, warehouse: sstr(wh).toUpperCase(), itemCode: sstr(code), itemName: '', category: '', brand: '', batch: sstr(batch), expiry: '', qty: 0, value: 0 });
    return m.get(k);
  };
  const setExp = (e, x, qty) => { const d = normDate(x); if (d && (!e.expiry || (qty > 0 && d < e.expiry))) e.expiry = d; };
  for (const r of openingRows) {
    if (isBlank(r.Warehouse) || isBlank(r['Item Code'])) continue;
    const e = touch(r.Warehouse, r['Item Code'], r['Batch Number']); const q = toNum(r.Quantity);
    e.qty += q; e.value += toNum(r['Stock Value']);
    e.itemName ||= sstr(r['Item Name']); e.category ||= sstr(r['Item Category Type Name']); e.brand ||= sstr(r['Brand Name']);
    setExp(e, r['Expiry Date'], q);
  }
  for (const r of ledgerRows) {
    if (isBlank(r.Warehouse) || isBlank(r['Item Code'])) continue;
    const e = touch(r.Warehouse, r['Item Code'], r['Batch Number']); const q = toNum(r.Quantity);
    e.qty += q; e.value += q * toNum(r.Rate);
    e.itemName ||= sstr(r['Item Name']);
    setExp(e, r['Expiry Date'], q);
  }
  for (const e of m.values()) { e.qty = rq(e.qty); e.value = round2(e.value); }
  return m;
}

export async function loadStock(store, { fresh = false } = {}) {
  const [o, l] = await Promise.all([store.read('Opening Stock', { fresh }), store.read('Stock Ledger', { fresh })]);
  return { opening: o.rows, ledger: l.rows, balances: computeBalances(o.rows, l.rows) };
}

export function buildCatalog(itemMasterRows, balances) {
  const c = new Map();
  for (const r of itemMasterRows) {
    const code = sstr(r.Code); if (!code) continue;
    c.set(code, { code, name: sstr(r['Item Name']), category: sstr(r['Item Category']), brand: sstr(r.Brand), unit: sstr(r.UOM), minStock: toNum(r['Min Stock Level']) });
  }
  for (const e of balances.values()) {
    if (!c.has(e.itemCode)) c.set(e.itemCode, { code: e.itemCode, name: e.itemName, category: e.category, brand: e.brand });
    else if (!c.get(e.itemCode).name) c.get(e.itemCode).name = e.itemName;
  }
  return c;
}

export function searchCatalog(catalog, q, limit = 30) {
  const s = sstr(q).toLowerCase(); const out = [];
  for (const it of catalog.values()) {
    if (!s || it.code.toLowerCase().includes(s) || it.name.toLowerCase().includes(s)) { out.push(it); if (out.length >= limit) break; }
  }
  return out;
}

const fefoSort = (a, b) => (a.expiry || '9999-12-31').localeCompare(b.expiry || '9999-12-31') || a.batch.localeCompare(b.batch);

// A working copy of the balances for ONE document: lines in the same document see each other's effect,
// and nothing is written until the whole document has been validated.
export class StockView {
  constructor(balances) { this.base = balances; this.delta = new Map(); this.entries = []; this.warnings = []; }
  qty(wh, code, batch) { const k = keyOf(wh, code, batch); return rq((this.base.get(k)?.qty || 0) + (this.delta.get(k) || 0)); }
  info(wh, code, batch) { return this.base.get(keyOf(wh, code, batch)); }
  rate(wh, code, batch) { const e = this.info(wh, code, batch); return e && e.qty > 0 ? round2(e.value / e.qty) : 0; }
  batches(wh, code) {
    const w = sstr(wh).toUpperCase(); const seen = new Map();
    for (const e of this.base.values()) if (e.warehouse === w && e.itemCode === sstr(code)) seen.set(e.batch, e);
    for (const k of this.delta.keys()) { const [kw, kc, kb] = k.split('|'); if (kw === w && kc === sstr(code) && !seen.has(kb)) seen.set(kb, { batch: kb, expiry: this._exp?.get(k) || '' }); }
    return [...seen.values()].map((e) => ({ batch: e.batch, expiry: e.expiry || this._exp?.get(keyOf(wh, code, e.batch)) || '', qty: this.qty(wh, code, e.batch), rate: this.rate(wh, code, e.batch) })).filter((b) => b.qty > 0).sort(fefoSort);
  }
  _push(type, doc, date, wh, code, name, batch, expiry, qty, rate) {
    const k = keyOf(wh, code, batch);
    this.delta.set(k, rq((this.delta.get(k) || 0) + qty));
    if (expiry) { (this._exp ||= new Map()).set(k, normDate(expiry) || sstr(expiry)); }
    this.entries.push({ type, doc, date, warehouse: sstr(wh).toUpperCase(), code: sstr(code), name, batch: sstr(batch), expiry: normDate(expiry), qty, rate });
  }
  // Take stock out. Explicit batch -> exactly that batch. No batch -> FEFO across non-expired batches (never issues expired stock silently).
  out({ wh, code, name, qty, batch, date, type, doc, label }) {
    if (!(qty > 0)) throw unprocessable(`${label}: quantity must be greater than zero`);
    const alloc = [];
    if (sstr(batch)) {
      const avail = this.qty(wh, code, batch);
      if (avail < qty) throw unprocessable(`${label}: only ${avail} available in ${wh} for batch ${batch} (need ${qty})`);
      const b = this.batches(wh, code).find((x) => x.batch === sstr(batch)) || { expiry: this.info(wh, code, batch)?.expiry || '' };
      if (b.expiry && b.expiry < date) this.warnings.push(`${label}: batch ${batch} expired on ${b.expiry}`);
      alloc.push({ batch: sstr(batch), expiry: b.expiry || '', qty, rate: this.rate(wh, code, batch) });
    } else {
      let need = qty;
      const cands = this.batches(wh, code).filter((b) => !b.expiry || b.expiry >= date);
      const total = cands.reduce((s, b) => s + b.qty, 0);
      if (total < qty) {
        const expired = this.batches(wh, code).length - cands.length;
        throw unprocessable(`${label}: only ${rq(total)} usable stock in ${wh} (need ${qty})${expired ? `; ${expired} expired batch(es) are not auto-issued - choose a batch explicitly if intended` : ''}`);
      }
      for (const b of cands) { if (need <= 0) break; const take = Math.min(need, b.qty); alloc.push({ batch: b.batch, expiry: b.expiry, qty: rq(take), rate: b.rate }); need = rq(need - take); }
    }
    for (const a of alloc) this._push(type, doc, date, wh, code, name, a.batch, a.expiry, -a.qty, a.rate);
    return alloc;
  }
  in({ wh, code, name, qty, batch, expiry, rate, date, type, doc, label }) {
    if (!(qty > 0)) throw unprocessable(`${label}: quantity must be greater than zero`);
    this._push(type, doc, date, wh, code, name, batch, expiry || this.info(wh, code, batch)?.expiry || '', qty, rate || 0);
  }
  ledgerRows(user) {
    return this.entries.map((e) => ({ Date: e.date, Type: e.type, Doc: e.doc, Warehouse: e.warehouse, 'Item Code': e.code, 'Item Name': e.name, 'Batch Number': e.batch, 'Expiry Date': e.expiry, Quantity: e.qty, Rate: e.rate, User: user }));
  }
  touchedKeys() { return [...this.delta.keys()]; }
}

// After appending, re-read fresh and make sure no touched batch went negative (guards against cross-instance races).
export async function findNegatives(store, keys) {
  const { balances } = await loadStock(store, { fresh: true });
  return keys.filter((k) => (balances.get(k)?.qty || 0) < -1e-9);
}

// Data-quality scan of the Opening Stock sheet (used by the Data Quality page).
export function scanOpeningStock(openingRows) {
  const groups = new Map(); const issues = { negative: [], blankValue: [], blankExpiry: [], duplicates: [], blankBatch: [] };
  for (const r of openingRows) {
    const k = keyOf(r.Warehouse, r['Item Code'], r['Batch Number']);
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
    const base = { warehouse: r.Warehouse, itemCode: r['Item Code'], itemName: r['Item Name'], batch: r['Batch Number'], qty: toNum(r.Quantity), expiry: normDate(r['Expiry Date']), value: r['Stock Value'] };
    if (toNum(r.Quantity) < 0) issues.negative.push(base);
    if (isBlank(r['Stock Value']) || toNum(r['Stock Value']) === 0) issues.blankValue.push(base);
    if (!normDate(r['Expiry Date'])) issues.blankExpiry.push(base);
    if (isBlank(r['Batch Number'])) issues.blankBatch.push(base);
  }
  for (const [, rs] of groups) if (rs.length > 1) issues.duplicates.push({ warehouse: rs[0].Warehouse, itemCode: rs[0]['Item Code'], batch: rs[0]['Batch Number'], rows: rs.length, netQty: rq(rs.reduce((s, x) => s + toNum(x.Quantity), 0)), detail: rs.map((x) => `${x.Quantity}@${normDate(x['Expiry Date']) || 'no expiry'}`).join('; ') });
  return issues;
}

export const isTransitLoc = (w) => /^TRANSIT-/i.test(sstr(w));

// A location is VIRTUAL when Warehouse Master lists it with a Warehouse Type containing "virtual", "hospital" or "imprest".
// Every other warehouse in Warehouse Master, or holding opening stock, is PHYSICAL. TRANSIT-* locations are system-managed (requisitions).
export async function locations(ctx) {
  const [wm, op] = await Promise.all([ctx.store.read('Warehouse Master'), ctx.store.read('Opening Stock')]);
  const isVirtualType = (t) => /virtual|hospital|imprest/i.test(sstr(t));
  const virtual = new Set(wm.rows.filter((r) => isVirtualType(r['Warehouse Type'])).map((r) => sstr(r['Warehouse Name']).toUpperCase()));
  const physical = new Set([...wm.rows.map((r) => sstr(r['Warehouse Name']).toUpperCase()), ...op.rows.map((r) => sstr(r.Warehouse).toUpperCase())].filter((w) => w && !virtual.has(w)));
  const classify = (w) => { const u = sstr(w).toUpperCase(); return isTransitLoc(u) ? 'In transit' : virtual.has(u) || !physical.has(u) ? 'Hospital / virtual' : 'Warehouse'; };
  return { physical, virtual, classify };
}
