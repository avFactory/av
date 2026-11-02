import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Btn, Field, Input } from '../ui.jsx';

export default function Register() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ shop_name: '', owner_name: '', phone: '', email: '', city: '', address: '', vat_number: '', cr_number: '', username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post('/auth/register-customer', f); await refresh(); nav('/store/account'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Link to="/login" className="back">→ تسجيل الدخول</Link>
      <h1 className="mb">تسجيل محل ذهب</h1>
      <form className="card card-b grid" onSubmit={submit}>
        {err && <div className="alert alert-bad">{err}</div>}
        <div className="grid g2">
          <Field label="اسم المحل *"><Input value={f.shop_name} onChange={set('shop_name')} required /></Field>
          <Field label="اسم المالك *"><Input value={f.owner_name} onChange={set('owner_name')} required /></Field>
          <Field label="رقم الجوال *"><Input value={f.phone} onChange={set('phone')} required dir="ltr" inputMode="tel" /></Field>
          <Field label="البريد الإلكتروني"><Input value={f.email} onChange={set('email')} type="email" dir="ltr" /></Field>
          <Field label="المدينة"><Input value={f.city} onChange={set('city')} /></Field>
          <Field label="العنوان"><Input value={f.address} onChange={set('address')} /></Field>
          <Field label="الرقم الضريبي (إن وجد)"><Input value={f.vat_number} onChange={set('vat_number')} dir="ltr" /></Field>
          <Field label="السجل التجاري"><Input value={f.cr_number} onChange={set('cr_number')} dir="ltr" /></Field>
          <Field label="اسم المستخدم (بالإنجليزية) *"><Input value={f.username} onChange={set('username')} required dir="ltr" /></Field>
          <Field label="كلمة المرور (8 أحرف على الأقل) *"><Input type="password" value={f.password} onChange={set('password')} required dir="ltr" /></Field>
        </div>
        <p className="muted small">يتم تفعيل الحساب بعد مراجعة إدارة المصنع وموافقتها.</p>
        <Btn size="lg" loading={busy} type="submit">إرسال طلب التسجيل</Btn>
      </form>
    </div>
  );
}
