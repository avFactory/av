import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { LinkBtn } from '../ui.jsx';
import Bell from './Bell.jsx';

const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);

function loadCart() { try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; } }

/** المتجر مفتوح للجميع للتصفح. إرسال الطلبات وعرض أجور التصنيع للعملاء المعتمدين فقط. */
export default function StoreLayout() {
  const { me, logout } = useAuth();
  const [cart, setCart] = useState(loadCart);
  useEffect(() => { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch { /* ignore */ } }, [cart]);
  const loc = useLocation();
  const isCustomer = me?.role_code === 'customer';
  const approved = isCustomer && me.customer_status === 'approved';
  const next = encodeURIComponent(loc.pathname + loc.search);
  // مصدر بيانات المنتجات: أسعار العميل الخاصة للمعتمد، والكتالوج العام لغيره
  const apiBase = approved ? '/store' : '/public';
  const count = cart.reduce((s, i) => s + Number(i.quantity), 0);
  return (
    <CartCtx.Provider value={{ cart, setCart, approved, apiBase, me, loginUrl: `/login?next=${next}` }}>
      <header className="store-top no-print">
        <div className="in">
          <Link to="/store" className="brand" style={{ padding: 0 }}><img src="/logo-gold.png" alt="AV" className="brand-logo" /><span>مصنع AV للمجوهرات <small style={{ opacity: .7, fontWeight: 500 }}>· متجر الجملة</small></span></Link>
          <nav>
            <NavLink to="/store" end>المنتجات</NavLink>
            <NavLink to="/store/custom">اطلب تصميمك</NavLink>
            {approved && <NavLink to="/store/orders">طلباتي</NavLink>}
            {approved && <NavLink to="/store/invoices">الفواتير</NavLink>}
            <NavLink to="/store/cart">السلة ({count})</NavLink>
          </nav>
          <div className="row gap">
            {!me && <>
              <Link to={`/login?next=${next}`} className="btn btn-primary btn-sm">تسجيل الدخول</Link>
              <Link to="/register" className="btn btn-ghost btn-sm" style={{ color: '#fff' }}>إنشاء حساب محل</Link>
            </>}
            {isCustomer && <>
              <Bell to="/store/notifications" />
              <NavLink to="/store/account" className="btn btn-ghost btn-sm" style={{ color: '#fff' }}>{me.shop_name}</NavLink>
              <button className="btn btn-ghost btn-sm" style={{ color: '#fff' }} onClick={logout}>خروج</button>
            </>}
            {me && !isCustomer && <Link to="/" className="btn btn-ghost btn-sm" style={{ color: '#fff' }}>العودة للنظام</Link>}
          </div>
        </div>
      </header>
      {isCustomer && !approved && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="alert alert-warn">حساب محل <b>{me.shop_name}</b> بانتظار موافقة إدارة المصنع. يمكنكم تصفح المنتجات الآن، وإرسال الطلبات بعد الاعتماد. ارفعوا مستندات المنشأة من <Link to="/store/account" className="link">صفحة الحساب</Link>.</div>
        </div>
      )}
      <Outlet />
    </CartCtx.Provider>
  );
}

/** بطاقة تظهر لمن لا يستطيع إرسال الطلب: زائر أو حساب غير معتمد */
export function OrderGate({ what = 'إرسال الطلب' }) {
  const { me, loginUrl } = useCart();
  if (me?.role_code === 'customer') return <div className="alert alert-warn">حسابكم بانتظار موافقة إدارة المصنع - يمكنكم {what} بعد الاعتماد.</div>;
  if (me) return <div className="alert alert-info">أنت مسجل بحساب موظف. {what} متاح لحسابات المحلات فقط.</div>;
  return (
    <div className="card card-b grid" style={{ gap: 10 }}>
      <b>سجّل الدخول ل{what}</b>
      <p className="muted small">المتجر متاح للتصفح للجميع، والطلب لأصحاب محلات الذهب المسجلين. ستبقى سلتك محفوظة.</p>
      <div className="row gap wrap"><LinkBtn to={loginUrl} kind="primary">تسجيل الدخول</LinkBtn><LinkBtn to="/register" kind="ghost">إنشاء حساب محل جديد</LinkBtn></div>
    </div>
  );
}
