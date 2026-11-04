import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtW, fmtDate, fmtMoney } from '../../format.js';
import { Loader, useFetch } from '../../ui.jsx';

const monthName = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { month: 'long', year: 'numeric' });

/** شاشة العجز للعامل: لكل طلب العجز، وما يُحمَّل على حسابه بعد النسبة المسموحة للمرحلة */
export default function WLosses() {
  const [month, setMonth] = useState('');
  const { data } = useFetch(`/w/losses${month ? `?month=${month}` : ''}`, { deps: [month], live: ['settlements'] });
  if (!data) return <Loader />;
  const months = [...new Set([data.month, ...data.months])].sort().reverse();
  return (
    <div className="wk-body">
      <div className="chips mb-2" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
        {months.map((m) => <button key={m} type="button" className={`chip ${m === data.month ? 'on' : ''}`} onClick={() => setMonth(m)}>{monthName(m)}</button>)}
      </div>
      <div className="card card-body loss-sum">
        <div><span>العجز على حسابي</span><b dir="ltr" className={data.totals.charged > 0 ? 'text-danger' : ''}>{fmtW(data.totals.charged)} <small>جم</small></b></div>
        <div><span>إجمالي العجز</span><b dir="ltr">{fmtW(data.totals.actual)} <small>جم</small></b></div>
        <div><span>المسموح (على المصنع)</span><b dir="ltr">{fmtW(data.totals.normal)} <small>جم</small></b></div>
      </div>
      {data.advance
        ? <div className="alert alert-warning py-2 small mb-2">سُجّل عجز هذا الشهر سلفة بقيمة <b>{fmtMoney(data.advance.amount)}</b> تُخصم من الراتب.</div>
        : data.totals.charged > 0 && <div className="small text-body-secondary mb-2">العجز الزائد عن نسبة المرحلة يبقى على حسابك حتى نهاية الشهر، ثم يُسجَّل سلفة تُخصم من الراتب.</div>}
      {!data.rows.length && <div className="text-center text-body-secondary py-5">لا يوجد عجز في هذا الشهر</div>}
      <div className="loss-list">
        {data.rows.map((r) => {
          const body = (
            <>
              <div className="loss-main">
                <b dir="ltr">{r.order_no}</b>
                <span className="small text-body-secondary">{r.stage_name} · {fmtDate(r.received_at)}</span>
              </div>
              <div className="loss-val">
                <span className="small text-body-secondary">العجز</span>
                <b dir="ltr">{fmtW(r.actual_loss)}</b>
              </div>
              <div className={`loss-val ${Number(r.charged) > 0 ? 'bad' : 'ok'}`}>
                <span className="small">{Number(r.charged) > 0 ? 'على حسابي' : 'ضمن المسموح'}</span>
                <b dir="ltr">{Number(r.charged) > 0 ? fmtW(r.charged) : '✓'}</b>
              </div>
            </>
          );
          return r.order_id
            ? <Link key={r.settlement_id} to={`/w/orders/${r.order_id}`} className="loss-row">{body}</Link>
            : <div key={r.settlement_id} className="loss-row">{body}</div>;
        })}
      </div>
    </div>
  );
}
