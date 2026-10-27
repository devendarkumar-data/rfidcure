export default function FilterBar({ children, onReset }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      {children}
      {onReset && <button className="btn btn-sm" onClick={onReset}>Reset</button>}
    </div>
  );
}
export function FilterItem({ label, children, grow }) {
  return <label className={`block ${grow ? 'min-w-[12rem] flex-1' : 'min-w-[8rem]'}`}><span className="label">{label}</span>{children}</label>;
}
