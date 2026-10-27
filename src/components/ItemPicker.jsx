import Combobox from './Combobox.jsx';

// Searchable item lookup against the central item catalogue. Calls onChange({code,name}).
export default function ItemPicker({ value, onChange, disabled, placeholder }) {
  return (
    <Combobox field="Items" value={value} disabled={disabled} allowFree={false} placeholder={placeholder || 'Search item code or name…'}
      onChange={() => {}} onPick={(o) => onChange({ code: o.value, name: o.name })} />
  );
}
