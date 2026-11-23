import { useRef, useState } from 'react';
import { api, fileUrl } from '../api.js';
import { COLORS } from '../format.js';
import { Btn, FileLink, useAction, showAlert, filesFromTransfer } from '../ui.jsx';
import { t } from '../i18n.js';

const IMG = (f) => /^image\//.test(f.mime || '');
const KIND = { model3d: '3D', design: 'تصميم', reference: 'مرجع', internal: '🔒 داخلية', product: 'المنتج', execution: 'تنفيذ', sketch: 'رسمة' };

/**
 * فريق 3D: كل منتجات الطلب بكل صورها، ولكل منتج: تحتاج تصميم / طباعة / لا تحتاج،
 * وإضافة صور وملفات 3D (STL/OBJ/3DM…) على المنتج — لا تظهر للعميل.
 */
export default function Items3D({ items, reload, canMoveAll, firstId }) {
  const [run, busy] = useAction();
  const mark = (x, body) => run(async () => { await api.post(`/w/orders/${x.id}/3d`, body); reload(); });
  const move = () => run(async () => {
    const r = await api.post(`/w/orders/${firstId}/group-advance`);
    reload();
    if (r.skipped?.length) showAlert(`${t('لم ينتقل')}:\n${r.skipped.map((s) => `${s.order_no}: ${s.reason}`).join('\n')}`);
  }, 'انتقل الطلب للمرحلة التالية');
  const design = items.filter((x) => x.needs_3d_design).length;
  return (
    <div className="card card-body d-grid gap-3">
      <div className="hrow between wrap gap">
        <b>{t('منتجات الطلب')} <span className="small text-body-secondary fw-normal">({items.length}{design ? ` · ${t('{n} عليها تصميم', { n: design })}` : ''})</span></b>
        {canMoveAll && <Btn size="sm" kind="dark" loading={busy} onClick={move}>{t('نقل الطلب كاملاً للمرحلة التالية')}</Btn>}
      </div>
      {items.map((x, i) => <Item3D key={x.id} n={i + 1} x={x} busy={busy} mark={mark} run={run} reload={reload} />)}
    </div>
  );
}

function Item3D({ n, x, busy, mark, run, reload }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const files = x.files || [];
  const imgs = files.filter(IMG);
  const others = files.filter((f) => !IMG(f));
  const has3d = files.some((f) => f.kind === 'model3d');
  const none = x.d3_checked_at && !x.needs_3d_design && !x.needs_3d_print;
  const upload = (list) => list.length && run(async () => {
    const fd = new FormData();
    for (const f of list) fd.append('files', f);
    await api.post(`/w/orders/${x.id}/3d-files`, fd);
    reload();
  }, 'تم رفع ملفات 3D');
  return (
    <div className={`i3d ${x.needs_3d_design ? 'needs' : ''} ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={async (e) => { e.preventDefault(); setDrag(false); upload(await filesFromTransfer(e.dataTransfer, '*')); }}>
      <div className="hrow between wrap gap">
        <div>
          <b>{n}. {x.product_type || x.title} × {x.quantity}</b> {x.needs_3d_design && <span className="badge text-bg-warning">{t('عليه تصميم')}</span>} {has3d && <span className="badge text-bg-success">3D ✓</span>}
          <div className="small text-body-secondary" dir="ltr" style={{ textAlign: 'start' }}>{x.order_no} · {t(x.stage_name)}</div>
          <div className="small">{[x.color && t(COLORS[x.color] || x.color), x.size && `${t('مقاس')} ${x.size}`].filter(Boolean).join(' · ')}</div>
          {x.notes && <div className="small text-body-secondary">📝 {x.notes}</div>}
        </div>
        <div className="d-flex gap-1 flex-wrap">
          <button type="button" disabled={busy} className={`chip chip-sm ${x.needs_3d_design ? 'on' : ''}`} onClick={() => mark(x, { needs_design: !x.needs_3d_design, needs_print: !!x.needs_3d_print })}>{t('✏️ تصميم')}</button>
          <button type="button" disabled={busy} className={`chip chip-sm ${x.needs_3d_print ? 'on' : ''}`} onClick={() => mark(x, { needs_design: !!x.needs_3d_design, needs_print: !x.needs_3d_print })}>{t('🖨 طباعة')}</button>
          <button type="button" disabled={busy} className={`chip chip-sm ${none ? 'on' : ''}`} onClick={() => mark(x, { needs_design: false, needs_print: false })}>{t('لا يحتاج')}</button>
        </div>
      </div>
      <div className="i3d-gallery">
        {imgs.map((f) => (
          <FileLink key={f.id} path={f.path} image className="i3d-img" title={f.name}>
            <img src={fileUrl(f.path, 400)} alt="" loading="lazy" /><span className={`i3d-tag ${f.kind === 'model3d' ? 'is3d' : ''}`}>{t(KIND[f.kind] || f.kind)}</span>
          </FileLink>
        ))}
        {others.map((f) => (
          <FileLink key={f.id} path={f.path} className="i3d-img i3d-file" title={f.name}>
            <b>{(f.name || '').split('.').pop()?.toUpperCase()}</b><small>{f.name}</small><span className="i3d-tag is3d">{t(KIND[f.kind] || f.kind)}</span>
          </FileLink>
        ))}
        <button type="button" className={`i3d-add ${x.needs_3d_design && !has3d ? 'hot' : ''}`} onClick={() => ref.current?.click()}>
          <b>＋</b><span>{t('صور / ملفات 3D')}</span>
        </button>
        <input ref={ref} type="file" multiple hidden accept="image/*,.stl,.obj,.3dm,.step,.stp,.glb,.gltf,.zip,.pdf" onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
