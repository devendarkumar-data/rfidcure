import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Card from '../../components/Card.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';

const lines = (v) => { try { const x = typeof v === 'string' ? JSON.parse(v || '[]') : v; return Array.isArray(x) ? x : []; } catch { return []; } };
const uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y)));

// GRN / MRN Detail Register: every document with its item lines (one row per item) and filters.
export default function GrnDetailRegister() {
  const [docs, setDocs] = useState(null); const [err, setErr] = useState('');
  const [f, setF] = useState({ q: '', type: '', wh: '', vendor: '', from: '', to: '' });
  useEffect(() => {
    (async () => {
      const all = []; let page = 1, pages = 1;
      do { const r = await api.get('/api/t/grn-mrn', { page, pageSize: 200 }); all.push(...r.rows); pages = r.pages; page += 1; } while (page <= pages && page <= 25);
      setDocs(all);
    })().catch((e) => setErr(e.message));
  }, []);
  const rows = useMemo(() => (docs || []).flatMap((d) => { const ls = lines(d.Lines); return (ls.length ? ls : [{}]).map((l, i) => ({ d, l, i })); }), [docs]);
  const opts = useMemo(() => ({ wh: uniq((docs || []).map((d) => d.Warehouse)), vendor: uniq((docs || []).map((d) => d['Vendor Account'])) }), [docs]);
  const shown = rows.filter(({ d, l }) => {
    const t = f.q.trim().toLowerCase();
    if (f.type && (d['Receipt Type'] || 'GRN') !== f.type) return false;
    if (f.wh && d.Warehouse !== f.wh) return false;
    if (f.vendor && d['Vendor Account'] !== f.vendor) return false;
    if (f.from && String(d.Date) < f.from) return false;
    if (f.to && String(d.Date) > f.to) return false;
    return !t || `${d['Document No.']} ${d['Supplier Ref No']} ${d['Invoice No.']} ${d['Vendor Account']} ${l['Item Code'] || ''} ${l.Items || l.Item || ''} ${l.Batch || ''} ${l['PO No'] || ''}`.toLowerCase().includes(t);
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const total = shown.reduce((s, { l }) => s + (Number(l['Accepted Qty'] ?? l.Quantity) || 0), 0);
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!docs) return <Spinner />;
  return (
    <>
      <PageHeader title="GRN / MRN Detail Register" subtitle="All receipt documents with their item lines. Use the filters to narrow down." />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <input className="input lg:col-span-2" placeholder="Search doc, invoice, PO, vendor, item, batch…" value={f.q} onChange={set('q')} aria-label="Search" />
          <select className="input" value={f.type} onChange={set('type')} aria-label="Receipt type"><option value="">GRN + MRN</option><option>GRN</option><option>MRN</option></select>
          <select className="input" value={f.wh} onChange={set('wh')} aria-label="Warehouse"><option value="">All warehouses</option>{opts.wh.map((x) => <option key={x}>{x}</option>)}</select>
          <select className="input" value={f.vendor} onChange={set('vendor')} aria-label="Vendor"><option value="">All vendors</option>{opts.vendor.map((x) => <option key={x}>{x}</option>)}</select>
          <div className="flex gap-1"><input type="date" className="input" value={f.from} onChange={set('from')} aria-label="From" /><input type="date" className="input" value={f.to} onChange={set('to')} aria-label="To" /></div>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead><tr>{['Document', 'Type', 'Date', 'Warehouse', 'Vendor', 'PO No.', 'Invoice', 'Item', 'Batch', 'Expiry', 'Qty', 'Rate'].map((h) => <th key={h} className={`th whitespace-nowrap ${h === 'Qty' || h === 'Rate' ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!shown.length && <tr><td className="td text-slate-500" colSpan={12}>No entries.</td></tr>}
              {shown.map(({ d, l, i }) => (
                <tr key={`${d['Document No.']}-${i}`} className="hover:bg-slate-50">
                  <td className="td !py-1 whitespace-nowrap font-medium"><Link className="text-brand-700 hover:underline" to={`/grn/${encodeURIComponent(d['Document No.'])}`}>{d['Document No.']}</Link></td>
                  <td className="td !py-1">{d['Receipt Type'] || 'GRN'}</td><td className="td !py-1 whitespace-nowrap">{d.Date}</td><td className="td !py-1">{d.Warehouse}</td><td className="td !py-1">{d['Vendor Account']}</td>
                  <td className="td !py-1 whitespace-nowrap">{l['PO No'] || d['Supplier Ref No']}</td><td className="td !py-1 whitespace-nowrap">{d['Invoice No.']}</td>
                  <td className="td !py-1 min-w-[16rem]">{l['Item Code'] ? `${l['Item Code']} — ` : ''}{l.Items || l.Item || ''}</td><td className="td !py-1 whitespace-nowrap">{l.Batch}</td><td className="td !py-1 whitespace-nowrap">{l['Expiry Date']}</td>
                  <td className="td !py-1 text-right tabular-nums">{l['Accepted Qty'] ?? l.Quantity ?? ''}</td><td className="td !py-1 text-right tabular-nums">{l.Rate ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={10}>{shown.length} lines</td><td className="td text-right tabular-nums">{Math.round(total * 100) / 100}</td><td className="td" /></tr></tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
