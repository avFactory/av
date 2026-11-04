import { useState } from 'react';
import Branches from '../../components/Branches.jsx';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney, fmtDate, STATUS, METHODS } from '../../format.js';
import { Btn, Card, Field, Input, Kv, Loader, Page, Select, StatusBadge, Table, Tabs, useAction, useFetch, Badge, TierBadge } from '../../ui.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const { can, lookups } = useAuth();
  const { data, reload } = useFetch(`/admin/customers/${id}`);
  const { data: st } = useFetch(can('finance.view') ? `/finance/statement/${id}` : null);
  const [tab, setTab] = useState('orders');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const c = data.customer;
  const setStatus = (status) => run(async () => { await api.put(`/admin/customers/${id}`, { status }); reload(); }, 'تم التحديث');
  return (
    <Page title={c.shop_name} subtitle={c.owner_name} back="/admin/customers" actions={can('customers.manage') && <>
      {c.status !== 'approved' && <Btn kind="ok" onClick={() => setStatus('approved')}>موافقة</Btn>}
      {c.status === 'pending' && <Btn kind="ghost" onClick={() => setStatus('rejected')}>رفض</Btn>}
      {c.status === 'approved' && <Btn kind="ghost" onClick={() => setStatus('suspended')}>إيقاف</Btn>}
      <Btn kind="ghost" onClick={() => setEdit({ ...c })}>تعديل</Btn>
    </>}>
      <div className="grid g2 mb">
        <Card title="بيانات المنشأة"><Kv items={[['الحالة', c.status], ['الجوال', c.phone], ['البريد', c.email], ['المدينة', c.city], ['العنوان', c.address], ['الرقم الضريبي', c.vat_number], ['السجل التجاري', c.cr_number], ['التصنيف', <TierBadge name={c.tier_name} color={c.tier_color} />], ['حسابات الدخول', data.users.map((u) => u.username).join('، ')]]} /></Card>
        <Card title="الرصيد"><Kv items={[['الرصيد المستحق', st ? fmtMoney(st.balance) : '—'], ['عدد الطلبات', data.orders.length], ['عدد الفواتير', data.invoices.length]]} />
          <b className="small mt d-block">مستندات المنشأة</b>
          <div className="files">
            {[['cr', 'السجل التجاري'], ['vat', 'الشهادة الضريبية'], ['national_address', 'العنوان الوطني']].map(([t, label]) => {
              const d = data.docs.find((x) => x.doc_type === t);
              return d
                ? <a key={t} href={fileUrl(d.path)} target="_blank" rel="noreferrer">{d.mime?.startsWith('image') ? <img src={fileUrl(d.path)} alt="" /> : <div className="doc">PDF</div>}<span><b>{label}</b></span></a>
                : <span key={t} className="text-body-secondary small border rounded-3 p-2">{label}: غير مرفق</span>;
            })}
            {data.docs.filter((d) => !d.doc_type).map((d) => <a key={d.id} href={fileUrl(d.path)} target="_blank" rel="noreferrer">{d.mime?.startsWith('image') ? <img src={fileUrl(d.path)} alt="" /> : <div className="doc">{(d.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{d.original_name}</span></a>)}
          </div>
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['orders', 'الطلبات'], ['invoices', 'الفواتير'], ['payments', 'المدفوعات'], ['statement', 'كشف الحساب'], ['rates', 'أسعار المصنعية الخاصة'], ['branches', `الفروع (${data.branches.length})`]]} />
      {tab === 'orders' && <div className="card"><Table rows={data.orders} columns={[['الطلب', (o) => <Link className="link" to={`/orders/${o.id}`}>{o.order_no}</Link>], ['الوصف', 'title'], ['الفرع', (o) => o.branch_name || 'الرئيسي'], ['الحالة', (o) => <StatusBadge map={STATUS} value={o.status} />], ['المرحلة', 'stage_name'], ['التاريخ', (o) => fmtDate(o.created_at)]]} /></div>}
      {tab === 'invoices' && <div className="card"><Table rows={data.invoices} columns={[['الفاتورة', (i) => <Link className="link" to={`/admin/invoices/${i.id}`}>{i.invoice_no}</Link>], ['النوع', (i) => (i.invoice_type === 'invoice' ? 'فاتورة' : 'إشعار دائن')], ['الإجمالي', (i) => fmtMoney(i.total)], ['التاريخ', (i) => fmtDate(i.issue_date)]]} /></div>}
      {tab === 'payments' && <div className="card"><Table rows={data.payments} columns={[['الرقم', 'payment_no'], ['النوع', 'kind'], ['المبلغ', (p) => fmtMoney(p.amount)], ['الطريقة', 'method'], ['التاريخ', (p) => fmtDate(p.received_at)]]} /></div>}
      {tab === 'statement' && <div className="card"><Table rows={st?.rows || []} columns={[['التاريخ', (r) => fmtDate(r.date)], ['المرجع', 'ref'], ['البيان', 'type'], ['مدين', (r) => fmtMoney(r.debit)], ['دائن', (r) => fmtMoney(r.credit)], ['الرصيد', (r) => fmtMoney(r.balance)]]} /></div>}
      {tab === 'rates' && <div className="card"><Table rows={data.rates} empty="لا توجد أسعار خاصة - تضاف من صفحة أجور التصنيع" columns={[['القاعدة', 'name'], ['الطريقة', (r) => METHODS[r.method]], ['الأجرة', (r) => fmtMoney(r.rate)], ['نوع المنتج', 'product_type'], ['الحالة', (r) => (r.active ? <Badge tone="ok">فعالة</Badge> : <Badge>ملغاة</Badge>)]]} /><div className="card-body"><Link className="link" to="/admin/labor">إدارة أجور التصنيع ←</Link></div></div>}
      {tab === 'branches' && <Branches list={data.branches} base={`/admin/customers/${id}/branches`} onChange={reload} />}
      {edit && (
        <Card title="تعديل البيانات" className="mt">
          <div className="grid g3">
            {[['shop_name', 'اسم المحل'], ['short_name', 'الاسم المختصر (للملصق، حتى 3 كلمات)'], ['owner_name', 'المالك'], ['phone', 'الجوال'], ['phone2', 'جوال آخر'], ['email', 'البريد'], ['city', 'المدينة'], ['address', 'العنوان'], ['vat_number', 'الرقم الضريبي'], ['cr_number', 'السجل التجاري'], ['notes', 'ملاحظات']].map(([k, l]) => <Field key={k} label={l}><Input value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
            <Field label="التصنيف"><Select value={edit.tier_id || ''} onChange={(e) => setEdit({ ...edit, tier_id: e.target.value })} placeholder="—" options={(lookups?.tiers || []).map((t) => [t.id, t.name])} /></Field>
          </div>
          <div className="hrow gap end mt"><Btn kind="ghost" onClick={() => setEdit(null)}>إلغاء</Btn><Btn loading={busy} onClick={() => run(async () => { const { status, ...rest } = edit; await api.put(`/admin/customers/${id}`, rest); setEdit(null); reload(); }, 'تم الحفظ')}>حفظ</Btn></div>
        </Card>
      )}
    </Page>
  );
}
