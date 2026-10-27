import { useState } from 'react';
import Modal from './Modal.jsx';

export default function ConfirmDialog({ title = 'Please confirm', message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel} footer={(
      <>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy ? 'Working…' : confirmLabel}</button>
      </>
    )}>
      <p className="text-sm text-slate-700">{message}</p>
    </Modal>
  );
}
