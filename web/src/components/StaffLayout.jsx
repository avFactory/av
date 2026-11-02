import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../auth.jsx';
import Bell from './Bell.jsx';

const NAV = [
  ['المشرف', [
    ['/sup', 'الرئيسية', ['custody.issue', 'custody.receive', 'custody.view_all'], true],
    ['/sup/issue', 'تسليم ذهب للعامل', ['custody.issue']],
    ['/sup/receive', 'استلام ذهب من العامل', ['custody.receive']],
    ['/sup/workers', 'العمال والعهد', ['workers.view', 'custody.issue']],
    ['/sup/review', 'مراجعة العجز', ['loss.review', 'loss.investigate']],
    ['/sup/log', 'سجل العمليات', ['custody.view_all', 'inventory.view', 'reports.view']],
    ['/sup/scan', 'مسح QR', ['scan.use']],
  ]],
  ['الإنتاج', [
    ['/orders', 'الطلبات', ['orders.view']],
    ['/orders/new', 'طلب تصنيع جديد', ['orders.manage']],
    ['/admin/stages', 'المراحل ونسب العجز', ['stages.manage', 'loss_rates.manage']],
  ]],
  ['الإدارة', [
    ['/admin', 'لوحة الإحصائيات', ['dashboard.view'], true],
    ['/admin/employees', 'الموظفون', ['employees.manage']],
    ['/admin/roles', 'الأدوار والصلاحيات', ['roles.manage']],
    ['/admin/customers', 'العملاء (المحلات)', ['customers.view']],
  ]],
  ['المخزون', [
    ['/admin/inventory', 'الذهب والمخزون', ['inventory.view']],
    ['/admin/stones', 'الألماس والأحجار', ['stones.view']],
    ['/admin/products', 'منتجات المتجر', ['products.manage']],
  ]],
  ['المالية', [
    ['/admin/invoices', 'الفواتير', ['finance.view']],
    ['/admin/payments', 'المدفوعات', ['finance.view']],
    ['/admin/expenses', 'المصروفات', ['finance.view']],
    ['/admin/labor', 'أجور التصنيع', ['labor.manage']],
  ]],
  ['النظام', [
    ['/admin/reports', 'التقارير', ['reports.view', 'loss.review']],
    ['/admin/audit', 'سجل التدقيق', ['audit.view']],
    ['/admin/settings', 'الإعدادات', ['settings.manage']],
  ]],
];

export default function StaffLayout() {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? 'open' : ''}`}>
        <a href="/" className="brand"><img src="/logo-gold.png" alt="AV" className="brand-logo" /><span>مصنع AV للمجوهرات</span></a>
        <nav>
          {NAV.map(([grp, items]) => {
            const vis = items.filter(([, , p]) => can(...p));
            if (!vis.length) return null;
            return (
              <div key={grp}>
                <div className="grp">{grp}</div>
                {vis.map(([to, label, , end]) => <NavLink key={to} to={to} end={end}>{label}</NavLink>)}
              </div>
            );
          })}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar no-print">
          <div className="row gap">
            <button className="btn btn-ghost menu-btn" onClick={() => setOpen(true)} aria-label="القائمة">☰</button>
            <span className="muted small">{me.full_name}</span>
          </div>
          <div className="row gap">
            <Bell />
            <NavLink to="/account" className="btn btn-ghost btn-sm">حسابي</NavLink>
            <button className="btn btn-ghost btn-sm" onClick={logout}>خروج</button>
          </div>
        </header>
        <div className="print-only print-head"><img src="/logo.png" alt="AV" /><b>مصنع AV للمجوهرات</b></div>
        <Outlet />
      </div>
    </div>
  );
}
