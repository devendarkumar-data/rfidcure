import { useEffect, useState } from 'react';

// Increments every `ms` while the browser tab is visible (and once when it becomes visible again),
// so list pages can re-fetch and show other users' transactions without a manual reload.
export const REFRESH_MS = 20000;
export function useTick(ms = REFRESH_MS) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let last = Date.now();
    const bump = () => { last = Date.now(); setN((x) => x + 1); };
    const t = setInterval(() => { if (!document.hidden) bump(); }, ms);
    const vis = () => { if (!document.hidden && Date.now() - last > ms) bump(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [ms]);
  return n;
}
