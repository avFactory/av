import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { COLORS, METHODS } from '../../format.js';
import { Btn, Card, Field, Input, Page, Select, Textarea, WeightInput, useAction, useFetch } from '../../ui.jsx';

export default function NewOrder() {
  const { lookups } = useAuth();
  const nav = useNavigate();
  const { data: products } = useFetch('/catalog/products');
  const [f, setF] = useState({ title: '', product_type: '', karat: '21', color: 'yellow', quantity: '1', approx_weight: '', size: '', due_date: '', notes: '', customer_id: '', product_id: '', route_id: '', design_approval_required: false, labor_method: '', labor_rate: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const submit = (e) => { e.preventDefault(); run(async () => { const o = await api.post('/orders', f); nav(`/orders/${o.id}`); }, 'تم إنشاء أمر الإنتاج'); };
  return (
    <Page title="طلب تصنيع جديد" back="/orders">
      <form onSubmit={submit} className="grid">
        <Card title="بيانات الطلب">
          <div className="grid g3">
            <Field label="العميل (اتركه فارغاً لطلب داخلي للمخزون)"><Select value={f.customer_id} onChange={set('customer_id')} placeholder="طلب داخلي" options={(lookups?.customers || []).map((c) => [c.id, c.shop_name])} /></Field>
            <Field label="منتج من الكتالوج (اختياري)"><Select value={f.product_id} onChange={(e) => { const p = products?.find((x) => String(x.id) === e.target.value); setF({ ...f, product_id: e.target.value, title: p?.name || f.title, product_type: p?.product_type || f.product_type, approx_weight: p?.approx_weight || f.approx_weight }); }} placeholder="—" options={(products || []).map((p) => [p.id, `${p.sku} - ${p.name}`])} /></Field>
            <Field label="الوصف *"><Input value={f.title} onChange={set('title')} required /></Field>
            <Field label="نوع القطعة"><Input value={f.product_type} onChange={set('product_type')} placeholder="خاتم، سلسال، أسورة…" /></Field>
            <Field label="العيار"><Select value={f.karat} onChange={set('karat')} options={[['18', '18'], ['21', '21'], ['24', '24']]} /></Field>
            <Field label="اللون"><Select value={f.color} onChange={set('color')} options={Object.entries(COLORS)} /></Field>
            <Field label="الكمية"><Input inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></Field>
            <Field label="الوزن التقريبي (جم)"><WeightInput value={f.approx_weight} onChange={set('approx_weight')} /></Field>
            <Field label="المقاس"><Input value={f.size} onChange={set('size')} /></Field>
            <Field label="موعد التسليم"><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
            <Field label="مسار الإنتاج"><Select value={f.route_id} onChange={set('route_id')} placeholder="تلقائي حسب نوع المنتج" options={(lookups?.routes || []).filter((r) => r.product_type !== '__stock__').map((r) => [r.id, r.name])} /></Field>
            <Field label=" "><label className="check"><input type="checkbox" checked={f.design_approval_required} onChange={set('design_approval_required')} /> يتطلب اعتماد العميل للتصميم قبل الصب</label></Field>
          </div>
          <Field label="ملاحظات" className="mt"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        </Card>
        <Card title="أجور التصنيع (اتركها لتطبيق قواعد الأجور تلقائياً)">
          <div className="grid g3">
            <Field label="طريقة الاحتساب"><Select value={f.labor_method} onChange={set('labor_method')} placeholder="تلقائي" options={Object.entries(METHODS)} /></Field>
            <Field label="الأجرة (ر.س)"><Input inputMode="decimal" value={f.labor_rate} onChange={set('labor_rate')} disabled={!f.labor_method} /></Field>
          </div>
          <p className="small muted mt">قيمة الذهب خارج حسابات المصنع - تُحتسب أجور التصنيع فقط.</p>
        </Card>
        <div className="hrow end"><Btn size="lg" type="submit" loading={busy}>إنشاء وتحويل لأمر إنتاج</Btn></div>
      </form>
    </Page>
  );
}
