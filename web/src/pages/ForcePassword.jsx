import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Btn, Field, Input } from '../ui.jsx';

/** شاشة إلزامية لتغيير كلمة المرور عند أول دخول */
export default function ForcePassword() {
  const { me, refresh, logout } = useAuth();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (f.next.length < 8) return setErr('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
    if (f.next !== f.confirm) return setErr('تأكيد كلمة المرور غير مطابق');
    setBusy(true);
    try { await api.post('/auth/change-password', { current: f.current, next: f.next }); await refresh(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-form" style={{ minHeight: '100vh' }}>
      <form onSubmit={submit}>
        <img src="/logo.png" alt="AV" className="login-logo" />
        <h1>مرحباً {me.full_name}</h1>
        <p className="muted">لحماية عهدتك وتوقيعك، اختر كلمة مرور خاصة بك لا يعرفها غيرك.</p>
        {err && <div className="alert alert-danger">{err}</div>}
        <Field label="كلمة المرور الحالية (التي أعطتك إياها الإدارة)"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} dir="ltr" autoFocus autoComplete="current-password" /></Field>
        <Field label="كلمة المرور الجديدة (8 أحرف على الأقل)"><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} dir="ltr" autoComplete="new-password" /></Field>
        <Field label="تأكيد كلمة المرور الجديدة"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} dir="ltr" autoComplete="new-password" /></Field>
        <Btn size="lg" type="submit" loading={busy}>حفظ ومتابعة</Btn>
        <button type="button" className="link small" onClick={logout}>خروج</button>
      </form>
    </div>
  );
}
