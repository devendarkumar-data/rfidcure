import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const daysCell = (v) => {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  return <span className="inline-flex items-center gap-1.5 tabular-nums">{v}{v < 0 ? <StatusBadge value="Expired" /> : v <= 90 ? <StatusBadge value="Expiring" /> : null}</span>;
};

export default function StockBatches() {
  const [sp, setSp] = useSearchParams();
  const flag = sp.get('flag') || ''; const [warehouse, setWarehouse] = useState(sp.get('warehouse') || '');
  const [whs, setWhs] = useState([]);
  useEffect(() => { api.get('/api/lookup', { field: 'Warehouse' }).then((r) => setWhs((r.options || []).filter((o) => o.inScope !== false))).catch(() => {}); }, []);
  const setFlag = (v) => { const n = new URLSearchParams(sp); if (v) n.set('flag', v); else n.delete('flag'); setSp(n, { replace: true }); };
  const columns = [
    { name: 'Warehouse' }, { name: 'Item Code' }, { name: 'Item Name' }, { name: 'Batch Number' }, { name: 'Expiry Date' },
    { name: 'Days To Expiry', render: daysCell, type: 'number' }, { name: 'Quantity', type: 'number' }, { name: 'Rate', type: 'number', sortable: false }, { name: 'Stock Value', type: 'number' },
    { name: 'Flag', sortable: false },
  ];
  return (
    <>
      <PageHeader title="Batch-wise Stock" subtitle="Every warehouse / item / batch with its current balance, expiry and value." />
      <FilterBar onReset={() => { setFlag(''); setWarehouse(''); }}>
        <FilterItem label="Warehouse"><select className="input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}><option value="">All permitted</option>{whs.map((w) => <option key={w.value}>{w.value}</option>)}</select></FilterItem>
        <FilterItem label="Flag"><select className="input" value={flag} onChange={(e) => setFlag(e.target.value)}><option value="">All</option><option>Expired</option><option>Expiring</option><option>Negative</option></select></FilterItem>
      </FilterBar>
      <DataTable endpoint="/api/stock/balances" columns={columns} params={{ warehouse, flag }} exportable exportName="batch-stock" searchPlaceholder="Search item, batch or brand…" rowKey={(r) => `${r.Warehouse}|${r['Item Code']}|${r['Batch Number']}`} emptyText="No stock matches the filters" />
    </>
  );
}
