import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { METHODS, fmtMoney, fmtDT } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, useAction, useFetch, Badge } from '../../ui.jsx';

const SCOPES = [['default', 'افتراضية لكل الطلبات'], ['product_type', 'حسب نوع المنتج'], ['product', 'منتج محدد'], ['tier', 'فئة عملاء'], ['customer', 'عميل محدد (خاصة)'], ['stage', 'أجرة مرحلة تصنيع (إضافية)']];

export default function Labor() {
  const { lookups } = useAuth();
  const { data, reload } = useFetch('/catalog/labor-rates');
  const { data: products } = useFetch('/catalog/products');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Page title="أجور التصنيع" subtitle="المصنع يتقاضى أجور التصنيع فقط - لا يوجد ربط بسعر الذهب. الأولوية: عميل > فئة > منتج > نوع منتج > افتراضي." actions={<Btn onClick={() => setF({ scope: 'default', method: 'per_gram' })}>قاعدة جديدة</Btn>}>
      <div className="alert alert-info mb small">مثال: وزن المنتج 10 جم × أجرة الجرام 15 ر.س = 150 ر.س أجور تصنيع. قيمة الذهب خارج حسابات النظام. الأجرة اليدوية تحدد على الطلب نفسه وتتطلب اعتماد الإدارة.</div>
      <div className="card"><Table rows={data} rowClass={(r) => (r.active ? '' : 'row-warn')} columns={[
        ['القاعدة', (r) => <b>{r.name}</b>], ['النطاق', (r) => SCOPES.find((s) => s[0] === r.scope)?.[1]],
        ['ينطبق على', (r) => [r.product_type, r.product_name, r.tier_name, r.shop_name, r.stage_name].filter(Boolean).join(' · ') || 'الكل'],
        ['الطريقة', (r) => METHODS[r.method]], ['الأجرة', (r) => <b>{fmtMoney(r.rate)}</b>], ['أنشأها', (r) => `${r.created_by_name || ''} ${fmtDT(r.created_at)}`],
        ['الحالة', (r) => (r.active ? <Badge tone="ok">فعالة</Badge> : <Badge>سابقة</Badge>)],
        ['', (r) => r.active && <div className="hrow gap"><Btn size="sm" kind="ghost" onClick={() => setF({ ...r })}>تعديل</Btn><Btn size="sm" kind="ghost" onClick={() => run(async () => { await api.put(`/catalog/labor-rates/${r.id}`, { active: false }); reload(); }, 'تم الإيقاف')}>إيقاف</Btn></div>],
      ]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'تعديل قاعدة (تحفظ القديمة في السجل)' : 'قاعدة أجور جديدة'}>
        {f && <>
          <Field label="اسم القاعدة"><Input value={f.name || ''} onChange={set('name')} /></Field>
          <Field label="النطاق"><Select value={f.scope} onChange={set('scope')} options={SCOPES} /></Field>
          {['product_type', 'customer', 'tier'].includes(f.scope) && f.scope === 'product_type' && <Field label="نوع المنتج"><Input value={f.product_type || ''} onChange={set('product_type')} /></Field>}
          {f.scope === 'product' && <Field label="المنتج"><Select value={f.product_id || ''} onChange={set('product_id')} placeholder="—" options={(products || []).map((p) => [p.id, p.name])} /></Field>}
          {f.scope === 'tier' && <Field label="فئة العملاء"><Select value={f.tier_id || ''} onChange={set('tier_id')} placeholder="—" options={(lookups?.tiers || []).map((t) => [t.id, t.name])} /></Field>}
          {f.scope === 'customer' && <>
            <Field label="العميل"><Select value={f.customer_id || ''} onChange={set('customer_id')} placeholder="—" options={(lookups?.customers || []).map((c) => [c.id, c.shop_name])} /></Field>
            <Field label="لنوع منتج محدد (اختياري)"><Input value={f.product_type || ''} onChange={set('product_type')} /></Field>
          </>}
          {f.scope === 'stage' && <Field label="المرحلة"><Select value={f.stage_id || ''} onChange={set('stage_id')} placeholder="—" options={(lookups?.stages || []).map((s) => [s.id, s.name])} /></Field>}
          <div className="grid g2">
            <Field label="طريقة الاحتساب"><Select value={f.method} onChange={set('method')} options={Object.entries(METHODS).filter(([k]) => k !== 'manual')} /></Field>
            <Field label="الأجرة (ر.س)"><Input dir="ltr" inputMode="decimal" value={f.rate || ''} onChange={set('rate')} /></Field>
          </div>
          <Btn loading={busy} onClick={() => run(async () => { if (f.id) await api.put(`/catalog/labor-rates/${f.id}`, f); else await api.post('/catalog/labor-rates', f); setF(null); reload(); }, 'تم الحفظ')}>حفظ</Btn>
        </>}
      </Modal>
    </Page>
  );
}
