// Thin fetch wrapper for the serverless API. The session lives in an HttpOnly cookie, so nothing secret is handled here.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

async function request(method, path, body, { headers = {}, quiet401 = false } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'x-requested-with': 'cure-erp', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && !quiet401 && onUnauthorized) onUnauthorized();
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const api = {
  get: (path, params, opts) => request('GET', path + qs(params), undefined, opts),
  post: (path, body, opts) => request('POST', path, body ?? {}, opts),
  put: (path, body, opts) => request('PUT', path, body ?? {}, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

// uuid-like key that satisfies /^[A-Za-z0-9-]{8,64}$/
export function idemKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Fetch a CSV from the API (with the session cookie) and hand it to the browser as a file.
export async function download(path, params, filename = 'export.csv') {
  const res = await fetch(path + qs(params), { credentials: 'same-origin', headers: { 'x-requested-with': 'cure-erp' } });
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || filename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { qs };
