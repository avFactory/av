import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Loader } from '../ui.jsx';
import PricingSheet from '../components/PricingSheet.jsx';
import ShortPricing from '../components/ShortPricing.jsx';
import { money } from '../pricingSheet.js';

const THEME_KEY = 'pricing_theme';
const readTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; } };

/** التسعيرة برابط خارجي: بدون تسجيل دخول، لا يظهر فيها إلا التسعيرة، والإدخال للأوزان فقط */
export default function PublicPricing() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => { api.get(`/public/pricing/${encodeURIComponent(token)}`).then(setD).catch(setErr); }, [token]);
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    document.title = 'تسعيرة منتجات AV';
    return () => m.remove();
  }, []);
  // الوضع الافتراضي أبيض، ويمكن التبديل للداكن (يُحفظ على هذا الجهاز)
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themeLock = '1';
    root.setAttribute('data-bs-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  const dark = theme === 'dark';
  return (
    <div className="track-page pricing-page">
      <header className="pricing-head">
        <div className="pricing-brand">
          <img src="/logo-white.png" alt="AV" />
          <div><b>مصنع AV للمجوهرات</b><div className="small">{d?.view === 'short' ? 'التسعيرة المختصرة' : 'التسعيرة'}</div></div>
        </div>
        {d && (
          <div className="pricing-head-gold">
            <div><span>سعر الذهب الصافي 24</span><b>{money(Number(d.gold24))}</b></div>
            {d.view !== 'short' && <div><span>سعر الذهب عيار 18</span><b>{money(Number(d.gold24) * 18 / 24)}</b></div>}
            <div><span>آخر تحديث</span><b>{d.updated_at || '—'}</b></div>
          </div>
        )}
        <button type="button" className="btn btn-sm pricing-theme" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'الوضع الفاتح' : 'الوضع الداكن'} title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}>
          {dark ? '☀ فاتح' : '☾ داكن'}
        </button>
      </header>
      <main className="container-fluid py-3" style={{ maxWidth: 1500 }}>
        {err && <div className="alert alert-warning">{err.message || 'الرابط غير صحيح'}</div>}
        {!d && !err && <Loader />}
        {d && (d.view === 'short' ? <ShortPricing token={token} initial={d.sections} /> : <PricingSheet data={d} mode="public" hideGold />)}
      </main>
    </div>
  );
}
