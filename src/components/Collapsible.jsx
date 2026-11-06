import { useState } from 'react';

// Section that can be collapsed / expanded (a small chevron toggle on the left of the title).
export default function Collapsible({ title, defaultOpen = true, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={className}>
      <button type="button" className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-brand-700" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="inline-block w-3 text-xs">{open ? '▾' : '▸'}</span>{title}
      </button>
      {open && children}
    </section>
  );
}
