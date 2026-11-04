import { useEffect, useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { fmtMoney } from '../../format.js';
import { Btn, Card, Field, Input, Loader, Page, useAction, useFetch } from '../../ui.jsx';
import AccountPw from '../Account.jsx';
import Branches from '../../components/Branches.jsx';
import { Kv } from '../../ui.jsx';

export default function SAccount() {
  const { data, reload } = useFetch('/store/account');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setF(data.customer); }, [data]);
  if (!data || !f) return <Loader />;
  const locked = data.customer.status === 'approved';
  if (!data.is_main) {
    // حساب فرع: عرض بيانات الفرع فقط، وبيانات المنشأة يعدلها الحساب الرئيسي
    return (
      <>
        <Page title={`${data.customer.shop_name} — ${data.branch.name}`} subtitle="حساب فرع">
          <Card title="بيانات الفرع"><Kv items={[['الفرع', data.branch.name], ['المدينة', data.branch.city], ['العنوان', data.branch.address], ['الجوال', data.branch.phone], ['التصنيف', data.customer.tier_name]]} /></Card>
          <div className="alert alert-info small mt">بيانات المنشأة والفروع يديرها الحساب الرئيسي للمحل.</div>
        </Page>
        <AccountPw />
      </>
    );
  }
  return (
    <>
      <Page title="بيانات المنشأة" subtitle={`التصنيف: ${data.customer.tier_name || "—"} · الرصيد المستحق: ${fmtMoney(data.balance)}`}>
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
          <div className="files mb">{data.docs.map((d) => <a key={d.id} href={fileUrl(d.path)} target="_blank" rel="noreferrer">{d.mime?.startsWith('image') ? <img src={fileUrl(d.path, 400)} alt="" /> : <div className="doc">{(d.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{{ cr: 'السجل التجاري', vat: 'الشهادة الضريبية', national_address: 'العنوان الوطني' }[d.doc_type] || d.original_name}</span></a>)}</div>
          <label className="btn btn-outline-secondary">رفع السجل التجاري / شهادة الضريبة<input type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => { const fd = new FormData(); for (const x of e.target.files) fd.append('files', x); run(async () => { await api.post('/store/account/documents', fd); reload(); }, 'تم رفع المستندات'); }} /></label>
        </Card>
        {data.customer.status === 'approved' && <div className="mt"><BranchesBox /></div>}
      </Page>
      <AccountPw />
    </>
  );
}

function BranchesBox() {
  const { data, reload } = useFetch('/store/branches');
  if (!data) return <Loader />;
  return <Branches list={data} base="/store/branches" onChange={reload} hint="لكل فرع كلمة مرور خاصة. عند الدخول يكتب الفرع اسم مستخدم المحل، ثم يختار فرعه، ثم كلمة مرور الفرع. كل فرع يرى طلباته فقط، والحساب الرئيسي يرى الجميع." />;
}
