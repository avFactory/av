import { useState } from 'react';
import { ThemeToggle } from '../ui.jsx';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { t, langInfo } from '../i18n.js';
import Bell from './Bell.jsx';
import LangPicker from './LangPicker.jsx';

export default function WorkerLayout() {
  const { me, logout } = useAuth();
  const [pick, setPick] = useState(false);
  // أول دخول للعامل: يختار لغته مرة واحدة (تُحفظ على حسابه)
  if (me.role_code === 'worker' && !me.lang) return <LangPicker first />;
  return (
    <div className="wk">
      <header className="navbar navbar-dark bg-dark sticky-top px-3 wk-top no-print" data-bs-theme="dark">
        <div className="d-flex align-items-center gap-2">
          <img src="/logo-white.png" alt="AV" className="brand-logo" />
          <div className="lh-sm"><div className="small text-white-50">{t('مرحباً')}</div><b className="text-gold">{me.full_name}</b> <span className="small text-white-50">{me.employee_no}</span></div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn btn-outline-light btn-sm wk-lang" onClick={() => setPick(true)} aria-label={t('اللغة')}>🌐 {langInfo().name}</button>
          <ThemeToggle light />
          <Bell to="/w/notifications" />
          <NavLink to="/w/account" className="btn btn-outline-light btn-sm">{t('حسابي')}</NavLink>
          <button className="btn btn-outline-light btn-sm" onClick={logout}>{t('خروج')}</button>
        </div>
      </header>
      {pick && <LangPicker onClose={() => setPick(false)} />}
      <Outlet />
      <nav className="nav nav-justified fixed-bottom bg-body border-top shadow-sm wk-nav no-print">
        <NavLink to="/w" end className="nav-link"><i>▤</i>{t('مهامي')}</NavLink>
        <NavLink to="/w/scan" className="nav-link"><i>⌁</i>{t('مسح QR')}</NavLink>
        {me?.is_3d ? <>
          <NavLink to="/w/designs" className="nav-link"><i>✏️</i>{t('التصاميم')}</NavLink>
          <NavLink to="/w/prints" className="nav-link"><i>🖨</i>{t('الطباعة')}</NavLink>
        </> : <>
          <NavLink to="/w/losses" className="nav-link"><i>⚖</i>{t('العجز')}</NavLink>
          <NavLink to="/w/history" className="nav-link"><i>↺</i>{t('السجل')}</NavLink>
        </>}
        <NavLink to="/w/notifications" className="nav-link"><i>◔</i>{t('الإشعارات')}</NavLink>
      </nav>
    </div>
  );
}
