import { Link } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDate, fmtDT, fmtW } from '../../format.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Empty, Loader, Page, useAction, useFetch } from '../../ui.jsx';
import { printLabels } from '../../components/PrintLabelsBtn.jsx';

/** مرحلة النواقص: القطع المنتظرة لتوفر الألماس أو الخامات، واستئنافها بعد التوفر */
export default function Shortages() {
  const { data, reload } = useFetch('/sup/shortages', { live: ['orders'] });
  const { can } = useAuth();
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const { rows, kinds } = data;
  const resume = (o) => {
    if (!window.confirm(`توفرت النواقص للطلب ${o.order_no}؟ سيعود لمرحلته (${o.stage_name}) ويكمل الإنتاج.`)) return;
    run(async () => { await api.post(`/orders/${o.id}/shortage/resume`); reload(); }, 'استؤنف الإنتاج');
  };
  return (
    <Page title="النواقص" subtitle={`${rows.length} طلب بانتظار توفر الألماس أو الخامات`}>
      {!rows.length ? <Empty>لا توجد نواقص حالياً</Empty> : (
        <div className="oi-list">
          {rows.map((o) => (
            <div key={o.id} className="oi-row" style={{ cursor: 'default' }}>
              {o.thumb ? <img src={fileUrl(o.thumb, 400)} alt="" /> : <span className="oi-ph">◇</span>}
              <div className="oi-main">
                <div><Link to={`/orders/${o.id}`} className="fw-bold" dir="ltr">{o.order_no}</Link> <b>· {o.product_type || o.title} × {o.quantity}</b></div>
                <div className="small"><span className="badge text-bg-danger me-1">{kinds[o.shortage_kind] || o.shortage_kind}</span>{o.shortage_reason}</div>
                <div className="small text-body-secondary">
                  {o.shop_name ? `${o.shop_name}${o.branch_name ? ` — ${o.branch_name}` : ''} · ` : ''}من الطلب <span dir="ltr">{o.shortage_from || '—'}</span> · المرحلة: {o.stage_name}
                  {Number(o.gold) > 0 ? ` · ذهب ${fmtW(o.gold)} جم` : ''} · منذ {fmtDT(o.shortage_at)}{o.by_name ? ` · ${o.by_name}` : ''}{o.due_date ? ` · التسليم ${fmtDate(o.due_date)}` : ''}
                </div>
              </div>
              <div className="oi-side d-flex gap-2 flex-wrap">
                <Btn size="sm" kind="ghost" onClick={() => printLabels([o.id]).catch(() => {})}>🏷 الباركود</Btn>
                {can('orders.advance', 'custody.issue') && <Btn size="sm" kind="ok" loading={busy} onClick={() => resume(o)}>توفرت — استئناف</Btn>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
