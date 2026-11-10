import { Link } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDate, COLORS, stoneItems } from '../../format.js';
import { Btn, Loader, useAction, useFetch } from '../../ui.jsx';

/**
 * طابور مرحلة 3D (لفريق 3D): كل طلب بمنتجاته، ولكل قطعة: تحتاج تصميم / طباعة / لا تحتاج،
 * ثم نقل الطلب كاملاً للمرحلة التالية بدون اعتماد المشرف (لا ذهب في هذه المرحلة).
 */
export default function Queue3d() {
  const { data, reload } = useFetch('/w/3d', { live: ['orders'] });
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const groups = [];
  for (const x of data) {
    let g = groups.find((y) => y.key === x.grp);
    if (!g) { g = { key: x.grp, items: [], shop: x.shop_name, due: x.due_date }; groups.push(g); }
    g.items.push(x);
  }
  const mark = (x, body) => run(async () => { await api.post(`/w/orders/${x.id}/3d`, body); reload(); });
  const move = (g) => run(async () => {
    const r = await api.post(`/w/orders/${g.items[0].id}/group-advance`);
    reload();
    if (r.skipped?.length) window.alert(`لم ينتقل:\n${r.skipped.map((s) => `${s.order_no}: ${s.reason}`).join('\n')}`);
  }, 'انتقل الطلب للمرحلة التالية');
  return (
    <div className="d-grid gap-2">
      <h3 className="h6 m-0 mt-2">🖨 مرحلة التصميم 3D <span className="small text-body-secondary">({groups.length} طلب)</span></h3>
      {!groups.length && <div className="small text-body-secondary">لا توجد طلبات في مرحلة 3D</div>}
      {groups.map((g) => {
        const unchecked = g.items.filter((x) => !x.d3_checked_at).length;
        return (
          <div key={g.key} className="d3-group">
            <div className="hrow between wrap gap">
              <div><b dir="ltr">{g.key}</b><div className="small text-body-secondary">{g.shop || 'طلب داخلي'}{g.due ? ` · التسليم ${fmtDate(g.due)}` : ''}</div></div>
              <span className="small">{g.items.length} أصناف</span>
            </div>
            {g.items.map((x) => {
              const extra = [x.size && `مقاس ${x.size}`, x.color && (COLORS[x.color] || x.color), ...stoneItems(x).map(([k, v]) => `${k} ${v}`)].filter(Boolean);
              const none = x.d3_checked_at && !x.needs_3d_design && !x.needs_3d_print;
              return (
                <div key={x.id} className="oi-row" style={{ cursor: 'default' }}>
                  {x.thumb ? <img src={fileUrl(x.thumb, 400)} alt="" /> : <span className="oi-ph">◇</span>}
                  <div className="oi-main">
                    <Link to={`/w/orders/${x.id}`} className="text-reset"><b>{x.product_type || x.title} × {x.quantity}</b></Link>
                    <div className="small text-body-secondary" dir="ltr" style={{ textAlign: 'right' }}>{x.order_no}</div>
                    {extra.length > 0 && <div className="small">{extra.join(' · ')}</div>}
                    {x.notes && <div className="small text-body-secondary">📝 {x.notes}</div>}
                  </div>
                  <div className="oi-side">
                    <div className="d-flex gap-1 flex-wrap justify-content-end">
                      <button type="button" disabled={busy} className={`chip chip-sm ${x.needs_3d_design ? 'on' : ''}`} onClick={() => mark(x, { needs_design: !x.needs_3d_design, needs_print: !!x.needs_3d_print })}>✏️ تصميم</button>
                      <button type="button" disabled={busy} className={`chip chip-sm ${x.needs_3d_print ? 'on' : ''}`} onClick={() => mark(x, { needs_design: !!x.needs_3d_design, needs_print: !x.needs_3d_print })}>🖨 طباعة</button>
                      <button type="button" disabled={busy} className={`chip chip-sm ${none ? 'on' : ''}`} onClick={() => mark(x, { needs_design: false, needs_print: false })}>لا يحتاج</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {unchecked > 0 && <div className="small text-body-secondary">{unchecked} قطعة لم تُحدد بعد</div>}
            <Btn kind="dark" loading={busy} onClick={() => move(g)}>نقل الطلب كاملاً للمرحلة التالية</Btn>
          </div>
        );
      })}
    </div>
  );
}
