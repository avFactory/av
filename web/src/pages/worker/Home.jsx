import { Link } from 'react-router-dom';
import { fileUrl } from '../../api.js';
import { fmtW, fmtDate, WORK_STATE } from '../../format.js';
import { Badge, Loader, Empty, useFetch } from '../../ui.jsx';
import { useAuth } from '../../auth.jsx';
import Queue3d from './Queue3d.jsx';
import { IncomingTransfers } from '../../components/TransferTools.jsx';
import { t, tMat } from '../../i18n.js';

export default function WHome() {
  const { data } = useFetch('/w/tasks', { live: ['custodies', 'orders'] });
  const { me } = useAuth();
  const { data: trs, reload: reloadTr } = useFetch('/w/transfers', { live: ['custodies', 'custody_transfers'] });
  const { data: held } = useFetch('/w/held', { live: ['settlements', 'gold_ledger'] });
  if (!data) return <Loader />;
  const { custodies, tasks } = data;
  const total = custodies.filter((c) => c.status === 'open').reduce((s, c) => s + Number(c.weight_issued), 0);
  return (
    <div className="wk-body">
      <div className="card card-body">
        <div className="hrow between"><span className="muted">{t('الذهب في عهدتي')}</span><b dir="ltr" style={{ fontSize: '1.4rem' }}>{fmtW(total)} {t('جم')}</b></div>
        {Number(held?.held) !== 0 && held && (
          <Link to="/w/losses" className="hrow between small mt-2 pt-2 border-top" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className={Number(held.held) > 0 ? 'text-danger' : ''}>{t('عجز الشهر في حسابي (يُثبَّت نهاية الشهر)')}</span><b dir="ltr">{fmtW(held.held)} {t('جم')}</b>
          </Link>
        )}
      </div>
      <IncomingTransfers items={trs?.incoming} onChange={() => { reloadTr(); }} />
      {me?.is_3d && <Queue3d />}
      {!custodies.length && !tasks.length && !me?.is_3d && <Empty>{t('لا توجد مهام مسندة إليك حالياً')}</Empty>}
      {custodies.map((c) => (
        <Link key={c.id} to={`/w/custody/${c.id}`} className="task">
          <div className="task-h">
            <div className="hrow gap">
              {c.thumb ? <img src={fileUrl(c.thumb, 400)} alt="" /> : null}
              <div><b>{t(c.order_no)}</b><div className="muted small">{t(c.title)}</div></div>
            </div>
            {c.status === 'under_review' ? <Badge tone="warn">{t('تحت المراجعة')}</Badge> : !c.worker_ack_at ? <Badge tone="bad">{t(c.worker_rejected_at ? 'رفضتها - بانتظار المشرف' : 'بانتظار قبولك')}</Badge> : <Badge tone={c.work_state === 'finished' ? 'ok' : 'gold'}>{t(WORK_STATE[c.work_state])}</Badge>}
          </div>
          <div className="hrow between small"><span>{t('المرحلة')}: <b>{t(c.stage_name)}</b></span><span dir="ltr"><b>{fmtW(c.weight_issued)}</b> {t('جم')}</span></div>
          <div className="hrow between small muted"><span>{tMat(c.material_name)}</span><span>{c.due_date ? `${t('التسليم')} ${fmtDate(c.due_date)}` : ''}</span></div>
        </Link>
      ))}
      {tasks.map((tk) => (
        <Link key={tk.order_id} to={`/w/orders/${tk.order_id}`} className="task">
          <div className="task-h"><div className="hrow gap">{tk.thumb ? <img src={fileUrl(tk.thumb, 400)} alt="" /> : null}<div><b>{tk.order_no}</b><div className="muted small">{tk.title}</div></div></div><Badge tone="info">{t(tk.stage_name)}</Badge></div>
          {tk.stage_state === 'pending_approval' && <span className="small muted">{t('بانتظار اعتماد المشرف')}</span>}
        </Link>
      ))}
    </div>
  );
}
