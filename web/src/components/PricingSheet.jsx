import { useMemo, useState } from 'react';
import { SECTIONS, COLUMNS, calc, money, withOverrides } from '../pricingSheet.js';

const toNum = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/**
 * جدول التسعيرة.
 * mode="public": الأوزان فقط قابلة للإدخال (لا تُحفظ)، وكل شيء آخر للعرض.
 * mode="admin": تعديل الثوابت (المصنعية، الفائدة، سعر القيراط...) والأوزان الافتراضية، عبر onRowsChange.
 */
export default function PricingSheet({ data, mode = 'public', rows: rowsProp, onRowsChange }) {
  const admin = mode === 'admin';
  const saved = admin ? rowsProp : data.rows;
  const [weights, setWeights] = useState({});
  const gold18 = (Number(data.gold24) || 0) * 18 / 24;

  const setW = (id, k, v) => {
    if (admin) onRowsChange({ ...saved, [id]: { ...(saved?.[id] || {}), [k]: toNum(v) } });
    else setWeights((w) => ({ ...w, [id]: { ...(w[id] || {}), [k]: toNum(v) } }));
  };
  const setConst = (id, k, v) => onRowsChange({ ...saved, [id]: { ...(saved?.[id] || {}), [k]: toNum(v) } });

  const sections = useMemo(() => SECTIONS.map((s) => ({ ...s, rows: s.rows.map((r) => withOverrides(r, saved)) })), [saved]);

  return (
    <div className="pricing">
      <div className="pricing-gold">
        <div><span>سعر الذهب الصافي 24</span><b>{money(Number(data.gold24))}</b></div>
        <div><span>سعر الذهب عيار 18</span><b>{money(gold18)}</b></div>
        <div><span>آخر تحديث</span><b>{data.updated_at || '—'}</b></div>
      </div>
      {sections.map((s) => (
        <section key={s.id} className="pricing-sec">
          <h2>{s.title}</h2>
          <div className="table-responsive">
            <table className="table table-bordered table-sm align-middle pricing-table keep">
              <thead><tr>{COLUMNS[s.kind].map(([k, label, type]) => <th key={k} className={type === 'input' ? 'col-in' : ''}>{label}</th>)}</tr></thead>
              <tbody>
                {s.rows.map((r0) => {
                  const r = admin ? r0 : { ...r0, ...Object.fromEntries(Object.entries(weights[r0.id] || {}).filter(([, v]) => v !== '')) };
                  const v = calc(s.kind, r, data.gold24, data.vat ?? 15);
                  return (
                    <tr key={r.id}>
                      {COLUMNS[s.kind].map(([k, , type]) => {
                        if (k === 'name') return <th key={k} scope="row">{r.name}</th>;
                        if (type === 'input') {
                          const cur = admin ? (saved?.[r.id]?.[k] ?? r0[k]) : (weights[r.id]?.[k] ?? '');
                          return (
                            <td key={k} className="col-in">
                              <input className="form-control form-control-sm" inputMode="decimal" dir="ltr" value={cur} placeholder={admin ? '' : String(r0[k])}
                                onChange={(e) => setW(r.id, k, e.target.value)} aria-label={`${r.name} - ${k === 'e' ? 'الوزن' : 'الوزن/العدد'}`} />
                            </td>
                          );
                        }
                        if (admin && type && type.startsWith('const')) {
                          const field = type.split(':')[1] || k;
                          return <td key={k}><input className="form-control form-control-sm pricing-const" inputMode="decimal" dir="ltr" value={saved?.[r.id]?.[field] ?? r0[field] ?? ''} onChange={(e) => setConst(r.id, field, e.target.value)} /></td>;
                        }
                        return <td key={k} className={['m', 'l', 'k'].includes(k) && k === (s.kind === 'diamond' ? 'm' : s.kind === 'gold' ? 'k' : 'l') ? 'pricing-total' : ''} dir="ltr">{money(v[k])}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {admin && s.kind === 'diamond' && (
            <div className="small text-body-secondary d-flex flex-wrap gap-3">
              {s.rows.map((r) => (
                <label key={r.id} className="d-flex align-items-center gap-1">{r.name}: سعر القيراط
                  <input className="form-control form-control-sm" style={{ width: 80 }} dir="ltr" value={saved?.[r.id]?.ct ?? r.ct} onChange={(e) => setConst(r.id, 'ct', e.target.value)} />
                  {r.base != null
                    ? <>الفائدة الأساسية <input className="form-control form-control-sm" style={{ width: 70 }} dir="ltr" value={saved?.[r.id]?.base ?? r.base} onChange={(e) => setConst(r.id, 'base', e.target.value)} />
                      + لكل قيراط فوق 3 <input className="form-control form-control-sm" style={{ width: 70 }} dir="ltr" value={saved?.[r.id]?.step ?? r.step} onChange={(e) => setConst(r.id, 'step', e.target.value)} /></>
                    : <>الفائدة <input className="form-control form-control-sm" style={{ width: 70 }} dir="ltr" value={saved?.[r.id]?.profit ?? r.profit} onChange={(e) => setConst(r.id, 'profit', e.target.value)} /></>}
                </label>
              ))}
            </div>
          )}
          {admin && s.kind === 'pearl' && (
            <div className="small text-body-secondary d-flex flex-wrap gap-3">
              {s.rows.map((r) => (
                <label key={r.id} className="d-flex align-items-center gap-1">{r.name}: السعر
                  <input className="form-control form-control-sm" style={{ width: 70 }} dir="ltr" value={saved?.[r.id]?.pp ?? r.pp} onChange={(e) => setConst(r.id, 'pp', e.target.value)} />
                  {r.per > 1 ? `لكل ${r.per} سم` : 'للحبة'}
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
      {!admin && <p className="small text-body-secondary">اكتب الأوزان في الخانات البيضاء لحساب السعر. القيم لا تُحفظ ولا تؤثر على أحد.</p>}
    </div>
  );
}
