import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Btn, Card, Field, Input, Page, useAction, useToast } from '../ui.jsx';

export default function Account() {
  const { me } = useAuth();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [run, busy] = useAction();
  const toast = useToast();
  const save = () => {
    if (f.next.length < 8) return toast('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف', 'bad');
    if (f.next !== f.confirm) return toast('تأكيد كلمة المرور غير مطابق', 'bad');
    return run(async () => { await api.post('/auth/change-password', { current: f.current, next: f.next }); setF({ current: '', next: '', confirm: '' }); }, 'تم تغيير كلمة المرور');
  };
  return (
    <Page title="حسابي" subtitle={`${me.full_name} · ${me.username}`}>
      <Card title="تغيير كلمة المرور">
        <div className="grid g3" style={{ maxWidth: 820 }}>
          <Field label="كلمة المرور الحالية"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} dir="ltr" autoComplete="current-password" /></Field>
          <Field label="الجديدة (8 أحرف على الأقل)"><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} dir="ltr" autoComplete="new-password" /></Field>
          <Field label="تأكيد الجديدة"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} dir="ltr" autoComplete="new-password" /></Field>
        </div>
        <Btn className="mt" loading={busy} disabled={!f.current || !f.next} onClick={save}>تغيير كلمة المرور</Btn>
        <p className="small muted mt">بعد التغيير يتم تسجيل خروجك من أي جهاز آخر، وتبقى داخلاً على هذا الجهاز.</p>
      </Card>
    </Page>
  );
}
