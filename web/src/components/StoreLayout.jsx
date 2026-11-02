import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Bell from './Bell.jsx';

const CartCtx = createContext(null);
export const useCart = () => useContext(CartCtx);

function loadCart() { try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; } }

export default function StoreLayout() {
  const { me, logout } = useAuth();
  const [cart, setCart] = useState(loadCart);
  useEffect(() => { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch { /* ignore */ } }, [cart]);
  const approved = me.customer_status === 'approved';
  const loc = useLocation();
  const openPath = /^\/store\/(account|notifications)/.test(loc.pathname);
  return (
    <CartCtx.Provider value={{ cart, setCart }}>
      <header className="store-top no-print">
        <div className="in">
          <Link to="/store" className="brand" style={{ padding: 0 }}><img src="/logo-gold.png" alt="AV" className="brand-logo" /><span>مصنع AV للمجوهرات <small style={{ opacity: .7, fontWeight: 500 }}>· متجر الجملة</small></span></Link>
          {approved && (
            <nav>
              <NavLink to="/store" end>المنتجات</NavLink>
              <NavLink to="/store/custom">اطلب تصميمك</NavLink>
              <NavLink to="/store/orders">طلباتي</NavLink>
              <NavLink to="/store/invoices">الفواتير</NavLink>
              <NavLink to="/store/cart">السلة ({cart.reduce((s, i) => s + Number(i.quantity), 0)})</NavLink>
            </nav>
          )}
          <div className="row gap">
            <Bell to="/store/notifications" />
            <NavLink to="/store/account" className="btn btn-ghost btn-sm" style={{ color: '#fff' }}>{me.shop_name}</NavLink>
            <button className="btn btn-ghost btn-sm" style={{ color: '#fff' }} onClick={logout}>خروج</button>
          </div>
        </div>
      </header>
      {approved ? <Outlet /> : (
        <div className="page" style={{ maxWidth: 720 }}>
          <div className="card card-b">
            <h1>حسابكم بانتظار الموافقة</h1>
            <p className="muted mt">شكراً لتسجيل محل <b>{me.shop_name}</b>. تقوم إدارة المصنع بمراجعة بيانات المنشأة، وسيصلكم إشعار عند الاعتماد.</p>
            <p className="mt">يمكنكم رفع مستندات المنشأة (السجل التجاري، شهادة الضريبة) من <Link to="/store/account" className="link">صفحة الحساب</Link>.</p>
          </div>
          {openPath && <Outlet />}
        </div>
      )}
    </CartCtx.Provider>
  );
}
