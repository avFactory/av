import { useState } from 'react';
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
          {data.docs.length > 0 && <><b className="small mt">مستندات المنشأة</b><div className="files">{data.docs.map((d) => <a key={d.id} href={fileUrl(d.path)} target="_blank" rel="noreferrer"><div className="doc">{(d.original_name || '').split('.').pop()?.toUpperCase()}</div><span>{d.original_name}</span></a>)}</div></>}
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['orders', 'الطلبات'], ['invoices', 'الفواتير'], ['payments', 'المدفوعات'], ['statement', 'كشف الحساب'], ['rates', 'أسعار المصنعية الخاصة']]} />
      {tab === 'orders' && <div className="card"><Table rows={data.orders} columns={[['الطلب', (o) => <Link className="link" to={`/orders/${o.id}`}>{o.order_no}</Link>], ['الوصف', 'title'], ['الحالة', (o) => <StatusBadge map={STATUS} value={o.status} />], ['المرحلة', 'stage_name'], ['التاريخ', (o) => fmtDate(o.created_at)]]} /></div>}
      {tab === 'invoices' && <div className="card"><Table rows={data.invoices} columns={[['الفاتورة', (i) => <Link className="link" to={`/admin/invoices/${i.id}`}>{i.invoice_no}</Link>], ['النوع', (i) => (i.invoice_type === 'invoice' ? 'فاتورة' : 'إشعار دائن')], ['الإجمالي', (i) => fmtMoney(i.total)], ['التاريخ', (i) => fmtDate(i.issue_date)]]} /></div>}
      {tab === 'payments' && <div className="card"><Table rows={data.payments} columns={[['الرقم', 'payment_no'], ['النوع', 'kind'], ['المبلغ', (p) => fmtMoney(p.amount)], ['الطريقة', 'method'], ['التاريخ', (p) => fmtDate(p.received_at)]]} /></div>}
      {tab === 'statement' && <div className="card"><Table rows={st?.rows || []} columns={[['التاريخ', (r) => fmtDate(r.date)], ['المرجع', 'ref'], ['البيان', 'type'], ['مدين', (r) => fmtMoney(r.debit)], ['دائن', (r) => fmtMoney(r.credit)], ['الرصيد', (r) => fmtMoney(r.balance)]]} /></div>}
      {tab === 'rates' && <div className="card"><Table rows={data.rates} empty="لا توجد أسعار خاصة - تضاف من صفحة أجور التصنيع" columns={[['القاعدة', 'name'], ['الطريقة', (r) => METHODS[r.method]], ['الأجرة', (r) => fmtMoney(r.rate)], ['نوع المنتج', 'product_type'], ['الحالة', (r) => (r.active ? <Badge tone="ok">فعالة</Badge> : <Badge>ملغاة</Badge>)]]} /><div className="card-body"><Link className="link" to="/admin/labor">إدارة أجور التصنيع ←</Link></div></div>}
      {edit && (
        <Card title="تعديل البيانات" className="mt">
          <div className="grid g3">
            {['shop_name', 'owner_name', 'phone', 'phone2', 'email', 'city', 'address', 'vat_number', 'cr_number', 'notes'].map((k) => <Field key={k} label={k}><Input value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>)}
            <Field label="التصنيف"><Select value={edit.tier_id || ''} onChange={(e) => setEdit({ ...edit, tier_id: e.target.value })} placeholder="—" options={(lookups?.tiers || []).map((t) => [t.id, t.name])} /></Field>
          </div>
          <div className="hrow gap end mt"><Btn kind="ghost" onClick={() => setEdit(null)}>إلغاء</Btn><Btn loading={busy} onClick={() => run(async () => { const { status, ...rest } = edit; await api.put(`/admin/customers/${id}`, rest); setEdit(null); reload(); }, 'تم الحفظ')}>حفظ</Btn></div>
        </Card>
      )}
    </Page>
  );
}
