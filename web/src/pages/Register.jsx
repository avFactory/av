import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Btn, Field, Input } from '../ui.jsx';

const DOCS = [['cr_doc', 'السجل التجاري'], ['vat_doc', 'الشهادة الضريبية'], ['address_doc', 'العنوان الوطني']];

export default function Register() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ shop_name: '', owner_name: '', phone: '', email: '', city: '', address: '', vat_number: '', cr_number: '', username: '', password: '' });
  const [docs, setDocs] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const missing = DOCS.find(([k]) => !docs[k]);
    if (missing) { setErr(`أرفق صورة ${missing[1]}`); setBusy(false); return; }
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    DOCS.forEach(([k]) => fd.append(k, docs[k]));
    try { await api.post('/auth/register-customer', fd); await refresh(); nav('/store/account'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Link to="/login" className="back">→ تسجيل الدخول</Link>
      <h1 className="mb">تسجيل محل ذهب</h1>
      <form className="card card-body grid" onSubmit={submit}>
        {err && <div className="alert alert-danger">{err}</div>}
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
        <div>
          <b>مستندات المنشأة *</b> <span className="small text-body-secondary">صورة واضحة أو PDF لكل مستند</span>
          <div className="reg-docs mt-2">
            {DOCS.map(([k, label]) => {
              const file = docs[k];
              const img = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
              return (
                <label key={k} className={`reg-doc${file ? ' done' : ''}`}>
                  <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => e.target.files[0] && setDocs({ ...docs, [k]: e.target.files[0] })} />
                  {img ? <img src={img} alt="" /> : <span className="reg-doc-ic" aria-hidden="true">{file ? 'PDF' : '＋'}</span>}
                  <b>{label}</b>
                  <span className="small">{file ? `✓ ${file.name}` : 'اضغط لإرفاق صورة'}</span>
                </label>
              );
            })}
          </div>
        </div>
        <p className="muted small">يتم تفعيل الحساب بعد مراجعة إدارة المصنع للمستندات وموافقتها.</p>
        <Btn size="lg" loading={busy} type="submit">إرسال طلب التسجيل</Btn>
      </form>
    </div>
  );
}
