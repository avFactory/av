import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate, fmtDT, COLORS } from '../format.js';
import { Loader, ThemeToggle } from '../ui.jsx';

/** صفحة تتبع الطلب العامة (برابط خاص، بدون تسجيل دخول) — عرض فقط */
export default function PublicTrack() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.get(`/public/track/${encodeURIComponent(token)}`).then((x) => alive && setD(x)).catch((e) => alive && setErr(e));
    load();
    const t = setInterval(load, 60000); // تحديث تلقائي كل دقيقة
    return () => { alive = false; clearInterval(t); };
  }, [token]);
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  return (
    <div className="track-page">
      <header className="track-head">
        <img src="/logo-white.png" alt="AV" />
        <div><b>مصنع AV للمجوهرات</b><div className="small">تتبع الطلب</div></div>
        <ThemeToggle light className="ms-auto" />
      </header>
      <main className="container py-4" style={{ maxWidth: 640 }}>
        {err && <div className="alert alert-warning">{err.message || 'رابط التتبع غير صحيح'}</div>}
        {!d && !err && <Loader />}
        {d && <>
          <div className="card mb-3"><div className="card-body">
            <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
              <div>
                <div className="small text-body-secondary" dir="ltr" style={{ textAlign: 'right' }}>{d.order_no}</div>
                <h1 className="h4 mb-1">{d.title}</h1>
                <div className="small text-body-secondary">
                  {[d.product_type, d.karat && `عيار ${d.karat}`, COLORS[d.color], d.quantity && `الكمية ${d.quantity}`, d.size && `مقاس ${d.size}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className={`badge rounded-pill fs-6 ${d.status === 'delivered' || d.status === 'ready' ? 'text-bg-success' : 'text-bg-warning'}`}>{d.status_label}</span>
            </div>
            <div className="mt-3">
              <div className="d-flex justify-content-between small mb-1"><span>المرحلة الحالية: <b>{d.stage_name || d.status_label}</b></span><span>{d.progress}%</span></div>
              <div className="progress" role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100}><div className="progress-bar" style={{ width: `${d.progress}%` }} /></div>
            </div>
            <div className="row g-2 mt-2 small">
              <div className="col-6"><span className="text-body-secondary">تاريخ الطلب: </span>{fmtDate(d.created_at)}</div>
              {d.due_date && <div className="col-6"><span className="text-body-secondary">التسليم المتوقع: </span>{fmtDate(d.due_date)}</div>}
              {d.ready_at && <div className="col-6"><span className="text-body-secondary">جاهز منذ: </span>{fmtDate(d.ready_at)}</div>}
              {d.delivered_at && <div className="col-6"><span className="text-body-secondary">تاريخ التسليم: </span>{fmtDate(d.delivered_at)}</div>}
            </div>
          </div></div>
          {d.stages.length > 0 && (
            <div className="card"><div className="card-body">
              <h2 className="h6 mb-3">مراحل التصنيع</h2>
              <ol className="timeline">
                {d.stages.map((s, i) => (
                  <li key={i} className={s.state === 'done' ? 'done' : s.state === 'current' ? 'cur' : ''}>
                    <div><b>{s.name}</b>{s.state === 'current' && <span className="small text-warning-emphasis"> — الطلب هنا الآن</span>}{s.at && <div className="small text-body-secondary">{fmtDT(s.at)}</div>}</div>
                  </li>
                ))}
              </ol>
            </div></div>
          )}
          <p className="small text-body-secondary text-center mt-3">هذه الصفحة للعرض فقط وتتحدث تلقائياً.</p>
        </>}
      </main>
    </div>
  );
}
