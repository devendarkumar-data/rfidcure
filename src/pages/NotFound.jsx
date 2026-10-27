import { Link } from 'react-router-dom';
export default function NotFound() {
  return (<div className="card mx-auto mt-10 max-w-md p-8 text-center"><h1 className="text-2xl font-semibold">Page not found</h1><p className="mt-2 text-sm text-slate-500">The page does not exist, or your role has no access to it.</p><Link to="/" className="btn btn-primary mt-4">Go to dashboard</Link></div>);
}
