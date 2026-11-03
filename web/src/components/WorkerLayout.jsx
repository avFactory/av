import { ThemeToggle } from '../ui.jsx';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Bell from './Bell.jsx';

export default function WorkerLayout() {
  const { me, logout } = useAuth();
  return (
    <div className="wk">
      <header className="navbar navbar-dark bg-dark sticky-top px-3 wk-top no-print" data-bs-theme="dark">
        <div className="d-flex align-items-center gap-2">
          <img src="/logo-gold.png" alt="AV" className="brand-logo" />
          <div className="lh-sm"><div className="small text-white-50">مرحباً</div><b className="text-gold">{me.full_name}</b> <span className="small text-white-50">{me.employee_no}</span></div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <ThemeToggle light />
          <Bell to="/w/notifications" />
          <NavLink to="/w/account" className="btn btn-outline-light btn-sm">حسابي</NavLink>
          <button className="btn btn-outline-light btn-sm" onClick={logout}>خروج</button>
        </div>
      </header>
      <Outlet />
      <nav className="nav nav-justified fixed-bottom bg-body border-top shadow-sm wk-nav no-print">
        <NavLink to="/w" end className="nav-link"><i>▤</i>مهامي</NavLink>
        <NavLink to="/w/scan" className="nav-link"><i>⌁</i>مسح QR</NavLink>
        <NavLink to="/w/history" className="nav-link"><i>↺</i>السجل</NavLink>
        <NavLink to="/w/notifications" className="nav-link"><i>◔</i>الإشعارات</NavLink>
      </nav>
    </div>
  );
}
