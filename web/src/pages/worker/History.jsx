import { fmtW, fmtDate, CUSTODY_STATUS } from '../../format.js';
import { Loader, StatusBadge, useFetch, Empty } from '../../ui.jsx';

export default function WHistory() {
  const { data } = useFetch('/w/history');
  if (!data) return <Loader />;
  return (
    <div className="wk-body">
      <h2>سجل طلباتي</h2>
      {!data.length && <Empty />}
      {data.map((c) => (
        <div key={c.id} className="task">
          <div className="task-h"><b>{c.order_no}</b><StatusBadge map={CUSTODY_STATUS} value={c.status} /></div>
          <div className="small">{c.title} · {c.stage_name}</div>
          <div className="calc">
            <div><span>استلمت</span><b>{fmtW(c.weight_issued)}</b></div>
            <div><span>أرجعت</span><b>{fmtW(c.returned_weight)}</b></div>
            <div><span>بقايا</span><b>{fmtW(c.scrap_weight)}</b></div>
            <div><span>العجز</span><b>{fmtW(c.actual_loss)}</b></div>
          </div>
          <div className="small muted">{fmtDate(c.issued_at)}{c.closed_at ? ` ← ${fmtDate(c.closed_at)}` : ''}</div>
        </div>
      ))}
    </div>
  );
}
