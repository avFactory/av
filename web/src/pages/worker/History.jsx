import { useState } from 'react';
import { fmtW, fmtDate, fmtDT, CUSTODY_STATUS, KINDS } from '../../format.js';
import { Loader, StatusBadge, useFetch, Empty, Tabs, Badge } from '../../ui.jsx';
import { t, tMat } from '../../i18n.js';

/** سجل العامل: طلباتي (كل عهدة وما بقي منها) + حركات الذهب (كل ما دخل وخرج مع الرصيد) */
export default function WHistory() {
  const [tab, setTab] = useState('orders');
  return (
    <div className="wk-body">
      <h2>{t('سجلي')}</h2>
      <Tabs value={tab} onChange={setTab} tabs={[['orders', t('طلباتي')], ['moves', t('حركات الذهب')]]} />
      {tab === 'orders' ? <Orders /> : <Moves />}
    </div>
  );
}

function Orders() {
  const { data } = useFetch('/w/history', { live: ['custodies', 'settlements'] });
  if (!data) return <Loader />;
  if (!data.length) return <Empty>{t('لا توجد طلبات في سجلك بعد')}</Empty>;
  return data.map((c) => {
    const handed = Number(c.handed_partial || 0);
    const left = Number(c.weight_issued) - Number(c.weight_used || 0);
    return (
      <div key={c.id} className="task">
        <div className="task-h"><b>{t(c.order_no)}</b><StatusBadge map={CUSTODY_STATUS} value={c.status} /></div>
        <div className="small">{t(c.title)} · {t(c.stage_name)}</div>
        <div className="calc">
          <div><span>{t('استلمت')}</span><b>{fmtW(c.weight_issued)}</b></div>
          {handed > 0 && <div><span>{t('سلّمت للمشرف جزئياً')}</span><b>{fmtW(handed)}</b></div>}
          {c.status === 'open' ? <div><span>{t('المتبقي لديك')}</span><b>{fmtW(left)}</b></div> : <div><span>{t('أرجعت')}</span><b>{fmtW(c.returned_weight)}</b></div>}
          {c.status !== 'open' && <div><span>{t('بقايا')}</span><b>{fmtW(c.scrap_weight)}</b></div>}
          {c.status !== 'open' && <div className={Number(c.abnormal_loss) > 0 ? 'bad' : ''}><span>{t('العجز')}</span><b>{fmtW(c.actual_loss)}</b></div>}
        </div>
        {c.corrections > 0 && <div className="small text-body-secondary">↩ {t('صُحّح الاستلام وأُعيد الذهب لعهدتك')}</div>}
        <div className="small muted">{fmtDate(c.issued_at)}{c.closed_at ? ` ← ${fmtDate(c.closed_at)}` : ''}</div>
      </div>
    );
  });
}

function Moves() {
  const { data } = useFetch('/w/movements', { live: ['gold_ledger'] });
  if (!data) return <Loader />;
  if (!data.length) return <Empty>{t('لا توجد حركات ذهب بعد')}</Empty>;
  // الرصيد بعد كل حركة (من الأقدم للأحدث) لكل عيار
  const bal = {};
  const withBal = [...data].reverse().map((m) => { bal[m.karat] = (bal[m.karat] || 0) + m.dir * Number(m.weight); return { ...m, after: bal[m.karat] }; }).reverse();
  return (
    <div className="d-grid gap-2">
      <div className="small text-body-secondary">{t('كل جرام دخل عهدتك (＋) أو خرج منها (−)، والرصيد لديك بعد كل حركة.')}</div>
      {withBal.map((m) => {
        const label = m.kind === 'reversal' ? `${t('تصحيح: إلغاء')} ${t(KINDS[m.reverses_kind] || m.reverses_kind || '')}` : t(KINDS[m.kind] || m.kind);
        return (
          <div key={m.id} className="task" style={m.reversed ? { opacity: 0.55 } : undefined}>
            <div className="task-h">
              <b>{label}</b>
              <b dir="ltr" style={{ color: m.dir > 0 ? 'var(--ok)' : 'var(--bad)' }}>{m.dir > 0 ? '+' : '−'}{fmtW(m.weight)} {t('جم')}</b>
            </div>
            <div className="small">{t(m.order_no) || '—'} · {tMat(m.material_name)}{m.reversed && <Badge tone="muted">{t('أُلغيت بتصحيح')}</Badge>}</div>
            {m.reason && <div className="small text-body-secondary">{m.reason}</div>}
            <div className="small muted d-flex justify-content-between"><span>{fmtDT(m.created_at)}</span><span>{t('الرصيد بعدها')}: <b dir="ltr">{fmtW(m.after)}</b> ({m.karat}K)</span></div>
          </div>
        );
      })}
    </div>
  );
}
