import { useState } from 'react';
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
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
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
            <Field label="العيار"><div className="chips">{['18', '21', '22', '24'].map((k) => <button type="button" key={k} className={`chip ${f.karat === k ? 'on' : ''}`} onClick={() => setF({ ...f, karat: k })}>{k}</button>)}</div></Field>
            <Field label="اللون"><div className="chips">{Object.entries(COLORS).map(([k, v]) => <button type="button" key={k} className={`chip ${f.color === k ? 'on' : ''}`} onClick={() => setF({ ...f, color: k })}>{v}</button>)}</div></Field>
            <Field label="الوزن التقريبي (جم)"><WeightInput value={f.approx_weight} onChange={set('approx_weight')} /></Field>
            <Field label="المقاس"><Input value={f.size} onChange={set('size')} /></Field>
            <Field label="الكمية"><Input inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></Field>
            <Field label="موعد التسليم المطلوب"><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
          </div>
          <Field label="ملاحظات" className="mt"><Textarea value={f.notes} onChange={set('notes')} rows={4} /></Field>
        </Card>
        <div className="hrow end"><Btn size="lg" type="submit" loading={busy}>إرسال الطلب للمصنع</Btn></div>
      </form>
    </Page>
  );
}
