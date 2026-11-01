import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, idemKey } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import Card from '../../components/Card.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import { useToast } from '../../components/Toast.jsx';
import RecordForm from '../RecordForm.jsx';
import { Back } from './index.jsx';

const DEFAULT_WH = 'MWH'; // Mother Warehouse

// Manual GRN / MRN: the whole form is open, items are added by hand, and each line has a "PO No" column to link it to a Purchase Order.
export default function GrnManual() {
  const nav = useNavigate(); const toast = useToast(); const { tables } = useAuth(); const table = tables['grn-mrn']; const [sp] = useSearchParams();
  const type = sp.get('type') === 'MRN' ? 'MRN' : 'GRN';
  const [wh, setWh] = useState(null);
  useEffect(() => { // MWH when the user may use it, otherwise their only warehouse
    api.get('/api/lookup', { field: 'Warehouse', scopeOnly: '1' }).then((r) => {
      const o = (r.options || []).map((x) => x.value);
      setWh(o.find((v) => v.toUpperCase() === DEFAULT_WH) || (o.length === 1 ? o[0] : ''));
    }).catch(() => setWh(''));
  }, []);
  if (!table || wh === null) return <Spinner />;
  const create = async (payload, key) => {
    const r = await api.post('/api/t/grn-mrn', { ...payload, header: { 'Update Stock': 'Yes', ...payload.header, 'Receipt Type': type } }, { headers: { 'Idempotency-Key': key || idemKey() } });
    toast.success(r.duplicate ? 'Already saved — duplicate ignored' : `${type} ${r.id} posted; stock updated`);
    nav(`/grn/${encodeURIComponent(r.id)}`);
  };
  return (
    <>
      <PageHeader back={<Back to="/grn/new">Create GRN</Back>} title={`Manual ${type}`} subtitle="Add the items yourself. In the PO No column pick the Purchase Order a line belongs to (leave blank for goods with no PO); linked lines reduce that PO's balance." />
      <Card><RecordForm table={table} mode="create" initial={{ header: { 'Update Stock': 'Yes', 'Receipt Type': type, ...(wh ? { Warehouse: wh } : {}) } }} onSubmit={create} onCancel={() => nav('/grn/new')} submitLabel="Save & post" /></Card>
    </>
  );
}
