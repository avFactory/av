import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDT } from '../format.js';
import { Loader, ThemeToggle } from '../ui.jsx';
import { ShapeIcon } from './admin/Stones.jsx';

const ct = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
// الراوند والدمعة في العمود الأيمن، وباقي القصّات في العمود الأيسر
const isRight = (g) => ['round', 'pear'].includes(g.icon) || /راوند|دمع|round|pear/i.test(g.name);
const STATUS = { ok: ['متوفر', 'ok'], low: ['كمية محدودة', 'low'], out: ['نفد', 'out'] };

/** مخزون الألماس برابط خارجي — عرض فقط، مرتب حسب القصّة والمقاس، يتحدث تلقائياً */
export default function PublicStones() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [shape, setShape] = useState('');
  const [hideOut, setHideOut] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => api.get(`/public/stones/${encodeURIComponent(token)}`).then((x) => alive && (setD(x), setErr(null))).catch((e) => alive && setErr(e));
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    document.title = 'مخزون الألماس المخبري — مصنع AV';
    return () => m.remove();
  }, []);

  const shapes = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.shapes
      .filter((g) => !shape || String(g.id) === shape)
      .map((g) => ({ ...g, items: g.items.filter((it) => (!hideOut || it.status !== 'out') && (!s || [g.name, it.size, it.color, it.clarity, it.type].filter(Boolean).join(' ').toLowerCase().includes(s))) }))
      .filter((g) => g.items.length);
  }, [d, q, shape, hideOut]);

  return (
    <div className="track-page stock-page">
      <header className="pricing-head">
        <div className="pricing-brand">
          <img src="/logo-white.png" alt="AV" />
          <div><b>مصنع AV للمجوهرات</b><div className="small">مخزون الألماس المخبري</div></div>
        </div>
        {d && (
          <div className="pricing-head-gold">
            <div><span>إجمالي المتوفر</span><b dir="ltr">{ct(d.totals.carats)} ct</b></div>
            <div><span>عدد الحبات</span><b>{d.totals.count.toLocaleString('en-US')}</b></div>
            <div><span>الأصناف المتوفرة</span><b>{d.totals.available} / {d.totals.types}</b></div>
          </div>
        )}
        <div className="d-flex gap-2 no-print">
          <button type="button" className="btn btn-sm pricing-theme" onClick={() => window.print()}>طباعة</button>
          <ThemeToggle light />
        </div>
      </header>

      <main className="container-fluid py-3" style={{ maxWidth: 1300 }}>
        {err && <div className="alert alert-warning">{err.message || 'الرابط غير صحيح'}</div>}
        {!d && !err && <Loader />}
        {d && <>
          <div className="stock-tools no-print">
            <input className="form-control" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالمقاس أو اللون أو النقاء…" aria-label="بحث" />
            <label className="check"><input type="checkbox" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} /> إخفاء غير المتوفر</label>
          </div>
          <div className="shape-bar no-print" role="tablist" aria-label="القصّة">
            <button type="button" role="tab" aria-selected={!shape} className={`shape-chip${!shape ? ' on' : ''}`} onClick={() => setShape('')}>
              <span style={{ fontSize: 20 }}>✦</span><b>الكل</b><span dir="ltr">{ct(d.totals.carats)} ct</span>
            </button>
            {d.shapes.map((g) => (
              <button key={g.id} type="button" role="tab" aria-selected={shape === String(g.id)} className={`shape-chip${shape === String(g.id) ? ' on' : ''}`} onClick={() => setShape(String(g.id))}>
                <ShapeIcon icon={g.icon} size={22} /><b>{g.name}</b><span dir="ltr">{ct(g.carats)} ct</span>
              </button>
            ))}
          </div>

          {!shapes.length && <div className="text-center text-body-secondary py-5">لا توجد أصناف مطابقة</div>}
          <div className="stock-cols">
            {[shapes.filter(isRight), shapes.filter((g) => !isRight(g))].filter((col) => col.length).map((col, ci) => (
            <div key={ci} className="stock-col">
            {col.map((g) => (
              <section key={g.id} className="stock-sec">
                <header>
                  <span className="stock-ic"><ShapeIcon icon={g.icon} size={26} /></span>
                  <h2>{g.name}</h2>
                  <span className="stock-sum"><b dir="ltr">{ct(g.items.reduce((a, it) => a + it.carats, 0))} ct</b> · {g.items.length} مقاس</span>
                </header>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0 stock-table keep">
                    <thead><tr><th>المقاس</th><th>اللون / النقاء</th><th className="text-end">المتوفر (قيراط)</th><th className="text-end">الحبات</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {g.items.map((it, i) => (
                        <tr key={i} className={it.status === 'out' ? 'is-out' : ''}>
                          <td><b dir="ltr">{it.size || '—'}</b></td>
                          <td className="small">{[it.color, it.clarity].filter(Boolean).join(' · ') || <span className="text-body-secondary">{it.type}</span>}</td>
                          <td className="text-end fw-bold" dir="ltr">{ct(it.carats)}</td>
                          <td className="text-end" dir="ltr">{it.count ? it.count.toLocaleString('en-US') : '—'}</td>
                          <td><span className={`stock-badge ${STATUS[it.status][1]}`}>{STATUS[it.status][0]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            </div>
            ))}
          </div>
          <p className="small text-body-secondary text-center mt-3">
            عرض فقط · يتحدث تلقائياً كل دقيقة · آخر تحديث للمخزون {d.last_movement_at ? fmtDT(d.last_movement_at) : '—'}
          </p>
        </>}
      </main>
    </div>
  );
}
