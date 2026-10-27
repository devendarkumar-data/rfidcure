import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Spinner from './components/Spinner.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import DataQuality from './pages/DataQuality.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import ReportPage, { ReportsIndex } from './pages/Reports.jsx';
import { ReqDetail, ReqForm, ReqRegister } from './pages/workflow/requisition.jsx';
import OpeningStock from './pages/OpeningStock.jsx';
import NotFound from './pages/NotFound.jsx';
import StockBatches from './pages/StockBatches.jsx';
import StockSummary from './pages/StockSummary.jsx';
import TablePage from './pages/TablePage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import { GrnDetail, GrnForm, GrnRegister, IntentDetail, IntentForm, IntentRegister, PoDetail, PoForm, PoRegister } from './pages/workflow/index.jsx';
import PoPrint from './pages/workflow/PoPrint.jsx';

function Protected() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner className="h-full" label="Loading your workspace…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.mustChange) return <ChangePassword forced />;
  return <AppLayout />;
}

// Route-level guard: only render when the user's meta grants the feature / table (the API enforces it again).
function Need({ feature, table, action = 'view', children }) {
  const { features, tables } = useAuth();
  const ok = (feature ? features[feature] : true) && (table ? tables[table]?.actions.includes(action) : true);
  return ok ? children : <NotFound />;
}

const Home = () => { const { features, tables } = useAuth(); return features.dashboard ? <Dashboard /> : <Landing tables={tables} />; };
function Landing({ tables }) {
  const first = Object.values(tables)[0];
  return first ? <Navigate to={`/t/${first.slug}`} replace /> : <NotFound />;
}
const Keyed = ({ children }) => { const { slug } = useParams(); return <div key={slug}>{children}</div>; };

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route index element={<Home />} />
        <Route path="change-password" element={<ChangePassword />} />
        <Route path="t/:slug" element={<Keyed><TablePage /></Keyed>} />

        <Route path="purchase-intent" element={<Need table="purchase-indent"><IntentRegister /></Need>} />
        <Route path="purchase-intent/new" element={<Need table="purchase-indent" action="create"><IntentForm /></Need>} />
        <Route path="purchase-intent/:id" element={<Need table="purchase-indent"><IntentDetail /></Need>} />
        <Route path="purchasing/po" element={<Need table="purchase-order-domestic"><PoRegister /></Need>} />
        <Route path="purchasing/po/new" element={<Need table="purchase-order-domestic" action="create"><PoForm /></Need>} />
        <Route path="purchasing/po/:id" element={<Need table="purchase-order-domestic"><PoDetail /></Need>} />
        <Route path="purchasing/po/:id/print" element={<Need table="purchase-order-domestic"><PoPrint /></Need>} />
        <Route path="requisitions" element={<Need table="purchase-requisition"><ReqRegister /></Need>} />
        <Route path="requisitions/new" element={<Need table="purchase-requisition" action="create"><ReqForm /></Need>} />
        <Route path="requisitions/:id" element={<Need table="purchase-requisition"><ReqDetail /></Need>} />
        <Route path="reports" element={<Need feature="reports"><ReportsIndex /></Need>} />
        <Route path="reports/:key" element={<Need feature="reports"><ReportPage /></Need>} />
        <Route path="grn" element={<Need table="grn-mrn"><GrnRegister /></Need>} />
        <Route path="grn/new" element={<Need table="grn-mrn" action="create"><GrnForm /></Need>} />
        <Route path="grn/:id" element={<Need table="grn-mrn"><GrnDetail /></Need>} />

        <Route path="inventory/summary" element={<Need feature="stock"><StockSummary /></Need>} />
        <Route path="inventory/opening-stock" element={<Need table="opening-stock"><OpeningStock /></Need>} />
        <Route path="inventory/batches" element={<Need feature="stock"><StockBatches /></Need>} />
        <Route path="admin/users" element={<Need feature="users"><UsersPage /></Need>} />
        <Route path="admin/data-quality" element={<Need feature="dataQuality"><DataQuality /></Need>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
