import { useEffect, useRef, useState } from 'react';

// Checkbox dropdown. `value` and onChange use an array of strings; the page stores it as "a|b|c" in the URL.
export default function MultiSelect({ label, options, value, onChange, allLabel = 'All', width = 'min-w-[9rem]' }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, []);
  const sel = new Set(value);
  const toggle = (o) => { const n = new Set(sel); if (n.has(o)) n.delete(o); else n.add(o); onChange([...n]); };
  const text = !value.length ? allLabel : value.length <= 2 ? value.join(', ') : `${value.length} selected`;
  return (
    <div className={`relative block ${width}`} ref={ref}>
      <span className="label">{label}</span>
      <button type="button" className="input flex w-full items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="truncate">{text}</span><span aria-hidden="true" className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute z-30 mt-1 max-h-64 w-full min-w-[11rem] overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <button type="button" className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-brand-700 hover:bg-slate-50" onClick={() => onChange([])}>Clear selection</button>
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(o)} onChange={() => toggle(o)} /> <span>{o}</span>
            </label>
          ))}
          {!options.length && <p className="px-2 py-1 text-sm text-slate-400">No options</p>}
        </div>
      )}
    </div>
  );
}
