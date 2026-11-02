import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Btn, Field, Input } from '../ui.jsx';

export default function Login() {
  const { me, refresh } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to={sp.get('next') || homeFor(me)} replace />;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api.post('/auth/login', f); await refresh(); nav(sp.get('next') || '/', { replace: true }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-screen">
      <div className="login-bg" aria-hidden="true" />
      <form className="login-card" onSubmit={submit}>
        <img src="/logo-gold.png" alt="AV" className="login-card-logo" />
        <h1>مصنع AV للمجوهرات</h1>
        <p className="login-sub">AV Jewelry Factory · تسجيل الدخول</p>
        {err && <div className="alert alert-danger">{err}</div>}
        <Field label="اسم المستخدم"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus autoComplete="username" dir="ltr" /></Field>
        <Field label="كلمة المرور"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" dir="ltr" /></Field>
        <Btn size="lg" loading={busy} type="submit">دخول</Btn>
        <p className="login-foot">صاحب محل ذهب؟ <Link to="/register">سجّل حساب محلك للطلب بالجملة</Link></p>
        <p className="login-foot"><Link to="/store">تصفح المتجر بدون تسجيل ←</Link></p>
      </form>
    </div>
  );
}
