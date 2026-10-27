import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, SPECS, parseDsl, slugify, REFS, TABLE_BY_SLUG } from '../shared/registry.js';
import TEMPLATE from '../shared/template-tabs.js';

test('67 template worksheets + added tabs, unique slugs', () => {
  assert.equal(TABLES.length, 68); // 67 from the template + Purchase Requisition
  assert.equal(new Set(TABLES.map((t) => t.slug)).size, 68);
});
test('every spec refers to a real template tab and every form field is a real column', () => {
  for (const s of SPECS) {
    const t = TABLES.find((x) => x.tab === s.tab);
    assert.ok(t, `spec for unknown tab ${s.tab}`);
    for (const f of parseDsl(s.form)) assert.ok(t.headers.includes(f.name), `${s.tab}: form field "${f.name}" is not a column`);
    for (const r of s.required || []) assert.ok(t.headers.includes(r), `${s.tab}: required "${r}" is not a column`);
    for (const w of s.wh || []) assert.ok(t.headers.includes(w), `${s.tab}: warehouse col "${w}" missing`);
  }
});
test('headers are exactly the template headers (no schema change)', () => {
  for (const t of TEMPLATE) assert.deepEqual(TABLES.find((x) => x.tab === t.tab).headers, t.headers);
});
test('every ref points at a registered master column', () => {
  for (const [k, r] of Object.entries(REFS)) if (r.master) { const t = TABLE_BY_SLUG[r.master]; assert.ok(t, `${k}: master ${r.master}`); assert.ok(t.headers.includes(r.col), `${k}: column ${r.col}`); }
});
test('slugify handles dashes and double spaces', () => {
  assert.equal(slugify('Purchase Order — Domestic'), 'purchase-order-domestic');
  assert.equal(slugify('GRN  MRN'), 'grn-mrn');
});
