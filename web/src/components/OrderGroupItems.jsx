import { Link } from 'react-router-dom';
import { fileUrl } from '../api.js';
import { stoneItems, COLORS } from '../format.js';
import { t } from '../i18n.js';

/** بنود الطلب كاملة (الطلب يُعامل كقطعة واحدة): صورة وتفاصيل كل بند */
export default function OrderGroupItems({ items = [], current, link }) {
  if (items.length < 2) return null;
  const total = items.reduce((a, x) => a + Number(x.quantity || 0), 0);
  return (
    <div className="card mb-3">
      <div className="card-header bg-transparent py-2"><b>{t('الطلب كامل')}</b> <span className="small text-body-secondary">({t('{n} أصناف · {q} قطعة', { n: items.length, q: total })})</span></div>
      <div className="list-group list-group-flush">
        {items.map((x) => {
          const extra = [x.size && `${t('مقاس')} ${x.size}`, x.color && t(COLORS[x.color] || x.color), ...stoneItems(x).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(' · ');
          const body = (
            <div className="d-flex gap-2 align-items-center">
              {x.thumb ? <img src={fileUrl(x.thumb, 400)} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, flex: 'none' }} /> : <div style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--bs-tertiary-bg)', flex: 'none' }} />}
              <div className="min-w-0 flex-grow-1">
                <div className="fw-semibold">{x.product_type || x.title} × {x.quantity} {x.id === current && <span className="badge text-bg-dark ms-1">{t('هذا البند')}</span>}</div>
                <div className="small text-body-secondary text-truncate">{x.title !== x.product_type ? `${x.title} · ` : ''}<span dir="ltr">{x.order_no}</span>{x.stage_name ? ` · ${t(x.stage_name)}` : ''}</div>
                {extra && <div className="small">{extra}</div>}
                {x.notes && <div className="small text-body-secondary">📝 {x.notes}</div>}
              </div>
            </div>
          );
          return link ? <Link key={x.id} to={link(x)} className="list-group-item list-group-item-action">{body}</Link> : <div key={x.id} className="list-group-item">{body}</div>;
        })}
      </div>
    </div>
  );
}
