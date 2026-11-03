import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { money } from '../pricingSheet.js';

const toNum = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/** التسعيرة المختصرة: المنتج والأوزان والسعر الشامل فقط. الحساب على الخادم فلا تصل التكاليف أو الفائدة لجهاز الزائر */
export default function ShortPricing({ token, initial }) {
  const [sections, setSections] = useState(initial);
  const [weights, setWeights] = useState({});
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (!Object.keys(weights).length) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try { setSections((await api.post(`/public/pricing/${encodeURIComponent(token)}/calc`, { weights })).sections); } catch { /* يبقى آخر حساب */ } finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [weights, token]);
  const setW = (id, k, v) => setWeights((w) => ({ ...w, [id]: { ...(w[id] || {}), [k]: toNum(v) } }));
  return (
    <div className="pricing">
      {sections.map((s) => (
        <section key={s.id} className="pricing-sec">
          <h2>{s.title}</h2>
          <div className="table-responsive">
            <table className="table table-bordered table-sm align-middle pricing-table pricing-short keep">
              <thead><tr>{s.columns.map(([k, label, type]) => <th key={k} className={type === 'input' ? 'col-in' : ''}>{label}</th>)}</tr></thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.id}>
                    {s.columns.map(([k, , type], i) => {
                      if (k === 'name') return <th key={k} scope="row">{r.name}</th>;
                      if (type === 'input') return (
                        <td key={k} className="col-in">
                          <input className="form-control form-control-sm" inputMode="decimal" dir="ltr" value={weights[r.id]?.[k] ?? ''} placeholder={String(r.defaults[k])}
                            onChange={(e) => setW(r.id, k, e.target.value)} aria-label={`${r.name}`} />
                        </td>
                      );
                      const last = i === s.columns.length - 1;
                      return <td key={k} dir="ltr" className={last ? `pricing-total${busy ? ' opacity-50' : ''}` : ''}>{money(r.values[k])}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="small text-body-secondary">اكتب الأوزان في الخانات الصفراء لحساب السعر. القيم لا تُحفظ ولا تؤثر على أحد.</p>
    </div>
  );
}
