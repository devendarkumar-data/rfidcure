// Live exchange rate (INR per 1 unit of a foreign currency) for the Import PO. Free public feed, cached for an hour;
// if the feed is unreachable the user types the rate by hand (the PO never depends on this call succeeding).
import { bad } from './util.js';
const URL_OF = (c) => `https://open.er-api.com/v6/latest/${c}`;
const cache = new Map();
export async function rate(code, fetchFn = globalThis.fetch) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw bad('Currency code is required');
  if (c === 'INR') return { currency: c, rate: 1, asOf: null, source: 'INR' };
  const hit = cache.get(c); if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  let j;
  try {
    const r = await fetchFn(URL_OF(c), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = await r.json();
  } catch { throw bad('Could not fetch the live rate right now. Enter the exchange rate manually.'); }
  const inr = Number(j?.rates?.INR);
  if (!(inr > 0)) throw bad(`No live INR rate found for ${c}. Enter the exchange rate manually.`);
  const v = { currency: c, rate: Math.round(inr * 10000) / 10000, asOf: j.time_last_update_utc || null, source: 'open.er-api.com' };
  cache.set(c, { at: Date.now(), v });
  return v;
}
