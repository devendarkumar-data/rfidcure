import { useParams } from 'react-router-dom';
import { api } from '../../api.js';
import Spinner from '../../components/Spinner.jsx';
import { Back, ErrorBox, useLoad } from './index.jsx';

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
const f2 = (v) => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = (v) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : String(d || ''));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n));
export function rupeesInWords(amount) {
  const total = Math.round(Math.abs(num(amount)) * 100); let rupees = Math.floor(total / 100); const paise = total % 100;
  if (!rupees && !paise) return 'Zero';
  const parts = []; const crore = Math.floor(rupees / 1e7); rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5); rupees %= 1e5; const thou = Math.floor(rupees / 1e3); rupees %= 1e3;
  if (crore) parts.push(`${below1000(crore)} Crore`); if (lakh) parts.push(`${below100(lakh)} Lakh`); if (thou) parts.push(`${below100(thou)} Thousand`); if (rupees) parts.push(below1000(rupees));
  let out = parts.join(' '); if (paise) out += `${out ? ' and ' : ''}${below100(paise)} Paise`;
  return `${out} Rupees`.replace(/^ Rupees$/, 'Zero');
}

const HEAD = '#b98f8d';
const box = { border: '1px solid #000' };
const th = { ...box, background: HEAD, fontWeight: 700, fontSize: 10, padding: '3px 2px', textAlign: 'center', verticalAlign: 'middle' };
const td = { borderLeft: '1px solid #000', borderRight: '1px solid #000', fontSize: 10, padding: '3px 3px', verticalAlign: 'top' };

export default function PoPrint() {
  const { id } = useParams();
  const { data, err } = useLoad(() => api.get('/api/wf/pos/get', { id }), [id]);
  if (err) return <ErrorBox msg={err} />;
  if (!data) return <Spinner />;
  const { header, lines, vendor, company: co, poType } = data;
  const igst = /^(yes|y|true)$/i.test(String(header['Is IGST'] || '')) || poType === 'import';
  const rows = lines.map((l) => {
    const gross = num(l.Quantity) * num(l.Rate); const disc = num(l['Other Discount']); const taxable = l['Taxable Value'] !== undefined && l['Taxable Value'] !== '' ? num(l['Taxable Value']) : gross - disc;
    const gst = num(l['GST %']);
    return { l, gross, disc, taxable, cg: igst ? 0 : gst / 2, sg: igst ? 0 : gst / 2, ig: igst ? gst : 0, total: l['Line Total'] !== undefined && l['Line Total'] !== '' ? num(l['Line Total']) : taxable };
  });
  const sum = (k) => rows.reduce((a, r) => a + num(r.l[k]), 0);
  const qtyTotal = rows.reduce((a, r) => a + num(r.l.Quantity), 0);
  const totalValue = rows.reduce((a, r) => a + r.total, 0); const rounded = Math.round(totalValue);
  const cityLine = [vendor.city].filter(Boolean).join(', ');
  const lbl = { fontWeight: 700, fontSize: 10 }; const val = { fontSize: 10 };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-3 text-black print:max-w-none print:p-0">
      <style>{'@page { size: A4; margin: 8mm; } @media print { body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } } .po-doc, .po-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }'}</style>
      <div className="mb-3 flex justify-between print:hidden"><Back to={`/purchasing/po/${encodeURIComponent(id)}`}>Back</Back><button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button></div>
      <div className="po-doc" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: 4, fontWeight: 700, fontSize: 12 }}>PURCHASE ORDER</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <tbody>
            <tr>
              <td style={{ ...box, background: HEAD, fontWeight: 700, fontSize: 11, padding: '3px 4px', width: '53%' }}>INVOICE TO</td>
              <td style={{ ...box, background: HEAD, fontWeight: 700, fontSize: 10, padding: '3px 4px', width: '24%' }}>PURCHASE ORDER NO.:</td>
              <td style={{ ...box, fontWeight: 700, fontSize: 10, padding: '3px 4px', width: '23%' }}>{id}</td>
            </tr>
            <tr>
              <td rowSpan={7} style={{ ...box, verticalAlign: 'top', padding: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}><img src="/logo.png" alt="Cure Surgicals" style={{ height: 48 }} /><div><div style={{ fontWeight: 700, fontSize: 14 }}>{co.name}</div><div style={val}>{co.address}</div></div></div>
                <div style={{ ...val, marginTop: 6 }}><span style={lbl}>STATE :</span> {co.state}</div>
                <div style={{ ...val, marginTop: 4 }}><span style={lbl}>CITY :</span> {co.city} &nbsp;&nbsp;&nbsp; <span style={lbl}>PIN :</span> {co.pin}</div>
                <div style={{ ...val, marginTop: 4 }}><span style={lbl}>TEL NO :</span> {co.tel} &nbsp;&nbsp;&nbsp; <span style={lbl}>GSTIN :</span> {co.gstin}</div>
                <div style={{ ...val, marginTop: 4 }}><span style={lbl}>EMAIL :</span> {co.email}</div>
                <div style={{ ...val, marginTop: 4 }}><span style={lbl}>WEBSITE :</span> {co.website}</div>
              </td>
              <td style={{ ...box, background: HEAD, ...lbl, padding: '3px 4px' }}>DATED :</td><td style={{ ...box, ...val, padding: '3px 4px' }}>{dmy(header.Date)}</td>
            </tr>
            <tr><td style={{ ...box, background: HEAD, ...lbl, padding: '3px 4px' }}>VENDOR CODE :</td><td style={{ ...box, ...val, padding: '3px 4px' }}>{vendor.code}</td></tr>
            <tr><td style={{ ...box, background: HEAD, ...lbl, padding: '3px 4px' }}>SUPPLIER REF NO :</td><td style={{ ...box, ...val, padding: '3px 4px' }}>{header['Supplier Ref No']}</td></tr>
            <tr><td style={{ ...box, background: HEAD, ...lbl, padding: '3px 4px' }}>DELIVERY PERIOD :</td><td style={{ ...box, ...val, padding: '3px 4px' }}>{header['Terms of Delivery'] || header['Terms Of Delivery'] || ''}</td></tr>
            <tr><td style={{ ...box, background: HEAD, ...lbl, padding: '3px 4px' }}>PAYMENT TERM :</td><td style={{ ...box, ...val, padding: '3px 4px' }}>{header['Payment Terms']}</td></tr>
            <tr><td style={{ ...box, background: HEAD, ...lbl, padding: '3px 4px' }}>WARRANTY PERIOD :</td><td style={{ ...box, ...val, padding: '3px 4px' }}>{header['Warranty Period'] || ''}</td></tr>
            <tr><td style={{ ...box, padding: '9px 4px' }} /><td style={{ ...box }} /></tr>
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <tbody>
            <tr><td style={{ ...box, background: HEAD, fontWeight: 700, fontSize: 11, padding: '3px 4px', width: '53%' }}>SUPPLIER DETAILS</td><td style={{ ...box, background: HEAD }} /></tr>
            <tr>
              <td style={{ ...box, verticalAlign: 'top', padding: 6 }}>
                <div style={val}><span style={lbl}>NAME :</span> <b>{vendor.name}</b></div>
                <div style={{ ...val, marginTop: 3, whiteSpace: 'pre-line' }}><span style={lbl}>ADDRESS :</span> {vendor.address}</div>
                <div style={{ ...val, marginTop: 3 }}><span style={lbl}>CITY :</span> {cityLine}</div>
              </td>
              <td style={{ ...box, verticalAlign: 'top', padding: 6 }}>
                <div style={val}><span style={lbl}>PINCODE :</span> {vendor.pincode}</div>
                <div style={{ ...val, marginTop: 3 }}><span style={lbl}>STATE NAME :</span> {vendor.state}</div>
                <div style={{ ...val, marginTop: 3 }}><span style={lbl}>DRUG LIC :</span> {vendor.drugLic}</div>
                <div style={{ ...val, marginTop: 3 }}><span style={lbl}>GSTIN :</span> {vendor.gstin}</div>
              </td>
            </tr>
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>{['4%', '12%', '21%', '5%', '5%', '7%', '8%', '6%', '8%', '5%', '5%', '5%', '9%'].map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr><th style={th} rowSpan={2}>S.NO</th><th style={th} rowSpan={2}>ITEM CODE</th><th style={th} rowSpan={2}>DESCRIPTION OF GOODS</th><th style={th} rowSpan={2}>QTY</th><th style={th} rowSpan={2}>UOM</th><th style={th} rowSpan={2}>RATE ₹</th><th style={th} rowSpan={2}>GROSS ₹</th><th style={th} rowSpan={2}>OTH DISC (₹)</th><th style={th} rowSpan={2}>TAXABLE AMOUNT (₹)</th><th style={th} colSpan={3}>GST %</th><th style={th} rowSpan={2}>TOTAL AMOUNT</th></tr>
            <tr><th style={th}>CGST</th><th style={th}>SGST</th><th style={th}>IGST</th></tr>
          </thead>
          <tbody>
            {rows.map(({ l, gross, disc, taxable, cg, sg, ig, total }, i) => (
              <tr key={i} style={{ pageBreakInside: 'avoid' }}>
                <td style={{ ...td, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...td, textAlign: 'center', wordBreak: 'break-all' }}>{l['Item Code']}</td>
                <td style={td}>{l.Description || l.Items}</td>
                <td style={{ ...td, textAlign: 'center' }}>{fq(l.Quantity)}</td>
                <td style={{ ...td, textAlign: 'center' }}>{l.Units || 'NOS'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{num(l.Rate) ? f2(l.Rate) : ''}</td>
                <td style={{ ...td, textAlign: 'right' }}>{gross ? f2(gross) : ''}</td>
                <td style={{ ...td, textAlign: 'right' }}>{disc ? f2(disc) : ''}</td>
                <td style={{ ...td, textAlign: 'right' }}>{taxable ? f2(taxable) : ''}</td>
                <td style={{ ...td, textAlign: 'center' }}>{cg ? cg : ''}</td><td style={{ ...td, textAlign: 'center' }}>{sg ? sg : ''}</td><td style={{ ...td, textAlign: 'center' }}>{ig ? ig : ''}</td>
                <td style={{ ...td, textAlign: 'right' }}>{total ? f2(total) : ''}</td>
              </tr>
            ))}
            <tr style={{ height: 14 }}>{Array.from({ length: 13 }).map((_, i) => <td key={i} style={td} />)}</tr>
            <tr>
              <td colSpan={3} style={{ ...box, fontWeight: 700, fontSize: 10, padding: '3px 4px', textAlign: 'center' }}>Page Total</td>
              <td style={{ ...box, fontWeight: 700, fontSize: 10, textAlign: 'center' }}>{fq(qtyTotal)}</td>
              <td colSpan={9} style={box} />
            </tr>
          </tbody>
        </table>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <tbody>
            <tr>
              <td rowSpan={5} style={{ ...box, verticalAlign: 'top', padding: 6, width: '73%' }}><span style={lbl}>NARRATION :</span> <span style={val}>{header['Narration-Notes']}</span></td>
              <td style={{ ...box, ...lbl, padding: '3px 4px', width: '14%' }}>CGST</td><td style={{ ...box, ...val, textAlign: 'right', padding: '3px 4px', width: '13%' }}>{f2(sum('CGST'))}</td>
            </tr>
            <tr><td style={{ ...box, ...lbl, padding: '3px 4px' }}>SGST</td><td style={{ ...box, ...val, textAlign: 'right', padding: '3px 4px' }}>{f2(sum('SGST'))}</td></tr>
            <tr><td style={{ ...box, ...lbl, padding: '3px 4px' }}>IGST</td><td style={{ ...box, ...val, textAlign: 'right', padding: '3px 4px' }}>{f2(sum('IGST'))}</td></tr>
            <tr><td style={{ ...box, ...lbl, padding: '3px 4px' }}>Total Value</td><td style={{ ...box, ...val, textAlign: 'right', padding: '3px 4px' }}>{f2(totalValue)}</td></tr>
            <tr><td style={{ ...box, ...lbl, padding: '3px 4px' }}>Total Value (Rounded)</td><td style={{ ...box, ...val, textAlign: 'right', padding: '3px 4px' }}>{f2(rounded)}</td></tr>
          </tbody>
        </table>
        <div style={{ ...box, borderTop: 'none', padding: '5px 6px', fontSize: 10 }}><b>INVOICE VALUE ( IN WORD ₹ ) :</b> &nbsp; {rupeesInWords(rounded)} Only</div>
        <div style={{ ...box, borderTop: 'none', padding: 6, fontSize: 10, minHeight: 120, position: 'relative' }}>
          <div style={{ fontWeight: 700 }}>TERMS &amp; CONDITIONS :</div>
          <div style={{ marginTop: 8 }}>{(co.terms || []).map((t, i) => <div key={i}>{t}</div>)}</div>
          <div style={{ position: 'absolute', right: 8, top: 52, textAlign: 'right' }}><b>For &nbsp;&nbsp;&nbsp; {co.name}</b></div>
          <div style={{ position: 'absolute', right: 8, top: 92, fontWeight: 700 }}>AUTHORISED SIGNATORY</div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center', fontWeight: 700 }}>This is computer generated invoice signature not required</div>
        </div>
      </div>
    </div>
  );
}
