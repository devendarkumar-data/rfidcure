// One serverless entry point. api/handler.js simply calls this. Keeping one function avoids Vercel's per-plan function limit.
import { MODULE_NAMES, TABLES, TABLE_BY_SLUG, REFS } from '../shared/registry.js';
import { actionsFor, actionsForTab, ROLE_LABELS } from '../shared/permissions.js';
import * as accessMatrix from './access-matrix.js';
import { mayRaiseIntent } from './workflow.js';
import { fieldAccess, STAGE_LABELS } from '../shared/permissions.js';
import { config } from './config.js';
import { getStore } from './store/index.js';
import { HttpError, bad, forbidden, notFound, today } from './util.js';
import { assertCan } from './access.js';
import { authenticate, changePassword, clearCookie, login, logout, sessionCookie } from './auth.js';
import * as crud from './crud.js';
import * as imprest from './imprest.js';
import * as eway from './eway.js';
import * as poseries from './poseries.js';
import * as admin from './admin.js';
import * as reports from './reports.js';
import * as wf from './workflow.js';
import * as tableIo from './table-io.js';
import * as opening from './opening.js';
import * as reqs from './requisition.js';
import * as repdefs from './report-defs.js';
import { toXlsx, XLSX_TYPE } from './xlsx.js';
import { audit } from './audit.js';

const MAX_BODY = 4_000_000; // opening-stock import sends a base64 file (Vercel's own limit is 4.5 MB)

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  res.statusCode = status;
  res.setHeader('Content-Type', Buffer.isBuffer(body) ? XLSX_TYPE : isText ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(isText ? body : JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return req.body ? JSON.parse(req.body) : {}; } catch { throw bad('Invalid JSON'); } }
    return req.body;
  }
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Invalid JSON'); }
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (cols, rows) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');

function csrfCheck(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-requested-with'] !== 'cure-erp') throw forbidden('Missing request header');
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    let o; try { o = new URL(origin); } catch { throw forbidden('Bad origin'); }
    if (o.host !== host && !config().allowedOrigins.includes(origin)) throw forbidden('Cross-site request blocked');
  }
}

const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
const isSecure = (req) => config().prod || req.headers['x-forwarded-proto'] === 'https';

function fieldMeta(ctx, f) {
  const acc = fieldAccess(ctx.user.role, f.name);
  const ref = REFS[f.name];
  return { name: f.name, type: f.type, options: f.options, yesNo: f.yesNo || undefined, lookup: ref ? f.name : undefined, special: ref?.special, readonly: f.readonly || f.type === 'calc' || f.type === 'auto' || acc !== 'w', hidden: acc === 'n' };
}
function tableMeta(ctx, t) {
  const acts = actionsForTab(ctx.user.role, t.stage, t.tab);
  if (!acts.includes('view')) return null;
  const readOnly = ctx.user.scope.mode === 'all-readonly';
  let allowed = acts.filter((a) => a === 'view' || a === 'export' || !readOnly);
  if (t.kind === 'doc') allowed = allowed.filter((a) => !(a === 'edit' && t.post) && a !== 'delete');
  else if (t.kind === 'master') allowed = allowed.filter((a) => ['view', 'create', 'edit', 'delete', 'export'].includes(a));
  else if (t.kind === 'log') allowed = allowed.filter((a) => ['view', 'create', 'export'].includes(a));
  else if (t.kind === 'settings') allowed = allowed.filter((a) => ['view', 'edit'].includes(a));
  else allowed = allowed.filter((a) => ['view', 'export'].includes(a));
  if (t.slug === 'purchase-indent' && !mayRaiseIntent(ctx)) allowed = allowed.filter((a) => !['create', 'edit'].includes(a)); // only MWH raises indents
  return {
    slug: t.slug, title: t.tab, module: t.module, kind: t.kind, stage: t.stage, idCol: t.idCol, actions: allowed, posts: !!t.post,
    required: t.required, hasLines: t.hasLines && t.lineFields.length > 0, itemField: t.itemField, sort: t.sort,
    fields: t.fields.filter((f) => !(t.hide || []).includes(f.name)).map((f) => fieldMeta(ctx, f)).filter((f) => !f.hidden),
    lineFields: t.lineFields.filter((f) => !(t.hideLines || []).includes(f.name)).map((f) => fieldMeta(ctx, f)).filter((f) => !f.hidden),
  };
}
function buildMeta(ctx, mustChange) {
  const u = ctx.user;
  const mods = new Map();
  for (const t of TABLES) {
    if (t.slug === 'users') continue;
    const m = tableMeta(ctx, t); if (!m) continue;
    if (!mods.has(t.module)) mods.set(t.module, { code: t.module, name: MODULE_NAMES[t.module], tables: [] });
    mods.get(t.module).tables.push(m);
  }
  const has = (stage, a = 'view') => actionsFor(u.role, stage).includes(a);
  const stockFields = ['Item Code', 'Batch Number', 'Quantity'].every((f) => fieldAccess(u.role, f) !== 'n');
  return {
    user: { id: u.id, name: u.name, role: u.role, roleLabel: u.roleLabel, branch: u.branch, scope: u.scope, canSwitchWarehouse: u.scope.mode === 'all' || !!u.scope.viewing, mustChange: !!mustChange, readOnly: u.scope.mode === 'all-readonly' },
    modules: [...mods.values()].sort((a, b) => a.code.localeCompare(b.code)),
    features: { access: has('admin') && actionsForTab(u.role, 'admin', 'Access Control').includes('view'), dashboard: has('reports'), stock: has('reports') && stockFields, users: has('admin'), dataQuality: has('admin'), exportReports: has('reports', 'export'), reports: has('reports') },
    roles: Object.values(ROLE_LABELS), stageLabels: STAGE_LABELS,
  };
}

const parseQuery = (url) => Object.fromEntries(url.searchParams.entries());

export default async function handler(req, res) {
  const started = Date.now();
  try {
    const url = new URL(req.url, 'http://local');
    const q = parseQuery(url);
    // On Vercel every /api/* request is rewritten to one function with the original path in ?route=
    const viaRewrite = typeof q.route === 'string';
    const rawPath = viaRewrite ? `/api/${q.route}` : url.pathname;
    if (viaRewrite) delete q.route;
    const path = rawPath.replace(/^\/api\/?/, '').replace(/\/+$/, '');
    const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
    csrfCheck(req);
    const store = getStore();
    const secure = isSecure(req);

    if (path === 'health') return send(res, 200, { ok: true, store: store.kind, env: config().appEnv });

    // ---- sign-in (no session needed) ----
    if (path === 'auth/login' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await login(store, { userId: b.userId, password: b.password }, ipOf(req));
      await accessMatrix.loadAccessMatrix(store);
      const ctx = { store, user: r.user };
      return send(res, 200, buildMeta(ctx, r.mustChange), { 'Set-Cookie': sessionCookie(r.token, r.minutes, secure) });
    }

    // ---- everything below needs a valid session ----
    let auth;
    try { auth = await authenticate(req, store); } catch (e) {
      if (e.status === 401) return send(res, 401, { error: e.message }, { 'Set-Cookie': clearCookie(secure) });
      throw e;
    }
    await accessMatrix.loadAccessMatrix(store);
    const ctx = { store, user: auth.user };
    // Administrators (scope "all") may look at one warehouse at a time: the browser sends X-View-Warehouse and the user is
    // treated as assigned to just that warehouse for this request.
    const vw = String(req.headers['x-view-warehouse'] || '').trim().toUpperCase();
    if (vw && /^[A-Z0-9_-]{1,20}$/.test(vw) && auth.user.scope.mode === 'all') ctx.user = { ...auth.user, scope: { mode: 'assigned', warehouses: [vw], viewing: vw } };
    const outHeaders = auth.refreshed ? { 'Set-Cookie': sessionCookie(auth.refreshed.token, auth.refreshed.minutes, secure) } : {};
    const ok = (body, status = 200, extra = {}) => send(res, status, body, { ...outHeaders, ...extra });

    if (path === 'auth/logout' && req.method === 'POST') { await logout(store, ctx); return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(secure) }); }
    if (path === 'auth/me' && req.method === 'GET') return ok(buildMeta(ctx, auth.mustChange));
    if (path === 'auth/change-password' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await changePassword(store, ctx, { oldPassword: b.oldPassword, newPassword: b.newPassword });
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(r.token, r.minutes, secure) });
    }
    if (auth.mustChange) throw forbidden('You must change your password before continuing');

    if (path === 'meta' && req.method === 'GET') return ok(buildMeta(ctx, false));

    // ---- generic tables ----
    if (seg[0] === 't' && seg[1]) {
      if (seg[1] === 'users') throw notFound('Unknown table');
      const table = crud.tableOr404(seg[1]);
      const sub = seg[2];
      if (!sub) {
        if (req.method === 'GET') {
          if (table.kind === 'settings') return ok(await crud.getSettingsRecord(ctx, table));
          const r = await crud.listRecords(ctx, table, q);
          if (q.export) {
            await audit(store, { user: ctx.user, module: table.tab, action: 'Export', remarks: `${r.total} rows` });
            const names = r.columns.map((c) => c.name);
            if (q.export === 'xlsx') return send(res, 200, await toXlsx(table.tab, names, r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="${table.slug}.xlsx"` });
            return send(res, 200, toCsv(names, r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="${table.slug}.csv"` });
          }
          return ok(r);
        }
        if (req.method === 'POST') { const b = await readBody(req); return ok(await crud.createRecord(ctx, table, b, req.headers['idempotency-key'], table.workflow === 'grn' ? wf.grnHooks(ctx) : {}), 201); }
        if (req.method === 'PUT' && table.kind === 'settings') return ok(await crud.saveSettingsRecord(ctx, table, await readBody(req)));
      }
      if (sub === 'import' && req.method === 'POST') return ok(await tableIo.importTable(ctx, table, await readBody(req)));
      if (sub === 'template' && req.method === 'GET') {
        if (table.kind !== 'master') throw new HttpError(405, 'No import template for this table');
        const cols = tableIo.importColumns(table);
        if (q.format === 'xlsx') return send(res, 200, await toXlsx(table.tab, cols, []), { ...outHeaders, 'Content-Disposition': `attachment; filename="${table.slug}-template.xlsx"` });
        return send(res, 200, toCsv(cols, []), { ...outHeaders, 'Content-Disposition': `attachment; filename="${table.slug}-template.csv"` });
      }
      if (sub === 'record') {
        if (!q.id) throw bad('id is required');
        if (req.method === 'GET') return ok(await crud.getRecord(ctx, table, q.id));
        if (req.method === 'PUT') return ok(await crud.updateRecord(ctx, table, q.id, await readBody(req)));
        if (req.method === 'DELETE') return ok(await crud.deleteRecord(ctx, table, q.id));
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (seg[0] === 'wf') {
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null; const idem = req.headers['idempotency-key'];
      const csv = async (r, name) => { await audit(store, { user: ctx.user, module: name, action: 'Export', remarks: `${r.total} rows` }); return send(res, 200, toCsv(Object.keys(r.rows[0] || { 'Document No.': 1 }).filter((k) => k !== 'actions'), r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="${name}.csv"` }); };
      const r2 = seg.slice(1).join('/');
      if (r2 === 'intents' && req.method === 'GET') { const r = await wf.listIntents(ctx, q); return q.export ? csv(r, 'purchase-intents') : ok(r); }
      if (r2 === 'intents/get' && req.method === 'GET') return ok(await wf.getIntent(ctx, q.id));
      if (r2 === 'intents/open' && req.method === 'GET') return ok(await wf.openIntents(ctx, q));
      if (r2 === 'intents' && req.method === 'POST') return ok(await wf.saveIntent(ctx, body, null, idem), 201);
      if (r2 === 'intents' && req.method === 'PUT') return ok(await wf.saveIntent(ctx, body, q.id));
      if (r2 === 'intents/action' && req.method === 'POST') return ok(await wf.intentAction(ctx, q.id, body));
      if (r2 === 'pos' && req.method === 'GET') { const r = await wf.listPos(ctx, q); return q.export ? csv(r, 'purchase-orders') : ok(r); }
      if (r2 === 'pos/get' && req.method === 'GET') return ok(await wf.getPo(ctx, q.id));
      if (r2 === 'pos/defaults' && req.method === 'GET') return ok(await wf.poDefaults(ctx));
      if (r2 === 'pos/item-info' && req.method === 'GET') return ok(await wf.poItemInfo(ctx, q));
      if (r2 === 'pos/vendor' && req.method === 'GET') { assertCan(ctx, TABLE_BY_SLUG['purchase-order-domestic'], 'view'); return ok(await poseries.preview(ctx, q.vendor, q.type === 'import' ? 'import' : 'domestic', q.date || today())); }
      if (r2 === 'pos/open' && req.method === 'GET') return ok(await wf.openPos(ctx, q));
      if (r2 === 'pos' && req.method === 'POST') return ok(await wf.savePo(ctx, body, null, idem), 201);
      if (r2 === 'pos' && req.method === 'PUT') return ok(await wf.savePo(ctx, body, q.id));
      if (r2 === 'pos/action' && req.method === 'POST') return ok(await wf.poAction(ctx, q.id, body));
      if (r2 === 'reqs' && req.method === 'GET') { const r = await reqs.listReqs(ctx, q); return q.export ? csv(r, 'purchase-requisitions') : ok(r); }
      if (r2 === 'reqs/get' && req.method === 'GET') return ok(await reqs.getReq(ctx, q.id));
      if (r2 === 'reqs' && req.method === 'POST') return ok(await reqs.saveReq(ctx, body, null, idem), 201);
      if (r2 === 'reqs' && req.method === 'PUT') return ok(await reqs.saveReq(ctx, body, q.id));
      if (r2 === 'reqs/action' && req.method === 'POST') return ok(await reqs.reqAction(ctx, q.id, body));
      throw notFound('Unknown endpoint');
    }

    if (seg[0] === 'reports') {
      if (seg.length === 1 && req.method === 'GET') return ok({ reports: repdefs.catalog(ctx) });
      if (seg.length === 2 && req.method === 'GET') {
        const r = await repdefs.runReport(ctx, seg[1], q);
        if (!q.export) return ok(r);
        await audit(store, { user: ctx.user, module: `Report: ${r.title}`, action: 'Export', remarks: `${r.total} rows (${q.export})` });
        const file = `${seg[1]}-${new Date().toISOString().slice(0, 10)}`;
        if (q.export === 'xlsx') return send(res, 200, await toXlsx(r.title, r.columns, r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="${file}.xlsx"` });
        return send(res, 200, toCsv(r.columns, r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="${file}.csv"` });
      }
      throw notFound('Unknown endpoint');
    }
    if (path === 'lookup' && req.method === 'GET') return ok(await crud.lookup(ctx, q.field, q.q, 30, q.scopeOnly === '1', { warehouse: q.warehouse, all: q.all, imprest: q.imprest }));
    if (path === 'imprest/consumption' && req.method === 'GET') return ok(await imprest.consumptionList(ctx, q.status));
    if (path === 'imprest/bill' && req.method === 'POST') return ok(await imprest.updateBill(ctx, await readBody(req)));
    if (path === 'imprest/register' && req.method === 'GET') return ok(await imprest.register(ctx, q.type === 'in' ? 'in' : 'out'));
    if (path === 'eway/pending' && req.method === 'GET') return ok(await eway.pending(ctx));
    if (path === 'imprest/pending' && req.method === 'GET') return ok(await imprest.pending(ctx));
    if (path === 'imprest/trail' && req.method === 'GET') return ok(await imprest.trail(ctx, q.ref));
    if (path === 'imprest/return' && req.method === 'POST') return ok(await imprest.receive(ctx, await readBody(req), req.headers['idempotency-key']), 201);
    if (path === 'imprest/consume' && req.method === 'POST') return ok(await imprest.consume(ctx, await readBody(req), req.headers['idempotency-key']), 201);
    if (path === 'imprest/consumption-queue' && req.method === 'GET') return ok(await imprest.consumptionQueue(ctx));
    if (path === 'lookup/customer' && req.method === 'GET') return ok(await crud.customerDetails(ctx, q.name));
    if (path === 'stock/balances' && req.method === 'GET') {
      const r = await reports.stockBalances(ctx, q);
      if (q.export) { await audit(store, { user: ctx.user, module: 'Stock', action: 'Export', remarks: `${r.total} rows` }); const cols = Object.keys(r.rows[0] || { Warehouse: 1 }); return send(res, 200, toCsv(cols, r.rows), { ...outHeaders, 'Content-Disposition': 'attachment; filename="stock.csv"' }); }
      return ok(r);
    }
    if (path === 'stock/opening' && req.method === 'GET') {
      const r = await opening.listOpening(ctx, q);
      if (q.export) {
        await audit(store, { user: ctx.user, module: 'Opening Stock', action: 'Export', remarks: `${r.total} rows` });
        const cols = ['Warehouse', 'Item Code', 'Item Name', 'Item Category Type Name', 'Brand Name', 'Batch Number', 'Expiry Date', 'Expiry Status', 'Opening Qty', 'Movement Since Opening', 'Qty As On Date', 'Stock Value'];
        if (q.export === 'xlsx') return send(res, 200, await toXlsx('Opening Stock', cols, r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="opening-stock-${r.asOn}.xlsx"` });
        return send(res, 200, toCsv(cols, r.rows), { ...outHeaders, 'Content-Disposition': `attachment; filename="opening-stock-${r.asOn}.csv"` });
      }
      return ok(r);
    }
    if (path === 'stock/opening/import' && req.method === 'POST') return ok(await opening.importOpening(ctx, await readBody(req)));
    if (path === 'stock/opening/row' && req.method === 'POST') return ok(await opening.addOpeningRow(ctx, await readBody(req)), 201);
    if (path === 'stock/opening/row' && req.method === 'PUT') return ok(await opening.editOpeningRow(ctx, await readBody(req)));
    if (path === 'stock/opening/template' && req.method === 'GET' && q.format === 'xlsx') return send(res, 200, await toXlsx('Opening Stock', opening.OPENING_HEADERS, []), { ...outHeaders, 'Content-Disposition': 'attachment; filename="opening-stock-template.xlsx"' });
    if (path === 'stock/opening/template' && req.method === 'GET') return send(res, 200, toCsv(opening.OPENING_HEADERS, []), { ...outHeaders, 'Content-Disposition': 'attachment; filename="opening-stock-template.csv"' });
    if (path === 'stock/levels' && req.method === 'GET') return ok(await reports.stockLevels(ctx, q));
    if (path === 'stock/summary' && req.method === 'GET') return ok(await reports.stockSummary(ctx, q));
    if (path === 'stock/batches' && req.method === 'GET') return ok(await reports.stockBatches(ctx, q));
    if (path === 'dashboard' && req.method === 'GET') return ok(await reports.dashboard(ctx, q));
    if (path === 'data-quality' && req.method === 'GET') return ok(await reports.dataQuality(ctx));

    if (seg[0] === 'admin' && seg[1] === 'access') {
      if (req.method === 'GET') return ok(await accessMatrix.accessView(ctx));
      if (req.method === 'PUT') return ok(await accessMatrix.setAccess(ctx, await readBody(req)));
    }
    if (seg[0] === 'admin' && seg[1] === 'users') {
      if (!seg[2] && req.method === 'GET') return ok(await admin.listUsers(ctx));
      if (!seg[2] && req.method === 'POST') return ok(await admin.createUser(ctx, await readBody(req)), 201);
      if (!seg[2] && req.method === 'PUT') return ok(await admin.updateUser(ctx, q.id, await readBody(req)));
      if (seg[2] === 'reset' && req.method === 'POST') return ok(await admin.resetPassword(ctx, q.id));
    }
    throw notFound('Unknown endpoint');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, details: e.details });
    console.error('[api] unhandled', req.method, req.url, e?.message); // message only: never log request bodies or credentials
    return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  } finally {
    if (process.env.LOG_REQUESTS === '1') console.log(req.method, req.url.split('?')[0], res.statusCode, Date.now() - started + 'ms');
  }
}
