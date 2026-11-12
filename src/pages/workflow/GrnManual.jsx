import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, idemKey } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import Card from '../../components/Card.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Spinner from '../../components/Spinner.jsx';
import { useToast } from '../../components/Toast.jsx';
import { COMPANY } from '../../../shared/company.js';
import RecordForm from '../RecordForm.jsx';
import { Back } from './index.jsx';

const DEFAULT_WH = 'MWH'; // Mother Warehouse

// Special GRN: the whole form is open, items are added by hand, not linked to any Purchase Order, no invoice number / date, no accounting terms.
export default function GrnManual() {
  const nav = useNavigate(); const toast = useToast(); const { tables } = useAuth(); const table = tables['grn-mrn'];
  const [wh, setWh] = useState(null);
  useEffect(() => { // MWH when the user may use it, otherwise their only warehouse
    api.get('/api/lookup', { field: 'Warehouse', scopeOnly: '1' }).then((r) => {
      const o = (r.options || []).map((x) => x.value);
      setWh(o.find((v) => v.toUpperCase() === DEFAULT_WH) || (o.length === 1 ? o[0] : ''));
    }).catch(() => setWh(''));
  }, []);
  if (!table || wh === null) return <Spinner />;
  // Special GRN carries no accounting terms: rates, taxes, discounts, invoice value and the GST block are left to the PO-based GRN
  const NO_HEAD = new Set(['Invoice Value', 'Invoice Date', 'Is IGST', 'Terms of Delivery', 'Type Of Purchase', 'Supplier Ref No', 'Invoice No.', 'Raise Receipt']);
  const NO_LINE = new Set(['PO No', 'PO Line', 'Ordered Qty', 'Received Qty', 'Short Close', 'Excess Decision', 'Rate', 'Gross', 'Other Discount', 'Taxable Value', 'CGST', 'IGST', 'Price Book Rate', 'Special Rate', 'MRP', 'Price Type', 'Division', 'Item Group']);
  const special = { ...table, noAccounts: true, fields: table.fields.filter((f) => !NO_HEAD.has(f.name)), lineFields: table.lineFields.filter((f) => !NO_LINE.has(f.name)) };
  const create = async (payload, key) => {
    const r = await api.post('/api/t/grn-mrn', { ...payload, header: { 'Update Stock': 'Yes', ...payload.header, 'Receipt Type': 'Special GRN' } }, { headers: { 'Idempotency-Key': key || idemKey() } });
    toast.success(r.duplicate ? 'Already saved — duplicate ignored' : `Special GRN ${r.id} posted; stock updated`);
    nav(`/grn/${encodeURIComponent(r.id)}`);
  };
  return (
    <>
      <PageHeader back={<Back to="/grn/special">Special GRN Register</Back>} title="Special GRN" subtitle="Receive goods that need not follow a whole PO: add the items yourself. Special GRN is not linked to a Purchase Order and carries no invoice number, date or accounting terms." />
      <Card><RecordForm table={special} mode="create" initial={{ header: { 'Update Stock': 'Yes', Location: COMPANY.state, ...(wh ? { Warehouse: wh } : {}) } }} onSubmit={create} onCancel={() => nav('/grn/special')} submitLabel="Save & post" /></Card>
    </>
  );
}
