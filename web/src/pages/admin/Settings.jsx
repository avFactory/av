import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Card, Field, Input, Loader, Page, Select, useAction, useFetch } from '../../ui.jsx';

export default function Settings() {
  const { refresh } = useAuth();
  const { data } = useFetch('/admin/settings');
  const [s, setS] = useState(null);
  const [dept, setDept] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (data) setS(data); }, [data]);
  if (!s) return <Loader />;
  const c = s.company || {};
  const setC = (k) => (e) => setS({ ...s, company: { ...c, [k]: e.target.value } });
  const ch = s.notify_channels || {};
  return (
    <Page title="الإعدادات">
      <div className="grid">
        <Card title="بيانات المنشأة (تظهر في الفواتير)">
          <div className="grid g3">
            <Field label="اسم المصنع"><Input value={c.name || ''} onChange={setC('name')} /></Field>
            <Field label="الرقم الضريبي"><Input value={c.vat_number || ''} onChange={setC('vat_number')} dir="ltr" /></Field>
            <Field label="السجل التجاري"><Input value={c.cr_number || ''} onChange={setC('cr_number')} dir="ltr" /></Field>
            <Field label="العنوان"><Input value={c.address || ''} onChange={setC('address')} /></Field>
            <Field label="الهاتف"><Input value={c.phone || ''} onChange={setC('phone')} dir="ltr" /></Field>
          </div>
        </Card>
        <Card title="الضريبة والأوزان والرقابة">
          <div className="grid g3">
            <Field label="نسبة ضريبة القيمة المضافة %"><Input value={s.vat_rate} onChange={(e) => setS({ ...s, vat_rate: e.target.value })} dir="ltr" /></Field>
            <Field label="دقة عرض الوزن (خانات عشرية)" hint="التخزين دائماً بدقة 4 خانات"><Select value={String(s.weight_decimals)} onChange={(e) => setS({ ...s, weight_decimals: Number(e.target.value) })} options={[['3', '3 خانات'], ['4', '4 خانات']]} /></Field>
            <Field label="حد المراجعة للعجز غير الطبيعي (جم)" hint="0 = أي تجاوز يحال للمراجعة"><Input value={s.abnormal_threshold} onChange={(e) => setS({ ...s, abnormal_threshold: e.target.value })} dir="ltr" /></Field>
            <Field label="أرقام العمال في شاشة صرف الألماس" hint="الأرقام الوظيفية مفصولة بفاصلة، مثال: 16, 17, 18, 19 — فارغ = كل العمال">
              <Input dir="ltr" value={Array.isArray(s.diamond_worker_nos) ? s.diamond_worker_nos.join(', ') : (s.diamond_worker_nos ?? '')} onChange={(e) => setS({ ...s, diamond_worker_nos: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="قنوات الإشعارات الخارجية للعملاء">
          <p className="small muted mb">تتطلب ضبط مفاتيح المزود على الخادم (متغيرات البيئة) - لا توضع المفاتيح في الواجهة.</p>
          <div className="hrow gap wrap">{[['whatsapp', 'WhatsApp Business'], ['sms', 'SMS'], ['email', 'البريد الإلكتروني']].map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={!!ch[k]} onChange={(e) => setS({ ...s, notify_channels: { ...ch, [k]: e.target.checked } })} />{l}</label>)}</div>
        </Card>
        <div className="hrow end"><Btn size="lg" loading={busy} onClick={() => run(async () => { await api.put('/admin/settings', { company: s.company, vat_rate: Number(s.vat_rate), weight_decimals: Number(s.weight_decimals), abnormal_threshold: Number(s.abnormal_threshold), notify_channels: s.notify_channels, diamond_worker_nos: (Array.isArray(s.diamond_worker_nos) ? s.diamond_worker_nos : String(s.diamond_worker_nos || '').split(/[,،\s]+/)).map((x) => String(x).trim()).filter(Boolean) }); await refresh(); }, 'تم حفظ الإعدادات')}>حفظ الإعدادات</Btn></div>
        <Card title="الأقسام">
          <div className="hrow gap">
            <Input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="اسم قسم جديد" style={{ maxWidth: 260 }} />
            <Btn kind="ghost" disabled={!dept} onClick={() => run(async () => { await api.post('/admin/departments', { name: dept }); setDept(''); await refresh(); }, 'تمت الإضافة')}>إضافة قسم</Btn>
          </div>
        </Card>
      </div>
    </Page>
  );
}
