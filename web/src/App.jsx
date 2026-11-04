import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, homeFor } from './auth.jsx';
import { Loader } from './ui.jsx';
import StaffLayout from './components/StaffLayout.jsx';
import WorkerLayout from './components/WorkerLayout.jsx';
import StoreLayout from './components/StoreLayout.jsx';
import Login from './pages/Login.jsx';
import PublicTrack from './pages/PublicTrack.jsx';
import PublicPricing from './pages/PublicPricing.jsx';
import PublicStones from './pages/PublicStones.jsx';
import Register from './pages/Register.jsx';
import ForcePassword from './pages/ForcePassword.jsx';

const L = (f) => lazy(f);
const SupHome = L(() => import('./pages/sup/Home.jsx'));
const Issue = L(() => import('./pages/sup/Issue.jsx'));
const Receive = L(() => import('./pages/sup/Receive.jsx'));
const Workers = L(() => import('./pages/sup/Workers.jsx'));
const WorkerProfile = L(() => import('./pages/sup/WorkerProfile.jsx'));
const Review = L(() => import('./pages/sup/Review.jsx'));
const Log = L(() => import('./pages/sup/Log.jsx'));
const Batch = L(() => import('./pages/sup/Batch.jsx'));
const Scan = L(() => import('./pages/sup/Scan.jsx'));
const Casting = L(() => import('./pages/sup/Casting.jsx'));
const Orders = L(() => import('./pages/orders/Orders.jsx'));
const OrderDetail = L(() => import('./pages/orders/OrderDetail.jsx'));
const NewOrder = L(() => import('./pages/orders/NewOrder.jsx'));
const Labels = L(() => import('./pages/orders/Labels.jsx'));
const Dashboard = L(() => import('./pages/admin/Dashboard.jsx'));
const Employees = L(() => import('./pages/admin/Employees.jsx'));
const Roles = L(() => import('./pages/admin/Roles.jsx'));
const Customers = L(() => import('./pages/admin/Customers.jsx'));
const CustomerDetail = L(() => import('./pages/admin/CustomerDetail.jsx'));
const Stages = L(() => import('./pages/admin/Stages.jsx'));
const Inventory = L(() => import('./pages/admin/Inventory.jsx'));
const Stones = L(() => import('./pages/admin/Stones.jsx'));
const Products = L(() => import('./pages/admin/Products.jsx'));
const Pricing = L(() => import('./pages/admin/Pricing.jsx'));
const Labor = L(() => import('./pages/admin/Labor.jsx'));
const Invoices = L(() => import('./pages/admin/Invoices.jsx'));
const InvoiceView = L(() => import('./pages/admin/InvoiceView.jsx'));
const Payments = L(() => import('./pages/admin/Payments.jsx'));
const Expenses = L(() => import('./pages/admin/Expenses.jsx'));
const Reports = L(() => import('./pages/admin/Reports.jsx'));
const Audit = L(() => import('./pages/admin/Audit.jsx'));
const Settings = L(() => import('./pages/admin/Settings.jsx'));
const Notifications = L(() => import('./pages/Notifications.jsx'));
const Account = L(() => import('./pages/Account.jsx'));
const WHome = L(() => import('./pages/worker/Home.jsx'));
const WCustody = L(() => import('./pages/worker/Custody.jsx'));
const WOrder = L(() => import('./pages/worker/Order.jsx'));
const WHistory = L(() => import('./pages/worker/History.jsx'));
const WScan = L(() => import('./pages/worker/Scan.jsx'));
const WLosses = L(() => import('./pages/worker/Losses.jsx'));
const LossAdvances = L(() => import('./pages/admin/LossAdvances.jsx'));
const Catalog = L(() => import('./pages/store/Catalog.jsx'));
const Product = L(() => import('./pages/store/Product.jsx'));
const Cart = L(() => import('./pages/store/Cart.jsx'));
const Custom = L(() => import('./pages/store/Custom.jsx'));
const MyOrders = L(() => import('./pages/store/MyOrders.jsx'));
const Track = L(() => import('./pages/store/Track.jsx'));
const SInvoices = L(() => import('./pages/store/Invoices.jsx'));
const SAccount = L(() => import('./pages/store/Account.jsx'));

function Guard({ perms, children }) {
  const { me, can } = useAuth();
  const loc = useLocation();
  if (me === undefined) return <Loader />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (perms && !can(...perms)) return <div className="page"><div className="alert alert-danger">ليست لديك صلاحية لعرض هذه الصفحة</div></div>;
  return children;
}

export default function App() {
  const { me } = useAuth();
  const loc = useLocation();
  // تتبع الطلب برابط عام: يعمل بدون تسجيل دخول
  if (loc.pathname.startsWith('/t/')) return <Suspense fallback={<Loader />}><Routes><Route path="/t/:token" element={<PublicTrack />} /></Routes></Suspense>;
  // التسعيرة برابط خارجي: بدون تسجيل دخول
  if (loc.pathname.startsWith('/p/')) return <Suspense fallback={<Loader />}><Routes><Route path="/p/:token" element={<PublicPricing />} /></Routes></Suspense>;
  // مخزون الألماس برابط خارجي: بدون تسجيل دخول
  if (loc.pathname.startsWith('/s/')) return <Suspense fallback={<Loader />}><Routes><Route path="/s/:token" element={<PublicStones />} /></Routes></Suspense>;
  if (me === undefined) return <Loader />;
  if (me?.must_change_password) return <ForcePassword />;
  const S = (el, perms) => <Guard perms={perms}>{el}</Guard>;
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Navigate to={homeFor(me)} replace />} />
        <Route path="/print/batch/:id" element={S(<Batch print />)} />
        <Route path="/print/labels" element={S(<Labels />, ['orders.view'])} />
        <Route path="/print/invoice/:id" element={S(<InvoiceView print />)} />

        <Route element={<Guard><StaffLayout /></Guard>}>
          <Route path="/sup" element={S(<SupHome />, ['custody.issue', 'custody.receive', 'custody.view_all'])} />
          <Route path="/sup/issue" element={S(<Issue />, ['custody.issue'])} />
          <Route path="/sup/receive" element={S(<Receive />, ['custody.receive'])} />
          <Route path="/sup/workers" element={S(<Workers />, ['workers.view', 'custody.issue', 'custody.receive'])} />
          <Route path="/sup/workers/:id" element={S(<WorkerProfile />, ['workers.view', 'custody.issue', 'custody.receive'])} />
          <Route path="/sup/review" element={S(<Review />, ['loss.review', 'loss.investigate', 'loss.approve'])} />
          <Route path="/sup/log" element={S(<Log />, ['custody.view_all', 'inventory.view', 'reports.view'])} />
          <Route path="/sup/batch/:id" element={S(<Batch />)} />
          <Route path="/sup/scan" element={S(<Scan />, ['scan.use', 'orders.view'])} />
          <Route path="/sup/casting" element={S(<Casting />, ['custody.issue', 'custody.receive', 'orders.advance', 'scan.use'])} />
          <Route path="/orders" element={S(<Orders />, ['orders.view'])} />
          <Route path="/orders/new" element={S(<NewOrder />, ['orders.manage'])} />
          <Route path="/orders/:id" element={S(<OrderDetail />, ['orders.view'])} />
          <Route path="/admin" element={S(<Dashboard />, ['dashboard.view'])} />
          <Route path="/admin/employees" element={S(<Employees />, ['employees.manage', 'workers.view'])} />
          <Route path="/admin/roles" element={S(<Roles />, ['roles.manage'])} />
          <Route path="/admin/customers" element={S(<Customers />, ['customers.view'])} />
          <Route path="/admin/customers/:id" element={S(<CustomerDetail />, ['customers.view'])} />
          <Route path="/admin/stages" element={S(<Stages />, ['stages.manage', 'loss_rates.manage'])} />
          <Route path="/admin/inventory" element={S(<Inventory />, ['inventory.view'])} />
          <Route path="/admin/stones" element={S(<Stones />, ['stones.view'])} />
          <Route path="/admin/products" element={S(<Products />, ['products.manage'])} />
          <Route path="/admin/pricing" element={S(<Pricing />, ['pricing.manage'])} />
          <Route path="/admin/loss-advances" element={S(<LossAdvances />, ['loss.advances', 'loss.approve'])} />
          <Route path="/admin/labor" element={S(<Labor />, ['labor.manage'])} />
          <Route path="/admin/invoices" element={S(<Invoices />, ['finance.view'])} />
          <Route path="/admin/invoices/:id" element={S(<InvoiceView />, ['finance.view'])} />
          <Route path="/admin/payments" element={S(<Payments />, ['finance.view'])} />
          <Route path="/admin/expenses" element={S(<Expenses />, ['finance.view'])} />
          <Route path="/admin/reports" element={S(<Reports />, ['reports.view', 'loss.review'])} />
          <Route path="/admin/audit" element={S(<Audit />, ['audit.view'])} />
          <Route path="/admin/settings" element={S(<Settings />, ['settings.manage'])} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/account" element={<Account />} />
        </Route>

        <Route element={<Guard perms={['worker.self']}><WorkerLayout /></Guard>}>
          <Route path="/w" element={<WHome />} />
          <Route path="/w/custody/:id" element={<WCustody />} />
          <Route path="/w/orders/:id" element={<WOrder />} />
          <Route path="/w/history" element={<WHistory />} />
          <Route path="/w/scan" element={<WScan />} />
          <Route path="/w/losses" element={<WLosses />} />
          <Route path="/w/notifications" element={<Notifications />} />
          <Route path="/w/account" element={<Account />} />
        </Route>

        {/* المتجر: يتطلب تسجيل الدخول، وصفحات الحساب والطلبات للعملاء فقط */}
        <Route element={<StoreLayout />}>
          <Route path="/store" element={<Catalog />} />
          <Route path="/store/products/:id" element={<Product />} />
          <Route path="/store/cart" element={<Cart />} />
          <Route path="/store/custom" element={<Custom />} />
          <Route path="/store/orders" element={S(<MyOrders />, ['store.access'])} />
          <Route path="/store/orders/:id" element={S(<Track />, ['store.access'])} />
          <Route path="/store/invoices" element={S(<SInvoices />, ['store.access'])} />
          <Route path="/store/invoices/:id" element={S(<InvoiceView store />, ['store.access'])} />
          <Route path="/store/account" element={S(<SAccount />, ['store.access'])} />
          <Route path="/store/notifications" element={S(<Notifications />, ['store.access'])} />
        </Route>
        <Route path="*" element={<div className="page"><h1>الصفحة غير موجودة</h1></div>} />
      </Routes>
    </Suspense>
  );
}
