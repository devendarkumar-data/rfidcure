import { useEffect, useMemo, useRef, useState } from 'react';
import { api, idemKey } from '../api.js';
import { COMPANY } from '../../shared/company.js';
import Collapsible from '../components/Collapsible.jsx';
import TotalsBlock from '../components/TotalsBlock.jsx';
import Field from '../components/Field.jsx';
import ItemStockPanel from '../components/ItemStockPanel.jsx';
import LinesEditor from '../components/LinesEditor.jsx';
import { useToast } from '../components/Toast.jsx';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const empty = (v) => v === '' || v === null || v === undefined;
const IMPREST_WH = { imprest: '1' }; // hospital / imprest warehouses that hold stock sent from the user's warehouse
const INWARD = new Set(['grn-mrn']); // posting tables whose Batch is typed in, not picked

// Header fields + (optional) line items for any table. mode: create | edit | view
// Imprest In / Consumption are entered by hand against an Imprest Out voucher: pick the voucher, then enter the quantity per item / batch.
function VoucherPicker({ kind, value, onPick }) {
  const [rows, setRows] = useState(null); const [q, setQ] = useState('');
  useEffect(() => { api.get(kind === 'cons' ? '/api/imprest/consumption-queue' : '/api/imprest/pending').then((r) => setRows(r.rows || [])).catch(() => setRows([])); }, [kind]);
  const n = q.trim().toLowerCase();
  const shown = (rows || []).filter((r) => !n || `${r.ref} ${r.hospital} ${r.customer}`.toLowerCase().includes(n));
  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <label className="label">Imprest Out voucher no.{kind === 'cons' ? ' *' : ''}</label>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search voucher no. or hospital…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search voucher" />
        <select className="input max-w-lg" value={value || ''} onChange={(e) => onPick(shown.find((r) => r.ref === e.target.value) || (rows || []).find((r) => r.ref === e.target.value) || null)} aria-label="Imprest Out voucher">
          <option value="">{rows ? '— Select voucher —' : 'Loading…'}</option>
          {shown.map((r) => <option key={r.ref} value={r.ref}>{r.ref} · {r.hospital} · {r.date} · open {r.balance}</option>)}
        </select>
      </div>
      <p className="mt-1 text-xs text-slate-500">Enter the quantity yourself for each item / batch. Only what is still open on the voucher can be {kind === 'cons' ? 'consumed' : 'taken back'}; nothing is consumed automatically.</p>
    </div>
  );
}

export default function RecordForm({ table, mode = 'create', initial, onSubmit, onCancel, submitLabel }) {
  const toast = useToast();
  const readOnly = mode === 'view';
  const [key] = useState(() => idemKey());
  const [values, setValues] = useState(() => {
    const v = { ...(initial?.header || {}) };
    if (mode === 'create' && table.fields.some((f) => f.name === 'Date' && !f.readonly) && !v.Date) v.Date = todayIST();
    if (mode === 'create' && ['imprest-out-new', 'imprest-in-new'].includes(table.slug)) { if (!v.Companies) v.Companies = COMPANY.name; if (!v['Place of Supply']) v['Place of Supply'] = COMPANY.state; } // our own company; place of supply is our state
    return v;
  });
  const [lines, setLines] = useState(() => (initial?.lines || []).map((l, i) => ({ ...l, _k: `i${i}` })));
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const GRN_ORDER = ['Receipt Type', 'Date', 'Warehouse', 'Document No.', 'Vendor Account', 'Type Of Purchase', 'Supplier Ref No', 'Location', 'Invoice No.', 'Invoice Date', 'Invoice Value', 'Is IGST', 'Update Stock', 'Raise Receipt', 'Attachment', 'Terms Of Delivery', 'Narration-Notes'];
  const isGrn = table.slug === 'grn-mrn';
  const ACCT = new Set(['place of supply', 'ship to name', 'ship to address', 'ship to city', 'ship to state', 'ship to pin code', 'bill code', 'is igst', 'ref. doc', 'ref. date']); // account / GST details can be folded away on Imprest forms
  const fields = useMemo(() => {
    const f = table.fields.filter((x) => !(mode === 'create' && (x.type === 'auto' && !table.idCol)));
    if (!isGrn) return f;
    const at = (n) => { const i = GRN_ORDER.findIndex((o) => o.toLowerCase() === n.toLowerCase()); return i < 0 ? 99 : i; }; // GRN header in fixed rows of 4 so every column lines up
    return [...f].sort((a, b) => at(a.name) - at(b.name));
  }, [table, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOut = table.slug === 'imprest-out-new' && mode === 'create';
  const isIn = table.slug === 'imprest-in-new' && mode === 'create';
  const foldFields = isOut || isIn ? fields.filter((x) => ACCT.has(x.name.toLowerCase())) : [];
  const mainFields = foldFields.length ? fields.filter((x) => !foldFields.includes(x)) : fields;
  const isCons = table.slug === 'material-consumption' && mode === 'create';
  const stockMode = isOut ? 'out' : isIn ? 'in' : isCons ? 'consume' : false;
  const [defWh, setDefWh] = useState('');
  const custTimer = useRef(null);
  useEffect(() => { // the user's own warehouse (or the one being viewed) becomes the default on every line
    if (!isOut && !isIn) return;
    api.get('/api/lookup', { field: 'Warehouse', scopeOnly: '1' }).then((r) => {
      const o = r.options || []; if (o.length !== 1) return;
      setDefWh(o[0].value); setLines((ls) => ls.map((l) => (l.Warehouse ? l : { ...l, Warehouse: o[0].value })));
    }).catch(() => {});
  }, [isOut, isIn]);
  const set = (n, v) => {
    if ((isIn && n === 'To Warehouse') || (isCons && n === 'Warehouse')) setLines((ls) => ls.map((l) => ({ _k: l._k, ...(l.Warehouse ? { Warehouse: l.Warehouse } : {}), ...(l['Consumption Type'] ? { 'Consumption Type': l['Consumption Type'] } : {}) }))); // another hospital: stock lines start again
    setValues((s) => ({ ...s, [n]: v })); if (errors[n]) setErrors((e) => ({ ...e, [n]: undefined }));
    if (isOut && n === 'Customer Account') { // shipping block + bill code come from the customer account
      clearTimeout(custTimer.current);
      custTimer.current = setTimeout(() => {
        api.get('/api/lookup/customer', { name: v }).then((c) => {
          if (!c.found) return;
          const put = {}; const take = (k, x) => { if (x) put[k] = x; };
          take('Ship to Name', c.name); take('Ship to Address', c.address); take('Ship to City', c.city); take('Ship to State', c.state); take('Ship to Pin code', c.pincode); take('Bill Code', c.code);
          setValues((s) => ({ ...s, ...put }));
        }).catch(() => {});
      }, 350);
    }
  };
  const getWarehouse = (l) => l.Warehouse || (table.slug === 'imprest-in-new' ? values['To Warehouse'] : (values.Warehouse || values['From Warehouse'] || ''));

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    const errs = {};
    for (const r of table.required) { if (fields.find((f) => f.name === r && !f.readonly) && empty(values[r])) errs[r] = 'Required'; }
    for (const f of fields) if (f.type === 'number' && !empty(values[f.name]) && (!Number.isFinite(Number(values[f.name])) || Number(values[f.name]) < 0)) errs[f.name] = 'Enter a non-negative number';
    setErrors(errs);
    if (Object.keys(errs).length) { setErr('Please fix the highlighted fields.'); return; }
    const header = {};
    for (const f of fields) if (!f.readonly && f.type !== 'auto' && f.type !== 'calc' && !empty(values[f.name])) header[f.name] = f.type === 'number' ? Number(values[f.name]) : values[f.name];
    let outLines;
    if (table.hasLines) {
      outLines = lines.map(({ _k, _avail, ...l }) => Object.fromEntries(Object.entries(l).filter(([, v]) => !empty(v)))).filter((l) => l['Item Code'] || Object.keys(l).length > 0);
      outLines = outLines.filter((l) => l['Item Code'] || l[table.itemField]);
      if (table.itemField && !outLines.length) { setErr('Add at least one line item.'); return; }
      if (stockMode) { const over = lines.findIndex((l) => l._avail != null && Number(l.Quantity) > l._avail); if (over >= 0) { setErr(`Line ${over + 1}: quantity exceeds the ${lines[over]._avail} available in stock.`); return; } }
      for (const l of outLines) for (const lf of table.lineFields) if (lf.type === 'number' && !empty(l[lf.name])) l[lf.name] = Number(l[lf.name]);
    }
    setBusy(true);
    try {
      const payload = table.hasLines ? { header, lines: outLines } : { header };
      const r = await onSubmit(payload, key);
      for (const w of r?.warnings || []) toast.warn(w);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate aria-label={table.title}>
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className={`grid gap-x-3 gap-y-2 ${isGrn ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 [&_.input]:h-9 [&_.label]:mb-1 [&_.label]:flex [&_.label]:min-h-[1.25rem] [&_.label]:items-end [&_.label]:text-[11px] [&_textarea.input]:h-9 [&_textarea.input]:min-h-0" : !table.hasLines && fields.length > 8 ? "grid-cols-1 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 [&_.label]:text-[11px] [&_.label]:leading-4" : fields.length > 8 ? "compact grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 [&_.input]:h-8 [&_.input]:py-0 [&_.input]:text-[13px] [&_.label]:mb-0 [&_.label]:text-[10px] [&_.label]:leading-4 [&_.label]:flex [&_.label]:min-h-[2rem] [&_.label]:items-end" : "sm:grid-cols-2"}`}>
        {mainFields.map((f) => <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} disabled={readOnly} required={table.required.includes(f.name)} error={errors[f.name]} extraParams={IMPREST_WH && ((isIn && f.name === 'To Warehouse') || (isCons && f.name === 'Warehouse')) ? IMPREST_WH : undefined} />)}
      </div>
      {foldFields.length > 0 && <Collapsible title="Account / GST details" className="mt-3">
        <div className={`grid gap-x-3 gap-y-2 ${isGrn ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 [&_.input]:h-9 [&_.label]:mb-1 [&_.label]:flex [&_.label]:min-h-[1.25rem] [&_.label]:items-end [&_.label]:text-[11px] [&_textarea.input]:h-9 [&_textarea.input]:min-h-0" : !table.hasLines && fields.length > 8 ? "grid-cols-1 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 [&_.label]:text-[11px] [&_.label]:leading-4" : fields.length > 8 ? "compact grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 [&_.input]:h-8 [&_.input]:py-0 [&_.input]:text-[13px] [&_.label]:mb-0 [&_.label]:text-[10px] [&_.label]:leading-4 [&_.label]:flex [&_.label]:min-h-[2rem] [&_.label]:items-end" : "sm:grid-cols-2"}`}>
          {foldFields.map((f) => <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} disabled={readOnly} required={table.required.includes(f.name)} error={errors[f.name]} extraParams={IMPREST_WH && ((isIn && f.name === 'To Warehouse') || (isCons && f.name === 'Warehouse')) ? IMPREST_WH : undefined} />)}
        </div>
      </Collapsible>}
      {table.hasLines && (
        <div className="mt-3">
          <h3 className="mb-1 text-sm font-semibold">Line items</h3>
          {(isIn || isCons) && !readOnly && <VoucherPicker kind={isIn ? 'in' : 'cons'} value={values['Imprest Ref']} onPick={(r) => { setValues((st) => ({ ...st, 'Imprest Ref': r ? r.ref : '', ...(r ? { [isIn ? 'To Warehouse' : 'Warehouse']: r.hospital } : {}) })); setLines(r ? r.lines.filter((g) => g.balance > 0).map((g, i) => ({ _k: `v${i}-${Date.now()}`, 'Item Code': g.code, [table.itemField]: g.name, Batch: g.batch, 'Expiry Date': g.expiry || '', ...(isIn ? { Warehouse: g.warehouse } : {}), _avail: g.balance, Quantity: '' })) : [{ _k: `e-${Date.now()}` }]); }} />}
          {(isOut || isIn || isCons) && <ItemStockPanel codes={lines.map((l) => l['Item Code'])} highlight={isIn ? values['To Warehouse'] : isCons ? values.Warehouse : lines[0]?.Warehouse} />}
          <LinesEditor lineFields={table.lineFields} itemField={table.itemField} lines={lines} onChange={setLines} readOnly={readOnly}
            batchMode={table.posts && !INWARD.has(table.slug) ? 'pick' : 'enter'} getWarehouse={getWarehouse}
            autoBatch={!!stockMode} lookupParams={isGrn ? (f, l) => (f.name === 'PO No' ? { vendor: values['Vendor Account'] || undefined, item: l['Item Code'] || undefined } : undefined) : undefined} fifo={isOut} stockPick={isOut ? false : stockMode} stockWh={isOut ? (l) => l.Warehouse : isIn ? () => values['To Warehouse'] : isCons ? () => values.Warehouse : null} scopeWarehouse={isOut || isIn} lineDefaults={(isOut || isIn) && defWh ? { Warehouse: defWh } : isCons ? { 'Consumption Type': 'Against Bill' } : null} />
          {table.lineFields.some((lf) => lf.name === 'Quantity') && lines.length > 0 && (() => {
            const n = (v) => Number(v) || 0;
            const tax = (k) => lines.reduce((x, l) => x + n(l.Quantity) * n(l.Rate) * n(l[k]) / 100, 0);
            const igstOn = /^y/i.test(String(values['Is IGST'] ?? ''));
            return <TotalsBlock qty={lines.reduce((x, l) => x + n(l.Quantity), 0)} hand={lines.reduce((x, l) => x + n(l._avail), 0)} gross={lines.reduce((x, l) => x + n(l.Quantity) * n(l.Rate), 0)}
              cgst={igstOn ? 0 : tax('CGST')} sgst={igstOn ? 0 : tax('SGST')} igst={igstOn ? tax('CGST') + tax('SGST') : 0} cess={tax('CESS')} />;
          })()}
          {table.posts && table.slug !== 'actual-stock' && <p className="mt-2 text-xs text-slate-500">Saving posts to the stock ledger and cannot be edited afterwards. Leave Batch on “Auto” to issue the earliest-expiry stock first.</p>}
        </div>
      )}
      {!readOnly && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel || (mode === 'edit' ? 'Save changes' : table.posts ? 'Save & post' : 'Save')}</button>
        </div>
      )}
    </form>
  );
}
