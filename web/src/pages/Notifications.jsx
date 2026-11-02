import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDT } from '../format.js';
import { Btn, Empty, Loader, useFetch } from '../ui.jsx';

export default function Notifications() {
  const nav = useNavigate();
  const { data, reload } = useFetch('/notifications', { live: ['notifications'] });
  if (!data) return <Loader />;
  const open = async (n) => { if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] }); if (n.link) nav(n.link.split('#')[0]); else reload(); };
  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <div className="page-h"><h1>الإشعارات</h1><Btn kind="ghost" onClick={async () => { await api.post('/notifications/read', {}); reload(); }}>تعليم الكل كمقروء</Btn></div>
      {!data.length && <Empty>لا توجد إشعارات</Empty>}
      <div className="grid" style={{ gap: 8 }}>
        {data.map((n) => (
          <button key={n.id} onClick={() => open(n)} className="card card-b" style={{ textAlign: 'right', cursor: 'pointer', font: 'inherit', color: 'inherit', borderInlineStart: n.read_at ? undefined : '4px solid var(--gold)' }}>
            <div className="row between"><b>{n.title}</b><span className="small muted">{fmtDT(n.created_at)}</span></div>
            {n.body && <div className="small muted">{n.body}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
