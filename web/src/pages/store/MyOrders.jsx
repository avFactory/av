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
      {loc.state?.cart && <div className="alert alert-success mb">تم إرسال الطلب {loc.state.cart} - سيراجعه المصنع ويؤكده.</div>}
      {!data.length && <Empty>لا توجد طلبات بعد</Empty>}
      <div className="grid">
        {groups(data).map((g) => (g.items.length === 1 ? <OrderCard key={g.key} o={g.items[0]} nav={nav} /> : (
          <div key={g.key} className="card">
            <div className="card-header bg-transparent hrow between wrap gap">
              <div><b dir="ltr">{g.key}</b> <span className="small muted">· {g.items.length} أصناف · {fmtDate(g.items[0].created_at)}{g.items[0].branch_name ? ` · ${g.items[0].branch_name}` : ''}</span></div>
              <span className="small muted">إجمالي القطع {g.items.reduce((a, o) => a + Number(o.quantity || 0), 0)}</span>
            </div>
            <div className="grid p-2" style={{ gap: 6 }}>{g.items.map((o) => <OrderCard key={o.id} o={o} nav={nav} compact />)}</div>
          </div>
        )))}
      </div>
    </Page>
  );
}

/** تجميع بنود الطلب الواحد (نفس رقم الطلب) */
function groups(data) {
  const m = new Map();
  for (const o of data) {
    const k = o.cart_ref || o.order_no;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return [...m].map(([key, items]) => ({ key, items: items.sort((a, b) => a.id - b.id) }));
}

function OrderCard({ o, nav, compact }) {
  const pct = o.total_stages && o.stage_seq ? Math.round((100 * (o.status === 'delivered' ? o.total_stages : o.stage_seq - 1)) / o.total_stages) : 0;
  const img = o.image || o.product_image;
  const size = compact ? 48 : 64;
  return (
    <button className={`card card-body hrow gap ${compact ? 'py-2 shadow-none' : ''}`} style={{ textAlign: 'right', cursor: 'pointer', font: 'inherit', color: 'inherit', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' }} onClick={() => nav(`/store/orders/${o.id}`)}>
      <div style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', background: 'var(--gold-soft)', flex: 'none', display: 'grid', placeItems: 'center', color: 'var(--gold)' }}>{img ? <img src={fileUrl(img, 400)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '◇'}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="hrow between wrap gap"><b>{o.order_no} — {o.title}</b><StatusBadge map={STATUS} value={o.status} /></div>
        <div className="small muted">{!compact && o.branch_name ? `${o.branch_name} · ` : ''}{o.material_name} · الكمية {o.quantity}{compact ? '' : ` · ${fmtDate(o.created_at)}`}{Number(o.labor_estimate) > 0 ? ` · أجور تقديرية ${fmtMoney(o.labor_estimate)}` : ''}</div>
        {o.status === 'quoted' && <div className="small" style={{ color: 'var(--warn)' }}>عرض أجور بانتظار موافقتكم</div>}
        {o.design_status === 'sent' && <div className="small" style={{ color: 'var(--warn)' }}>تصميم بانتظار اعتمادكم</div>}
        {['in_production', 'ready', 'delivered'].includes(o.status) && <div className="hrow gap small mt" style={{ marginTop: 6 }}><div className="progress grow"><div style={{ width: `${pct}%` }} /></div><span>{pct}%</span><span className="muted">{o.stage_name}</span></div>}
      </div>
    </button>
  );
}
