import { useState } from 'react';
import { fmtW, fmtDate } from '../format.js';
import { Btn, Input, Loader, Select, useFetch } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const time = (d) => new Date(d).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
const karatOf = (name) => (String(name || '').match(/\d+/) || [''])[0];
export const stmtQs = (f) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

/** طباعة صفحة عبر إطار مخفي (بدون فتح تبويب) — الصفحة تطبع نفسها عند ?auto=1 */
export function printUrl(url) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  const done = () => { window.removeEventListener('message', onMsg); setTimeout(() => f.remove(), 1500); };
  const onMsg = (e) => { if (e.origin === location.origin && e.data === 'page-printed') done(); };
  window.addEventListener('message', onMsg);
  setTimeout(done, 120000);
  f.src = url + (url.includes('?') ? '&' : '?') + 'auto=1';
  document.body.appendChild(f);
}

/** أرقام الملخص: افتتاحي، مدين، دائن، الرصيد النهائي */
export function StmtSummary({ data }) {
  return (
    <div className="stmt-sum">
      {data.from && <div><span>رصيد افتتاحي</span><b dir="ltr">{fmtW(data.opening_pure)}</b><small>صافي 24</small></div>}
      <div className="deb"><span>إجمالي المدين (له)</span><b dir="ltr">{fmtW(data.totals.debit)}</b><small>{fmtW(data.totals.debit_pure)} صافي 24</small></div>
      <div className="cre"><span>إجمالي الدائن (منه)</span><b dir="ltr">{fmtW(data.totals.credit)}</b><small>{fmtW(data.totals.credit_pure)} صافي 24</small></div>
      <div className="fin"><span>الرصيد النهائي</span><b dir="ltr">{fmtW(data.totals.balance_pure)}</b>
        <small>{data.totals.balances.length ? data.totals.balances.map((b) => `${fmtW(b.weight)} ${b.name}`).join(' · ') : 'لا يوجد رصيد'} · صافي 24</small></div>
    </div>
  );
}

/** جدول الكشف (مشترك بين الشاشة والطباعة) */
export function StmtTable({ data, one }) {
  const cols = one ? 8 : 9;
  return (
    <table className="stmt-table">
      <thead><tr>
        <th className="c-date">التاريخ</th><th className="c-no">رقم الحركة</th><th>البيان</th><th className="c-ord">الطلب</th>{!one && <th className="c-k">العيار</th>}
        <th className="n">مدين (له)</th><th className="n">دائن (منه)</th><th className="n">الرصيد</th><th className="n">صافي 24</th>
      </tr></thead>
      <tbody>
        {data.from && (
          <tr className="r-open"><td colSpan={cols - 2}><b>رصيد افتتاحي قبل {fmtDate(data.from)}</b>{!one && data.opening.length > 0 && <span className="sub"> · {data.opening.map((o) => `${o.name}: ${fmtW(o.weight)}`).join(' · ')}</span>}</td>
            <td className="n">{one && data.opening[0] ? fmtW(data.opening[0].weight) : ''}</td><td className="n">{fmtW(data.opening_pure)}</td></tr>
        )}
        {!data.rows.length && <tr><td colSpan={cols} className="empty">لا توجد حركات في هذه الفترة</td></tr>}
        {data.rows.map((r) => (
          <tr key={r.id} className={r.reversed ? 'r-rev' : r.kind === 'reversal' ? 'r-fix' : ''}>
            <td className="c-date"><span>{fmtDate(r.created_at)}</span><small>{time(r.created_at)}</small></td>
            <td className="c-no" dir="ltr">{r.movement_no}</td>
            <td className="c-desc">
              <div><b>{r.label}</b>{r.party && <span className={`party ${r.debit ? 'in' : 'out'}`}>{r.party}</span>}{r.reversed && <span className="party rev">أُلغيت بتصحيح</span>}</div>
              {r.reason && <small title={r.reason}>{r.reason}</small>}
            </td>
            <td className="c-ord" dir="ltr">{r.order_no || '—'}</td>
            {!one && <td className="c-k"><span className="kchip">{karatOf(r.material_name)}</span></td>}
            <td className="n deb">{r.debit ? fmtW(r.debit) : ''}</td>
            <td className="n cre">{r.credit ? fmtW(r.credit) : ''}</td>
            <td className="n bal">{fmtW(r.balance)}</td>
            <td className="n pure">{fmtW(r.balance_pure)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="r-tot">
          <td colSpan={cols - 4}><b>الإجمالي</b> <span className="sub">({data.rows.length} حركة)</span></td>
          <td className="n deb">{fmtW(data.totals.debit)}</td>
          <td className="n cre">{fmtW(data.totals.credit)}</td>
          <td className="n bal">{one ? fmtW(data.totals.balances[0]?.weight || 0) : ''}</td>
          <td className="n pure"><b>{fmtW(data.totals.balance_pure)}</b></td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * كشف حساب العامل/الماكينة بالذهب: مدين = دخل حسابه (منا أو محوّل له)، دائن = خرج منه (لنا أو لعامل آخر أو عجز مثبت)
 */
export default function WorkerStatement({ worker }) {
  const { lookups } = useAuth();
  const [f, setF] = useState({ from: '', to: '', material: '' });
  const qs = stmtQs(f);
  const { data } = useFetch(`/sup/workers/${worker.id}/statement${qs ? `?${qs}` : ''}`, { deps: [qs], live: ['gold_ledger'] });
  const one = !!f.material || (data && new Set(data.rows.map((r) => r.material_id)).size <= 1);
  return (
    <div className="card worker-stmt">
      <div className="stmt-bar">
        <label>من<Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>إلى<Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label>العيار<Select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} placeholder="كل العيارات" options={(lookups?.materials || []).map((m) => [m.id, m.name])} /></label>
        {(f.from || f.to || f.material) && <Btn kind="ghost" size="sm" onClick={() => setF({ from: '', to: '', material: '' })}>كل الفترات</Btn>}
        <span className="ms-auto d-flex gap-2">
          <Btn kind="ghost" onClick={() => printUrl(`/print/worker-statement/${worker.id}${qs ? `?${qs}` : ''}`)}>🖨 طباعة</Btn>
          <a className="btn btn-outline-success" href={`/api/sup/workers/${worker.id}/statement.xlsx${qs ? `?${qs}` : ''}`}>⬇ تصدير Excel</a>
        </span>
      </div>
      {!data ? <Loader /> : <>
        <StmtSummary data={data} />
        <div className="table-responsive"><StmtTable data={data} one={one} /></div>
      </>}
    </div>
  );
}
