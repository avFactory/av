import { useState } from 'react';
import { useFetch } from '../../ui.jsx';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { COLORS } from '../../format.js';
import { useCart, OrderGate } from '../../components/StoreLayout.jsx';
import { Btn, Card, Field, Input, Page, Textarea, WeightInput, useAction } from '../../ui.jsx';

/** اطلب تصميمك: رفع الصور والرسومات وملفات 3D */
export default function Custom() {
  const { approved } = useCart();
  const nav = useNavigate();
  const [f, setF] = useState({ product_type: '', title: '', karat: '21', color: 'yellow', approx_weight: '', size: '', quantity: '1', due_date: '', notes: '' });
  const [files, setFiles] = useState({ reference: [], sketch: [], model: [] });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (k !== 'diamonds' && k !== 'has_diamonds' && !k.startsWith('show_')) fd.append(k, v ?? ''); });
      fd.append('diamonds', JSON.stringify(f.has_diamonds ? (f.diamonds || []).filter((d) => d.lot_id) : []));
      [...files.reference, ...files.sketch, ...files.model].forEach((x) => fd.append('files', x));
      if (files.sketch.length && !files.reference.length) fd.append('file_kind', 'sketch');
      const r = await api.post('/store/custom', fd);
      nav(`/store/orders/${r.id}`);
    }, 'تم إرسال طلب التصميم - سيصلكم عرض أجور التصنيع');
  };
  if (!approved) {
    return (
      <Page title="اطلب تصميمك" subtitle="صمّم قطعتك الخاصة: ارفع صورة أو رسماً أو ملف 3D، ويرسل لك المصنع عرض أجور التصنيع">
        <div className="grid g3 mb">
          <div className="card card-body"><b>1. ارفع التصميم</b><p className="small muted">صور، رسم يدوي، أو ملفات 3D (STL, OBJ, 3DM…)</p></div>
          <div className="card card-body"><b>2. حدد المواصفات</b><p className="small muted">العيار، اللون، الوزن التقريبي، المقاس، الكمية</p></div>
          <div className="card card-body"><b>3. استلم العرض</b><p className="small muted">يراجع المصنع طلبك ويرسل عرض أجور التصنيع للموافقة</p></div>
        </div>
        <OrderGate what="طلب تصميم خاص" />
      </Page>
    );
  }
  return (
    <Page title="اطلب تصميمك" subtitle="ارفع صورة أو رسماً أو ملف 3D، وسيرسل لكم المصنع عرض أجور التصنيع للموافقة">
      <form onSubmit={submit} className="grid">
        <Card title="الملفات">
          <div className="grid g3">
            <Field label="صور التصميم"><input type="file" accept="image/*" multiple onChange={(e) => setFiles({ ...files, reference: [...e.target.files] })} /></Field>
            <Field label="رسم يدوي (صورة/PDF)"><input type="file" accept="image/*,.pdf" multiple onChange={(e) => setFiles({ ...files, sketch: [...e.target.files] })} /></Field>
            <Field label="ملفات 3D (STL, OBJ, 3DM, STEP, GLB)"><input type="file" accept=".stl,.obj,.3dm,.step,.stp,.glb,.gltf,.zip" multiple onChange={(e) => setFiles({ ...files, model: [...e.target.files] })} /></Field>
          </div>
        </Card>
        <Card title="المواصفات">
          <div className="grid g3">
            <Field label="نوع القطعة *"><Input value={f.product_type} onChange={set('product_type')} required placeholder="خاتم، طقم، سلسال…" /></Field>
            <Field label="اسم/وصف مختصر"><Input value={f.title} onChange={set('title')} /></Field>
            <Field label="العيار"><div className="chips">{['18', '21', '24'].map((k) => <button type="button" key={k} className={`chip ${f.karat === k ? 'on' : ''}`} onClick={() => setF({ ...f, karat: k })}>{k}</button>)}</div></Field>
            <Field label="اللون"><div className="chips">{Object.entries(COLORS).map(([k, v]) => <button type="button" key={k} className={`chip ${f.color === k ? 'on' : ''}`} onClick={() => setF({ ...f, color: k })}>{v}</button>)}</div></Field>
            <Field label="الوزن التقريبي (جم)"><WeightInput value={f.approx_weight} onChange={set('approx_weight')} /></Field>
            <Field label="المقاس"><Input value={f.size} onChange={set('size')} /></Field>
            <Field label="الكمية"><Input inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></Field>
            <Field label="موعد التسليم المطلوب"><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
          </div>
          <Field label="ملاحظات" className="mt"><Textarea value={f.notes} onChange={set('notes')} rows={4} /></Field>
        </Card>
        <StonesCard f={f} setF={setF} />
        <div className="hrow end"><Btn size="lg" type="submit" loading={busy}>إرسال الطلب للمصنع</Btn></div>
      </form>
    </Page>
  );
}

const STONES = [['pearl_weight', 'اللؤلؤ', 'وزن اللؤلؤ (جم)'], ['stone_weight', 'الحجر', 'وزن الحجر (قيراط)'], ['zircon_weight', 'الزركون', 'وزن الزركون (جم)']];
const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/** الألماس والأحجار في التصميم (اختياري): نوع الألماس ووزنه، واللؤلؤ والحجر والزركون */
function StonesCard({ f, setF }) {
  const { data: types } = useFetch('/store/diamond-types');
  const list = f.diamonds || [];
  const setList = (l) => setF({ ...f, diamonds: l, has_diamonds: true });
  const upd = (i, k, v) => setList(list.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const shapes = [...new Map((types || []).map((t) => [t.shape, t])).values()];
  const shown = (k) => !!f[`show_${k}`];
  return (
    <Card title={<span>الألماس والأحجار <span className="small text-body-secondary fw-normal">(اختياري — لكل قطعة)</span></span>}>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <button type="button" className={`chip ${f.has_diamonds ? 'on' : ''}`} onClick={() => setF({ ...f, has_diamonds: !f.has_diamonds, diamonds: !f.has_diamonds && !list.length ? [{ shape: '', lot_id: '', carats: '', count: '' }] : list })}>💎 الألماس</button>
        {STONES.map(([k, l]) => <button key={k} type="button" className={`chip ${shown(k) ? 'on' : ''}`} onClick={() => setF({ ...f, [`show_${k}`]: !shown(k), [k]: shown(k) ? '' : f[k] })}>{l}</button>)}
      </div>
      {f.has_diamonds && (
        <div className="d-grid gap-3 mb-2">
          {list.map((d, i) => {
            const sizes = (types || []).filter((t) => t.shape === d.shape);
            return (
              <div key={i} className="border rounded-3 p-2 d-grid gap-2">
                <div className="d-flex justify-content-between align-items-center"><b className="small">نوع الألماس {list.length > 1 ? i + 1 : ''}</b>
                  <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => setList(list.filter((_, j) => j !== i))}>حذف</button></div>
                <div className="chips">{shapes.map((s) => <button type="button" key={s.shape} className={`chip ${d.shape === s.shape ? 'on' : ''}`} onClick={() => setList(list.map((x, j) => (j === i ? { ...x, shape: s.shape, lot_id: '' } : x)))}>{s.shape}</button>)}</div>
                {d.shape && (
                  <div className="chips">{sizes.map((t) => (
                    <button type="button" key={t.id} disabled={!t.available} title={t.available ? '' : 'غير متوفر حالياً'} className={`chip ${String(d.lot_id) === String(t.id) ? 'on' : ''}`} onClick={() => upd(i, 'lot_id', t.id)}>
                      <bdi dir="ltr">{t.size_label}</bdi>{t.color ? ` ${t.color}` : ''}{t.clarity ? ` ${t.clarity}` : ''}
                    </button>
                  ))}</div>
                )}
                {d.lot_id && (
                  <div className="grid g2">
                    <Field label="وزن الألماس (قيراط) *"><Input dir="ltr" inputMode="decimal" value={d.carats} onChange={(e) => upd(i, 'carats', num(e.target.value))} placeholder="0.00" /></Field>
                    <Field label="عدد الحبات"><Input dir="ltr" inputMode="numeric" value={d.count} onChange={(e) => upd(i, 'count', e.target.value.replace(/\D/g, ''))} /></Field>
                  </div>
                )}
              </div>
            );
          })}
          <div><Btn kind="ghost" size="sm" onClick={() => setList([...list, { shape: '', lot_id: '', carats: '', count: '' }])}>+ نوع ألماس آخر</Btn></div>
        </div>
      )}
      {STONES.some(([k]) => shown(k)) && <div className="grid g3">{STONES.filter(([k]) => shown(k)).map(([k, , label]) => <Field key={k} label={label}><Input dir="ltr" inputMode="decimal" value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: num(e.target.value) })} /></Field>)}</div>}
    </Card>
  );
}
