import { Link } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDate, COLORS, stoneItems } from '../../format.js';
import { Btn, Loader, useAction, useFetch, showAlert, askConfirm } from '../../ui.jsx';
import { t } from '../../i18n.js';

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
  // تحديد تصميم/طباعة لمنتج واحد: يظهر في صفحة التصاميم أو الطباعة (المنتج وحده وليس الطلب كاملاً)
  const mark = (x, body) => {
    const toDesign = body.needs_design && !x.needs_3d_design;
    const toPrint = body.needs_print && !x.needs_3d_print;
    return run(async () => { await api.post(`/w/orders/${x.id}/3d`, body); reload(); },
      toDesign ? 'أُضيف المنتج لصفحة التصاميم' : toPrint ? 'أُضيف المنتج لصفحة الطباعة' : undefined);
  };
  const move = async (g) => {
    const pend = g.items.filter((x) => (x.needs_3d_design && !x.d3_design_done_at) || (x.needs_3d_print && !x.d3_print_done_at));
    if (pend.length && !await askConfirm(t('{n} منتج لم يُنجز تصميمه أو طباعته بعد. نقل الطلب كاملاً للمرحلة التالية الآن؟', { n: pend.length }))) return;
    moveNow(g);
  };
  const moveNow = (g) => run(async () => {
    const r = await api.post(`/w/orders/${g.items[0].id}/group-advance`);
    reload();
    if (r.skipped?.length) showAlert(`لم ينتقل:\n${r.skipped.map((s) => `${s.order_no}: ${s.reason}`).join('\n')}`);
  }, 'انتقل الطلب للمرحلة التالية');
  return (
    <div className="d-grid gap-2">
      <h3 className="h6 m-0 mt-2">{t('🖨 مرحلة التصميم 3D')} <span className="small text-body-secondary">{t('({n} طلب)', { n: groups.length })}</span></h3>
      {!groups.length && <div className="small text-body-secondary">{t('لا توجد طلبات في مرحلة 3D')}</div>}
      {groups.map((g) => {
        const unchecked = g.items.filter((x) => !x.d3_checked_at).length;
        return (
          <div key={g.key} className="d3-group">
            <div className="hrow between wrap gap">
              <div><b dir="ltr">{g.key}</b><div className="small text-body-secondary">{g.shop || t('طلب داخلي')}{g.due ? ` · ${t('التسليم')} ${fmtDate(g.due)}` : ''}</div></div>
              <span className="small">{t('{n} أصناف', { n: g.items.length })}</span>
            </div>
            {g.items.map((x) => {
              const extra = [x.size && `${t('مقاس')} ${x.size}`, x.color && t(COLORS[x.color] || x.color), ...stoneItems(x).map(([k, v]) => `${k} ${v}`)].filter(Boolean);
              const none = x.d3_checked_at && !x.needs_3d_design && !x.needs_3d_print;
              return (
                <div key={x.id} className="oi-row" style={{ cursor: 'default' }}>
                  {x.thumb ? <img src={fileUrl(x.thumb, 400)} alt="" /> : <span className="oi-ph">◇</span>}
                  <div className="oi-main">
                    <Link to={`/w/orders/${x.id}`} className="text-reset"><b>{x.product_type || x.title} × {x.quantity}</b></Link>
                    <div className="small text-body-secondary" dir="ltr" style={{ textAlign: 'right' }}>{x.order_no}</div>
                    {extra.length > 0 && <div className="small">{extra.join(' · ')}</div>}
                    {x.notes && <div className="small text-body-secondary">📝 {x.notes}</div>}
                    {(x.needs_3d_design || x.needs_3d_print) && <div className="small d-flex gap-2 flex-wrap mt-1">
                      {x.needs_3d_design && <Link to="/w/designs" className={`badge ${x.d3_design_done_at ? 'text-bg-success' : 'text-bg-warning'}`}>{x.d3_design_done_at ? t('✓ صُمم') : t('✏️ في التصاميم')}</Link>}
                      {x.needs_3d_print && <Link to="/w/prints" className={`badge ${x.d3_print_done_at ? 'text-bg-success' : 'text-bg-warning'}`}>{x.d3_print_done_at ? t('✓ طُبع') : t('🖨 في الطباعة')}</Link>}
                    </div>}
                  </div>
                  <div className="oi-side">
                    <div className="d-flex gap-1 flex-wrap justify-content-end">
                      <button type="button" disabled={busy} className={`chip chip-sm ${x.needs_3d_design ? 'on' : ''}`} onClick={() => mark(x, { needs_design: !x.needs_3d_design, needs_print: !!x.needs_3d_print })}>{t('✏️ تصميم')}</button>
                      <button type="button" disabled={busy} className={`chip chip-sm ${x.needs_3d_print ? 'on' : ''}`} onClick={() => mark(x, { needs_design: !!x.needs_3d_design, needs_print: !x.needs_3d_print })}>{t('🖨 طباعة')}</button>
                      <button type="button" disabled={busy} className={`chip chip-sm ${none ? 'on' : ''}`} onClick={() => mark(x, { needs_design: false, needs_print: false })}>{t('لا يحتاج')}</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {unchecked > 0 && <div className="small text-body-secondary">{t('{n} قطعة لم تُحدد بعد', { n: unchecked })}</div>}
            <Btn kind="dark" loading={busy} onClick={() => move(g)}>{t('نقل الطلب كاملاً للمرحلة التالية')}</Btn>
          </div>
        );
      })}
    </div>
  );
}
