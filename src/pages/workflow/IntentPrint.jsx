import { useParams } from 'react-router-dom';
import { api } from '../../api.js';
import Spinner from '../../components/Spinner.jsx';
import { Back, ErrorBox, useLoad } from './index.jsx';

const dmy = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : String(d || ''));
const border = '1px solid #000';
const cell = { border, fontSize: 11, padding: '3px 5px', verticalAlign: 'top' };
const HEAD = '#b98f8d';

export default function IntentPrint() {
  const { id } = useParams();
  const { data, err } = useLoad(() => api.get('/api/wf/intents/get', { id }), [id]);
  if (err) return <ErrorBox msg={err} />;
  if (!data) return <Spinner />;
  const { header, lines, status } = data;
  const q = (v) => (v === '' || v === null || v === undefined ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
  const kv = [['Purchase Indent No.', id], ['Date', dmy(header.Date)], ['Requesting Warehouse', header['Requesting Warehouse']], ['Status', status.Status], ['Requested by', status['Created By']], ['Reviewed by', status['Reviewed By']], ['Reviewed on', dmy(String(status['Reviewed At'] || '').slice(0, 10))], ['Review remarks', status['Review Remarks']]];
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-3 text-black print:max-w-none print:p-0">
      <style>{'@page { size: A4; margin: 10mm; } @media print { body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'}</style>
      <div className="mb-3 flex justify-between print:hidden"><Back to={`/purchase-intent/${encodeURIComponent(id)}`}>Back</Back><button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button></div>
      <div style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>PURCHASE INDENT</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}><tbody>
          <tr><td colSpan={4} style={{ ...cell, background: HEAD }}><img src="/logo.png" alt="Cure Surgicals" style={{ height: 40, verticalAlign: 'middle', marginRight: 8 }} /><b style={{ fontSize: 13 }}>Cure Surgicals</b></td></tr>
          {[0, 2, 4, 6].map((i) => <tr key={i}>{kv.slice(i, i + 2).map(([k, v]) => <><td key={`${k}l`} style={{ ...cell, fontWeight: 700, width: '18%', background: '#f1e4e3' }}>{k}</td><td key={`${k}v`} style={{ ...cell, width: '32%' }}>{v}</td></>)}</tr>)}
          {header['Narration-Notes'] && <tr><td style={{ ...cell, fontWeight: 700, background: '#f1e4e3' }}>Notes</td><td colSpan={3} style={cell}>{header['Narration-Notes']}</td></tr>}
        </tbody></table>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['S.NO', 'ITEM CODE', 'DESCRIPTION OF GOODS', 'UOM', 'CURRENT STOCK', 'REQUIRED', 'REQUIRED BY', 'PRIORITY', 'APPROVED'].map((h) => <th key={h} style={{ ...cell, background: HEAD, textAlign: 'center' }}>{h}</th>)}</tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td><td style={cell}>{l['Item Code']}</td><td style={cell}>{l.Description || l.Items}</td><td style={{ ...cell, textAlign: 'center' }}>{l.Units || 'NOS'}</td><td style={{ ...cell, textAlign: 'right' }}>{q(l['Current Stock'])}</td><td style={{ ...cell, textAlign: 'right' }}>{q(l.Quantity)}</td><td style={cell}>{dmy(l['Required By Date'])}</td><td style={cell}>{l.Priority}</td><td style={{ ...cell, textAlign: 'right' }}>{q(l['Approved Qty'] ?? l['Approved'])}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5} style={{ ...cell, fontWeight: 700, textAlign: 'center' }}>Total</td><td style={{ ...cell, fontWeight: 700, textAlign: 'right' }}>{q(lines.reduce((s, l) => s + (Number(l.Quantity) || 0), 0))}</td><td colSpan={3} style={cell} /></tr></tfoot>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 50, fontSize: 11 }}><div>Requested by</div><div>Approved by</div></div>
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 10, fontWeight: 700 }}>This is computer generated document, signature not required</div>
      </div>
    </div>
  );
}
