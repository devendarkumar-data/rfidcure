import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Pick several values from a lookup; stored as one comma-separated cell ("USD, EUR").
export default function MultiSelect({ id, field, value, onChange, disabled }) {
  const [opts, setOpts] = useState([]); const [open, setOpen] = useState(false); const box = useRef(null);
  const chosen = String(value || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  useEffect(() => { api.get('/api/lookup', { field }).then((r) => setOpts(r.options || [])).catch(() => setOpts([])); }, [field]);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, []);
  const toggle = (v) => onChange((chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]).join(', '));
  return (
    <div ref={box} className="relative">
      <button type="button" id={id} disabled={disabled} className="input flex w-full items-center justify-between gap-1 text-left" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`truncate ${chosen.length ? '' : 'text-slate-400'}`}>{chosen.length ? chosen.join(', ') : '— Select —'}</span><span aria-hidden className="text-slate-400">▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-multiselectable className="absolute z-30 mt-1 max-h-56 w-56 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {!opts.length && <li className="px-3 py-2 text-slate-500">No options</li>}
          {opts.map((o) => (
            <li key={o.value}><label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />{o.label}</label></li>
          ))}
        </ul>
      )}
    </div>
  );
}
