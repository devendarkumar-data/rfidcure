import { useTick } from '../useTick.js';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth } from '../auth.jsx';
import Card from '../components/Card.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import Icon from '../components/Icon.jsx';
import Combobox from '../components/Combobox.jsx';
import ItemPicker from '../components/ItemPicker.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';

const n2 = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const KEYS = ['warehouse', 'item', 'batch', 'category', 'brand', 'expiryStatus', 'expiryFrom', 'expiryTo', 'asOn', 'negative'];

function downloadErrors(errors, warnings = []) {
  const esc = (v) => { let x = String(v ?? ''); if (/^[=+@-]/.test(x)) x = `'${x}`; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const lines = ['Row,Type,Message', ...errors.map((e) => `${e.row},Error,${esc(e.message)}`), ...warnings.map((e) => `${e.row},Warning,${esc(e.message)}`)];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'opening-stock-import-errors.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const toB64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader(); fr.onerror = () => rej(new Error('Could not read the file'));
  fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(file);
});

function ImportDialog({ onClose, onDone }) {
  const toast = useToast(); const ref = useRef(null);
  const [file, setFile] = useState(null); const [mode, setMode] = useState('replace'); const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (confirm) => {
    if (!file) { setErr('Choose a file first'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post('/api/stock/opening/import', { filename: file.name, content: await toB64(file), mode, confirm });
      setRes(r);
      if (r.committed) { toast.success(`Opening stock imported: ${r.counts.rows} rows`); onDone(); }
    } catch (e) { setErr(e.message); if (e.details?.length) setRes({ errors: e.details, counts: { errors: e.details.length }, warnings: [], sample: [] }); } finally { setBusy(false); }
  };
  const ok = res && !res.committed && !res.counts.errors;
  return (
    <Modal wide title="Import Opening Stock" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn" disabled={busy || !file} onClick={() => run(false)}>{busy && !ok ? 'Checking…' : 'Check file'}</button>
      <button className="btn btn-primary" disabled={busy || !ok} onClick={() => run(true)}>{mode === 'replace' ? 'Replace opening stock' : 'Add these rows'}</button>
    </>}>
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">File (.xlsx or .csv)</label>
          <input ref={ref} type="file" accept=".xlsx,.csv" className="input !p-1.5" onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); setErr(''); }} />
          <div className="mt-1 flex gap-3 text-xs">
            <button type="button" className="text-brand-700 hover:underline" onClick={() => download('/api/stock/opening/template', { format: 'xlsx' }, 'opening-stock-template.xlsx').catch((e) => toast.error(e.message))}>Blank Excel template</button>
            <button type="button" className="text-brand-700 hover:underline" onClick={() => download('/api/stock/opening/template', {}, 'opening-stock-template.csv').catch((e) => toast.error(e.message))}>Blank CSV template</button>
          </div>
        </div>
        <fieldset>
          <legend className="label">What should happen to existing opening stock?</legend>
          <label className="mb-1 flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={mode === 'replace'} onChange={() => { setMode('replace'); setRes(null); }} /><span><b>Replace all</b> — only allowed before any stock has been posted</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={mode === 'append'} onChange={() => { setMode('append'); setRes(null); }} /><span><b>Add rows</b> — keeps existing rows; refuses warehouse/item/batch combinations that already exist</span></label>
        </fieldset>
      </div>
      <p className="mt-3 text-xs text-slate-500">Columns: Warehouse, Item Code, Item Name, Item Category Type Name, Batch Number, Quantity, Expiry Date, Brand Name, Stock Value. Warehouse, Item Code and Quantity are required. Nothing is written until you confirm.</p>
      {res && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            {[['Rows', res.counts.rows], ['Total quantity', n2(res.counts.quantity)], ['Errors', res.counts.errors], ['Warnings', res.counts.warnings ?? res.warnings?.length ?? 0]].map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">{k}</div><div className={`text-lg font-semibold tabular-nums ${k === 'Errors' && v ? 'text-red-600' : ''}`}>{v ?? '—'}</div></div>
            ))}
          </div>
          {res.counts.existingRows > 0 && res.mode === 'replace' && !res.committed && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">This will delete the {res.counts.existingRows} existing opening-stock rows and load the file instead.</p>}
          {!!res.errors?.length && <div><div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold text-red-700">Errors ({res.errors.length}) — fix the file and check again</h3><button type="button" className="btn btn-sm" onClick={() => downloadErrors(res.errors, res.warnings)}>Download error report</button></div><ul className="max-h-48 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs">{res.errors.slice(0, 100).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul></div>}
          {!!res.warnings?.length && <div><h3 className="mb-1 text-sm font-semibold text-amber-700">Warnings (import is still possible)</h3><ul className="max-h-32 overflow-auto rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">{res.warnings.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul></div>}
          {res.committed && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Import complete.</p>}
        </div>
      )}
    </Modal>
  );
}

function RowDialog({ row, onClose, onDone }) {
  const toast = useToast(); const edit = !!row;
  const [v, setV] = useState(edit ? { Warehouse: row.Warehouse, 'Item Code': row['Item Code'], 'Item Name': row['Item Name'], 'Batch Number': row['Batch Number'], Quantity: row['Opening Qty'], 'Expiry Date': row['Expiry Date'], 'Stock Value': row['Stock Value'], reason: '' } : { Warehouse: '', 'Item Code': '', 'Item Name': '', 'Item Category Type Name': '', 'Batch Number': '', Quantity: '', 'Expiry Date': '', 'Brand Name': '', 'Stock Value': '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (edit) await api.put('/api/stock/opening/row', { warehouse: v.Warehouse, itemCode: v['Item Code'], batch: v['Batch Number'], quantity: v.Quantity, expiry: v['Expiry Date'], stockValue: v['Stock Value'], reason: v.reason });
      else await api.post('/api/stock/opening/row', { row: v });
      toast.success(edit ? 'Opening stock updated' : 'Opening stock row added'); onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={edit ? `Edit opening stock — ${row['Item Code']} / ${row['Batch Number'] || 'no batch'}` : 'Add opening stock'} onClose={onClose} footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Warehouse *</label>{edit ? <input className="input" disabled value={v.Warehouse} /> : <Combobox field="Warehouse" value={v.Warehouse} onChange={(x) => set('Warehouse', x)} />}</div>
        <div><label className="label">Item *</label>{edit ? <input className="input" disabled value={`${v['Item Code']} — ${v['Item Name']}`} /> : <ItemPicker value={v['Item Code'] ? `${v['Item Code']} — ${v['Item Name']}` : ''} onChange={({ code, name }) => setV((s) => ({ ...s, 'Item Code': code, 'Item Name': name }))} />}</div>
        <div><label className="label">Batch number</label><input className="input" disabled={edit} value={v['Batch Number']} onChange={(e) => set('Batch Number', e.target.value)} /></div>
        <div><label className="label">Opening quantity *</label><input className="input" type="number" min="0" step="any" value={v.Quantity} onChange={(e) => set('Quantity', e.target.value)} /></div>
        <div><label className="label">Expiry date</label><input className="input" type="date" value={v['Expiry Date']} onChange={(e) => set('Expiry Date', e.target.value)} /></div>
        <div><label className="label">Stock value (₹)</label><input className="input" type="number" min="0" step="any" value={v['Stock Value']} onChange={(e) => set('Stock Value', e.target.value)} /></div>
        {!edit && <><div><label className="label">Category</label><input className="input" value={v['Item Category Type Name']} onChange={(e) => set('Item Category Type Name', e.target.value)} /></div><div><label className="label">Brand</label><input className="input" value={v['Brand Name']} onChange={(e) => set('Brand Name', e.target.value)} /></div></>}
        {edit && <div className="sm:col-span-2"><label className="label">Reason for change *</label><input className="input" value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Recorded in the audit log" /></div>}
      </div>
      {edit && <p className="mt-2 text-xs text-slate-500">Changing the opening quantity changes today's stock by the same amount. Item and batch cannot be changed; add a new row instead.</p>}
    </Modal>
  );
}

export default function OpeningStock() {
  const { tables } = useAuth(); const toast = useToast(); const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) || '']));
  const setF = (patch) => { const n = { ...f, ...patch }; setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v)), { replace: true }); };
  const [whs, setWhs] = useState([]); const [facets, setFacets] = useState({ categories: [], brands: [] }); const [info, setInfo] = useState(null);
  const [refresh, setRefresh] = useState(0); const [imp, setImp] = useState(false); const [rowDlg, setRowDlg] = useState(null);
  const canExport = tables['opening-stock']?.actions.includes('export');
  useEffect(() => { api.get('/api/lookup', { field: 'Warehouse' }).then((r) => setWhs((r.options || []).filter((o) => o.inScope !== false))).catch(() => {}); }, []);
  const tick = useTick();
  useEffect(() => {
    let live = true;
    api.get('/api/stock/opening', { ...f, pageSize: 1 }).then((r) => { if (live) { setInfo(r); setFacets(r.facets); } }).catch(() => {});
    return () => { live = false; };
  }, [sp, refresh, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = [
    { name: 'Warehouse' }, { name: 'Item Code' }, { name: 'Item Name' }, { name: 'Item Category Type Name', label: 'Category' }, { name: 'Brand Name', label: 'Brand' }, { name: 'Batch Number', label: 'Batch' },
    { name: 'Expiry Date', label: 'Expiry' }, { name: 'Expiry Status', render: (v) => (v === 'Valid' || v === 'No expiry' ? <span className="text-slate-500">{v}</span> : <StatusBadge value={v} />) },
    { name: 'Opening Qty', type: 'number' }, { name: 'Movement Since Opening', label: 'Movement', type: 'number', sortable: false }, { name: 'Qty As On Date', label: f.asOn ? `Qty on ${f.asOn}` : 'Qty till date', type: 'number' }, { name: 'Stock Value', type: 'number', render: (v) => inr(v) },
  ];
  const t = info?.totals;
  return (
    <>
      <PageHeader title="Opening Stock" subtitle="Stock loaded at go-live, by warehouse, item and batch. “Qty till date” adds all postings made after opening, up to the date you choose."
        actions={<>
          {canExport && <button className="btn" onClick={() => download('/api/stock/opening', { ...f, export: 'xlsx' }, 'opening-stock.xlsx').catch((e) => toast.error(e.message))}><Icon name="download" className="h-4 w-4" /> Excel</button>}
          {canExport && <button className="btn" onClick={() => download('/api/stock/opening', { ...f, export: 'csv' }, 'opening-stock.csv').catch((e) => toast.error(e.message))}><Icon name="download" className="h-4 w-4" /> CSV</button>}
          {info?.canImport && <button className="btn" onClick={() => setRowDlg({})}>+ Add opening stock</button>}
          {info?.canImport && <button className="btn btn-primary" onClick={() => setImp(true)}>Import</button>}
        </>} />
      <FilterBar onReset={() => setSp({}, { replace: true })}>
        <FilterItem label="Warehouse"><select className="input" value={f.warehouse} onChange={(e) => setF({ warehouse: e.target.value })}><option value="">All permitted</option>{whs.map((w) => <option key={w.value}>{w.value}</option>)}</select></FilterItem>
        <FilterItem label="Item" grow><input className="input" placeholder="code or name" value={f.item} onChange={(e) => setF({ item: e.target.value })} /></FilterItem>
        <FilterItem label="Batch"><input className="input" value={f.batch} onChange={(e) => setF({ batch: e.target.value })} /></FilterItem>
        <FilterItem label="Category"><select className="input" value={f.category} onChange={(e) => setF({ category: e.target.value })}><option value="">All</option>{facets.categories.map((c) => <option key={c}>{c}</option>)}</select></FilterItem>
        <FilterItem label="Brand"><select className="input" value={f.brand} onChange={(e) => setF({ brand: e.target.value })}><option value="">All</option>{facets.brands.map((c) => <option key={c}>{c}</option>)}</select></FilterItem>
        <FilterItem label="Expiry status"><select className="input" value={f.expiryStatus} onChange={(e) => setF({ expiryStatus: e.target.value })}><option value="">All</option><option>Expired</option><option>Expiring</option><option>Valid</option><option>No expiry</option></select></FilterItem>
        <FilterItem label="Expiry from"><input type="date" className="input" value={f.expiryFrom} onChange={(e) => setF({ expiryFrom: e.target.value })} /></FilterItem>
        <FilterItem label="Expiry to"><input type="date" className="input" value={f.expiryTo} onChange={(e) => setF({ expiryTo: e.target.value })} /></FilterItem>
        <FilterItem label="Stock as on date"><input type="date" className="input" value={f.asOn} onChange={(e) => setF({ asOn: e.target.value })} /></FilterItem>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={!!f.negative} onChange={(e) => setF({ negative: e.target.checked ? '1' : '' })} /> Negative rows only</label>
      </FilterBar>
      {t && (
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          {[['Rows', t.rows.toLocaleString()], ['Opening quantity', n2(t.openingQty)], [`Quantity as on ${info.asOn}`, n2(t.qtyAsOn)], ['Opening stock value', inr(t.value)]].map(([k, v]) => (
            <Card key={k}><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v}</div></Card>
          ))}
        </div>
      )}
      <DataTable endpoint="/api/stock/opening" columns={columns} params={f} refreshKey={refresh} searchPlaceholder="Search anything in the rows…" rowActions={info?.canImport ? (r) => <button className="btn btn-sm" onClick={() => setRowDlg({ row: r })}>Edit</button> : undefined} rowKey={(r) => `${r.Warehouse}|${r['Item Code']}|${r['Batch Number']}`} emptyText="No opening-stock rows match the filters" />
      {rowDlg && <RowDialog row={rowDlg.row} onClose={() => setRowDlg(null)} onDone={() => { setRowDlg(null); setRefresh((n) => n + 1); }} />}
      {imp && <ImportDialog onClose={() => setImp(false)} onDone={() => { setImp(false); setRefresh((n) => n + 1); }} />}
    </>
  );
}
