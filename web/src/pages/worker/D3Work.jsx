import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { COLORS, fmtDate, fmtDT } from '../../format.js';
import { Btn, Empty, Loader, Tabs, useAction, useFetch } from '../../ui.jsx';
import { D3Gallery, useD3Drop } from '../../components/Items3D.jsx';
import { t } from '../../i18n.js';
import { PriorityBadge } from '../../components/Priority.jsx';

/**
 * صفحة التصاميم / الطباعة لفريق 3D: كل منتج (بند) على حدة وليس الطلب كاملاً.
 * التصميم: يرفع صور/ملفات 3D ثم «تم التصميم». الطباعة: يحمّل الملف ويطبع ثم «تمت الطباعة».
 */
export default function D3Work({ kind }) {
  const [tab, setTab] = useState('now');
  const { data, reload } = useFetch(`/w/3d/${kind}${tab === 'done' ? '?done=1' : ''}`, { live: ['orders', 'order_files'], deps: [tab] });
  const [run, busy] = useAction();
  const design = kind === 'design';
  const done = (x, undo = false) => run(async () => { await api.post(`/w/orders/${x.id}/3d-done`, { kind, undo }); reload(); },
    undo ? 'تم التراجع' : design ? 'تم التصميم ✓' : 'تمت الطباعة ✓');
  return (
    <div className="wk-body">
      <h2>{t(design ? '✏️ التصاميم' : '🖨 الطباعة')}</h2>
      <div className="small text-body-secondary">{t(design ? 'كل منتج حُدد له «تصميم» في مهامي. ارفع صور أو ملفات التصميم 3D ثم اضغط «تم التصميم».' : 'كل منتج حُدد له «طباعة» — منتج واحد وليس الطلب كاملاً. حمّل ملف التصميم واطبعه ثم اضغط «تمت الطباعة».')}</div>
      <Tabs value={tab} onChange={setTab} tabs={[['now', t('الحالية')], ['done', t('المنجزة (30 يوماً)')]]} />
      {!data ? <Loader /> : !data.length ? <Empty>{t(tab === 'done' ? 'لا يوجد منجز' : design ? 'لا توجد تصاميم مطلوبة' : 'لا توجد طباعة مطلوبة')}</Empty>
        : data.map((x) => <D3Item key={x.id} x={x} kind={kind} tab={tab} busy={busy} run={run} reload={reload} onDone={done} />)}
    </div>
  );
}

function D3Item({ x, kind, tab, busy, run, reload, onDone }) {
  const design = kind === 'design';
  const has3d = (x.files || []).some((f) => f.kind === 'model3d');
  const waitDesign = !design && x.needs_3d_design && !x.d3_design_done_at;
  const { drag, props } = useD3Drop(x, run, reload);
  const at = design ? x.d3_design_done_at : x.d3_print_done_at;
  const by = design ? x.design_by_name : x.print_by_name;
  return (
    <div className={`i3d ${drag ? 'dragging' : ''}`} {...(design ? props : {})}>
      <div className="hrow between wrap gap">
        <div>
          <Link to={`/w/orders/${x.id}`} className="text-reset"><b>{x.product_type || x.title} × {x.quantity}</b></Link>
          {' '}<PriorityBadge value={x.priority} />
          {has3d && <span className="badge text-bg-success ms-1">3D ✓</span>}
          {waitDesign && <span className="badge text-bg-warning ms-1">{t('بانتظار التصميم')}</span>}
          <div className="small text-body-secondary" dir="ltr" style={{ textAlign: 'start' }}>{x.order_no} · {x.shop_name || t('طلب داخلي')}</div>
          <div className="small">{[x.title !== x.product_type && x.title, x.color && t(COLORS[x.color] || x.color), x.size && `${t('مقاس')} ${x.size}`, x.due_date && `${t('التسليم')} ${fmtDate(x.due_date)}`].filter(Boolean).join(' · ')}</div>
          {x.notes && <div className="small text-body-secondary">📝 {x.notes}</div>}
        </div>
        {tab === 'done'
          ? <div className="text-end small"><span className="badge text-bg-success">✓ {fmtDT(at)}</span><div className="text-body-secondary">{by}</div><button type="button" className="btn btn-link btn-sm p-0" disabled={busy} onClick={() => onDone(x, true)}>{t('تراجع')}</button></div>
          : <Btn kind="ok" loading={busy} disabled={design ? !has3d : waitDesign} title={design && !has3d ? t('ارفع ملف التصميم أولاً') : ''} onClick={() => onDone(x)}>{t(design ? '✓ تم التصميم' : '✓ تمت الطباعة')}</Btn>}
      </div>
      <D3Gallery x={x} run={run} reload={reload} upload={design && tab !== 'done'} />
      {design && !has3d && tab !== 'done' && <div className="small text-body-secondary">{t('ارفع صورة أو ملف التصميم (أو اسحبه على البطاقة) ثم اضغط «تم التصميم».')}</div>}
    </div>
  );
}
