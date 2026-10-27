export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (m, d) => new HttpError(400, m, d);
export const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);
export const unprocessable = (m, d) => new HttpError(422, m, d);

const IST = 'Asia/Kolkata';
export function istParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
export const today = () => istParts().date;

// Accepts yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, Date, or a Google/Excel serial number. Returns yyyy-mm-dd or ''.
export function normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
    return '';
  }
  if (v instanceof Date) return Number.isNaN(+v) ? '' : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(+new Date(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// Indian financial year label, April to March: 2026-10-26 -> "26-27"
export function fyOf(dateStr = today()) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const isBlank = (v) => v === '' || v === null || v === undefined;
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sstr = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Serialises async work per key inside one server instance. Cross-instance races are handled by
// re-checking after the write (see docs.js / crud.js) - see README "Known limitations".
const chains = new Map();
export function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  chains.set(key, run.finally(() => { if (chains.get(key) === run) chains.delete(key); }).catch(() => {}));
  return run;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function constantTimeEq(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
