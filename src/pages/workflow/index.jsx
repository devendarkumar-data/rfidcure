import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, idemKey } from '../../api.js';
import { BASE_CURRENCY, CURRENCIES, PURCHASE_TYPES } from '../../../shared/po-options.js';
import { useAuth } from '../../auth.jsx';
import Card from '../../components/Card.jsx';
import Combobox from '../../components/Combobox.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterItem } from '../../components/FilterBar.jsx';
import ItemPicker from '../../components/ItemPicker.jsx';
import Modal from '../../components/Modal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useToast } from '../../components/Toast.jsx';

// ---------------------------------------------------------------------------------------------------------------------
// shared helpers
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
export const n2 = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const empty = (v) => v === '' || v === null || v === undefined;

export function useLoad(fn, deps) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const reload = useCallback(async () => {
    setErr('');
    try { setData(await fn()); } catch (e) { setErr(e.message); setData(null); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, err, reload, setData };
}
export const ErrorBox = ({ msg }) => msg ? <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div> : null;
export const Back = ({ to, children }) => <Link to={to} className="mb-1 inline-block text-sm text-brand-700 hover:underline">← {children}</Link>;
export const KV = ({ k, children }) => <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm">{empty(children) || children === '' ? <span className="text-slate-300">—</span> : children}</dd></div>;

// Editable line grid. cols: {k,label,type:'item'|'number'|'date'|'text'|'select'|'ro',options,num}
export function Grid({ cols, lines, onChange, readOnly = false, minLines = 1, errors = {}, extra, describe = true, onItem }) {
  const idRef = useRef(1000);
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  useEffect(() => { if (!readOnly && !lines.length && minLines) onChange([{ _k: idRef.current++ }]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cell = (c, l, i) => {
    const v = l[c.k] ?? '';
    if (readOnly || c.type === 'ro') return c.type === 'number' || c.num ? <span className="tabular-nums">{n2(v)}</span> : <span>{String(v) || <span className="text-slate-300">—</span>}</span>;
    if (c.type === 'item') return <div className="min-w-[15rem]"><ItemPicker value={l['Item Code'] ? `${l['Item Code']} — ${l.Items || ''}` : ''} disabled={!!l['Intent No']} onChange={({ code, name, unit, brand }) => set(i, { 'Item Code': code, Items: name, ...(describe ? { Description: name } : {}), Units: unit || 'NOS' }) || onItem?.(i, { code, name, unit, brand })} /></div>;
    if (c.type === 'ref') return <div className="min-w-[10rem]"><Combobox field={c.field} value={v} onChange={(x) => set(i, { [c.k]: x })} /></div>;
    if (c.type === 'select') return <select className="input min-w-[7rem]" value={v} onChange={(e) => set(i, { [c.k]: e.target.value })} aria-label={c.label}>{c.options.map((o) => <option key={o}>{o}</option>)}</select>;
    if (c.type === 'number') return <input className="input min-w-[6rem] text-right" type="number" min="0" step="any" value={v} onChange={(e) => set(i, { [c.k]: e.target.value })} aria-label={c.label} />;
    if (c.type === 'date') return <input className="input min-w-[9rem]" type="date" value={v} onChange={(e) => set(i, { [c.k]: e.target.value })} aria-label={c.label} />;
    return <input className="input min-w-[8rem]" value={v} onChange={(e) => set(i, { [c.k]: e.target.value })} aria-label={c.label} />;
  };
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead><tr><th className="th w-8">#</th>{cols.map((c) => <th key={c.k} className={`th ${c.type === 'number' || c.num ? 'text-right' : ''}`}>{c.label}</th>)}{!readOnly && <th className="th w-10" />}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={l._k ?? i} className={errors[i] ? 'bg-red-50' : ''}>
                <td className="td text-slate-400">{i + 1}</td>
                {cols.map((c) => <td key={c.k} className={`td align-top ${c.num ? 'text-right' : ''}`}>{cell(c, l, i)}</td>)}
                {!readOnly && <td className="td align-top"><button type="button" className="btn btn-sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="btn btn-sm" onClick={() => onChange([...lines, { _k: idRef.current++ }])}>+ Add line</button>{extra}</div>}
    </div>
  );
}

export function HistoryCard({ history }) {
  return (
    <Card title="History" pad={false}>
      {history?.length ? (
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead><tr>{['Date', 'Time', 'Event', 'From', 'To', 'User', 'Remarks'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{history.map((h, i) => (
            <tr key={i}><td className="td whitespace-nowrap">{h.Date}</td><td className="td whitespace-nowrap">{h.Time}</td><td className="td">{h.Event}</td><td className="td">{h['From Status']}</td><td className="td">{h['To Status']}</td><td className="td">{h['User ID']}</td><td className="td">{h.Remarks}</td></tr>
          ))}</tbody></table></div>
      ) : <p className="p-4 text-sm text-slate-500">No history yet.</p>}
    </Card>
  );
}

// Dialog asking for remarks before a workflow action.
export function RemarksDialog({ title, label = 'Remarks', required, confirmLabel, danger, onConfirm, onCancel }) {
  const [v, setV] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onCancel} footer={<><button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={async () => {
        if (required && !v.trim()) { setErr(`${label} are required`); return; }
        setBusy(true); try { await onConfirm(v.trim()); } catch (e) { setErr(e.message); setBusy(false); }
      }}>{busy ? 'Working…' : confirmLabel}</button></>}>
      <ErrorBox msg={err} />
      <label className="label" htmlFor="rm-text">{label}{required && <span className="text-red-600"> *</span>}</label>
      <textarea id="rm-text" className="input min-h-[5rem]" value={v} maxLength={1000} onChange={(e) => setV(e.target.value)} autoFocus />
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// PURCHASE INTENT
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const INTENT_STATUSES = ['Draft', 'Pending Review', 'Returned for Correction', 'Approved', 'Partially Converted to PO', 'Fully Converted to PO', 'Rejected', 'Closed'];
const intentCols = [
  { k: 'Items', label: 'Item', type: 'item' }, { k: 'Units', label: 'Units', type: 'text' }, { k: 'Current Stock', label: 'Current Stock', type: 'ro', num: true },
  { k: 'Quantity', label: 'Required Qty', type: 'number' }, { k: 'Required By Date', label: 'Required By', type: 'date' },
  { k: 'Priority', label: 'Priority', type: 'select', options: PRIORITIES }, { k: 'Reason', label: 'Reason', type: 'text' },
];

export function IntentForm() {
  const nav = useNavigate(); const toast = useToast(); const [sp] = useSearchParams(); const editId = sp.get('edit');
  const [key] = useState(() => idemKey());
  const [hdr, setHdr] = useState({ Date: todayIST(), 'Requesting Warehouse': '', 'Narration-Notes': '' });
  const [lines, setLines] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(!editId);
  const shortId = sp.get('short');
  useEffect(() => {
    if (!shortId || editId) return;
    api.get('/api/wf/reqs/get', { id: shortId }).then((r) => {
      const short = r.lines.filter((l) => l.Shortage > 0);
      if (!short.length) { setErr(`Mother Warehouse has enough stock for requisition ${shortId}; no indent needed.`); return; }
      setHdr((h) => ({ ...h, 'Requesting Warehouse': r.header['Issuing Warehouse'], 'Narration-Notes': `Shortage for Purchase Requisition ${shortId} (${r.header['Requesting Warehouse']})` }));
      setLines(short.map((l, i) => ({ _k: `s${i}`, 'Item Code': l['Item Code'], Items: l.Items, Units: l.Units, Quantity: l.Shortage, Reason: `Shortage for requisition ${shortId}`, Priority: r.header.Priority || 'Normal' })));
    }).catch((e) => setErr(e.message));
  }, [shortId, editId]);
  useEffect(() => {
    if (!editId) return;
    api.get('/api/wf/intents/get', { id: editId }).then((r) => { setHdr({ Date: r.header.Date, 'Requesting Warehouse': r.header['Requesting Warehouse'], 'Narration-Notes': r.header['Narration-Notes'] || '' }); setLines(r.lines.map((l, i) => ({ ...l, _k: `e${i}` }))); setReady(true); }).catch((e) => { setErr(e.message); setReady(true); });
  }, [editId]);
  const { user } = useAuth();
  const myWh = user?.scope?.mode === 'assigned' ? (user.scope.warehouses || []) : [];
  useEffect(() => { // default to the warehouse of the signed-in person
    if (!editId && !shortId && myWh.length) setHdr((h) => (h['Requesting Warehouse'] ? h : { ...h, 'Requesting Warehouse': myWh[0] }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wh = hdr['Requesting Warehouse']; const codesKey = lines.map((l) => l['Item Code']).filter(Boolean).join(',');
  const [levels, setLevels] = useState({});
  useEffect(() => {
    if (!wh || !codesKey) { setLevels({}); return undefined; }
    let live = true;
    api.get('/api/stock/levels', { codes: codesKey, warehouses: wh }).then((r) => { if (live) setLevels(r.levels || {}); }).catch(() => { if (live) setLevels({}); });
    return () => { live = false; };
  }, [wh, codesKey]);
  if (!ready) return <Spinner />;
  const cols = intentCols.map((c) => (c.k === 'Current Stock' ? { ...c, label: `Current stock${wh ? ` at ${wh}` : ''}` } : c));
  const shown = lines.map((l) => (l['Item Code'] && wh ? { ...l, 'Current Stock': levels[l['Item Code']]?.[wh.toUpperCase()] ?? 0 } : l));
  const save = async (submit) => {
    setErr('');
    if (!hdr['Requesting Warehouse']) return setErr('Select the requesting warehouse');
    const out = lines.filter((l) => l['Item Code']).map(({ _k, ...l }) => Object.fromEntries(Object.entries(l).filter(([, v]) => !empty(v))));
    if (!out.length) return setErr('Add at least one item');
    for (const [i, l] of out.entries()) { if (!(num(l.Quantity) > 0)) return setErr(`Line ${i + 1}: enter a required quantity greater than zero`); if (l['Required By Date'] && l['Required By Date'] < hdr.Date) return setErr(`Line ${i + 1}: Required By date is before the intent date`); }
    setBusy(true);
    try {
      const body = { header: Object.fromEntries(Object.entries(hdr).filter(([, v]) => !empty(v))), lines: out, submit };
      const r = editId ? await api.put(`/api/wf/intents?id=${encodeURIComponent(editId)}`, body) : await api.post('/api/wf/intents', body, { headers: { 'Idempotency-Key': key } });
      toast.success(submit ? `Purchase Intent ${r.id} submitted for review` : `Purchase Intent ${r.id} saved as draft`);
      nav(`/purchase-intent/${encodeURIComponent(r.id)}`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader back={<Back to="/purchase-intent">Purchase Intents</Back>} title={editId ? `Edit Purchase Intent ${editId}` : 'Create Purchase Intent'} subtitle="Request material for a warehouse. Intents never change stock." />
      <ErrorBox msg={err} />
      <Card title="Header" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label">Date</label><input type="date" className="input" value={hdr.Date} onChange={(e) => setHdr({ ...hdr, Date: e.target.value })} /></div>
          <div><label className="label">Requesting Warehouse <span className="text-red-600">*</span></label><Combobox field="Requesting Warehouse" allowFree={false} value={hdr['Requesting Warehouse']} onChange={(v) => setHdr({ ...hdr, 'Requesting Warehouse': v })} /></div>
          <div className="sm:col-span-3"><label className="label">Notes</label><textarea className="input min-h-[3.5rem]" value={hdr['Narration-Notes']} maxLength={1000} onChange={(e) => setHdr({ ...hdr, 'Narration-Notes': e.target.value })} /></div>
        </div>
      </Card>
      <Card title="Items" className="mb-4"><Grid cols={cols} lines={shown} onChange={setLines} /><p className="mt-2 text-xs text-slate-500">Unit comes from the item (UOM column in Item Master; NOS if not set). Current stock is live from the stock ledger for the requesting warehouse{myWh.length ? ` (you are assigned to ${myWh.join(', ')})` : ''}.</p></Card>
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn" disabled={busy} onClick={() => nav(-1)}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Submit for review'}</button>
      </div>
    </>
  );
}
export function IntentRegister() {
  const nav = useNavigate(); const toast = useToast(); const { tables } = useAuth(); const [sp, setSp] = useSearchParams();
  const f = { status: sp.get('status') || '', from: sp.get('from') || '', to: sp.get('to') || '', warehouse: sp.get('warehouse') || '', item: sp.get('item') || '', requestedBy: sp.get('requestedBy') || '', reviewer: sp.get('reviewer') || '', priority: sp.get('priority') || '' };
  const setF = (patch) => { const n = { ...f, ...patch }; setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v)), { replace: true }); };
  const [refresh, setRefresh] = useState(0); const [dlg, setDlg] = useState(null);
  const t = tables['purchase-indent']; const poCreate = tables['purchase-order-domestic']?.actions.includes('create');
  const act = async (id, action, remarks) => { try { await api.post(`/api/wf/intents/action?id=${encodeURIComponent(id)}`, { action, remarks }); toast.success(`Intent ${id}: ${action} done`); setRefresh((n) => n + 1); } catch (e) { toast.error(e.message); throw e; } };
  const columns = [
    { name: 'Document No.', render: (v) => <span className="font-medium text-brand-700">{v}</span> }, { name: 'Date' }, { name: 'Requesting Warehouse', label: 'Warehouse' }, { name: 'Requested By' }, { name: 'Purchase Manager', label: 'Reviewer' },
    { name: 'Priority' }, { name: 'Item Summary', sortable: false }, { name: 'Total Required Qty', label: 'Required', type: 'number', sortable: false }, { name: 'Total Approved Qty', label: 'Approved', type: 'number', sortable: false },
    { name: 'Ordered Qty', label: 'Ordered', type: 'number', sortable: false }, { name: 'Status' },
  ];
  return (
    <>
      <PageHeader title="Purchase Intents" subtitle={f.status ? `Status: ${f.status}` : 'All intents you can see'} actions={t?.actions.includes('create') && <Link className="btn btn-primary" to="/purchase-intent/new">+ New Purchase Intent</Link>} />
      <FilterBar onReset={() => setSp({}, { replace: true })}>
        <FilterItem label="Status"><select className="input" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">All</option>{INTENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></FilterItem>
        <FilterItem label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></FilterItem>
        <FilterItem label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} /></FilterItem>
        <FilterItem label="Warehouse"><input className="input" value={f.warehouse} placeholder="e.g. DWH" onChange={(e) => setF({ warehouse: e.target.value })} /></FilterItem>
        <FilterItem label="Item"><input className="input" value={f.item} placeholder="code or name" onChange={(e) => setF({ item: e.target.value })} /></FilterItem>
        <FilterItem label="Requested by"><input className="input" value={f.requestedBy} onChange={(e) => setF({ requestedBy: e.target.value })} /></FilterItem>
        <FilterItem label="Reviewer"><input className="input" value={f.reviewer} onChange={(e) => setF({ reviewer: e.target.value })} /></FilterItem>
        <FilterItem label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ priority: e.target.value })}><option value="">All</option>{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></FilterItem>
      </FilterBar>
      <DataTable endpoint="/api/wf/intents" columns={columns} params={f} refreshKey={refresh} exportable exportName="purchase-intents" searchPlaceholder="Search number, item, warehouse…" defaultSort={{ col: 'Date', dir: 'desc' }}
        rowKey={(r) => r['Document No.']} onRowClick={(r) => nav(`/purchase-intent/${encodeURIComponent(r['Document No.'])}`)}
        rowActions={(r) => (
          <div className="flex justify-end gap-1">
            <Link className="btn btn-sm" to={`/purchase-intent/${encodeURIComponent(r['Document No.'])}`}>{r.actions.approve ? 'Review' : 'View'}</Link>
            {r.actions.approve && <button className="btn btn-sm btn-primary" title="Approve the full requested quantity" onClick={(e) => { e.stopPropagation(); act(r['Document No.'], 'approve').catch(() => {}); }}>Approve</button>}
            {r.actions.reject && <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setDlg(<RemarksDialog title={`Reject intent ${r['Document No.']}`} required danger confirmLabel="Reject" onConfirm={(rm) => act(r['Document No.'], 'reject', rm).then(() => setDlg(null)).catch(() => {})} onCancel={() => setDlg(null)} />); }}>Reject</button>}
            {r.actions.edit && <Link className="btn btn-sm" to={`/purchase-intent/new?edit=${encodeURIComponent(r['Document No.'])}`}>Edit</Link>}
            {r.actions.submit && <button className="btn btn-sm" onClick={() => act(r['Document No.'], 'submit').catch(() => {})}>Submit</button>}
            {r.actions.convert && poCreate && <Link className="btn btn-sm btn-primary" to={`/purchasing/po/new?intent=${encodeURIComponent(r['Document No.'])}`}>Create PO</Link>}
          </div>
        )} />
      {dlg}
    </>
  );
}

export function IntentDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const { tables } = useAuth();
  const { data, err, reload } = useLoad(() => api.get('/api/wf/intents/get', { id }), [id]);
  const [dlg, setDlg] = useState(null); const [appr, setAppr] = useState({}); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) setAppr(Object.fromEntries(data.lines.map((l) => [l['Line No'], l.Quantity]))); }, [data]);
  if (err) return <><Back to="/purchase-intent">Purchase Intents</Back><ErrorBox msg={err} /></>;
  if (!data) return <Spinner />;
  const { header, lines, status, can, history } = data; const reviewing = can.approve;
  const run = async (action, remarks, body = {}) => { await api.post(`/api/wf/intents/action?id=${encodeURIComponent(id)}`, { action, remarks, ...body }); toast.success(`Intent ${id}: ${action} done`); setDlg(null); reload(); };
  const doApprove = async () => {
    setMsg('');
    try { await run('approve', '', { lines: lines.map((l) => ({ lineNo: l['Line No'], approvedQty: num(appr[l['Line No']]) })) }); } catch (e) { setMsg(e.message); }
  };
  const poCreate = tables['purchase-order-domestic']?.actions.includes('create');
  return (
    <>
      <PageHeader back={<Back to="/purchase-intent">Purchase Intents</Back>} title={`Purchase Intent ${id}`} subtitle={<StatusBadge value={status.Status} />}
        actions={<>
          {can.edit && <Link className="btn" to={`/purchase-intent/new?edit=${encodeURIComponent(id)}`}>Edit</Link>}
          {can.submit && <button className="btn btn-primary" onClick={() => run('submit').catch((e) => toast.error(e.message))}>Submit for review</button>}
          {can.convert && poCreate && <Link className="btn btn-primary" to={`/purchasing/po/new?intent=${encodeURIComponent(id)}`}>Create PO</Link>}
          {can.close && <button className="btn" onClick={() => setDlg('close')}>Close intent</button>}
        </>} />
      <ErrorBox msg={msg} />
      <Card title="Header" className="mb-4"><dl className="grid gap-4 sm:grid-cols-4">
        <KV k="Date">{header.Date}</KV><KV k="Warehouse">{header['Requesting Warehouse']}</KV><KV k="Requested by">{status['Created By']}</KV><KV k="Submitted">{status['Submitted At']?.slice(0, 16).replace('T', ' ')}</KV>
        <KV k="Reviewed by">{status['Reviewed By']}</KV><KV k="Reviewed at">{status['Reviewed At']?.slice(0, 16).replace('T', ' ')}</KV><KV k="Review remarks">{status['Review Remarks']}</KV><KV k="Notes">{header['Narration-Notes']}</KV>
      </dl></Card>
      <Card title={reviewing ? 'Items — set approved quantity per line' : 'Items'} pad={false} className="mb-4">
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead><tr>{['#', 'Item', 'Units', 'Current Stock', 'Required', 'Required By', 'Priority', 'Reason', 'Approved', 'Ordered', 'Remaining'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{lines.map((l) => (
            <tr key={l['Line No']}><td className="td">{l['Line No']}</td><td className="td"><div className="font-medium">{l.Items}</div><div className="text-xs text-slate-500">{l['Item Code']}</div></td><td className="td">{l.Units || 'NOS'}</td>
              <td className="td text-right tabular-nums">{n2(l['Current Stock'])}</td><td className="td text-right tabular-nums">{n2(l.Quantity)}</td><td className="td">{l['Required By Date']}</td><td className="td"><StatusBadge value={l.Priority} /></td><td className="td">{l.Reason}</td>
              <td className="td text-right">{reviewing ? <input className="input w-24 text-right" type="number" min="0" max={l.Quantity} step="any" aria-label={`Approved qty line ${l['Line No']}`} value={appr[l['Line No']] ?? ''} onChange={(e) => setAppr({ ...appr, [l['Line No']]: e.target.value })} /> : <span className="tabular-nums">{n2(l['Approved Qty'])}</span>}</td>
              <td className="td text-right tabular-nums">{n2(l['Ordered Qty'])}</td><td className="td text-right tabular-nums">{n2(l['Remaining Qty'])}</td></tr>
          ))}</tbody></table></div>
      </Card>
      {reviewing && (
        <Card title="Purchase Manager review" className="mb-4"><div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={doApprove}>Approve</button>
          <button className="btn" onClick={() => setDlg('return')}>Return for correction</button>
          <button className="btn btn-danger" onClick={() => setDlg('reject')}>Reject</button>
        </div></Card>
      )}
      <HistoryCard history={history} />
      {dlg === 'reject' && <RemarksDialog title="Reject Purchase Intent" required danger confirmLabel="Reject" onConfirm={(r) => run('reject', r)} onCancel={() => setDlg(null)} />}
      {dlg === 'return' && <RemarksDialog title="Return for correction" required confirmLabel="Return" onConfirm={(r) => run('return', r)} onCancel={() => setDlg(null)} />}
      {dlg === 'close' && <RemarksDialog title="Close Purchase Intent" required confirmLabel="Close" onConfirm={(r) => run('close', r)} onCancel={() => setDlg(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// PURCHASE ORDER
const PO_VIEWS = { 'pending-auth': 'PO Pending Authorization', pending: 'Pending Purchase Orders (authorized, not fully received)', approved: 'Authorized POs', all: 'All Purchase Orders' };
// Display names for PO statuses (stored values are unchanged)
export const PO_LABEL = { 'Pending Authorization': 'PO Pending Authorization', Approved: 'PO Authorized' };
export const poLabel = (s) => PO_LABEL[s] || s;
const PO_STATUSES = ['Draft', 'Pending Authorization', 'Returned for Correction', 'Approved', 'Partially Received', 'Completed', 'Rejected', 'Closed', 'Cancelled'];

// client-side mirror of server calcPoLines, for live totals only (the server recalculates)
function calc(type, hdr, lines) {
  const igst = /^yes$/i.test(hdr['Is IGST'] || ''); const fx = type === 'import' ? num(hdr['Exchange Rate']) || 1 : 1;
  let sub = 0, tax = 0, grand = 0;
  const out = lines.map((l) => {
    const gross = r2(num(l.Quantity) * num(l.Rate) * fx), taxable = r2(Math.max(0, gross - num(l['Other Discount'])));
    if (type === 'domestic') { const t = r2(taxable * num(l['GST %']) / 100); sub += taxable; tax += t; grand += taxable + t; return { ...l, Gross: gross, 'Taxable Value': taxable, 'Line Total': r2(taxable + t), _tax: t, _igst: igst }; }
    const tot = r2(taxable + num(l['PKG Charges'])); sub += tot; grand += tot; return { ...l, Gross: gross, 'Line Total': tot };
  });
  return { lines: out, subtotal: r2(sub), tax: r2(tax), grand: r2(grand) };
}

const poCols = (type) => (type === 'domestic' ? [
  { k: 'Items', label: 'Items', type: 'item' }, { k: 'Description', label: 'Description', type: 'text' }, { k: 'Warehouse', label: 'Warehouse', type: 'ref', field: 'Warehouse' }, { k: 'Units', label: 'Units', type: 'text' },
  { k: 'Current Stock', label: 'Closing Stock', type: 'ro', num: true }, { k: 'Reorder Level', label: 'Reorder Level', type: 'number' }, { k: 'Nos. of Pcs/Box', label: 'Nos. of Pcs/Box', type: 'number' },
  { k: 'Quantity', label: 'Quantity', type: 'number' }, { k: 'Rate', label: 'Rate', type: 'number' }, { k: 'SP Rate', label: 'SP Rate', type: 'number' },
  { k: 'Price Type', label: 'Price Type', type: 'select', options: ['', 'Price Book', 'Special Book'] }, { k: 'Price Book Rate', label: 'Price Book Rate', type: 'number' }, { k: 'Special Rate', label: 'Special Rate', type: 'number' }, { k: 'Last PO Rate', label: 'Last PO Rate', type: 'number' },
  { k: 'Brand', label: 'Brand', type: 'ref', field: 'Brand' }, { k: 'Item Group', label: 'Item Group', type: 'ref', field: 'Item Group' }, { k: 'Division', label: 'Division', type: 'ref', field: 'Division' },
  { k: 'Other Discount', label: 'Discount', type: 'number' }, { k: 'GST %', label: 'GST %', type: 'number' },
  { k: 'Intent No', label: 'Intent', type: 'ro' }, { k: 'Intent Line', label: 'Int. line', type: 'ro' }, { k: 'Line Total', label: 'Line Total', type: 'ro', num: true },
] : [
  { k: 'Items', label: 'Item', type: 'item' }, { k: 'Units', label: 'Units', type: 'text' }, { k: 'Intent No', label: 'Intent', type: 'ro' }, { k: 'Intent Line', label: 'Int. line', type: 'ro' },
  { k: 'Quantity', label: 'Quantity', type: 'number' }, { k: 'Rate', label: 'Rate (FX)', type: 'number' }, { k: 'Other Discount', label: 'Discount', type: 'number' },
  { k: 'PKG Charges', label: 'PKG Charges', type: 'number' }, { k: 'Line Total', label: 'Line Total', type: 'ro', num: true },
]);

export function PoForm() {
  const nav = useNavigate(); const toast = useToast(); const { user } = useAuth(); const [sp] = useSearchParams(); const editId = sp.get('edit'); const intentParam = sp.get('intent');
  const [key] = useState(() => idemKey());
  const [type, setType] = useState('domestic');
  const [canChoose, setCanChoose] = useState(true); const [whList, setWhList] = useState([]);
  const [hdr, setHdr] = useState({ Date: todayIST(), 'Type Of Purchase': '', 'Voucher Prefix': 'PO', 'Vendor Account': '', Location: '', 'Is IGST': 'No', 'Place of Supply': '', 'Payment Terms': '', 'Terms of Delivery': '', 'Narration-Notes': '', 'Supplier Ref No': '', 'Exchange Rate': '', Currency: '' });
  const [lines, setLines] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(false); const [override, setOverride] = useState(''); const [needOverride, setNeedOverride] = useState(false);
  const canOverride = ['super_admin', 'admin', 'purchase_manager'].includes(user?.role) || user?.actions?.includes?.('po:approve');

  const addFromIntents = useCallback((rows) => {
    setLines((cur) => {
      const have = new Set(cur.map((l) => `${l['Intent No']}|${l['Intent Line']}`));
      const add = rows.filter((x) => !have.has(`${x.no}|${x.line.lineNo}`)).map((x, i) => ({ _k: `n${Date.now()}${i}`, 'Item Code': x.line.itemCode, Items: x.line.items, Description: x.line.description || x.line.items, Units: x.line.units, Quantity: x.line.remaining, 'GST %': '', 'Intent No': x.no, 'Intent Line': x.line.lineNo }));
      return [...cur.filter((l) => l['Item Code'] || l['Intent No']), ...add];
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (editId) {
          const r = await api.get('/api/wf/pos/get', { id: editId });
          setType(r.poType); setHdr((h) => ({ ...h, ...r.header })); setLines(r.lines.map((l, i) => ({ ...l, _k: `e${i}` })));
        } else {
          const d = await api.get('/api/wf/pos/defaults'); setHdr((h) => ({ ...h, Location: d.location })); setCanChoose(d.canChooseWarehouse); setWhList(d.warehouses || []);
          if (intentParam) { const r = await api.get('/api/wf/intents/open', { q: intentParam }); const it = r.rows.find((x) => x['Document No.'] === intentParam); if (it) addFromIntents(it.lines.map((line) => ({ no: it['Document No.'], line }))); else setErr(`Intent ${intentParam} has no approved quantity left to order`); }
        }
      } catch (e) { setErr(e.message); } finally { setReady(true); }
    })();
  }, [editId, intentParam, addFromIntents]);

  const onItem = (i, it) => {
    if (type !== 'domestic') return;
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, Description: it.name, Brand: it.brand || l.Brand, Warehouse: l.Warehouse || hdr.Location } : l)));
    api.get('/api/wf/pos/item-info', { code: it.code, warehouse: hdr.Location }).then((r) => setLines((cur) => cur.map((l, j) => (j === i && l['Item Code'] === it.code ? { ...l, 'Current Stock': r.currentStock, 'Reorder Level': r.reorderLevel || l['Reorder Level'], 'Last PO Rate': r.lastRate || l['Last PO Rate'], Brand: r.brand || l.Brand, Units: l.Units || r.unit } : l)))).catch(() => {});
  };
  const c = useMemo(() => calc(type, hdr, lines), [type, hdr, lines]);
  if (!ready) return <Spinner />;
  const setH = (k, v) => setHdr((h) => ({ ...h, [k]: v }));
  const save = async (submit) => {
    setErr('');
    if (!hdr['Vendor Account']) return setErr('Select a vendor');
    if (type === 'import' && !hdr.Currency) return setErr('Select the currency');
    if (type === 'import' && !(num(hdr['Exchange Rate']) > 0)) return setErr('Enter the exchange rate');
    const out = c.lines.filter((l) => l['Item Code']).map(({ _k, _tax, _igst, ...l }) => Object.fromEntries(Object.entries(l).filter(([, v]) => !empty(v))));
    if (!out.length) return setErr('Add at least one item');
    for (const [i, l] of out.entries()) { if (!(num(l.Quantity) > 0)) return setErr(`Line ${i + 1}: enter a quantity`); if (!(num(l.Rate) > 0)) return setErr(`Line ${i + 1}: enter a rate`); }
    const header = Object.fromEntries(Object.entries(hdr).filter(([k, v]) => !empty(v) && !(type === 'domestic' && ['Exchange Rate', 'Currency'].includes(k)) && !(type === 'import' && ['Is IGST', 'Place of Supply', 'Payment Terms'].includes(k)) && !['Status', 'Document No.', 'Submit For Approval'].includes(k)));
    setBusy(true);
    try {
      const body = { poType: type, header, lines: out, submit, ...(override.trim() ? { override: { reason: override.trim() } } : {}) };
      const r = editId ? await api.put(`/api/wf/pos?id=${encodeURIComponent(editId)}`, body) : await api.post('/api/wf/pos', body, { headers: { 'Idempotency-Key': key } });
      toast.success(submit ? `PO ${r.id} created — PO Pending Authorization` : `PO ${r.id} saved as draft`);
      nav(`/purchasing/po/${encodeURIComponent(r.id)}`);
    } catch (e) { setErr(e.message); if (/exceeds the remaining approved/.test(e.message)) setNeedOverride(true); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader back={<Back to="/purchasing/po">Purchase Orders</Back>} title={editId ? `Edit PO ${editId}` : 'Create Purchase Order'} subtitle="Raise the PO from approved Purchase Intents. Stock changes only when goods are received (GRN)." />
      <ErrorBox msg={err} />
      <Card title="Header" className="mb-4">
        <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {!editId && <div><label className="label" htmlFor="po-cat">Purchase category</label><select id="po-cat" className="input" value={type} onChange={(e) => { setType(e.target.value); setLines([]); }}><option value="domestic">Domestic</option><option value="import">Import</option></select></div>}
          <div><label className="label">Type of purchase</label><select className="input" value={hdr['Type Of Purchase']} onChange={(e) => setH('Type Of Purchase', e.target.value)}><option value="">Select…</option>{PURCHASE_TYPES.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><label className="label">Date</label><input type="date" className="input" value={hdr.Date} onChange={(e) => setH('Date', e.target.value)} /></div>
          <div><label className="label">Vendor <span className="text-red-600">*</span></label><Combobox field="Vendor Account" value={hdr['Vendor Account']} onChange={(v) => setH('Vendor Account', v)} /></div>
          {canChoose && <div><label className="label">Warehouse / Location</label><select className="input" value={hdr.Location} onChange={(e) => setH('Location', e.target.value)}>{!hdr.Location && <option value="">Select…</option>}{[...new Set([hdr.Location, ...whList].filter(Boolean))].map((w) => <option key={w}>{w}</option>)}</select></div>}
          <div><label className="label">Voucher prefix</label><input className="input" value={hdr['Voucher Prefix']} onChange={(e) => setH('Voucher Prefix', e.target.value)} /></div>
          <div><label className="label">Supplier reference</label><input className="input" value={hdr['Supplier Ref No']} onChange={(e) => setH('Supplier Ref No', e.target.value)} /></div>
          {type === 'domestic' ? (<>
            <div><label className="label">Currency</label><input className="input bg-slate-50" readOnly value={`${BASE_CURRENCY[0]} – ${BASE_CURRENCY[1]}`} /></div>
            <div><label className="label">IGST?</label><select className="input" value={hdr['Is IGST']} onChange={(e) => setH('Is IGST', e.target.value)}><option>No</option><option>Yes</option></select></div>
            <div><label className="label">Place of supply</label><Combobox field="Place of Supply" value={hdr['Place of Supply']} onChange={(v) => setH('Place of Supply', v)} /></div>
            <div className="sm:col-span-2"><label className="label">Payment terms</label><textarea rows={1} className="input h-9 min-h-0 resize-y py-1.5" value={hdr['Payment Terms']} onChange={(e) => setH('Payment Terms', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Terms of delivery</label><textarea rows={1} className="input h-9 min-h-0 resize-y py-1.5" value={hdr['Terms of Delivery']} onChange={(e) => setH('Terms of Delivery', e.target.value)} /></div>
          </>) : (<>
            <div><label className="label">Currency <span className="text-red-600">*</span></label><select className="input" value={hdr.Currency} onChange={(e) => setH('Currency', e.target.value)}><option value="">Select…</option>{CURRENCIES.map(([c, n]) => <option key={c} value={c}>{c} – {n}</option>)}</select></div>
            <div><label className="label">Exchange rate (INR per {hdr.Currency || 'unit'}) <span className="text-red-600">*</span></label><input className="input" type="number" min="0" step="any" value={hdr['Exchange Rate']} onChange={(e) => setH('Exchange Rate', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Terms of delivery</label><textarea rows={1} className="input h-9 min-h-0 resize-y py-1.5" value={hdr['Terms Of Delivery'] || ''} onChange={(e) => setH('Terms Of Delivery', e.target.value)} /></div>
          </>)}
          <div className="sm:col-span-2 lg:col-span-4"><label className="label">Notes</label><textarea rows={1} className="input h-9 min-h-0 resize-y py-1.5" value={hdr['Narration-Notes']} onChange={(e) => setH('Narration-Notes', e.target.value)} /></div>
        </div>
      </Card>
      <Card title="Items" className="mb-4">
        <Grid cols={poCols(type)} lines={c.lines} onChange={setLines} onItem={onItem} extra={<button type="button" className="btn btn-sm btn-primary" onClick={() => setPicker(true)}>+ Add from approved intents</button>} />
        <dl className="mt-4 ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
          <dt className="text-slate-500">Subtotal</dt><dd className="text-right tabular-nums">{inr(c.subtotal)}</dd>
          {type === 'domestic' && <><dt className="text-slate-500">{/^yes$/i.test(hdr['Is IGST']) ? 'IGST' : 'CGST + SGST'}</dt><dd className="text-right tabular-nums">{inr(c.tax)}</dd></>}
          {type === 'import' && num(hdr['Exchange Rate']) > 0 && <><dt className="text-slate-500">Total in {hdr.Currency || 'foreign currency'}</dt><dd className="text-right tabular-nums">{n2(c.grand / num(hdr['Exchange Rate']))}</dd></>}
          <dt className="font-semibold">Grand total (INR){type === 'import' ? ' equivalent' : ''}</dt><dd className="text-right font-semibold tabular-nums">{inr(c.grand)}</dd>
        </dl>
      </Card>
      {needOverride && canOverride && (
        <Card title="Override approved intent quantity" className="mb-4"><p className="mb-2 text-sm text-slate-600">Your role may exceed the approved quantity with a recorded reason.</p>
          <input className="input" placeholder="Reason (recorded in history)" value={override} onChange={(e) => setOverride(e.target.value)} /></Card>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn" disabled={busy} onClick={() => nav(editId ? `/purchasing/po/${encodeURIComponent(editId)}` : '/purchasing/po')}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save as Draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Create PO'}</button>
      </div>
      {picker && <IntentPicker onClose={() => setPicker(false)} onAdd={(rows) => { addFromIntents(rows); setPicker(false); }} />}
    </>
  );
}

function IntentPicker({ onClose, onAdd }) {
  const [q, setQ] = useState(''); const { data, err } = useLoad(() => api.get('/api/wf/intents/open', { q }), [q]); const [sel, setSel] = useState({});
  const rows = data?.rows || [];
  const chosen = rows.flatMap((i) => i.lines.filter((l) => sel[`${i['Document No.']}|${l.lineNo}`]).map((line) => ({ no: i['Document No.'], line })));
  return (
    <Modal wide title="Add from approved Purchase Intents" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!chosen.length} onClick={() => onAdd(chosen)}>Add {chosen.length || ''} line{chosen.length === 1 ? '' : 's'}</button></>}>
      <input className="input mb-3" placeholder="Search intent number, item, warehouse…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox msg={err} />
      {!data ? <Spinner /> : !rows.length ? <p className="text-sm text-slate-500">No approved intents with quantity left to order.</p> : rows.map((i) => (
        <div key={i['Document No.']} className="mb-3 rounded-md border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-sm"><b>{i['Document No.']}</b><span className="text-slate-500">{i.Date} · {i['Requesting Warehouse']}</span><StatusBadge value={i.status} /></div>
          {i.lines.map((l) => { const k = `${i['Document No.']}|${l.lineNo}`; return (
            <label key={k} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0 hover:bg-brand-50/40">
              <input type="checkbox" checked={!!sel[k]} onChange={(e) => setSel({ ...sel, [k]: e.target.checked })} />
              <span className="flex-1">{l.items} <span className="text-xs text-slate-500">({l.itemCode})</span></span>
              <span className="text-xs text-slate-500">approved {n2(l.approved)} · ordered {n2(l.ordered)}</span><b className="tabular-nums">remaining {n2(l.remaining)}</b>
            </label>); })}
        </div>
      ))}
    </Modal>
  );
}

export function PoRegister() {
  const nav = useNavigate(); const { tables } = useAuth(); const [sp, setSp] = useSearchParams();
  const view = PO_VIEWS[sp.get('view')] ? sp.get('view') : 'all';
  const f = { view, status: sp.get('status') || '', from: sp.get('from') || '', to: sp.get('to') || '', vendor: sp.get('vendor') || '', intent: sp.get('intent') || '', type: sp.get('type') || '' };
  const setF = (patch) => { const n = { ...f, ...patch }; setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v)), { replace: true }); };
  const t = tables['purchase-order-domestic'];
  const toast = useToast(); const [rk, setRk] = useState(0); const [dlg, setDlg] = useState(null);
  const act = async (id, action, remarks) => { try { await api.post(`/api/wf/pos/action?id=${encodeURIComponent(id)}`, { action, remarks }); toast.success(`PO ${id}: ${action === 'approve' ? 'authorized' : 'rejected'}`); setRk((n) => n + 1); } catch (e) { toast.error(e.message); throw e; } };
  const columns = [
    { name: 'Document No.', label: 'PO No.', render: (v) => <span className="font-medium text-brand-700">{v}</span> }, { name: 'Date' }, { name: 'PO Type', sortable: false }, { name: 'Vendor Account', label: 'Vendor' },
    { name: 'Source Purchase Intent', label: 'Intent', sortable: false }, { name: 'Item Summary', sortable: false }, { name: 'Total Quantity', label: 'Qty', type: 'number', sortable: false },
    ...(view === 'pending-auth' || view === 'all' ? [{ name: 'Created By', sortable: false }, { name: 'Submitted At', label: 'Submitted', sortable: false, render: (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—') }] : []),
    ...(view !== 'pending-auth' ? [{ name: 'Received Quantity', label: 'Received', type: 'number', sortable: false }, { name: 'Balance Quantity', label: 'Balance', type: 'number', sortable: false }, { name: 'GRN Status', sortable: false }] : []),
    { name: 'Grand Total', label: 'Value', type: 'number', render: (v) => inr(v) }, { name: 'Status', render: (v) => <StatusBadge value={poLabel(v)} /> },
  ];
  return (
    <>
      <PageHeader title={PO_VIEWS[view]} actions={t?.actions.includes('create') && <Link className="btn btn-primary" to="/purchasing/po/new">+ Create PO</Link>} />
      <FilterBar onReset={() => setSp({ view }, { replace: true })}>
        {view === 'all' && <FilterItem label="Status"><select className="input" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">All</option>{PO_STATUSES.map((s) => <option key={s} value={s}>{poLabel(s)}</option>)}</select></FilterItem>}
        <FilterItem label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></FilterItem>
        <FilterItem label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} /></FilterItem>
        <FilterItem label="Vendor"><input className="input" value={f.vendor} onChange={(e) => setF({ vendor: e.target.value })} /></FilterItem>
        <FilterItem label="Intent no."><input className="input" value={f.intent} onChange={(e) => setF({ intent: e.target.value })} /></FilterItem>
        <FilterItem label="Type"><select className="input" value={f.type} onChange={(e) => setF({ type: e.target.value })}><option value="">All</option><option value="domestic">Domestic</option><option value="import">Import</option></select></FilterItem>
      </FilterBar>
      <DataTable key={view} endpoint="/api/wf/pos" columns={columns} params={f} refreshKey={rk} exportable exportName={`purchase-orders-${view}`} searchPlaceholder="Search PO, vendor, item, intent…" defaultSort={{ col: 'Date', dir: 'desc' }}
        rowKey={(r) => r['Document No.']} onRowClick={(r) => nav(`/purchasing/po/${encodeURIComponent(r['Document No.'])}`)}
        rowActions={(r) => (
          <div className="flex justify-end gap-1">
            <Link className="btn btn-sm" to={`/purchasing/po/${encodeURIComponent(r['Document No.'])}`}>{r.actions.approve ? 'Authorize' : 'View'}</Link>
            {r.actions.approve && <button className="btn btn-sm btn-primary" title="Authorize the PO as raised" onClick={(e) => { e.stopPropagation(); act(r['Document No.'], 'approve').catch(() => {}); }}>Approve</button>}
            {r.actions.reject && <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setDlg(<RemarksDialog title={`Reject PO ${r['Document No.']}`} required danger confirmLabel="Reject" onConfirm={(rm) => act(r['Document No.'], 'reject', rm).then(() => setDlg(null)).catch(() => {})} onCancel={() => setDlg(null)} />); }}>Reject</button>}
            {r.actions.receive && <Link className="btn btn-sm btn-primary" to={`/grn/new?po=${encodeURIComponent(r['Document No.'])}`}>Receive</Link>}
          </div>
        )} />
      {dlg}
    </>
  );
}

export function PoDetail() {
  const { id } = useParams(); const toast = useToast(); const { user } = useAuth();
  const { data, err, reload } = useLoad(() => api.get('/api/wf/pos/get', { id }), [id]);
  const [dlg, setDlg] = useState(null); const [edit, setEdit] = useState({}); const [msg, setMsg] = useState(''); const [override, setOverride] = useState(''); const [showOv, setShowOv] = useState(false);
  useEffect(() => { if (data) setEdit(Object.fromEntries(data.lines.map((l) => [l['Line No'], { quantity: l.Quantity, remove: false }]))); }, [data]);
  if (err) return <><Back to="/purchasing/po">Purchase Orders</Back><ErrorBox msg={err} /></>;
  if (!data) return <Spinner />;
  const { header, lines, status, can, history, totals, grns, poType } = data; const authorizing = can.approve;
  const run = async (action, remarks, body = {}) => { await api.post(`/api/wf/pos/action?id=${encodeURIComponent(id)}`, { action, remarks, ...body }); toast.success(`PO ${id}: ${action} done`); setDlg(null); setMsg(''); reload(); };
  const approve = async () => {
    setMsg('');
    const payload = lines.map((l) => ({ lineNo: l['Line No'], quantity: num(edit[l['Line No']]?.quantity), remove: !!edit[l['Line No']]?.remove }));
    try { await run('approve', '', { lines: payload, ...(override.trim() ? { override: { reason: override.trim() } } : {}) }); } catch (e) { setMsg(e.message); if (/exceeds the remaining approved/.test(e.message)) setShowOv(true); }
  };
  return (
    <>
      <PageHeader back={<Back to="/purchasing/po?view=all">Purchase Orders</Back>} title={`Purchase Order ${id}`} subtitle={<span className="inline-flex items-center gap-2"><StatusBadge value={poLabel(status.Status)} /><span className="text-slate-500">{poType === 'import' ? 'Import' : 'Domestic'}{data.grnStatus ? ` · ${data.grnStatus}` : ''}</span></span>}
        actions={<>
          {can.edit && <Link className="btn" to={`/purchasing/po/new?edit=${encodeURIComponent(id)}`}>Edit</Link>}
          {can.submit && <button className="btn btn-primary" onClick={() => run('submit').catch((e) => toast.error(e.message))}>Submit for authorization</button>}
          {can.receive && <Link className="btn btn-primary" to={`/grn/new?po=${encodeURIComponent(id)}`}>Create GRN</Link>}
          <Link className="btn" to={`/purchasing/po/${encodeURIComponent(id)}/print`}>Print</Link>
          {can.close && <button className="btn" onClick={() => setDlg('close')}>Close / short-close</button>}
          {can.cancel && <button className="btn btn-danger" onClick={() => setDlg('cancel')}>Cancel PO</button>}
        </>} />
      <ErrorBox msg={msg} />
      <Card title="Header" className="mb-4"><dl className="grid gap-4 sm:grid-cols-4">
        <KV k="Date">{header.Date}</KV><KV k="Vendor">{header['Vendor Account']}</KV><KV k="Location">{header.Location}</KV><KV k="Destination">{header.Destination}</KV>
        <KV k="Source intents">{status['Source Ref']}</KV><KV k="Created by">{status['Created By']}</KV><KV k="Submitted">{status['Submitted At']?.slice(0, 16).replace('T', ' ')}</KV><KV k="Place of supply">{header['Place of Supply']}</KV><KV k="Type of purchase">{header['Type Of Purchase']}</KV><KV k="Voucher prefix">{header['Voucher Prefix']}</KV><KV k="Supplier ref">{header['Supplier Ref No']}</KV>
        <KV k="Authorised by">{status['Reviewed By']}</KV><KV k="Authorised at">{status['Reviewed At']?.slice(0, 16).replace('T', ' ')}</KV><KV k="Remarks">{status['Review Remarks']}</KV><KV k="Payment / delivery terms">{[header['Payment Terms'], header['Terms of Delivery'] || header['Terms Of Delivery']].filter(Boolean).join(' · ')}</KV>
      </dl></Card>
      <Card title={authorizing ? 'Items — adjust quantity or remove lines before authorizing' : 'Items'} pad={false} className="mb-4">
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead><tr>{['#', 'Item', 'Intent', 'Stock', ...(poType === 'domestic' ? ['Reorder', 'Brand', 'Item Group', 'Division', 'Last PO rate', 'Price type'] : []), 'Quantity', 'Rate', 'Disc.', poType === 'domestic' ? 'GST %' : 'PKG', 'Line total', 'Received', 'Balance', ...(authorizing ? ['Remove'] : [])].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{lines.map((l) => { const e = edit[l['Line No']] || {}; return (
            <tr key={l['Line No']} className={e.remove ? 'bg-red-50 line-through opacity-60' : ''}>
              <td className="td">{l['Line No']}</td><td className="td"><div className="font-medium">{l.Items}</div><div className="text-xs text-slate-500">{l['Item Code']}</div></td>
              <td className="td text-xs">{l['Intent No'] ? `${l['Intent No']} / ${l['Intent Line']}` : '—'}</td><td className="td text-right tabular-nums">{n2(l['Current Stock'])}</td>
              {poType === 'domestic' && <><td className="td text-right tabular-nums">{n2(l['Reorder Level'])}</td><td className="td">{l.Brand}</td><td className="td">{l['Item Group']}</td><td className="td">{l.Division}</td><td className="td text-right tabular-nums">{n2(l['Last PO Rate'])}</td><td className="td">{l['Price Type']}</td></>}
              <td className="td text-right">{authorizing ? <input className="input w-24 text-right" type="number" min="0" step="any" aria-label={`Quantity line ${l['Line No']}`} value={e.quantity ?? ''} disabled={e.remove} onChange={(ev) => setEdit({ ...edit, [l['Line No']]: { ...e, quantity: ev.target.value } })} /> : <span className="tabular-nums">{n2(l.Quantity)}</span>}</td>
              <td className="td text-right tabular-nums">{n2(l.Rate)}</td><td className="td text-right tabular-nums">{n2(l['Other Discount'])}</td><td className="td text-right tabular-nums">{n2(poType === 'domestic' ? l['GST %'] : l['PKG Charges'])}</td>
              <td className="td text-right tabular-nums">{n2(l['Line Total'])}</td><td className="td text-right tabular-nums">{n2(l['Received Qty'])}</td><td className="td text-right tabular-nums">{n2(l['Balance Qty'])}</td>
              {authorizing && <td className="td"><input type="checkbox" aria-label={`Remove line ${l['Line No']}`} checked={!!e.remove} onChange={(ev) => setEdit({ ...edit, [l['Line No']]: { ...e, remove: ev.target.checked } })} /></td>}
            </tr>); })}</tbody></table></div>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 p-4 text-sm"><dt className="text-slate-500">Subtotal</dt><dd className="text-right tabular-nums">{inr(totals.subtotal)}</dd>{poType === 'domestic' && <><dt className="text-slate-500">Tax</dt><dd className="text-right tabular-nums">{inr(totals.taxTotal)}</dd></>}<dt className="font-semibold">Grand total</dt><dd className="text-right font-semibold tabular-nums">{inr(totals.grandTotal)}</dd></dl>
      </Card>
      {authorizing && (
        <Card title="PO authorization" className="mb-4">
          {showOv && <div className="mb-3"><label className="label">Override reason (quantity exceeds the approved intent)</label><input className="input" value={override} onChange={(e) => setOverride(e.target.value)} /></div>}
          <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={approve}>Approve</button><button className="btn" onClick={() => setDlg('return')}>Return for correction</button><button className="btn btn-danger" onClick={() => setDlg('reject')}>Reject</button></div>
          <p className="mt-2 text-xs text-slate-500">Original quantities are kept in the history if you change or remove lines.</p>
        </Card>
      )}
      {status.Status === 'Pending Authorization' && !authorizing && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Waiting for authorization{status['Created By'] === user?.id ? ' — you created this PO, so another authoriser must approve it.' : '.'}</p>}
      {grns?.length > 0 && <Card title="Goods receipts" className="mb-4" pad={false}><ul className="divide-y divide-slate-100 text-sm">{grns.map((g, i) => <li key={i} className="px-4 py-2"><Link className="text-brand-700 hover:underline" to={`/grn/${encodeURIComponent(g.id || g['Document No.'] || g)}`}>{g.id || g['Document No.'] || String(g)}</Link>{g.Date ? ` · ${g.Date}` : ''}</li>)}</ul></Card>}
      <HistoryCard history={history} />
      {dlg === 'reject' && <RemarksDialog title="Reject PO" label="Comments" required danger confirmLabel="Reject" onConfirm={(r) => run('reject', r)} onCancel={() => setDlg(null)} />}
      {dlg === 'return' && <RemarksDialog title="Return PO for correction" label="Comments" required confirmLabel="Return" onConfirm={(r) => run('return', r)} onCancel={() => setDlg(null)} />}
      {dlg === 'cancel' && <RemarksDialog title="Cancel PO" required danger confirmLabel="Cancel PO" onConfirm={(r) => run('cancel', r)} onCancel={() => setDlg(null)} />}
      {dlg === 'close' && <RemarksDialog title="Close PO (short-close the balance)" required confirmLabel="Close PO" onConfirm={(r) => run('close', r)} onCancel={() => setDlg(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// GRN
export function GrnForm() {
  const nav = useNavigate(); const toast = useToast(); const [sp] = useSearchParams(); const [key] = useState(() => idemKey());
  const [pos, setPos] = useState(null); const [po, setPo] = useState(sp.get('po') || '');
  const [hdr, setHdr] = useState({ Date: todayIST(), 'Invoice No.': '', 'Invoice Date': '', 'Invoice Value': '', 'Narration-Notes': '', Attachment: '' });
  const [rec, setRec] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  useEffect(() => { api.get('/api/wf/pos/open').then((r) => setPos(r.rows)).catch((e) => { setErr(e.message); setPos([]); }); }, []);
  const cur = pos?.find((p) => p['Document No.'] === po);
  useEffect(() => { setRec({}); }, [po]);
  if (!pos) return <Spinner />;
  const list = pos.filter((p) => !q || `${p['Document No.']} ${p['Vendor Account']}`.toLowerCase().includes(q.toLowerCase()));
  const setR = (ln, k, v) => setRec((s) => ({ ...s, [ln]: { ...(s[ln] || {}), [k]: v } }));
  const save = async () => {
    setErr('');
    const out = [];
    for (const l of cur.lines) {
      const r = rec[l.poLine] || {}; const got = num(r.rec); if (!got) continue; const rej = num(r.rej);
      if (rej > got) return setErr(`${l.items}: rejected quantity cannot exceed received quantity`);
      if (got - rej > l.balance + 1e-9) return setErr(`${l.items}: accepted ${n2(got - rej)} exceeds the PO balance ${n2(l.balance)}`);
      out.push({ 'PO Line': l.poLine, 'Received Qty': got, 'Rejected / Damaged Qty': rej, Batch: r.batch || '', 'Expiry Date': r.exp || '', ...(r.short ? { 'Short Close': 'Close Balance (authorized)' } : {}) });
    }
    if (!out.length) return setErr('Enter a received quantity on at least one line');
    setBusy(true);
    try {
      const header = { ...Object.fromEntries(Object.entries(hdr).filter(([, v]) => !empty(v))), 'Supplier Ref No': po, Warehouse: cur.Warehouse };
      if (header['Invoice Value'] !== undefined) header['Invoice Value'] = num(header['Invoice Value']);
      const r = await api.post('/api/t/grn-mrn', { header, lines: out }, { headers: { 'Idempotency-Key': key } });
      toast.success(r.duplicate ? 'Already saved — duplicate ignored' : `GRN ${r.id} posted; stock updated`);
      nav(`/grn/${encodeURIComponent(r.id)}`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader back={<Back to="/grn">GRN Register</Back>} title="Create GRN" subtitle="Receive goods against an approved Purchase Order. Accepted quantity is posted to stock once." />
      <ErrorBox msg={err} />
      <Card title="1. Purchase Order" className="mb-4">
        {!pos.length ? <p className="text-sm text-slate-500">No approved Purchase Orders are waiting for receipt in your warehouses.</p> : (<>
          <input className="input mb-2 sm:max-w-sm" placeholder="Search PO or vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={po} onChange={(e) => setPo(e.target.value)} aria-label="Purchase order">
            <option value="">— Select a PO —</option>{list.map((p) => <option key={p['Document No.']} value={p['Document No.']}>{p['Document No.']} · {p['Vendor Account']} · {p.Warehouse} · {p.Status}</option>)}
          </select>
          {po && !cur && <p className="mt-2 text-sm text-red-600">PO {po} is not open for receipt (it may be fully received, closed, or outside your warehouses).</p>}
        </>)}
      </Card>
      {cur && (<>
        <Card title="2. Receipt details" className="mb-4"><div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label">Vendor</label><input className="input" disabled value={cur['Vendor Account']} /></div>
          <div><label className="label">Warehouse</label><input className="input" disabled value={cur.Warehouse} /></div>
          <div><label className="label">GRN date</label><input type="date" className="input" value={hdr.Date} onChange={(e) => setHdr({ ...hdr, Date: e.target.value })} /></div>
          <div><label className="label">Invoice no.</label><input className="input" value={hdr['Invoice No.']} onChange={(e) => setHdr({ ...hdr, 'Invoice No.': e.target.value })} /></div>
          <div><label className="label">Invoice date</label><input type="date" className="input" value={hdr['Invoice Date']} onChange={(e) => setHdr({ ...hdr, 'Invoice Date': e.target.value })} /></div>
          <div><label className="label">Invoice value</label><input type="number" min="0" step="any" className="input" value={hdr['Invoice Value']} onChange={(e) => setHdr({ ...hdr, 'Invoice Value': e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Notes</label><input className="input" value={hdr['Narration-Notes']} onChange={(e) => setHdr({ ...hdr, 'Narration-Notes': e.target.value })} /></div>
          <div><label className="label">Attachment reference</label><input className="input" value={hdr.Attachment} onChange={(e) => setHdr({ ...hdr, Attachment: e.target.value })} /></div>
        </div></Card>
        <Card title="3. Items received (leave quantity blank for lines not delivered)" pad={false} className="mb-4">
          <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
            <thead><tr>{['Item', 'Ordered', 'Received so far', 'Balance', 'Received now', 'Rejected', 'Accepted', 'Batch', 'Expiry', 'Short-close'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{cur.lines.map((l) => { const r = rec[l.poLine] || {}; const acc = Math.max(0, num(r.rec) - num(r.rej)); return (
              <tr key={l.poLine}><td className="td"><div className="font-medium">{l.items}</div><div className="text-xs text-slate-500">{l.itemCode} · line {l.poLine}</div></td>
                <td className="td text-right tabular-nums">{n2(l.ordered)}</td><td className="td text-right tabular-nums">{n2(l.received)}</td><td className="td text-right font-medium tabular-nums">{n2(l.balance)}</td>
                <td className="td"><input className="input w-24 text-right" type="number" min="0" step="any" aria-label={`Received qty ${l.items}`} value={r.rec ?? ''} onChange={(e) => setR(l.poLine, 'rec', e.target.value)} /></td>
                <td className="td"><input className="input w-24 text-right" type="number" min="0" step="any" aria-label={`Rejected qty ${l.items}`} value={r.rej ?? ''} onChange={(e) => setR(l.poLine, 'rej', e.target.value)} /></td>
                <td className={`td text-right tabular-nums ${acc > l.balance + 1e-9 ? 'font-semibold text-red-600' : ''}`}>{n2(acc)}</td>
                <td className="td"><input className="input min-w-[8rem]" aria-label={`Batch ${l.items}`} value={r.batch ?? ''} onChange={(e) => setR(l.poLine, 'batch', e.target.value)} /></td>
                <td className="td"><input className="input min-w-[9rem]" type="date" aria-label={`Expiry ${l.items}`} value={r.exp ?? ''} onChange={(e) => setR(l.poLine, 'exp', e.target.value)} /></td>
                <td className="td text-center"><input type="checkbox" aria-label={`Short close ${l.items}`} checked={!!r.short} onChange={(e) => setR(l.poLine, 'short', e.target.checked)} /></td></tr>); })}</tbody></table></div>
        </Card>
        <div className="flex flex-wrap justify-end gap-2"><button className="btn" disabled={busy} onClick={() => nav(-1)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Posting…' : 'Post GRN & update stock'}</button></div>
      </>)}
    </>
  );
}

export function GrnRegister() {
  const nav = useNavigate(); const { tables } = useAuth(); const [range, setRange] = useState({ from: '', to: '' }); const t = tables['grn-mrn'];
  const columns = [{ name: 'Document No.', label: 'GRN No.', render: (v) => <span className="font-medium text-brand-700">{v}</span> }, { name: 'Date' }, { name: 'Supplier Ref No', label: 'PO No.' }, { name: 'Vendor Account', label: 'Vendor' }, { name: 'Warehouse' }, { name: 'Invoice No.' }, { name: 'Invoice Value', type: 'number' }];
  return (
    <>
      <PageHeader title="GRN Register" actions={t?.actions.includes('create') && <Link className="btn btn-primary" to="/grn/new">+ Create GRN</Link>} />
      <FilterBar onReset={() => setRange({ from: '', to: '' })}>
        <FilterItem label="From"><input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></FilterItem>
        <FilterItem label="To"><input type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></FilterItem>
      </FilterBar>
      <DataTable endpoint="/api/t/grn-mrn" columns={columns} params={range} exportable={t?.actions.includes('export')} exportName="grn" defaultSort={{ col: 'Date', dir: 'desc' }}
        rowKey={(r) => r['Document No.']} onRowClick={(r) => nav(`/grn/${encodeURIComponent(r['Document No.'])}`)} />
    </>
  );
}

export function GrnDetail() {
  const { id } = useParams();
  const { data, err } = useLoad(() => api.get('/api/t/grn-mrn/record', { id }), [id]);
  if (err) return <><Back to="/grn">GRN Register</Back><ErrorBox msg={err} /></>;
  if (!data) return <Spinner />;
  const h = data.record || {}; const lines = data.lines || [];
  return (
    <>
      <PageHeader back={<Back to="/grn">GRN Register</Back>} title={`GRN ${id}`} actions={h['Supplier Ref No'] && <Link className="btn" to={`/purchasing/po/${encodeURIComponent(h['Supplier Ref No'])}`}>View PO {h['Supplier Ref No']}</Link>} />
      <Card title="Header" className="mb-4"><dl className="grid gap-4 sm:grid-cols-4">
        <KV k="Date">{h.Date}</KV><KV k="PO No.">{h['Supplier Ref No']}</KV><KV k="Vendor">{h['Vendor Account']}</KV><KV k="Warehouse">{h.Warehouse}</KV>
        <KV k="Invoice no.">{h['Invoice No.']}</KV><KV k="Invoice date">{h['Invoice Date']}</KV><KV k="Invoice value">{h['Invoice Value']}</KV><KV k="Notes">{h['Narration-Notes']}</KV>
      </dl></Card>
      <Card title="Items" pad={false}><div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
        <thead><tr>{['#', 'Item', 'PO line', 'Ordered', 'Received', 'Rejected', 'Accepted', 'Batch', 'Expiry'].map((x) => <th key={x} className="th">{x}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{lines.map((l, i) => <tr key={i}><td className="td">{i + 1}</td><td className="td"><div className="font-medium">{l.Items}</div><div className="text-xs text-slate-500">{l['Item Code']}</div></td><td className="td">{l['PO Line']}</td>
          <td className="td text-right tabular-nums">{n2(l['Ordered Qty'])}</td><td className="td text-right tabular-nums">{n2(l['Received Qty'])}</td><td className="td text-right tabular-nums">{n2(l['Rejected / Damaged Qty'])}</td><td className="td text-right tabular-nums">{n2(l['Accepted Qty'])}</td><td className="td">{l.Batch}</td><td className="td">{l['Expiry Date']}</td></tr>)}</tbody></table></div></Card>
    </>
  );
}
