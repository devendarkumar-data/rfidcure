export default function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-10 text-sm text-slate-500 ${className}`} role="status">
      <svg className="h-5 w-5 animate-spin text-brand-700" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="4" /><path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>
      {label}
    </div>
  );
}
