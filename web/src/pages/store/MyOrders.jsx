import { useNavigate, useLocation } from 'react-router-dom';
import { fileUrl } from '../../api.js';
import { fmtDate, fmtMoney, STATUS } from '../../format.js';
import { Loader, Page, StatusBadge, useFetch, Empty } from '../../ui.jsx';

export default function MyOrders() {
  const nav = useNavigate();
  const loc = useLocation();
  const { data } = useFetch('/store/orders', { live: ['orders'] });
  if (!data) return <Loader />;
  return (
    <Page title="طلباتي">
      {loc.state?.cart && <div className="alert alert-ok mb">تم إرسال الطلب {loc.state.cart} - سيراجعه المصنع ويؤكده.</div>}
      {!data.length && <Empty>لا توجد طلبات بعد</Empty>}
      <div className="grid">
        {data.map((o) => {
          const pct = o.total_stages && o.stage_seq ? Math.round((100 * (o.status === 'delivered' ? o.total_stages : o.stage_seq - 1)) / o.total_stages) : 0;
          const img = o.image || o.product_image;
          return (
            <button key={o.id} className="card card-b row gap" style={{ textAlign: 'right', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => nav(`/store/orders/${o.id}`)}>
              <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', background: 'var(--gold-soft)', flex: 'none', display: 'grid', placeItems: 'center', color: 'var(--gold)' }}>{img ? <img src={fileUrl(img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '◇'}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row between wrap gap"><b>{o.order_no} — {o.title}</b><StatusBadge map={STATUS} value={o.status} /></div>
                <div className="small muted">{o.material_name} · الكمية {o.quantity} · {fmtDate(o.created_at)}{o.labor_estimate ? ` · أجور تقديرية ${fmtMoney(o.labor_estimate)}` : ''}</div>
                {o.status === 'quoted' && <div className="small" style={{ color: 'var(--warn)' }}>عرض أجور بانتظار موافقتكم</div>}
                {o.design_status === 'sent' && <div className="small" style={{ color: 'var(--warn)' }}>تصميم بانتظار اعتمادكم</div>}
                {['in_production', 'ready', 'delivered'].includes(o.status) && <div className="row gap small mt" style={{ marginTop: 6 }}><div className="progress grow"><div style={{ width: `${pct}%` }} /></div><span>{pct}%</span><span className="muted">{o.stage_name}</span></div>}
              </div>
            </button>
          );
        })}
      </div>
    </Page>
  );
}
