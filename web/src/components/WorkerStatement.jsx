import { useState } from 'react';
import { fmtW, fmtDT } from '../format.js';
import { Btn, Input, Loader, Select, useFetch } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

/**
 * كشف حساب العامل/الماكينة بالذهب:
 * مدين = ذهب دخل حسابه (مسلَّم له منا أو محوّل له من عامل آخر)، دائن = ذهب خرج منه (مستلم منه لنا أو محوّل لعامل آخر أو عجز مثبت)،
 * والرصيد بعد كل حركة لكل عيار وبالصافي عيار 24، مع الإجمالي — طباعة وتصدير Excel.
 */
export default function WorkerStatement({ worker }) {
  const { lookups } = useAuth();
  const [f, setF] = useState({ from: '', to: '', material: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data } = useFetch(`/sup/workers/${worker.id}/statement${qs ? `?${qs}` : ''}`, { deps: [qs], live: ['gold_ledger'] });
  const one = !!f.material || (data && new Set(data.rows.map((r) => r.material_id)).size <= 1);
  return (
    <div className="card worker-stmt">
      <div className="card-body d-flex flex-wrap gap-2 align-items-end no-print">
        <label className="d-grid small">من<Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="d-grid small">إلى<Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="d-grid small">العيار<Select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} placeholder="كل العيارات" options={(lookups?.materials || []).map((m) => [m.id, m.name])} /></label>
        {(f.from || f.to || f.material) && <Btn kind="ghost" size="sm" onClick={() => setF({ from: '', to: '', material: '' })}>كل الفترات</Btn>}
        <span className="ms-auto d-flex gap-2">
          <Btn kind="ghost" onClick={() => window.print()}>🖨 طباعة</Btn>
          <a className="btn btn-outline-success" href={`/api/sup/workers/${worker.id}/statement.xlsx${qs ? `?${qs}` : ''}`}>⬇ تصدير Excel</a>
        </span>
      </div>
      <div className="print-only p-3"><h2 className="h5 m-0">كشف حساب {worker.kind === 'machine' ? 'الماكينة' : 'العامل'}: {worker.full_name} {worker.employee_no ? `(${worker.employee_no})` : ''}</h2>
        <div className="small">{f.from || f.to ? `الفترة: ${f.from || '…'} — ${f.to || 'اليوم'}` : 'كل الفترات'} · طُبع {fmtDT(new Date())}</div></div>
      {!data ? <Loader /> : (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0 stmt-table">
            <thead><tr><th>التاريخ</th><th>رقم الحركة</th><th>البيان</th><th>الطلب</th>{!one && <th>العيار</th>}<th className="n">مدين (له)</th><th className="n">دائن (منه)</th><th className="n">الرصيد</th><th className="n">الرصيد صافي 24</th></tr></thead>
            <tbody>
              {data.from && (
                <tr className="table-light"><td colSpan={one ? 4 : 5}><b>رصيد افتتاحي قبل {data.from}</b> {!one && <span className="small text-body-secondary">{data.opening.map((o) => `${o.name}: ${fmtW(o.weight)}`).join(' · ')}</span>}</td>
                  <td /><td /><td className="n">{one && data.opening[0] ? fmtW(data.opening[0].weight) : ''}</td><td className="n">{fmtW(data.opening_pure)}</td></tr>
              )}
              {!data.rows.length && <tr><td colSpan={9} className="text-center text-body-secondary py-4">لا توجد حركات في هذه الفترة</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.id} className={r.reversed ? 'text-body-secondary' : ''}>
                  <td className="small text-nowrap">{fmtDT(r.created_at)}</td>
                  <td className="small" dir="ltr">{r.movement_no}</td>
                  <td><b>{r.label}</b>{r.party && <span className="small text-body-secondary"> · {r.party}</span>}{r.reversed && <span className="badge text-bg-light border ms-1">أُلغيت بتصحيح</span>}{r.reason && <div className="small text-body-secondary">{r.reason}</div>}</td>
                  <td className="small" dir="ltr">{r.order_no || '—'}</td>
                  {!one && <td className="small">{r.material_name}</td>}
                  <td className="n text-success">{r.debit ? fmtW(r.debit) : ''}</td>
                  <td className="n text-danger">{r.credit ? fmtW(r.credit) : ''}</td>
                  <td className="n fw-semibold">{fmtW(r.balance)}</td>
                  <td className="n">{fmtW(r.balance_pure)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="stmt-total">
                <td colSpan={one ? 4 : 5}><b>الإجمالي</b> <span className="small text-body-secondary">({data.rows.length} حركة)</span></td>
                <td className="n text-success"><b>{fmtW(data.totals.debit)}</b></td>
                <td className="n text-danger"><b>{fmtW(data.totals.credit)}</b></td>
                <td className="n"><b>{one ? fmtW(data.totals.balances[0]?.weight || 0) : ''}</b></td>
                <td className="n"><b>{fmtW(data.totals.balance_pure)}</b></td>
              </tr>
              <tr className="stmt-final"><td colSpan={9}>
                <b>الرصيد النهائي لدى {worker.full_name}:</b>{' '}
                {data.totals.balances.length ? data.totals.balances.map((b) => <span key={b.material_id} className="me-3"><b dir="ltr">{fmtW(b.weight)}</b> جم {b.name}</span>) : <b>0.000</b>}
                <span className="me-3">= <b dir="ltr">{fmtW(data.totals.balance_pure)}</b> جم صافي عيار 24</span>
              </td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
