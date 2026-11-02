import { useEffect, useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { fmtMoney } from '../../format.js';
import { Btn, Card, Field, Input, Loader, Page, useAction, useFetch } from '../../ui.jsx';
import AccountPw from '../Account.jsx';

export default function SAccount() {
  const { data, reload } = useFetch('/store/account');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setF(data.customer); }, [data]);
  if (!data || !f) return <Loader />;
  const locked = data.customer.status === 'approved';
  return (
    <>
      <Page title="بيانات المنشأة" subtitle={`الفئة: ${data.customer.tier_name || '—'} · الرصيد المستحق: ${fmtMoney(data.balance)}`}>
        <Card>
          <div className="grid g3">
            <Field label="اسم المحل"><Input value={f.shop_name} disabled /></Field>
            {[['owner_name', 'اسم المالك'], ['phone', 'الجوال'], ['email', 'البريد'], ['city', 'المدينة'], ['address', 'العنوان']].map(([k, l]) => <Field key={k} label={l}><Input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
            <Field label="الرقم الضريبي" hint={locked ? 'يعدل عبر المصنع بعد الاعتماد' : ''}><Input value={f.vat_number || ''} disabled={locked} onChange={(e) => setF({ ...f, vat_number: e.target.value })} /></Field>
            <Field label="السجل التجاري"><Input value={f.cr_number || ''} disabled={locked} onChange={(e) => setF({ ...f, cr_number: e.target.value })} /></Field>
          </div>
          <Btn className="mt" loading={busy} onClick={() => run(async () => { await api.put('/store/account', f); reload(); }, 'تم الحفظ')}>حفظ</Btn>
        </Card>
        <Card title="مستندات المنشأة" className="mt">
          <div className="files mb">{data.docs.map((d) => <a key={d.id} href={fileUrl(d.path)} target="_blank" rel="noreferrer"><div className="doc">{(d.original_name || '').split('.').pop()?.toUpperCase()}</div><span>{d.original_name}</span></a>)}</div>
          <label className="btn btn-ghost">رفع السجل التجاري / شهادة الضريبة<input type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => { const fd = new FormData(); for (const x of e.target.files) fd.append('files', x); run(async () => { await api.post('/store/account/documents', fd); reload(); }, 'تم رفع المستندات'); }} /></label>
        </Card>
      </Page>
      <AccountPw />
    </>
  );
}
