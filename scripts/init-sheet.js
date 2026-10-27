// Creates any missing worksheet (with its header row) and refuses to touch a worksheet whose header differs from the approved template.
// Safe to run repeatedly. Adds the three extra tabs the app needs: Credentials, Doc Status, Doc History.
import { sheetsStore } from './_env.js';
import { ALLOWED_TABS } from '../shared/registry.js';
const store = await sheetsStore();
let ok = 0, failed = 0;
for (const tab of ALLOWED_TABS) {
  try { await store.ensure(tab); ok++; } catch (e) { failed++; console.error(`✗ ${tab}: ${e.message}`); }
}
console.log(`${ok} worksheets ready${failed ? `, ${failed} need attention (see above)` : ''}.`);
process.exit(failed ? 1 : 0);
