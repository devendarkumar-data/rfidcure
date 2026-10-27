import { istParts } from './util.js';

const SECRET_KEYS = /password|hash|token|secret/i;
const clip = (s, n = 1500) => (s.length > n ? s.slice(0, n) + '…' : s);
export function safeJson(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return clip(v);
  return clip(JSON.stringify(v, (k, val) => (SECRET_KEYS.test(k) ? '[redacted]' : k === 'Lines' && typeof val === 'string' ? `[${val.length} chars]` : val)));
}

async function write(store, tab, { user, event, module, doc, action, prev, next, remarks }) {
  const t = istParts();
  await store.append(tab, [{
    'User ID': user?.id || '', Event_Type: event, Module: module || '', Document_No: doc || '', Action: action || '',
    'Previous Value': safeJson(prev), 'New Value': safeJson(next), Created_Date: t.date, Created_Time: t.time, Remarks: remarks || '',
  }]);
}
// Data changes (create / update / delete / failed authorisations) -> "Audit Logs"
export const audit = (store, e) => write(store, 'Audit Logs', { event: 'Data', ...e });
// Sign-in / sign-out / password events -> "Activity Log"
export const activity = (store, e) => write(store, 'Activity Log', e);
