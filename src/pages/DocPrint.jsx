import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Spinner from '../components/Spinner.jsx';

// Printable document (A4) for Imprest Out / Imprest In / Material Consumption. Opened from the registers by clicking the document number.
export const PRINTABLE = { 'imprest-out-new': 'IMPREST OUT', 'imprest-in-new': 'IMPREST IN', 'material-consumption': 'MATERIAL CONSUMPTION' };
export const printPath = (slug, id) => `/print/${slug}/${encodeURIComponent(id)}`;
const HIDE_HEAD = new Set(['Lines', 'DocNo', 'Document No.', 'Return Closed', 'Ref. Doc', 'Ref. Date', 'Is IGST', 'Location', 'Dispatch Name', 'Dispatch City', 'Dispatch Address', 'Dispatch Pincode', 'Dispatch State']);
const HIDE_LINE = new Set(['_k', '_name', 'Warehouse Type']);
const LABEL = { Items: 'Item Name', Item: 'Item Name' };
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : String(d ?? ''));
const border = '1px solid #000';

export default function DocPrint() {
  const { slug, id: idParam } = useParams(); const id = decodeURIComponent(idParam || '');
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api.get(`/api/t/${slug}/record`, { id }).then(setData).catch((e) => setErr(e.message)); }, [slug, id]);
  if (!PRINTABLE[slug]) return <div className="card p-4 text-sm">This document cannot be printed.</div>;
  if (err) return <div role="alert" className="card p-4 text-sm text-red-600">{err}</div>;
  if (!data) return <Spinner />;
  const head = Object.entries(data.record || {}).filter(([k, v]) => !k.startsWith('_') && !k.startsWith('__') && !HIDE_HEAD.has(k) && v !== '' && v !== null && v !== undefined);
  const lines = data.lines || [];
  const cols = [];
  for (const l of lines) for (const k of Object.keys(l)) if (!HIDE_LINE.has(k) && !k.startsWith('__') && !cols.includes(k) && lines.some((x) => x[k] !== '' && x[k] !== null && x[k] !== undefined)) cols.push(k);
  const qtyTotal = lines.reduce((s, l) => s + (Number(l.Quantity) || 0), 0);
  const cell = { border, fontSize: 11, padding: '3px 5px', verticalAlign: 'top' };
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-3 text-black print:max-w-none print:p-0">
      <style>{'@page { size: A4; margin: 10mm; } @media print { body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'}</style>
      <div className="mb-3 flex justify-between print:hidden"><Link className="text-sm text-brand-700 hover:underline" to={-1}>← Back</Link><button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button></div>
      <div style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}><img src="/logo.png" alt="Cure Surgicals" style={{ height: 46, display: 'inline-block', verticalAlign: 'middle', marginRight: 10 }} /></div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{PRINTABLE[slug]}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}><tbody>
          {Array.from({ length: Math.ceil(head.length / 2) }, (_, i) => head.slice(i * 2, i * 2 + 2)).map((pair, i) => (
            <tr key={i}>{pair.map(([k, v]) => <><td key={`${k}-l`} style={{ ...cell, fontWeight: 700, width: '18%', background: '#f1e4e3' }}>{k}</td><td key={`${k}-v`} style={{ ...cell, width: '32%' }}>{/date/i.test(k) ? dmy(v) : String(v)}</td></>)}{pair.length < 2 && <td colSpan={2} style={cell} />}</tr>
          ))}
        </tbody></table>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...cell, background: '#b98f8d' }}>#</th>{cols.map((c) => <th key={c} style={{ ...cell, background: '#b98f8d', textAlign: 'center' }}>{LABEL[c] || c}</th>)}</tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td style={cell}>{i + 1}</td>{cols.map((c) => <td key={c} style={{ ...cell, textAlign: typeof l[c] === 'number' ? 'right' : 'left' }}>{/date/i.test(c) ? dmy(l[c]) : String(l[c] ?? '')}</td>)}</tr>)}</tbody>
          {cols.includes('Quantity') && <tfoot><tr><td style={{ ...cell, fontWeight: 700 }} colSpan={cols.indexOf('Quantity') + 1}>Total</td><td style={{ ...cell, fontWeight: 700, textAlign: 'right' }}>{qtyTotal}</td><td style={cell} colSpan={cols.length - cols.indexOf('Quantity') - 1} /></tr></tfoot>}
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 50, fontSize: 11 }}><div>Prepared by</div><div>Checked by</div><div>Receiver's signature &amp; stamp</div></div>
      </div>
    </div>
  );
}
