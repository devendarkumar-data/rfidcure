import Combobox from './Combobox.jsx';

const baseId = (n) => `f-${String(n).replace(/[^a-z0-9]+/gi, '-')}`;

// Renders one form control from the field meta sent by /api/meta.
export default function Field({ field, value, onChange, required, disabled, error, extraParams }) {
  const id = baseId(field.name);
  const ro = disabled || field.readonly;
  const v = value ?? '';
  let control;
  if (field.type === 'auto' || field.type === 'calc') {
    control = <input id={id} className="input" value={v} disabled placeholder={field.type === 'auto' ? 'Generated on save' : 'Calculated'} />;
  } else if (field.options || field.type === 'bool' || field.yesNo) {
    const opts = field.options || ['Yes', 'No'];
    control = (
      <select id={id} className="input" value={v} disabled={ro} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.lookup) {
    control = <Combobox id={id} field={field.lookup} value={v} disabled={ro} onChange={(val) => onChange(val)} extraParams={extraParams} allowFree />;
  } else if (field.type === 'textarea') {
    control = <textarea id={id} className="input min-h-[4.5rem]" value={v} disabled={ro} maxLength={5000} onChange={(e) => onChange(e.target.value)} />;
  } else if (field.type === 'number') {
    control = <input id={id} className="input" type="number" inputMode="decimal" min="0" step="any" value={v} disabled={ro} onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)} />;
  } else if (field.type === 'date') {
    control = <input id={id} className="input" type="date" value={v} disabled={ro} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = <input id={id} className="input" type="text" value={v} disabled={ro} maxLength={500} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="label">{field.name}{required && <span className="text-red-600"> *</span>}</label>
      {control}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
