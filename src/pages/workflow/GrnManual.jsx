import { useNavigate } from 'react-router-dom';
import { api, idemKey } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import Card from '../../components/Card.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toast.jsx';
import RecordForm from '../RecordForm.jsx';
import { Back } from './index.jsx';

// Manual GRN / MRN: the whole form is open, items are added by hand, and each line has a "PO No" column to link it to a Purchase Order.
export default function GrnManual() {
  const nav = useNavigate(); const toast = useToast(); const { tables } = useAuth(); const table = tables['grn-mrn'];
  if (!table) return null;
  const create = async (payload, key) => {
    const r = await api.post('/api/t/grn-mrn', { ...payload, header: { 'Update Stock': 'Yes', ...payload.header } }, { headers: { 'Idempotency-Key': key || idemKey() } });
    toast.success(r.duplicate ? 'Already saved — duplicate ignored' : `GRN ${r.id} posted; stock updated`);
    nav(`/grn/${encodeURIComponent(r.id)}`);
  };
  return (
    <>
      <PageHeader back={<Back to="/grn/new">Create GRN</Back>} title="Create GRN / MRN — manual" subtitle="Add the items yourself. In the PO No column pick the Purchase Order a line belongs to (leave blank for goods with no PO); linked lines reduce that PO's balance." />
      <Card><RecordForm table={table} mode="create" onSubmit={create} onCancel={() => nav('/grn/new')} submitLabel="Save & post" /></Card>
    </>
  );
}
