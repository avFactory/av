import { ThemeToggle } from '../ui.jsx';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useScanner } from '../useScanner.js';
import { useAuth } from '../auth.jsx';
import Bell from './Bell.jsx';

const NAV = [
  ['المشرف', [
    ['/sup', 'الرئيسية', ['custody.issue', 'custody.receive', 'custody.view_all'], true],
    ['/sup/issue', 'تسليم ذهب للعامل', ['custody.issue']],
    ['/sup/receive', 'استلام ذهب من العامل', ['custody.receive']],
    ['/sup/workers', 'العمال والعهد', ['workers.view', 'custody.issue']],
    ['/sup/schedule', 'جدول الطلبات', ['schedule.view']],
    ['/sup/shortages', 'النواقص', ['orders.view', 'custody.issue', 'custody.receive']],
    ['/sup/review', 'مراجعة العجز', ['loss.review', 'loss.investigate']],
    ['/admin/loss-advances', 'سلف العجز', ['loss.advances']],
    ['/sup/log', 'سجل العمليات', ['custody.view_all', 'inventory.view', 'reports.view']],
    ['/sup/scan', 'مسح QR', ['scan.use']],
    ['/sup/casting', 'الصب', ['custody.issue', 'custody.receive', 'orders.advance']],
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
    ['/admin/stones', 'الألماس المخبري والأحجار', ['stones.view']],
    ['/admin/findings', 'خامات المصنع', ['inventory.view', 'custody.issue', 'findings.manage']],
    ['/admin/products', 'منتجات المتجر', ['products.manage']],
    ['/admin/pricing', 'التسعيرة', ['pricing.manage']],
  ]],
  ['المالية', [
    ['/admin/invoices', 'الفواتير', ['finance.view']],
    ['/admin/payments', 'المدفوعات', ['finance.view']],
    ['/admin/submissions', 'مستندات السداد', ['finance.view']],
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
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  // القوائم المنسدلة: المجموعة التي فيها الصفحة الحالية تُفتح تلقائياً، والاختيار يُحفظ على الجهاز
  const [groups, setGroups] = useState(() => { try { return JSON.parse(localStorage.getItem('nav_groups') || '{}'); } catch { return {}; } });
  const activeGrp = NAV.find(([, items]) => items.some(([to, , , end]) => (end ? loc.pathname === to : loc.pathname === to || loc.pathname.startsWith(`${to}/`))))?.[0];
  const isOpen = (g) => (groups[g] ?? g === activeGrp);
  const toggleGrp = (g) => setGroups((x) => { const n = { ...x, [g]: !isOpen(g) }; try { localStorage.setItem('nav_groups', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  // مسح ملصق طلب بقارئ الباركود من أي صفحة يفتح بيانات الطلب
  const navScan = useNavigate();
  useScanner((code) => navScan(`/sup/scan?code=${encodeURIComponent(code)}`), can('scan.use', 'orders.view') && loc.pathname !== '/sup/scan');
  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? 'open' : ''}`}>
        <a href="/" className="brand"><img src="/logo-white.png" alt="AV" className="brand-logo" /><span>مصنع AV للمجوهرات</span></a>
        <nav className="nav nav-pills flex-column">
          {NAV.map(([grp, items]) => {
            const vis = items.filter(([, , p]) => can(...p));
            if (!vis.length) return null;
            return (
              <div key={grp} className={`nav-grp ${isOpen(grp) ? 'open' : ''} ${grp === activeGrp ? 'has-active' : ''}`}>
                <button type="button" className="grp-btn" aria-expanded={isOpen(grp)} onClick={() => toggleGrp(grp)}>
                  <span>{grp}</span><span className="grp-arrow" aria-hidden="true">‹</span>
                </button>
                {isOpen(grp) && <div className="grp-items">{vis.map(([to, label, , end]) => <NavLink key={to} to={to} end={end} className="nav-link">{label}</NavLink>)}</div>}
              </div>
            );
          })}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="navbar bg-body border-bottom sticky-top topbar no-print">
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-outline-secondary menu-btn" onClick={() => setOpen(true)} aria-label="القائمة"><span className="navbar-toggler-icon" style={{ width: '1.1em', height: '1.1em' }} /></button>
            <span className="text-body-secondary small">{me.full_name}</span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <ThemeToggle />
            <Bell />
            <NavLink to="/account" className="btn btn-outline-secondary btn-sm">حسابي</NavLink>
            <button className="btn btn-outline-secondary btn-sm" onClick={logout}>خروج</button>
          </div>
        </header>
        <div className="print-only print-head"><img src="/logo.png" alt="AV" /><b>مصنع AV للمجوهرات</b></div>
        <Outlet />
      </div>
    </div>
  );
}
