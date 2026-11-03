import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Loader } from '../ui.jsx';
import PricingSheet from '../components/PricingSheet.jsx';

/** التسعيرة برابط خارجي: بدون تسجيل دخول، لا يظهر فيها إلا التسعيرة، والإدخال للأوزان فقط */
export default function PublicPricing() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get(`/public/pricing/${encodeURIComponent(token)}`).then(setD).catch(setErr); }, [token]);
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    document.title = 'تسعيرة منتجات AV';
    return () => m.remove();
  }, []);
  return (
    <div className="track-page">
      <header className="track-head">
        <img src="/logo-gold.png" alt="AV" />
        <div><b>مصنع AV للمجوهرات</b><div className="small">التسعيرة</div></div>
      </header>
      <main className="container-fluid py-3" style={{ maxWidth: 1500 }}>
        {err && <div className="alert alert-warning">{err.message || 'الرابط غير صحيح'}</div>}
        {!d && !err && <Loader />}
        {d && <PricingSheet data={d} mode="public" />}
      </main>
    </div>
  );
}
