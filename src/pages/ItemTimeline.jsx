import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api.js';
import Card from '../components/Card.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../components/Toast.jsx';
import { fmtDate } from '../dateOptions.js';
import { EmailDialog } from './Reports.jsx';

const KEY = 'item-timeline';
const n = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Item Timeline: one parent row per item; opening it shows the item's whole life underneath (indent, PO, GRN, transfers, Imprest Out / In, Consumption).
// Export / e-mail cover what is on screen: each item is written as a heading line followed by its timeline.
export default function ItemTimeline() {
  const toast = useToast();
  const [f, setF] = useState({ item: '', batch: '', from: '', to: '', status: '' });
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState(new Set()); const [mail, setMail] = useState(false); const [fmt, setFmt] = useState('xlsx'); const [shown, setShown] = useState(50);
  useEffect(() => {
    let live = true; setBusy(true); setErr('');
    const t = setTimeout(() => api.get(`/api/reports/${KEY}`, { ...f, all: 1 }).then((r) => { if (live) { setData(r); setShown(50); } }).catch((e) => { if (live) setErr(e.message); }).finally(() => { if (live) setBusy(false); }), 250);
    return () => { live = false; clearTimeout(t); };
  }, [f]);
  const items = useMemo(() => {
    const m = new Map();
    for (const r of data?.rows || []) { const g = m.get(r['Item Code']) || m.set(r['Item Code'], { code: r['Item Code'], name: r['Item Name'], rows: [] }).get(r['Item Code']); g.rows.push(r); }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [data]);
  const flip = (set, setter, k) => { const s = new Set(set); if (s.has(k)) s.delete(k); else s.add(k); setter(s); };
  // Export / e-mail always cover what is on screen (the filters above), every item written as a heading line followed by its timeline.
  const exp = (kind) => download(`/api/reports/${KEY}`, { ...f, export: kind }, `item-timeline.${kind}`).catch((e) => toast.error(e.message));
  return (
    <>
      <PageHeader back={<Link to="/reports" className="mb-1 inline-block text-sm text-brand-700 hover:underline">← Reports</Link>} title="Item Timeline"
        subtitle="Open an item to see its whole life: indent, PO, GRN, transfers, Imprest Out / In and Consumption, with batch numbers. Use the filters, then export or e-mail what is shown."
        actions={<><select className="input !w-auto" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Format"><option value="xlsx">Excel</option><option value="pdf">PDF</option><option value="csv">CSV</option></select>
          <button className="btn" disabled={!items.length} onClick={() => exp(fmt)}>Export</button><button className="btn" disabled={!items.length} onClick={() => setMail(true)}>E-mail</button></>} />
      <FilterBar onReset={() => setF({ item: '', batch: '', from: '', to: '', status: '' })}>
        <FilterItem label="Item" grow><input className="input" value={f.item} placeholder="code or name" onChange={(e) => setF({ ...f, item: e.target.value })} /></FilterItem>
        <FilterItem label="Batch"><input className="input" value={f.batch} placeholder="batch no." onChange={(e) => setF({ ...f, batch: e.target.value })} /></FilterItem>
        {!!data?.statuses?.length && <FilterItem label="Event"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{data.statuses.map((s) => <option key={s}>{s}</option>)}</select></FilterItem>}
        <FilterItem label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></FilterItem>
        <FilterItem label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></FilterItem>
      </FilterBar>
      {mail && <EmailDialog reportKey={KEY} title="Item Timeline" filters={f} onClose={() => setMail(false)} />}
      <Card pad={false}>
        {err && <div role="alert" className="p-4 text-sm text-red-600">{err}</div>}
        {busy && !data && <Spinner />}
        {data && (
          <div className="relative overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead><tr><th className="th w-8" /><th className="th">Item Code</th><th className="th">Item Name</th><th className="th text-right">Events</th><th className="th">First</th><th className="th">Latest</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {!items.length && <tr><td className="td text-slate-500" colSpan={6}>{busy ? 'Loading…' : 'No activity found.'}</td></tr>}
                {items.slice(0, shown).map((i) => (
                  <Fragment key={i.code}>
                    <tr className="bg-white hover:bg-slate-50">
                      <td className="td"><button type="button" className="text-slate-500" aria-expanded={open.has(i.code)} aria-label={open.has(i.code) ? 'Collapse' : 'Expand'} onClick={() => flip(open, setOpen, i.code)}>{open.has(i.code) ? '▾' : '▸'}</button></td>
                      <td className="td font-medium">{i.code}</td><td className="td">{i.name}</td><td className="td text-right tabular-nums">{i.rows.length}</td><td className="td">{fmtDate(i.rows[0].Date)}</td><td className="td">{fmtDate(i.rows[i.rows.length - 1].Date)}</td>
                    </tr>
                    {open.has(i.code) && (
                      <tr><td className="bg-slate-50 !p-0" colSpan={6}>
                        <table className="min-w-full text-xs"><thead><tr>{['Date', 'Event', 'Document', 'Batch', 'Expiry', 'Warehouse', 'Qty', 'Party', 'Reference'].map((h) => <th key={h} className={`th ${h === 'Qty' ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                          <tbody className="divide-y divide-slate-100">{i.rows.map((r, k) => <tr key={k}><td className="td whitespace-nowrap">{fmtDate(r.Date)}</td><td className="td"><StatusBadge value={r.Event} /></td><td className="td whitespace-nowrap">{r.Document}</td><td className="td">{r['Batch Number']}</td><td className="td whitespace-nowrap">{fmtDate(r['Expiry Date'])}</td><td className="td">{r.Warehouse}</td><td className={`td text-right tabular-nums ${r.Quantity < 0 ? 'text-red-600' : ''}`}>{n(r.Quantity)}</td><td className="td">{r.Party}</td><td className="td">{r.Reference}</td></tr>)}</tbody></table>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {items.length > shown && <div className="p-3 text-center"><button type="button" className="btn" onClick={() => setShown(shown + 50)}>Show more ({items.length - shown} items left)</button></div>}
          </div>
        )}
      </Card>
    </>
  );
}
