import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, idemKey } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import Card from '../../components/Card.jsx';
import Combobox from '../../components/Combobox.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterItem } from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useToast } from '../../components/Toast.jsx';
import { Back, ErrorBox, Grid, HistoryCard, KV, RemarksDialog, n2, num, todayIST, useLoad } from './index.jsx';

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Partially Dispatched', 'Dispatched', 'Partially Received', 'Received', 'Rejected', 'Cancelled'];
const VIEWS = { pending: 'Pending Purchase Requisitions (awaiting approval)', open: 'Open Requisitions (approved, not fully received)', all: 'All Purchase Requisitions' };
const empty = (v) => v === '' || v === null || v === undefined;

const cols = [
  { k: 'Items', label: 'Item', type: 'item' }, { k: 'Units', label: 'Unit', type: 'text' }, { k: 'Current Stock', label: 'Stock at requesting WH', type: 'ro', num: true },
  { k: 'Mother Stock', label: 'Mother WH stock', type: 'ro', num: true }, { k: 'Quantity', label: 'Required qty', type: 'number' }, { k: 'Reason', label: 'Reason', type: 'text' },
];

export function ReqForm() {
  const nav = useNavigate(); const toast = useToast(); const { user } = useAuth(); const [sp] = useSearchParams(); const editId = sp.get('edit');
  const [key] = useState(() => idemKey());
  const mine = user?.scope?.mode === 'assigned' ? user.scope.warehouses[0] || '' : '';
  const [hdr, setHdr] = useState({ Date: todayIST(), 'Requesting Warehouse': sp.get('warehouse') || mine, 'Issuing Warehouse': '', Priority: 'Normal', 'Narration-Notes': '' });
  const [lines, setLines] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const d = await api.get('/api/wf/pos/defaults');
        if (editId) {
          const r = await api.get('/api/wf/reqs/get', { id: editId });
          setHdr({ Date: r.header.Date, 'Requesting Warehouse': r.header['Requesting Warehouse'], 'Issuing Warehouse': r.header['Issuing Warehouse'], Priority: r.header.Priority || 'Normal', 'Narration-Notes': r.header['Narration-Notes'] || '' });
          setLines(r.lines.map((l, i) => ({ ...l, _k: `e${i}` })));
        } else {
          setHdr((h) => ({ ...h, 'Issuing Warehouse': d.location }));
          const items = sp.get('items'); // from the low-stock report: code:qty,code:qty
          if (items) {
            const out = [];
            for (const [i, pair] of items.split(',').entries()) {
              const [code, qty] = pair.split(':'); const r = await api.get('/api/lookup', { field: 'Items', q: code });
              const o = (r.options || []).find((x) => x.value === code); if (o) out.push({ _k: `p${i}`, 'Item Code': code, Items: o.name, Quantity: num(qty) || '', Reason: 'Below minimum stock level' });
            }
            setLines(out);
          }
        }
      } catch (e) { setErr(e.message); } finally { setReady(true); }
    })();
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // live stock of each chosen item at the requesting and the Mother warehouse
  const codes = lines.map((l) => l['Item Code']).filter(Boolean).join(','); const rw = hdr['Requesting Warehouse']; const iw = hdr['Issuing Warehouse'];
  const [levels, setLevels] = useState({});
  useEffect(() => {
    if (!codes || !rw || !iw) return;
    let live = true;
    api.get('/api/stock/levels', { codes, warehouses: `${rw},${iw}` }).then((r) => { if (live) setLevels(r.levels); }).catch(() => {});
    return () => { live = false; };
  }, [codes, rw, iw]);
  const shown = useMemo(() => lines.map((l) => ({ ...l, 'Current Stock': levels[l['Item Code']]?.[String(rw).toUpperCase()] ?? '', 'Mother Stock': levels[l['Item Code']]?.[String(iw).toUpperCase()] ?? '' })), [lines, levels, rw, iw]);
  if (!ready) return <Spinner />;
  const short = shown.filter((l) => l['Item Code'] && l['Mother Stock'] !== '' && num(l.Quantity) > num(l['Mother Stock']));

  const save = async (submit) => {
    setErr('');
    if (!rw) return setErr('Select the requesting warehouse');
    const out = shown.filter((l) => l['Item Code']).map(({ _k, 'Current Stock': a, 'Mother Stock': b, ...l }) => Object.fromEntries(Object.entries(l).filter(([, v]) => !empty(v))));
    if (!out.length) return setErr('Add at least one item');
    for (const [i, l] of out.entries()) if (!(num(l.Quantity) > 0)) return setErr(`Line ${i + 1}: enter a required quantity`);
    setBusy(true);
    try {
      const body = { header: Object.fromEntries(Object.entries(hdr).filter(([, v]) => !empty(v))), lines: out, submit };
      const r = editId ? await api.put(`/api/wf/reqs?id=${encodeURIComponent(editId)}`, body) : await api.post('/api/wf/reqs', body, { headers: { 'Idempotency-Key': key } });
      toast.success(submit ? `Requisition ${r.id} sent for approval` : `Requisition ${r.id} saved as draft`);
      nav(`/requisitions/${encodeURIComponent(r.id)}`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader back={<Back to="/requisitions">Purchase Requisitions</Back>} title={editId ? `Edit Requisition ${editId}` : 'Create Purchase Requisition'} subtitle="Ask the Mother Warehouse for stock. This is an internal transfer request, not a vendor purchase." />
      <ErrorBox msg={err} />
      <Card title="Header" className="mb-4"><div className="grid gap-3 sm:grid-cols-4">
        <div><label className="label">Date</label><input type="date" className="input" value={hdr.Date} onChange={(e) => setHdr({ ...hdr, Date: e.target.value })} /></div>
        <div><label className="label">Requesting warehouse *</label><Combobox field="Requesting Warehouse" allowFree={false} value={rw} onChange={(v) => setHdr({ ...hdr, 'Requesting Warehouse': v })} /></div>
        <div><label className="label">Issuing (Mother) warehouse</label><Combobox field="Issuing Warehouse" allowFree={false} value={iw} onChange={(v) => setHdr({ ...hdr, 'Issuing Warehouse': v })} /></div>
        <div><label className="label">Priority</label><select className="input" value={hdr.Priority} onChange={(e) => setHdr({ ...hdr, Priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="sm:col-span-4"><label className="label">Notes</label><textarea className="input min-h-[3rem]" value={hdr['Narration-Notes']} onChange={(e) => setHdr({ ...hdr, 'Narration-Notes': e.target.value })} /></div>
      </div></Card>
      <Card title="Items" className="mb-4">
        <Grid cols={cols} lines={shown} describe={false} onChange={(l) => setLines(l)} />
        {!!short.length && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Mother Warehouse stock is lower than the quantity asked for on {short.length} item{short.length > 1 ? 's' : ''}. The requisition can still be raised; the Mother Warehouse can dispatch part of it or raise a Purchase Indent for the shortage.</p>}
      </Card>
      <div className="flex flex-wrap justify-end gap-2"><button className="btn" disabled={busy} onClick={() => nav(-1)}>Cancel</button><button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Submit for approval'}</button></div>
    </>
  );
}

export function ReqRegister() {
  const nav = useNavigate(); const { tables } = useAuth(); const [sp, setSp] = useSearchParams();
  const view = VIEWS[sp.get('view')] ? sp.get('view') : 'all';
  const f = { view, status: sp.get('status') || '', warehouse: sp.get('warehouse') || '', item: sp.get('item') || '', from: sp.get('from') || '', to: sp.get('to') || '' };
  const setF = (patch) => { const n = { ...f, ...patch }; setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v)), { replace: true }); };
  const t = tables['purchase-requisition'];
  const toast = useToast(); const [rej, setRej] = useState(null); const [rk, setRk] = useState(0); const [busyId, setBusyId] = useState('');
  const act = async (id, action, remarks = '') => {
    setBusyId(id);
    try { await api.post(`/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action, remarks }); toast.success(`Requisition ${id}: ${action === 'approve' ? 'approved (full quantity)' : 'rejected'}`); setRej(null); setRk((k) => k + 1); }
    catch (e) { toast.error(e.message); } finally { setBusyId(''); }
  };
  const columns = [
    { name: 'Document No.', label: 'Requisition', render: (v) => <span className="font-medium text-brand-700">{v}</span> }, { name: 'Date' }, { name: 'Requesting Warehouse', label: 'From' }, { name: 'Issuing Warehouse', label: 'To (issuer)' }, { name: 'Priority' },
    { name: 'Item Summary', sortable: false }, { name: 'Total Requested', label: 'Required', type: 'number', sortable: false }, { name: 'Total Approved', label: 'Approved', type: 'number', sortable: false },
    { name: 'Total Dispatched', label: 'Dispatched', type: 'number', sortable: false }, { name: 'Total Received', label: 'Received', type: 'number', sortable: false }, { name: 'Requested By', sortable: false }, { name: 'Status' },
  ];
  return (
    <>
      <PageHeader title={VIEWS[view]} actions={t?.actions.includes('create') && <Link className="btn btn-primary" to="/requisitions/new">+ New Requisition</Link>} />
      <FilterBar onReset={() => setSp({ view }, { replace: true })}>
        {view === 'all' && <FilterItem label="Status"><select className="input" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></FilterItem>}
        <FilterItem label="Warehouse"><input className="input" value={f.warehouse} placeholder="e.g. DWH" onChange={(e) => setF({ warehouse: e.target.value })} /></FilterItem>
        <FilterItem label="Item"><input className="input" value={f.item} placeholder="code or name" onChange={(e) => setF({ item: e.target.value })} /></FilterItem>
        <FilterItem label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></FilterItem>
        <FilterItem label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} /></FilterItem>
      </FilterBar>
      <DataTable key={view} endpoint="/api/wf/reqs" columns={columns} params={f} refreshKey={rk} exportable exportName="purchase-requisitions" searchPlaceholder="Search number, warehouse, item…" defaultSort={{ col: 'Date', dir: 'desc' }}
        rowKey={(r) => r['Document No.']} onRowClick={(r) => nav(`/requisitions/${encodeURIComponent(r['Document No.'])}`)}
        rowActions={(r) => (
          <div className="flex justify-end gap-1">
            {r.actions.approve && <button className="btn btn-sm btn-primary" disabled={busyId === r['Document No.']} title="Approve the full requested quantity" onClick={(e) => { e.stopPropagation(); act(r['Document No.'], 'approve'); }}>Approve</button>}
            {r.actions.approve && <button className="btn btn-sm" disabled={busyId === r['Document No.']} onClick={(e) => { e.stopPropagation(); setRej(r['Document No.']); }}>Reject</button>}
            <Link className="btn btn-sm" to={`/requisitions/${encodeURIComponent(r['Document No.'])}`}>{r.actions.approve ? 'Review' : r.actions.dispatch ? 'Dispatch' : r.actions.receive ? 'Receive' : 'View'}</Link>
          </div>
        )} />
      {rej && <RemarksDialog title={`Reject requisition ${rej}`} required danger confirmLabel="Reject" onConfirm={(rm) => act(rej, 'reject', rm)} onCancel={() => setRej(null)} />}
    </>
  );
}

export function ReqDetail() {
  const { id } = useParams(); const toast = useToast();
  const { data, err, reload } = useLoad(() => api.get('/api/wf/reqs/get', { id }), [id]);
  const [dlg, setDlg] = useState(null); const [msg, setMsg] = useState(''); const [appr, setAppr] = useState({}); const [qty, setQty] = useState({}); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setAppr(Object.fromEntries(data.lines.map((l) => [l['Line No'], l.Quantity])));
    setQty(Object.fromEntries(data.lines.map((l) => [l['Line No'], { d: Math.max(0, Math.min(l['Remaining Qty'], l['Mother Stock'])), r: l['In Transit'] }])));
  }, [data]);
  if (err) return <><Back to="/requisitions">Purchase Requisitions</Back><ErrorBox msg={err} /></>;
  if (!data) return <Spinner />;
  const { header, lines, status, can, history } = data;
  const run = async (action, remarks, body = {}, quiet) => {
    setBusy(true); setMsg('');
    try { await api.post(`/api/wf/reqs/action?id=${encodeURIComponent(id)}`, { action, remarks, ...body }); toast.success(`Requisition ${id}: ${action} done`); setDlg(null); reload(); }
    catch (e) { if (quiet) setMsg(e.message); else throw e; } finally { setBusy(false); }
  };
  const anyShort = lines.some((l) => l.Shortage > 0);
  const approving = can.approve; const showFlow = ['Approved', 'Partially Dispatched', 'Dispatched', 'Partially Received', 'Received'].includes(status.Status);
  return (
    <>
      <PageHeader back={<Back to="/requisitions">Purchase Requisitions</Back>} title={`Purchase Requisition ${id}`} subtitle={<StatusBadge value={status.Status} />}
        actions={<>
          {can.edit && <Link className="btn" to={`/requisitions/new?edit=${encodeURIComponent(id)}`}>Edit</Link>}
          {can.submit && <button className="btn btn-primary" onClick={() => run('submit', '', {}, true)}>Submit for approval</button>}
          {can.cancel && <button className="btn btn-danger" onClick={() => setDlg('cancel')}>Cancel</button>}
        </>} />
      <ErrorBox msg={msg} />
      <Card title="Header" className="mb-4"><dl className="grid gap-4 sm:grid-cols-4">
        <KV k="Date">{header.Date}</KV><KV k="Requesting warehouse">{header['Requesting Warehouse']}</KV><KV k="Issuing warehouse">{header['Issuing Warehouse']}</KV><KV k="Priority">{header.Priority}</KV>
        <KV k="Requested by">{status['Created By']}</KV><KV k="Submitted">{status['Submitted At']?.slice(0, 16).replace('T', ' ')}</KV><KV k="Decision by">{status['Reviewed By']}</KV><KV k="Remarks">{status['Review Remarks']}</KV>
        <KV k="Notes">{header['Narration-Notes']}</KV>
      </dl></Card>
      {anyShort && ['Pending Approval', 'Approved', 'Partially Dispatched'].includes(status.Status) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span><b>Shortage at the Mother Warehouse.</b> Stock on hand is lower than the quantity still needed on {lines.filter((l) => l.Shortage > 0).length} item(s). Dispatch what is available, and raise a Purchase Indent for the rest.</span>
          <Link className="btn btn-sm btn-primary" to={`/purchase-intent/new?short=${encodeURIComponent(id)}`}>Raise Purchase Indent for shortage</Link>
        </div>
      )}
      <Card title="Items" pad={false} className="mb-4"><div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
        <thead><tr>{['#', 'Item', 'Unit', 'Required', 'Approved', 'At requesting WH', 'Mother WH', 'Dispatched', 'In transit', 'Received', 'Shortage', ...(approving ? ['Approve qty'] : []), ...(can.dispatch ? ['Dispatch now'] : []), ...(can.receive ? ['Receive now'] : [])].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{lines.map((l) => { const n = l['Line No']; return (
          <tr key={n}><td className="td">{n}</td><td className="td"><div className="font-medium">{l.Items}</div><div className="text-xs text-slate-500">{l['Item Code']}</div></td><td className="td">{l.Units}</td>
            <td className="td text-right tabular-nums">{n2(l.Quantity)}</td><td className="td text-right tabular-nums">{showFlow ? n2(l['Approved Qty']) : '—'}</td>
            <td className="td text-right tabular-nums">{n2(l['Current Stock'])}</td><td className="td text-right tabular-nums">{n2(l['Mother Stock'])}</td>
            <td className="td text-right tabular-nums">{n2(l['Dispatched Qty'])}</td><td className="td text-right tabular-nums">{n2(l['In Transit'])}</td><td className="td text-right tabular-nums">{n2(l['Received Qty'])}</td>
            <td className="td text-right tabular-nums">{l.Shortage > 0 ? <span className="font-semibold text-red-600">{n2(l.Shortage)}</span> : '—'}</td>
            {approving && <td className="td"><input className="input w-24 text-right" type="number" min="0" max={l.Quantity} step="any" aria-label={`Approve qty line ${n}`} value={appr[n] ?? ''} onChange={(e) => setAppr({ ...appr, [n]: e.target.value })} /></td>}
            {can.dispatch && <td className="td">{l['Remaining Qty'] > 0 ? <input className="input w-24 text-right" type="number" min="0" max={l['Remaining Qty']} step="any" aria-label={`Dispatch qty line ${n}`} value={qty[n]?.d ?? ''} onChange={(e) => setQty({ ...qty, [n]: { ...qty[n], d: e.target.value } })} /> : '—'}</td>}
            {can.receive && <td className="td">{l['In Transit'] > 0 ? <input className="input w-24 text-right" type="number" min="0" max={l['In Transit']} step="any" aria-label={`Receive qty line ${n}`} value={qty[n]?.r ?? ''} onChange={(e) => setQty({ ...qty, [n]: { ...qty[n], r: e.target.value } })} /> : '—'}</td>}
          </tr>); })}</tbody></table></div></Card>
      {approving && <Card title="Mother Warehouse approval" className="mb-4"><div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => run('approve', '', { lines: lines.map((l) => ({ lineNo: l['Line No'], approvedQty: num(appr[l['Line No']]) })) }, true)}>Approve</button>
        <button className="btn btn-danger" onClick={() => setDlg('reject')}>Reject</button></div></Card>}
      {can.dispatch && <Card title="Dispatch from the Mother Warehouse" className="mb-4">
        <p className="mb-2 text-sm text-slate-600">Stock leaves {header['Issuing Warehouse']} now (earliest-expiry batches first) and is held <b>in transit</b> until {header['Requesting Warehouse']} confirms receipt.</p>
        <button className="btn btn-primary" disabled={busy} onClick={() => run('dispatch', '', { lines: lines.filter((l) => l['Remaining Qty'] > 0 && num(qty[l['Line No']]?.d) > 0).map((l) => ({ lineNo: l['Line No'], quantity: num(qty[l['Line No']].d) })) }, true)}>Dispatch</button></Card>}
      {can.receive && <Card title="Confirm receipt" className="mb-4">
        <p className="mb-2 text-sm text-slate-600">Confirm what actually arrived at {header['Requesting Warehouse']}. Stock is added to this warehouse with the same batches.</p>
        <button className="btn btn-primary" disabled={busy} onClick={() => run('receive', '', { lines: lines.filter((l) => l['In Transit'] > 0 && num(qty[l['Line No']]?.r) > 0).map((l) => ({ lineNo: l['Line No'], quantity: num(qty[l['Line No']].r) })) }, true)}>Confirm receipt</button></Card>}
      <HistoryCard history={history} />
      {dlg === 'reject' && <RemarksDialog title="Reject requisition" required danger confirmLabel="Reject" onConfirm={(r) => run('reject', r)} onCancel={() => setDlg(null)} />}
      {dlg === 'cancel' && <RemarksDialog title="Cancel requisition" required danger confirmLabel="Cancel requisition" onConfirm={(r) => run('cancel', r)} onCancel={() => setDlg(null)} />}
    </>
  );
}
