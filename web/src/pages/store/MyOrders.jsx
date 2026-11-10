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
          <GroupCard key={g.key} g={g} nav={nav} open={loc.state?.cart === g.key} />
        )))}
      </div>
    </Page>
  );
}

/** طلب بأكثر من منتج: قائمة منسدلة (ملخص بالصور والعدد والحالة، وتفتح لعرض البنود) */
function GroupCard({ g, nav, open }) {
  const pieces = g.items.reduce((a, o) => a + Number(o.quantity || 0), 0);
  const labor = g.items.reduce((a, o) => a + Number(o.labor_estimate || 0), 0);
  const imgs = g.items.map((o) => o.image || o.product_image).filter(Boolean);
  const st = Object.entries(g.items.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {}));
  const action = g.items.some((o) => o.status === 'quoted' || o.design_status === 'sent');
  return (
    <details className="card order-group" open={open}>
      <summary className="card-body">
        <div className="og-thumbs">{imgs.slice(0, 4).map((p, i) => <img key={i} src={fileUrl(p, 400)} alt="" />)}{imgs.length > 4 && <span>+{imgs.length - 4}</span>}{!imgs.length && <span>◇</span>}</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="hrow between wrap gap"><b dir="ltr">{g.key}</b><span className="d-flex gap-1 flex-wrap">{st.map(([k, n]) => <span key={k} className="d-inline-flex align-items-center gap-1"><StatusBadge map={STATUS} value={k} />{st.length > 1 && <small className="muted">{n}</small>}</span>)}</span></div>
          <div className="small muted">{g.items.length} أصناف · {pieces} قطعة · {fmtDate(g.items[0].created_at)}{g.items[0].branch_name ? ` · ${g.items[0].branch_name}` : ''}{labor > 0 ? ` · أجور تقديرية ${fmtMoney(labor)}` : ''}</div>
          {action && <div className="small" style={{ color: 'var(--warn)' }}>بنود بانتظار موافقتكم</div>}
        </div>
        <span className="og-chev" aria-hidden="true">⌄</span>
      </summary>
      <div className="grid px-2 pb-2" style={{ gap: 6 }}>{g.items.map((o) => <OrderCard key={o.id} o={o} nav={nav} compact />)}</div>
    </details>
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
        {o.status === 'shortage' && <div className="small text-danger">بانتظار توفر {({ diamond: 'الألماس', chain: 'السلاسل / الروبتشن', findings: 'الخامات', stones: 'الأحجار', gold: 'الذهب' })[o.shortage_kind] || 'النواقص'}{o.shortage_from ? ` · من الطلب ${o.shortage_from}` : ''}</div>}
        {o.status === 'quoted' && <div className="small" style={{ color: 'var(--warn)' }}>عرض أجور بانتظار موافقتكم</div>}
        {o.design_status === 'sent' && <div className="small" style={{ color: 'var(--warn)' }}>تصميم بانتظار اعتمادكم</div>}
        {['in_production', 'ready', 'delivered'].includes(o.status) && <div className="hrow gap small mt" style={{ marginTop: 6 }}><div className="progress grow"><div style={{ width: `${pct}%` }} /></div><span>{pct}%</span><span className="muted">{o.stage_name}</span></div>}
      </div>
    </button>
  );
}
