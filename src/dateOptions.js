// Report date options (same list as the Focus report screen). Financial year runs 1 April - 31 March.
export const DATE_OPTIONS = ['Date Range', 'As on date', 'Current month', 'Previous month', 'Current week', 'Previous week', 'Today', 'Current year', 'Previous year', 'Current Financial Year', 'Previous Financial Year', 'Yesterday', 'Current Quarter', 'Previous Quarter'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function rangeFor(opt, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const fy = m >= 3 ? y : y - 1; const wd = (now.getDay() + 6) % 7; // Monday = 0
  const mon = new Date(y, m, d - wd); const q0 = Math.floor(((m + 9) % 12) / 3); // quarter index in the financial year
  const qStart = new Date(fy, 3 + q0 * 3, 1);
  const r = (a, b) => ({ from: iso(a), to: iso(b) });
  switch (opt) {
    case 'As on date': return r(new Date(fy, 3, 1), now);
    case 'Current month': return r(new Date(y, m, 1), new Date(y, m + 1, 0));
    case 'Previous month': return r(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'Current week': return r(mon, new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6));
    case 'Previous week': return r(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7), new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 1));
    case 'Today': return r(now, now);
    case 'Yesterday': return r(new Date(y, m, d - 1), new Date(y, m, d - 1));
    case 'Current year': return r(new Date(y, 0, 1), new Date(y, 11, 31));
    case 'Previous year': return r(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    case 'Current Financial Year': return r(new Date(fy, 3, 1), new Date(fy + 1, 2, 31));
    case 'Previous Financial Year': return r(new Date(fy - 1, 3, 1), new Date(fy, 2, 31));
    case 'Current Quarter': return r(qStart, new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0));
    case 'Previous Quarter': return r(new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1), new Date(qStart.getFullYear(), qStart.getMonth(), 0));
    default: return { from: '', to: '' };
  }
}
export const natCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
export function downloadCsv(name, headers, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
