import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, Tabs, useAction, useFetch, Badge } from '../../ui.jsx';

const ST = { pending: ['بانتظار الموافقة', 'warn'], approved: ['معتمد', 'ok'], rejected: ['مرفوض', 'bad'], suspended: ['موقوف', 'muted'] };

export default function Customers() {
  const nav = useNavigate();
  const { can, lookups } = useAuth();
  const [tab, setTab] = useState('');
  const { data, reload } = useFetch(`/admin/customers${tab ? `?status=${tab}` : ''}`, { live: ['notifications'] });
  const [f, setF] = useState(null);
  const [tier, setTier] = useState('');
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Page title="العملاء - محلات الذهب" actions={can('customers.manage') && <Btn onClick={() => setF({})}>إضافة عميل</Btn>}>
      <Tabs value={tab} onChange={setTab} tabs={[['', 'الكل'], ['pending', 'بانتظار الموافقة'], ['approved', 'المعتمدون'], ['suspended', 'الموقوفون']]} />
      {!data ? <Loader /> : <div className="card"><Table rows={data} onRow={(c) => nav(`/admin/customers/${c.id}`)} columns={[
        ['المحل', (c) => <b>{c.shop_name}</b>], ['المالك', 'owner_name'], ['الجوال', 'phone'], ['المدينة', 'city'], ['الرقم الضريبي', 'vat_number'], ['الفئة', 'tier_name'],
        ['الطلبات', 'orders_count'], ['الرصيد', (c) => fmtMoney(c.balance)], ['الحالة', (c) => <Badge tone={ST[c.status][1]}>{ST[c.status][0]}</Badge>],
        ['', (c) => c.status === 'pending' && can('customers.manage') && <Btn size="sm" kind="ok" onClick={(e) => { e.stopPropagation(); run(async () => { await api.put(`/admin/customers/${c.id}`, { status: 'approved' }); reload(); }, 'تمت الموافقة'); }}>موافقة</Btn>],
      ]} /></div>}
      {can('customers.manage') && (
        <div className="card card-b mt row gap wrap">
          <b>فئات العملاء:</b> {(lookups?.tiers || []).map((t) => <Badge key={t.id}>{t.name}</Badge>)}
          <Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="فئة جديدة" style={{ width: 200 }} />
          <Btn size="sm" kind="ghost" disabled={!tier} onClick={() => run(async () => { await api.post('/admin/tiers', { name: tier }); setTier(''); window.location.reload(); }, 'تمت الإضافة')}>إضافة فئة</Btn>
        </div>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title="عميل جديد" wide>
        {f && <>
          <div className="grid g3">
            {[['shop_name', 'اسم المحل *'], ['owner_name', 'اسم المالك'], ['phone', 'الجوال'], ['phone2', 'جوال آخر'], ['email', 'البريد'], ['city', 'المدينة'], ['address', 'العنوان'], ['vat_number', 'الرقم الضريبي'], ['cr_number', 'السجل التجاري']].map(([k, l]) => <Field key={k} label={l}><Input value={f[k] || ''} onChange={set(k)} /></Field>)}
            <Field label="الفئة"><Select value={f.tier_id || ''} onChange={set('tier_id')} placeholder="—" options={(lookups?.tiers || []).map((t) => [t.id, t.name])} /></Field>
            <Field label="اسم مستخدم للمتجر (اختياري)"><Input value={f.username || ''} onChange={set('username')} dir="ltr" /></Field>
            <Field label="كلمة المرور"><Input type="password" value={f.password || ''} onChange={set('password')} dir="ltr" /></Field>
          </div>
          <div className="row end"><Btn loading={busy} onClick={() => run(async () => { await api.post('/admin/customers', f); setF(null); reload(); }, 'تمت الإضافة')}>حفظ</Btn></div>
        </>}
      </Modal>
    </Page>
  );
}
