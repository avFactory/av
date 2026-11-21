import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDT } from '../format.js';
import { Btn, Empty, Loader, useFetch } from '../ui.jsx';
import { t } from '../i18n.js';

export default function Notifications() {
  const nav = useNavigate();
  const { data, reload } = useFetch('/notifications', { live: ['notifications'] });
  if (!data) return <Loader />;
  const open = async (n) => { if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] }); if (n.link) nav(n.link.split('#')[0]); else reload(); };
  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <div className="page-h"><h1>{t('الإشعارات')}</h1><Btn kind="ghost" onClick={async () => { await api.post('/notifications/read', {}); reload(); }}>{t('تعليم الكل كمقروء')}</Btn></div>
      {!data.length && <Empty>{t('لا توجد إشعارات')}</Empty>}
      <div className="grid" style={{ gap: 8 }}>
        {data.map((n) => (
          <button key={n.id} onClick={() => open(n)} className="card card-body" style={{ textAlign: 'start', cursor: 'pointer', font: 'inherit', color: 'inherit', borderInlineStart: n.read_at ? undefined : '4px solid var(--gold)' }}>
            <div className="hrow between"><b>{n.title}</b><span className="small muted">{fmtDT(n.created_at)}</span></div>
            {n.body && <div className="small muted">{n.body}</div>}
            {n.resolved_note && <div className="small mt-1"><span className="badge text-bg-success fw-normal">{n.resolved_note}</span></div>}
          </button>
        ))}
      </div>
    </div>
  );
}
