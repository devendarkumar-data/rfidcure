import { useEffect, useMemo, useRef, useState } from 'react';
import { api, idemKey } from '../api.js';
import Field from '../components/Field.jsx';
import LinesEditor from '../components/LinesEditor.jsx';
import { useToast } from '../components/Toast.jsx';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const empty = (v) => v === '' || v === null || v === undefined;
const INWARD = new Set(['grn-mrn']); // posting tables whose Batch is typed in, not picked

// Header fields + (optional) line items for any table. mode: create | edit | view
export default function RecordForm({ table, mode = 'create', initial, onSubmit, onCancel, submitLabel }) {
  const toast = useToast();
  const readOnly = mode === 'view';
  const [key] = useState(() => idemKey());
  const [values, setValues] = useState(() => {
    const v = { ...(initial?.header || {}) };
    if (mode === 'create' && table.fields.some((f) => f.name === 'Date' && !f.readonly) && !v.Date) v.Date = todayIST();
    return v;
  });
  const [lines, setLines] = useState(() => (initial?.lines || []).map((l, i) => ({ ...l, _k: `i${i}` })));
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const fields = useMemo(() => table.fields.filter((f) => !(mode === 'create' && (f.type === 'auto' && !table.idCol)) ), [table, mode]);
  const isOut = table.slug === 'imprest-out-new' && mode === 'create';
  const isIn = table.slug === 'imprest-in-new' && mode === 'create';
  const [defWh, setDefWh] = useState('');
  const custTimer = useRef(null);
  useEffect(() => { // the user's own warehouse (or the one being viewed) becomes the default on every line
    if (!isOut) return;
    api.get('/api/lookup', { field: 'Warehouse', scopeOnly: '1' }).then((r) => {
      const o = r.options || []; if (o.length !== 1) return;
      setDefWh(o[0].value); setLines((ls) => ls.map((l) => (l.Warehouse ? l : { ...l, Warehouse: o[0].value })));
    }).catch(() => {});
  }, [isOut]);
  const set = (n, v) => {
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
      outLines = lines.map(({ _k, ...l }) => Object.fromEntries(Object.entries(l).filter(([, v]) => !empty(v)))).filter((l) => l['Item Code'] || Object.keys(l).length > 0);
      outLines = outLines.filter((l) => l['Item Code'] || l[table.itemField]);
      if (table.itemField && !outLines.length) { setErr('Add at least one line item.'); return; }
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
      <div className={`grid gap-x-2 gap-y-1.5 ${fields.length > 8 ? "compact grid-cols-2 md:grid-cols-4 xl:grid-cols-6 [&_.input]:py-1 [&_.input]:text-sm [&_label]:text-xs" : "sm:grid-cols-2"}`}>
        {fields.map((f) => <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} disabled={readOnly} required={table.required.includes(f.name)} error={errors[f.name]} />)}
      </div>
      {table.hasLines && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Line items</h3>
          <LinesEditor lineFields={table.lineFields} itemField={table.itemField} lines={lines} onChange={setLines} readOnly={readOnly}
            batchMode={table.posts && !INWARD.has(table.slug) ? 'pick' : 'enter'} getWarehouse={getWarehouse}
            autoBatch={isOut || isIn} batchFromAll={isIn} scopeWarehouse={isOut} lineDefaults={isOut && defWh ? { Warehouse: defWh } : null} />
          {table.posts && table.slug !== 'actual-stock' && <p className="mt-2 text-xs text-slate-500">Saving posts to the stock ledger and cannot be edited afterwards. Leave Batch on “Auto” to issue the earliest-expiry stock first.</p>}
        </div>
      )}
      {!readOnly && (
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel || (mode === 'edit' ? 'Save changes' : table.posts ? 'Save & post' : 'Save')}</button>
        </div>
      )}
    </form>
  );
}
