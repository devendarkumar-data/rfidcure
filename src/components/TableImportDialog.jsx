import { useState } from 'react';
import { api, download } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';

const toB64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader(); fr.onerror = () => rej(new Error('Could not read the file'));
  fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(file);
});

function saveErrors(errors, name) {
  const esc = (v) => { let x = String(v ?? ''); if (/^[=+@-]/.test(x)) x = `'${x}`; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const url = URL.createObjectURL(new Blob(['﻿' + ['Row,Message', ...errors.map((e) => `${e.row},${esc(e.message)}`)].join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name}-import-errors.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Import a master table from .xlsx / .csv: check first, then confirm. Nothing is written while there are errors.
export default function TableImportDialog({ slug, title, columns, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null); const [skip, setSkip] = useState(false); const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (confirm) => {
    if (!file) { setErr('Choose a file first'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/t/${slug}/import`, { filename: file.name, content: await toB64(file), skipExisting: skip, confirm });
      setRes(r);
      if (r.committed) { toast.success(`${title}: ${r.counts.rows} rows imported`); onDone(); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const ok = res && !res.committed && !res.counts.errors && res.counts.rows > 0;
  return (
    <Modal wide title={`Import — ${title}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn" disabled={busy || !file} onClick={() => run(false)}>{busy && !ok ? 'Checking…' : 'Check file'}</button>
      <button className="btn btn-primary" disabled={busy || !ok} onClick={() => run(true)}>Import {ok ? res.counts.rows : ''} rows</button>
    </>}>
      {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <label className="label" htmlFor="ti-file">File (.xlsx or .csv)</label>
      <input id="ti-file" type="file" accept=".xlsx,.csv" className="input !p-1.5" onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); setErr(''); }} />
      <div className="mt-1 flex gap-3 text-xs">
        <button type="button" className="text-brand-700 hover:underline" onClick={() => download(`/api/t/${slug}/template`, { format: 'xlsx' }, `${slug}-template.xlsx`).catch((e) => toast.error(e.message))}>Blank Excel template</button>
        <button type="button" className="text-brand-700 hover:underline" onClick={() => download(`/api/t/${slug}/template`, {}, `${slug}-template.csv`).catch((e) => toast.error(e.message))}>Blank CSV template</button>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={skip} onChange={(e) => { setSkip(e.target.checked); setRes(null); }} /><span>Skip rows that already exist (otherwise they are reported as errors)</span></label>
      <p className="mt-3 text-xs text-slate-500">Columns: {columns.join(', ')}. The Master Id is generated automatically. New rows are added; existing records are never changed. Nothing is written until you click Import and the file has no errors.</p>
      {res && (
        <div className="mt-3 text-sm">
          <div className="flex flex-wrap gap-4"><span><b>{res.counts.rows}</b> valid rows</span><span className={res.counts.errors ? 'text-red-600' : ''}><b>{res.counts.errors}</b> errors</span>{!!res.counts.skipped && <span><b>{res.counts.skipped}</b> skipped (already exist)</span>}</div>
          {!!res.errors?.length && (
            <div className="mt-2">
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => saveErrors(res.errors, slug)}>Download error report</button>
              <ul className="mt-1 max-h-48 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{res.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
            </div>
          )}
          {ok && <p className="mt-2 text-green-700">File is valid. Click Import to add these rows.</p>}
        </div>
      )}
    </Modal>
  );
}
