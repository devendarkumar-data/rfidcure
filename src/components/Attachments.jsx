import { useRef, useState } from 'react';
import { api } from '../api.js';

// Attachment value is stored in one sheet cell as "ATTID|file name;ATTID|file name".
export const parseAtt = (v) => String(v || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf('|'); return { id: s.slice(0, i), name: s.slice(i + 1) }; });
const pack = (list) => list.map((a) => `${a.id}|${a.name}`).join(';');
const MAX = 5;

export async function openAttachment(id) {
  const f = await api.get('/api/attachments/get', { id });
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
  const a = document.createElement('a'); a.href = url; a.download = f.name; a.target = '_blank'; a.rel = 'noopener'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function AttachmentLinks({ value }) {
  const [err, setErr] = useState('');
  const list = parseAtt(value);
  if (!list.length) return <span className="text-slate-400">—</span>;
  return (<span className="flex flex-wrap gap-x-3">{list.map((a) => <button key={a.id} type="button" className="text-brand-700 underline" onClick={(ev) => { ev.stopPropagation(); openAttachment(a.id).catch((e) => setErr(e.message)); }}>{a.name}</button>)}{err && <span className="text-xs text-red-600">{err}</span>}</span>);
}

export default function AttachmentInput({ id, value, onChange, disabled, docType = 'grn' }) {
  const ref = useRef(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const list = parseAtt(value);
  const pick = async (e) => {
    const files = [...e.target.files]; e.target.value = ''; setErr('');
    let cur = list;
    for (const f of files) {
      if (cur.length >= MAX) { setErr(`At most ${MAX} files`); break; }
      if (f.size > 1_500_000) { setErr(`${f.name} is larger than 1.5 MB`); continue; }
      setBusy(true);
      try {
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });
        const r = await api.post('/api/attachments', { docType, fileName: f.name, mime: f.type, data });
        cur = [...cur, { id: r.id, name: r.name }]; onChange(pack(cur));
      } catch (x) { setErr(x.message); } finally { setBusy(false); }
    }
  };
  return (
    <div>
      {!disabled && <input ref={ref} id={id} type="file" accept="application/pdf,image/png,image/jpeg" multiple className="block w-full text-xs file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1" onChange={pick} disabled={busy} />}
      {busy && <p className="mt-1 text-xs text-slate-500">Uploading…</p>}
      <ul className="mt-1 space-y-0.5 text-xs">{list.map((a) => (
        <li key={a.id} className="flex items-center gap-2"><button type="button" className="truncate text-brand-700 underline" onClick={() => openAttachment(a.id).catch((x) => setErr(x.message))}>{a.name}</button>
          {!disabled && <button type="button" className="text-red-600" aria-label={`Remove ${a.name}`} onClick={() => onChange(pack(list.filter((x) => x.id !== a.id)))}>✕</button>}</li>))}</ul>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {!disabled && <p className="mt-0.5 text-[11px] text-slate-400">PDF, PNG or JPG, up to 1.5 MB each</p>}
    </div>
  );
}
