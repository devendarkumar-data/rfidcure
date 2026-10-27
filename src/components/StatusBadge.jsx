const tone = (s) => {
  const v = String(s || '').toLowerCase();
  if (!v) return 'bg-slate-100 text-slate-600';
  if (/(reject|cancel|inactive|expired|negative|fail|mismatch|locked)/.test(v)) return 'bg-red-100 text-red-700';
  if (/(pending|submitted|draft|expiring|expiry soon|review|partial|returned|hold)/.test(v)) return 'bg-amber-100 text-amber-800';
  if (/(approved|active|authori[sz]ed|fulfilled|complete|closed|posted|matched|yes|received)/.test(v)) return 'bg-green-100 text-green-700';
  return 'bg-slate-100 text-slate-700';
};
export default function StatusBadge({ value }) {
  if (value === '' || value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone(value)}`}>{String(value)}</span>;
}
