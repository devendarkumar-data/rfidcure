import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const Ctx = createContext(null);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((kind, message, ms = 5000) => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, kind, message }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), ms);
  }, []);
  const api = useMemo(() => ({
    success: (m) => push('success', m), error: (m) => push('error', m, 8000), warn: (m) => push('warn', m, 8000), info: (m) => push('info', m),
  }), [push]);
  const color = { success: 'bg-green-600', error: 'bg-red-600', warn: 'bg-amber-500', info: 'bg-brand-700' };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-md px-3 py-2 text-sm text-white shadow-lg ${color[t.kind]}`}>
            {t.message}
            <button className="float-right ml-2 opacity-80 hover:opacity-100" aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
