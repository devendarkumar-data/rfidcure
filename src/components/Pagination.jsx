export default function Pagination({ page, pages, total, pageSize, onPage, onPageSize }) {
  const from = total ? (page - 1) * pageSize + 1 : 0, to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
      <span>{total ? `${from}–${to} of ${total.toLocaleString()}` : 'No records'}</span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select className="input !w-auto !py-1" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span className="tabular-nums">{page} / {pages || 1}</span>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
