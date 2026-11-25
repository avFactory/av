import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Btn, Field, Input, ThemeToggle } from '../ui.jsx';
import { loginWithPasskey, passkeySupported, platformAvailable, registerPasskey } from '../passkey.js';
import { askConfirm } from '../ui.jsx';

// منع التحويل لموقع خارجي بعد الدخول: مسار داخلي فقط
const safeNext = (v) => (typeof v === 'string' && /^\/(?![\/\\])[^\s]*$/.test(v) && !/[\\]|%5c|%2f%2f/i.test(v) ? v : null);

/** بعد الدخول بكلمة المرور على جهاز فيه بصمة/وجه: عرض تفعيل الدخول بالبصمة مرة واحدة لكل مستخدم على الجهاز */
async function offerPasskey(username) {
  const key = `pk_offer:${String(username).toLowerCase()}`;
  try { if (localStorage.getItem(key)) return; } catch { return; }
  if (!passkeySupported() || !(await platformAvailable())) return;
  try {
    const mine = await api.get('/auth/passkeys');
    try { localStorage.setItem(key, '1'); } catch { /* */ }
    if (mine.length) return;
    if (await askConfirm('تبي تدخل المرة الجاية ببصمة الإصبع أو الوجه بدل كلمة المرور؟\nالبصمة تبقى في جهازك ولا تُرسل للنظام.', { title: 'الدخول بالبصمة', ok: '👆 تفعيل الآن' })) await registerPasskey();
  } catch { /* يمكن تفعيلها لاحقاً من «حسابي» */ }
}

export default function Login() {
  const { me, refresh } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // فروع المحل: تُجلب بعد كتابة اسم المستخدم، ويختار العميل فرعه قبل كلمة المرور
  const [branches, setBranches] = useState({ for: null, list: [] });
  const [branch, setBranch] = useState(null);
  if (me) return <Navigate to={safeNext(sp.get('next')) || homeFor(me)} replace />;
  const loadBranches = async (username) => {
    const u = username.trim();
    if (!u || branches.for === u.toLowerCase()) return branches.list;
    try {
      const r = await api.post('/auth/login-options', { username: u });
      setBranches({ for: u.toLowerCase(), list: r.branches, main: r.main !== false });
      setBranch(null);
      return r.branches;
    } catch { return []; }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const list = await loadBranches(f.username);
      if (list.length && branch === null) { setErr('اختر الفرع ثم اكتب كلمة مرور الفرع'); return; }
      await api.post('/auth/login', { ...f, branch_id: branch && branch !== '0' ? branch : undefined });
      await offerPasskey(f.username);
      await refresh();
      nav(safeNext(sp.get('next')) || '/', { replace: true });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const hasBranches = branches.for === f.username.trim().toLowerCase() && branches.list.length > 0;
  const bio = async () => {
    setBusy(true); setErr(null);
    try { await loginWithPasskey(); await refresh(); nav(safeNext(sp.get('next')) || '/', { replace: true }); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-screen">
      <div className="login-bg" aria-hidden="true" />
      <ThemeToggle light className="login-theme" />
      <form className="login-card" onSubmit={submit}>
        <img src="/logo-white.png" alt="AV" className="login-card-logo" />
        <h1>مصنع AV للمجوهرات</h1>
        <p className="login-sub">AV Jewelry Factory · تسجيل الدخول</p>
        {err && <div className="alert alert-danger">{err}</div>}
        <Field label="اسم المستخدم"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} onBlur={(e) => loadBranches(e.target.value)} autoFocus autoComplete="username" dir="ltr" /></Field>
        {hasBranches && (
          <Field label="اختر الفرع">
            <select className="form-select" value={branch ?? ''} onChange={(e) => setBranch(e.target.value === '' ? null : e.target.value)} autoFocus>
              <option value="" disabled>— اختر —</option>
              {branches.main !== false && <option value="0">الحساب الرئيسي للمحل</option>}
              {branches.list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={hasBranches && branch && branch !== '0' ? 'كلمة مرور الفرع' : 'كلمة المرور'}><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" dir="ltr" /></Field>
        <Btn size="lg" loading={busy} type="submit">دخول</Btn>
        {passkeySupported() && <>
          <div className="login-or"><span>أو</span></div>
          <button type="button" className="btn btn-outline-light btn-lg login-bio" disabled={busy} onClick={bio}>
            <span aria-hidden="true">👆</span> الدخول بالبصمة أو الوجه
          </button>
        </>}
        <p className="login-foot">صاحب محل ذهب؟ <Link to="/register">سجّل حساب محلك للطلب بالجملة</Link></p>
      </form>
    </div>
  );
}
