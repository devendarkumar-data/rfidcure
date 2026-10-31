import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useAuth } from '../auth.jsx';

const daysCell = (v) => {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  return <span className="inline-flex items-center gap-1.5 tabular-nums">{v}{v < 0 ? <StatusBadge value="Expired" /> : v <= 90 ? <StatusBadge value="Expiring" /> : null}</span>;
};

// Stock Master: one row per warehouse / item / batch with the opening quantity and the live quantity side by side.
export default function StockMaster() {
  const { tables } = useAuth(); const [warehouse, setWarehouse] = useState(''); const [whs, setWhs] = useState([]);
  useEffect(() => { api.get('/api/lookup', { field: 'Warehouse' }).then((r) => setWhs((r.options || []).filter((o) => o.inScope !== false))).catch(() => {}); }, []);
  const columns = [
    { name: 'Warehouse' }, { name: 'Item Code' }, { name: 'Item Name' }, { name: 'Brand', sortable: false }, { name: 'Category', sortable: false }, { name: 'Batch Number' }, { name: 'Expiry Date' },
    { name: 'Days To Expiry', render: daysCell, type: 'number' }, { name: 'Opening Qty', type: 'number', sortable: false }, { name: 'Quantity', label: 'Live Qty', type: 'number' }, { name: 'Rate', type: 'number', sortable: false }, { name: 'Stock Value', type: 'number' }, { name: 'Flag', sortable: false },
  ];
  return (
    <>
      <PageHeader title="Stock Master" subtitle="Opening stock and live stock by warehouse, item and batch. Hospital (imprest) locations are not listed." actions={tables['opening-stock'] ? <Link className="btn" to="/inventory/opening-stock">Opening stock import / edit</Link> : null} />
      <FilterBar onReset={() => setWarehouse('')}>
        <FilterItem label="Warehouse"><select className="input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}><option value="">All permitted</option>{whs.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</select></FilterItem>
      </FilterBar>
      <DataTable endpoint="/api/stock/balances" columns={columns} params={{ warehouse, master: 1 }} exportable exportName="stock-master" searchPlaceholder="Search item, batch or brand…" rowKey={(r) => `${r.Warehouse}|${r['Item Code']}|${r['Batch Number']}`} emptyText="No stock found" />
    </>
  );
}
