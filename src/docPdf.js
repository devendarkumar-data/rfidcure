// One PDF per transaction (Imprest Out / Imprest In / Consumption), built in the browser from the register rows of that document.
const TITLE = { out: 'IMPREST OUT', in: 'IMPREST IN', cons: 'MATERIAL CONSUMPTION' };
export async function downloadDocPdf(type, no, lines, company = 'Cure Surgicals') {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const d = lines[0] || {}; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14); doc.text(company, 40, 40); doc.setFontSize(12); doc.text(TITLE[type] || 'DOCUMENT', 40, 58);
  doc.setFontSize(9);
  const head = [['Document No', no], ['Date', d.date], ['Customer A/c', d['Customer A/c Name']], ['Hospital', d['Warehouse 2']], ['Doctor', d['Doctor Name']], ['Location', d['Location Name']], ['Against', d['Base Link Doc No']], ['Narration', d.Narration]].filter((r) => r[1]);
  head.forEach(([k, v], i) => { const x = 40 + (i % 2) * 400, y = 78 + Math.floor(i / 2) * 14; doc.text(`${k}: ${v}`, x, y); });
  const qty = lines.reduce((s, l) => s + (Number(l.Quantity) || 0), 0), net = lines.reduce((s, l) => s + (Number(l['Net Amount']) || 0), 0);
  autoTable(doc, {
    startY: 78 + Math.ceil(head.length / 2) * 14 + 8, styles: { fontSize: 8 }, headStyles: { fillColor: [11, 74, 143] },
    head: [['#', 'Item Code', 'Item Name', 'HSN', 'Batch', 'Expiry', 'Qty', 'Rate', 'Net Amount']],
    body: lines.map((l, i) => [i + 1, l['Item Code'], l['Item Name'], l['Item HSN/SAC'], l.Batch, l['Expiry Date'], l.Quantity, l.Rate, l['Net Amount']]),
    foot: [['', '', '', '', '', 'Total', qty, '', net.toFixed(2)]], footStyles: { fillColor: [241, 245, 249], textColor: 20 },
  });
  doc.save(`${String(no).replace(/[\\/]/g, '-')}.pdf`);
}
