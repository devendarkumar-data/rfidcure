import Collapsible from './Collapsible.jsx';

const r2 = (v) => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Totals under the lines: Quantity, Stock in hand, Gross, CGST, SGST, IGST, Cess, Taxable Value, Net. Collapsible.
export default function TotalsBlock({ qty = 0, hand = 0, gross = 0, cgst = 0, sgst = 0, igst = 0, cess = 0 }) {
  const rows = [[['Quantity', r2(qty)], ['Stock in hand', r2(hand)], ['Gross', r2(gross)]], [['CGST', r2(cgst)], ['SGST', r2(sgst)], ['IGST', r2(igst)]], [['Cess', r2(cess)], ['Taxable Value', r2(gross)], ['Net', `₹ ${r2(gross + cgst + sgst + igst + cess)}`]]];
  return (
    <Collapsible title="Totals" className="mt-3" defaultOpen={false}>
      <table className="w-full max-w-4xl border-collapse text-sm"><tbody>{rows.map((r, ri) => <tr key={ri}>{r.map(([k, v]) => <><th key={`${k}-k`} className={`w-[17%] border border-slate-300 px-2 py-2 text-left font-semibold ${k === 'Net' ? 'text-brand-700' : 'text-slate-700'}`}>{k} :</th><td key={`${k}-v`} className={`w-[16%] border border-slate-300 px-2 py-2 text-right tabular-nums ${k === 'Net' ? 'font-semibold text-brand-700' : ''}`}>{v}</td></>)}</tr>)}</tbody></table>
    </Collapsible>
  );
}
