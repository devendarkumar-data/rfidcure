import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';

// Searchable dropdown. Loads suggestions from /api/lookup?field=… ; when the master is empty, free text is accepted.
export default function Combobox({ field, value, onChange, disabled, placeholder, onPick, id, required, allowFree = true, extraParams }) {
  const [text, setText] = useState(value ?? '');
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const box = useRef(null); const [pos, setPos] = useState(null); const listId = useId(); const seq = useRef(0);

  useEffect(() => { setText(value ?? ''); }, [value]);
  useEffect(() => {
    if (!open) return undefined;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.get('/api/lookup', { field, q: text, ...extraParams });
        if (my === seq.current) { setOpts(r.options || []); if (!text) setEmpty(!(r.options || []).length); }
      } catch { if (my === seq.current) setOpts([]); } finally { if (my === seq.current) setBusy(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [open, text, field, extraParams]);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, []);

  // Position the list with fixed coordinates so it is never clipped by a scrolling table / modal.
  useEffect(() => {
    if (!open || !box.current) { setPos(null); return undefined; }
    const place = () => { const r = box.current.getBoundingClientRect(); const below = window.innerHeight - r.bottom; setPos({ left: r.left, width: Math.max(r.width, 220), ...(below < 240 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) }); };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const pick = (o) => { setText(o.value); setOpen(false); onChange?.(o.value, o); onPick?.(o); };
  return (
    <div ref={box} className="relative">
      <input id={id} className="input" value={text} disabled={disabled} required={required} placeholder={placeholder || 'Type to search…'} role="combobox" aria-expanded={open} aria-controls={listId} autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (allowFree) onChange?.(e.target.value, null); }}
        onBlur={() => { if (!allowFree && text !== (value ?? '')) setText(value ?? ''); }} />
      {open && !disabled && (
        <ul id={listId} role="listbox" style={pos || { visibility: 'hidden' }} className="fixed z-[60] max-h-60 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {busy && <li className="px-3 py-1.5 text-slate-400">Searching…</li>}
          {!busy && !opts.length && <li className="px-3 py-1.5 text-slate-400">{empty && allowFree ? 'No master data yet — free text accepted' : 'No matches'}</li>}
          {opts.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}
              className={`cursor-pointer px-3 py-1.5 hover:bg-brand-50 ${o.inScope === false ? 'text-slate-400' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              {o.label}{o.inScope === false && <span className="ml-2 text-xs">(not your warehouse)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
