import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth } from '../auth.jsx';
import Card from '../components/Card.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import DataTable from '../components/DataTable.jsx';
import FilterBar, { FilterItem } from '../components/FilterBar.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Spinner from '../components/Spinner.jsx';
import { useToast } from '../components/Toast.jsx';
import NotFound from './NotFound.jsx';
import RecordForm from './RecordForm.jsx';
import TableImportDialog from '../components/TableImportDialog.jsx';

const clean = (s) => s.replace(/\s{2,}/g, ' ');

function SettingsForm({ table }) {
  const toast = useToast(); const canEdit = table.actions.includes('edit');
  const [vals, setVals] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api.get(`/api/t/${table.slug}`).then((r) => setVals(r.values)).catch((e) => setErr(e.message)); }, [table.slug]);
  if (err) return <Card><p className="text-sm text-red-600">{err}</p></Card>;
  if (!vals) return <Spinner />;
  return (
    <Card>
      <RecordForm key={table.slug} table={{ ...table, required: [], hasLines: false }} mode={canEdit ? 'edit' : 'view'} initial={{ header: vals }} submitLabel="Save settings"
        onSubmit={async (p) => { const r = await api.put(`/api/t/${table.slug}`, { values: p.header }); toast.success('Settings saved'); setVals((v) => ({ ...v, ...r.values })); return r; }} />
    </Card>
  );
}

export default function TablePage() {
  const { slug } = useParams();
  const { tables } = useAuth();
  const table = tables[slug];
  const toast = useToast();
  const [dlg, setDlg] = useState(null); // {type:'create'|'edit'|'view'|'delete', row, data}
  const [refresh, setRefresh] = useState(0);
  const [range, setRange] = useState({ from: '', to: '' });
  useEffect(() => { setDlg(null); setRange({ from: '', to: '' }); }, [slug]);

  const columns = useMemo(() => {
    if (!table) return [];
    const cols = table.fields.filter((f) => f.type !== 'textarea').slice(0, /imprest/i.test(table.slug) ? 60 : 9).map((f) => ({ name: f.name, type: f.type === 'number' ? 'number' : 'text' }));
    if (table.hasLines) cols.push({ name: '__lines', label: 'Lines', type: 'number', sortable: false });
    return cols;
  }, [table]);

  const openRecord = useCallback(async (row, type) => {
    try { const r = await api.get(`/api/t/${slug}/record`, { id: row[table.idCol] }); setDlg({ type, row, data: r }); } catch (e) { toast.error(e.message); }
  }, [slug, table, toast]);

  if (!table) return <NotFound />;
  const acts = table.actions; const hasDate = table.fields.some((f) => f.name === 'Date' || f.name === 'Created_Date');
  const canCreate = acts.includes('create') && ['doc', 'master', 'log'].includes(table.kind);
  const readonlyKinds = ['list', 'audit', 'stockdata'];

  if (table.kind === 'settings') return (<><PageHeader title={clean(table.title)} subtitle="System settings" /><SettingsForm table={table} /></>);

  const create = async (payload, key) => {
    const body = table.kind === 'master' ? payload.header : payload;
    const r = await api.post(`/api/t/${slug}`, body, { headers: { 'Idempotency-Key': key } });
    toast.success(r.duplicate ? 'Already saved — duplicate submission ignored' : `${table.kind === 'master' ? 'Record' : table.title} saved${r.id ? `: ${r.id}` : ''}`);
    setDlg(null); setRefresh((n) => n + 1); return r;
  };
  const update = async (payload) => {
    const r = await api.put(`/api/t/${slug}/record?id=${encodeURIComponent(dlg.row[table.idCol])}`, table.kind === 'master' ? payload.header : payload);
    toast.success('Changes saved'); setDlg(null); setRefresh((n) => n + 1); return r;
  };
  const del = async () => {
    try { await api.del(`/api/t/${slug}/record?id=${encodeURIComponent(dlg.row[table.idCol])}`); toast.success('Record deleted'); setDlg(null); setRefresh((n) => n + 1); } catch (e) { toast.error(e.message); setDlg(null); }
  };

  const rowActions = table.idCol ? (r) => (
    <div className="flex justify-end gap-1">
      <button className="btn btn-sm" onClick={() => openRecord(r, 'view')}>View</button>
      {acts.includes('edit') && ['doc', 'master'].includes(table.kind) && !table.posts && <button className="btn btn-sm" onClick={() => openRecord(r, 'edit')}>Edit</button>}
      {table.posts && canCreate && <button className="btn btn-sm" title="Open a new entry pre-filled from this document (posted documents are corrected by a new entry)" onClick={() => openRecord(r, 'copy')}>Enter similar</button>}
      {acts.includes('delete') && table.kind === 'master' && <button className="btn btn-sm text-red-700" onClick={() => setDlg({ type: 'delete', row: r })}>Delete</button>}
    </div>
  ) : undefined;

  return (
    <>
      <PageHeader title={clean(table.title)} subtitle={table.posts ? 'Saving a document here posts to the stock ledger.' : readonlyKinds.includes(table.kind) ? 'Read-only register' : undefined}
        actions={<>
          {table.kind === 'master' && acts.includes('export') && <button className="btn" onClick={() => download(`/api/t/${slug}`, { export: 'xlsx' }, `${slug}.xlsx`).catch((e) => toast.error(e.message))}><Icon name="download" className="h-4 w-4" /> Export Excel</button>}
          {table.kind === 'master' && acts.includes('export') && <button className="btn" onClick={() => download(`/api/t/${slug}`, { export: 'csv' }, `${slug}.csv`).catch((e) => toast.error(e.message))}><Icon name="download" className="h-4 w-4" /> Export CSV</button>}
          {table.kind === 'master' && canCreate && <button className="btn" onClick={() => setDlg({ type: 'import' })}>Import</button>}
          {canCreate && <button className="btn btn-primary" onClick={() => setDlg({ type: 'create' })}><Icon name="plus" className="h-4 w-4" /> New</button>}
        </>} />
      {hasDate && (
        <FilterBar onReset={() => setRange({ from: '', to: '' })}>
          <FilterItem label="From"><input type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></FilterItem>
          <FilterItem label="To"><input type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></FilterItem>
        </FilterBar>
      )}
      <DataTable endpoint={`/api/t/${slug}`} columns={columns} params={range} rowActions={rowActions} exportable={acts.includes('export')} exportName={table.slug}
        refreshKey={refresh} rowKey={(r) => r[table.idCol] ?? r.__row ?? JSON.stringify(r)} onRowClick={table.idCol ? (r) => openRecord(r, 'view') : undefined} />

      {dlg?.type === 'import' && <TableImportDialog slug={slug} title={clean(table.title)} columns={table.fields.filter((f) => !f.readonly && f.type !== 'auto' && f.type !== 'calc' && f.name !== table.idCol).map((f) => f.name)} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setRefresh((n) => n + 1); }} />}
      {dlg?.type === 'create' && <Modal title={`New — ${clean(table.title)}`} wide={table.hasLines} onClose={() => setDlg(null)}><RecordForm table={table} mode="create" onSubmit={create} onCancel={() => setDlg(null)} /></Modal>}
      {dlg?.type === 'copy' && <Modal title={`New entry from ${dlg.row[table.idCol]}`} wide={table.hasLines} onClose={() => setDlg(null)}><RecordForm table={table} mode="create" initial={{ header: Object.fromEntries(Object.entries(dlg.data.record).filter(([k]) => k !== table.idCol && k !== 'Date' && !table.fields.some((f) => f.name === k && (f.type === 'auto' || f.readonly)))), lines: (dlg.data.lines || []).map(({ _k, ...l }) => l) }} onSubmit={create} onCancel={() => setDlg(null)} /></Modal>}
      {dlg?.type === 'edit' && <Modal title={`Edit — ${dlg.row[table.idCol]}`} wide={table.hasLines} onClose={() => setDlg(null)}><RecordForm table={table} mode="edit" initial={{ header: dlg.data.record, lines: dlg.data.lines }} onSubmit={update} onCancel={() => setDlg(null)} /></Modal>}
      {dlg?.type === 'view' && (
        <Modal title={dlg.row[table.idCol]} wide={table.hasLines} onClose={() => setDlg(null)} footer={dlg.data.editable && acts.includes('edit') ? <button className="btn btn-primary" onClick={() => setDlg({ ...dlg, type: 'edit' })}>Edit</button> : null}>
          <RecordForm table={table} mode="view" initial={{ header: dlg.data.record, lines: dlg.data.lines }} />
        </Modal>
      )}
      {dlg?.type === 'delete' && <ConfirmDialog danger title="Delete record" confirmLabel="Delete" message={`Delete ${dlg.row[table.idCol]}? This cannot be undone.`} onConfirm={del} onCancel={() => setDlg(null)} />}
    </>
  );
}
