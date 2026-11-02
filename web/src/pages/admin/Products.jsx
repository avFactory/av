import { useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { COLORS, METHODS, fmtW, fmtMoney } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, Textarea, useAction, useFetch, Badge } from '../../ui.jsx';

const AV = { available: 'متوفر', made_to_order: 'حسب الطلب', unavailable: 'غير متوفر' };

export default function Products() {
  const { lookups } = useAuth();
  const { data, reload } = useFetch('/catalog/products');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  const toggle = (k, v) => { const a = f[k] || []; setF({ ...f, [k]: a.includes(v) ? a.filter((x) => x !== v) : [...a, v] }); };
  const save = () => run(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) {
      if (['files', 'media', 'id'].includes(k) || v == null) continue;
      fd.append(k, Array.isArray(v) ? v.join(',') : v);
    }
    for (const x of f.files || []) fd.append('files', x);
    if (f.id) await api.put(`/catalog/products/${f.id}`, fd); else await api.post('/catalog/products', fd);
    setF(null); reload();
  }, 'تم حفظ المنتج');
  if (!data) return <Loader />;
  return (
    <Page title="منتجات المتجر" actions={<Btn onClick={() => setF({ karats: [21], colors: ['yellow'], sizes: [], availability: 'made_to_order', active: true, labor_method: 'per_gram' })}>منتج جديد</Btn>}>
      <div className="card"><Table rows={data} onRow={(p) => setF({ ...p, karats: p.karats, colors: p.colors, sizes: p.sizes, files: null })} columns={[
        ['', (p) => (p.media[0] ? <img src={fileUrl(p.media[0].path)} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} /> : null)],
        ['رقم المنتج', 'sku'], ['الاسم', (p) => <b>{p.name}</b>], ['النوع', 'product_type'], ['العيارات', (p) => p.karats.join('، ')], ['الألوان', (p) => p.colors.map((c) => COLORS[c]).join('، ')],
        ['الوزن', (p) => fmtW(p.final_weight || p.approx_weight)], ['الأجرة', (p) => (p.labor_method ? `${fmtMoney(p.labor_rate)} ${METHODS[p.labor_method]}` : 'حسب القواعد')], ['المخزون', 'stock_qty'],
        ['التوفر', (p) => AV[p.availability]], ['', (p) => (p.active ? <Badge tone="ok">ظاهر</Badge> : <Badge>مخفي</Badge>)],
      ]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'تعديل منتج' : 'منتج جديد'} wide>
        {f && <>
          <div className="grid g3">
            <Field label="رقم المنتج *"><Input value={f.sku || ''} onChange={(e) => setF({ ...f, sku: e.target.value })} dir="ltr" /></Field>
            <Field label="اسم المنتج *"><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="نوع القطعة *"><Input value={f.product_type || ''} onChange={(e) => setF({ ...f, product_type: e.target.value })} /></Field>
            <Field label="الوزن التقريبي (جم)"><Input dir="ltr" value={f.approx_weight || ''} onChange={(e) => setF({ ...f, approx_weight: e.target.value })} /></Field>
            <Field label="الوزن النهائي (جم)"><Input dir="ltr" value={f.final_weight || ''} onChange={(e) => setF({ ...f, final_weight: e.target.value })} /></Field>
            <Field label="المقاسات (مفصولة بفاصلة)"><Input value={(f.sizes || []).join(',')} onChange={(e) => setF({ ...f, sizes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
            <Field label="طريقة الأجرة"><Select value={f.labor_method || ''} onChange={(e) => setF({ ...f, labor_method: e.target.value })} placeholder="حسب قواعد الأجور" options={Object.entries(METHODS).filter(([k]) => k !== 'manual')} /></Field>
            <Field label="أجرة التصنيع (ر.س)"><Input dir="ltr" value={f.labor_rate || ''} onChange={(e) => setF({ ...f, labor_rate: e.target.value })} /></Field>
            <Field label="التوفر"><Select value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} options={Object.entries(AV)} /></Field>
            <Field label="مسار الإنتاج"><Select value={f.route_id || ''} onChange={(e) => setF({ ...f, route_id: e.target.value })} placeholder="تلقائي" options={(lookups?.routes || []).map((r) => [r.id, r.name])} /></Field>
          </div>
          <Field label="العيارات"><div className="chips">{[18, 21, 22, 24].map((k) => <button type="button" key={k} className={`chip ${(f.karats || []).includes(k) ? 'on' : ''}`} onClick={() => toggle('karats', k)}>{k}</button>)}</div></Field>
          <Field label="الألوان"><div className="chips">{Object.entries(COLORS).map(([k, v]) => <button type="button" key={k} className={`chip ${(f.colors || []).includes(k) ? 'on' : ''}`} onClick={() => toggle('colors', k)}>{v}</button>)}</div></Field>
          <Field label="الوصف"><Textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="الصور والفيديو"><input type="file" multiple accept="image/*,video/*" onChange={(e) => setF({ ...f, files: e.target.files })} /></Field>
          {f.media?.length > 0 && <div className="files">{f.media.map((m) => <span key={m.id}><img src={fileUrl(m.path)} alt="" /><button className="link small" onClick={() => setF({ ...f, remove_media: [...(f.remove_media || []), m.id], media: f.media.filter((x) => x.id !== m.id) })}>حذف</button></span>)}</div>}
          <label className="check"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ظاهر في المتجر</label>
          <div className="hrow end"><Btn loading={busy} onClick={save}>حفظ</Btn></div>
        </>}
      </Modal>
    </Page>
  );
}
