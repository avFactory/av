import { useState } from 'react';
import { api } from '../api.js';
import { Btn, Card, Field, Input, Modal, Table, Badge, useAction } from '../ui.jsx';

/** إدارة فروع المحل: إضافة فرع بكلمة مرور خاصة، تعديل، تغيير كلمة المرور، إيقاف/تفعيل */
export default function Branches({ list, base, onChange, hint }) {
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const body = { name: f.name, city: f.city, address: f.address, phone: f.phone, ...(f.password ? { password: f.password } : {}) };
    if (f.id) await api.put(`${base}/${f.id}`, body); else await api.post(base, body);
    setF(null); onChange();
  }, f?.id ? 'تم حفظ الفرع' : 'تمت إضافة الفرع');
  const toggle = (b) => run(async () => { await api.put(`${base}/${b.id}`, { active: !b.active }); onChange(); }, b.active ? 'تم إيقاف الفرع' : 'تم تفعيل الفرع');
  return (
    <Card title={`الفروع (${list.length})`} actions={<Btn size="sm" onClick={() => setF({ name: '', city: '', address: '', phone: '', password: '' })}>إضافة فرع</Btn>} pad={false}>
      {hint && <div className="card-body pb-0"><div className="alert alert-info small">{hint}</div></div>}
      <Table rows={list} empty="لا توجد فروع - الحساب الرئيسي فقط" columns={[
        ['الفرع', (b) => <b>{b.name}</b>], ['المدينة', 'city'], ['العنوان', 'address'], ['الجوال', (b) => <span dir="ltr">{b.phone || ''}</span>],
        ['الطلبات', 'orders_count'], ['الحالة', (b) => (b.active ? <Badge tone="ok">فعّال</Badge> : <Badge>موقوف</Badge>)],
        ['', (b) => <div className="d-flex gap-2 justify-content-end">
          <Btn size="sm" kind="ghost" onClick={() => setF({ ...b, password: '' })}>تعديل / كلمة المرور</Btn>
          <Btn size="sm" kind="ghost" loading={busy} onClick={() => toggle(b)}>{b.active ? 'إيقاف' : 'تفعيل'}</Btn>
        </div>],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? `تعديل ${f.name}` : 'فرع جديد'}>
        {f && <>
          <Field label="اسم الفرع *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: فرع العليا" autoFocus /></Field>
          <div className="grid g2">
            <Field label="المدينة"><Input value={f.city || ''} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="الجوال"><Input value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" /></Field>
          </div>
          <Field label="العنوان"><Input value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label={f.id ? 'كلمة مرور جديدة للفرع (اتركها فارغة لعدم التغيير)' : 'كلمة مرور الفرع * (8 أحرف على الأقل)'} hint="يدخل الفرع باسم مستخدم المحل نفسه، ثم يختار الفرع ويكتب هذه الكلمة.">
            <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} dir="ltr" autoComplete="new-password" />
          </Field>
          <div className="d-flex justify-content-end"><Btn loading={busy} disabled={!f.name || (!f.id && f.password.length < 8)} onClick={save}>حفظ</Btn></div>
        </>}
      </Modal>
    </Card>
  );
}
