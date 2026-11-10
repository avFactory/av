import { Link } from 'react-router-dom';
import { fileUrl } from '../../api.js';
import { fmtW, fmtDate, WORK_STATE } from '../../format.js';
import { Badge, Loader, Empty, useFetch } from '../../ui.jsx';
import { useAuth } from '../../auth.jsx';
import Queue3d from './Queue3d.jsx';

export default function WHome() {
  const { data } = useFetch('/w/tasks', { live: ['custodies', 'orders'] });
  const { me } = useAuth();
  if (!data) return <Loader />;
  const { custodies, tasks } = data;
  const total = custodies.filter((c) => c.status === 'open').reduce((s, c) => s + Number(c.weight_issued), 0);
  return (
    <div className="wk-body">
      <div className="card card-body hrow between"><span className="muted">الذهب في عهدتي</span><b dir="ltr" style={{ fontSize: '1.4rem' }}>{fmtW(total)} جم</b></div>
      {me?.is_3d && <Queue3d />}
      {!custodies.length && !tasks.length && !me?.is_3d && <Empty>لا توجد مهام مسندة إليك حالياً</Empty>}
      {custodies.map((c) => (
        <Link key={c.id} to={`/w/custody/${c.id}`} className="task">
          <div className="task-h">
            <div className="hrow gap">
              {c.thumb ? <img src={fileUrl(c.thumb, 400)} alt="" /> : null}
              <div><b>{c.order_no}</b><div className="muted small">{c.title}</div></div>
            </div>
            {c.status === 'under_review' ? <Badge tone="warn">تحت المراجعة</Badge> : !c.worker_ack_at ? <Badge tone="bad">{c.worker_rejected_at ? 'رفضتها - بانتظار المشرف' : 'بانتظار قبولك'}</Badge> : <Badge tone={c.work_state === 'finished' ? 'ok' : 'gold'}>{WORK_STATE[c.work_state]}</Badge>}
          </div>
          <div className="hrow between small"><span>المرحلة: <b>{c.stage_name}</b></span><span dir="ltr"><b>{fmtW(c.weight_issued)}</b> جم</span></div>
          <div className="hrow between small muted"><span>{c.material_name}</span><span>{c.due_date ? `التسليم ${fmtDate(c.due_date)}` : ''}</span></div>
        </Link>
      ))}
      {tasks.map((t) => (
        <Link key={t.order_id} to={`/w/orders/${t.order_id}`} className="task">
          <div className="task-h"><div className="hrow gap">{t.thumb ? <img src={fileUrl(t.thumb, 400)} alt="" /> : null}<div><b>{t.order_no}</b><div className="muted small">{t.title}</div></div></div><Badge tone="info">{t.stage_name}</Badge></div>
          {t.stage_state === 'pending_approval' && <span className="small muted">بانتظار اعتماد المشرف</span>}
        </Link>
      ))}
    </div>
  );
}
