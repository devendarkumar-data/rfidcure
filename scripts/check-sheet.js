// Read-only: reports every worksheet that is missing or whose header row differs from the approved template.
import { sheetsStore } from './_env.js';
const store = await sheetsStore();
const res = await store.checkAll(); let bad = 0;
for (const r of res) {
  if (r.status === 'ok') continue; bad++;
  console.log(`${r.status.toUpperCase().padEnd(8)} ${r.tab}`);
  if (r.status === 'mismatch') { console.log('   expected:', r.expected.join(' | ')); console.log('   found   :', r.found.join(' | ')); }
}
console.log(bad ? `\n${bad} of ${res.length} worksheets need attention. Run "npm run init-sheet" to create missing ones.` : `All ${res.length} worksheets match the approved template.`);
process.exit(bad ? 1 : 0);
