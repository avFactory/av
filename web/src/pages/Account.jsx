import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Btn, Card, Field, Input, Page, useAction } from '../ui.jsx';

export default function Account() {
  const { me } = useAuth();
  const [f, setF] = useState({ current: '', next: '' });
  const [run, busy] = useAction();
  return (
    <Page title="حسابي" subtitle={`${me.full_name} · ${me.username}`}>
      <Card title="تغيير كلمة المرور">
        <div className="grid g2" style={{ maxWidth: 600 }}>
          <Field label="الحالية"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} dir="ltr" /></Field>
          <Field label="الجديدة (8 أحرف على الأقل)"><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} dir="ltr" /></Field>
        </div>
        <Btn className="mt" loading={busy} onClick={() => run(async () => { await api.post('/auth/change-password', f); window.location.href = '/login'; }, 'تم التغيير - سجل الدخول مجدداً')}>تغيير</Btn>
      </Card>
    </Page>
  );
}
