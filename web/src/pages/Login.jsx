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
    <div className="auth">
      <div className="auth-art">
        <span className="brand-mark" style={{ width: 54, height: 54, fontSize: '1.6rem' }}>ذ</span>
        <h2>نظام إدارة مصنع الذهب والمجوهرات</h2>
        <p>العهدة والأوزان، الإنتاج، العجز، المخزون، الفواتير، ومتجر الجملة لمحلات الذهب.</p>
      </div>
      <div className="auth-form">
        <form onSubmit={submit}>
          <h1>تسجيل الدخول</h1>
          {err && <div className="alert alert-bad">{err}</div>}
          <Field label="اسم المستخدم"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus autoComplete="username" dir="ltr" /></Field>
          <Field label="كلمة المرور"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" dir="ltr" /></Field>
          <Btn size="lg" loading={busy} type="submit">دخول</Btn>
          <p className="muted small">صاحب محل ذهب؟ <Link to="/register" className="link">سجّل حساب محلك للطلب بالجملة</Link></p>
        </form>
      </div>
    </div>
  );
}
