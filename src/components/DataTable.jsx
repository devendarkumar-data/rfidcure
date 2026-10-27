import { useTick } from '../useTick.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, download } from '../api.js';
import Icon from './Icon.jsx';
import Pagination from './Pagination.jsx';
import Spinner from './Spinner.jsx';
import StatusBadge from './StatusBadge.jsx';
import { useToast } from './Toast.jsx';

const fmtNum = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export function renderCell(col, v, row) {
  if (col.render) return col.render(v, row);
  if (v === '' || v === null || v === undefined) return <span className="text-slate-300">—</span>;
  if (col.type === 'number') return <span className="tabular-nums">{fmtNum(v)}</span>;
  if (/status|flag/i.test(col.name)) return <StatusBadge value={v} />;
  const s = String(v);
  return s.length > 80 ? <span title={s}>{s.slice(0, 80)}…</span> : s;
}

// Server-side search / sort / pagination table.
export default function DataTable({ endpoint, columns, params, rowActions, exportable = false, exportName, searchPlaceholder = 'Search…', refreshKey = 0, pageSizeDefault = 25, rowKey, onRowClick, toolbar, emptyText = 'No records found', defaultSort, searchable = true }) {
  const toast = useToast();
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [sort, setSort] = useState(defaultSort?.col || ''); const [dir, setDir] = useState(defaultSort?.dir || 'asc');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(pageSizeDefault);
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  const seq = useRef(0); const pjson = JSON.stringify(params || {});

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [pjson, endpoint]);

  const load = useCallback(async () => {
    const my = ++seq.current; setBusy(true); setErr('');
    try {
      const r = await api.get(endpoint, { q: dq, sort, dir, page, pageSize, ...JSON.parse(pjson) });
      if (my === seq.current) setData(r);
    } catch (e) { if (my === seq.current) { setErr(e.message); setData(null); } } finally { if (my === seq.current) setBusy(false); }
  }, [endpoint, dq, sort, dir, page, pageSize, pjson]);
  const tick = useTick();
  useEffect(() => { load(); }, [load, refreshKey, tick]);

  const toggle = (c) => { if (c.sortable === false) return; if (sort === c.name) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(c.name); setDir('asc'); } setPage(1); };
  const doExport = async () => {
    try { await download(endpoint, { q: dq, sort, dir, ...JSON.parse(pjson), export: 'csv' }, `${exportName || 'export'}.csv`); } catch (e) { toast.error(e.message); }
  };
  const rows = data?.rows || [];

  return (
    <div className="card overflow-hidden">
      {(searchable || exportable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          {searchable && (
            <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
              <span className="pointer-events-none absolute left-2.5 top-2 text-slate-400"><Icon name="search" className="h-4 w-4" /></span>
              <input className="input !pl-8" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar}
            {exportable && <button className="btn" onClick={doExport}><Icon name="download" className="h-4 w-4" /> Export CSV</button>}
          </div>
        </div>
      )}
      <div className="relative overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.name} className={`th ${c.type === 'number' ? 'text-right' : ''} ${c.sortable === false ? '' : 'cursor-pointer select-none hover:text-slate-800'}`} onClick={() => toggle(c)} aria-sort={sort === c.name ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {c.label || c.name}{sort === c.name && <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
              {rowActions && <th className="th text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={rowKey ? rowKey(r) : r.__row ?? i} className={onRowClick ? 'cursor-pointer hover:bg-brand-50/50' : 'hover:bg-slate-50'} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.name} className={`td ${c.type === 'number' ? 'text-right' : ''}`}>{renderCell(c, r[c.name], r)}</td>)}
                {rowActions && <td className="td whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>{rowActions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {busy && !rows.length && <Spinner />}
        {busy && rows.length > 0 && <div className="absolute inset-0 bg-white/50" aria-hidden="true" />}
        {!busy && err && <div className="p-6 text-center text-sm text-red-600">{err} <button className="btn btn-sm ml-2" onClick={load}>Retry</button></div>}
        {!busy && !err && !rows.length && <div className="p-10 text-center text-sm text-slate-500">{emptyText}</div>}
      </div>
      {data && <Pagination page={data.page || 1} pages={data.pages || 1} total={data.total || 0} pageSize={data.pageSize || pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
    </div>
  );
}
