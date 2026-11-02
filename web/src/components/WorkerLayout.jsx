import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Bell from './Bell.jsx';

export default function WorkerLayout() {
  const { me, logout } = useAuth();
  return (
    <div className="wk">
      <header className="wk-top no-print">
        <div className="row gap"><img src="/logo-gold.png" alt="AV" className="brand-logo" /><div><div className="small" style={{ opacity: .7 }}>مرحباً</div><b>{me.full_name}</b> <span className="small" style={{ opacity: .7 }}>{me.employee_no}</span></div></div>
        <div className="row gap"><Bell to="/w/notifications" /><NavLink to="/w/account" className="btn btn-ghost btn-sm" style={{ color: '#fff' }}>حسابي</NavLink><button className="btn btn-ghost btn-sm" style={{ color: '#fff' }} onClick={logout}>خروج</button></div>
      </header>
      <Outlet />
      <nav className="wk-nav no-print">
        <NavLink to="/w" end><i>▤</i>مهامي</NavLink>
        <NavLink to="/w/scan"><i>⌁</i>مسح QR</NavLink>
        <NavLink to="/w/history"><i>↺</i>السجل</NavLink>
        <NavLink to="/w/notifications"><i>◔</i>الإشعارات</NavLink>
      </nav>
    </div>
  );
}
