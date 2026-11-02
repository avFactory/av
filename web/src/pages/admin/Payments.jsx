import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney, fmtDT } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, useAction, useFetch, Tabs } from '../../ui.jsx';

const KIND = { advance: 'دفعة مقدمة', payment: 'سداد', refund: 'استرداد' };
const METHOD = { cash: 'نقدي', transfer: 'تحويل', card: 'بطاقة', cheque: 'شيك', other: 'أخرى' };

export default function Payments() {
  const { can, lookups } = useAuth();
  const [tab, setTab] = useState('list');
  const { data, reload } = useFetch('/finance/payments');
  const { data: rec } = useFetch(tab === 'rec' ? '/finance/reports/receivables' : null);
  const [f, setF] = useState(null);
  const [invs, setInvs] = useState([]);
  const [run, busy] = useAction();
  useEffect(() => { if (f?.customer_id) api.get(`/finance/invoices?customer_id=${f.customer_id}`).then(setInvs); }, [f?.customer_id]);
  return (
    <Page title="المدفوعات والتحصيل" actions={can('payments.manage') && <Btn onClick={() => setF({ kind: 'payment', method: 'transfer' })}>تسجيل دفعة</Btn>}>
      <Tabs value={tab} onChange={setTab} tabs={[['list', 'الدفعات'], ['rec', 'أرصدة العملاء']]} />
      {tab === 'list' && (!data ? <Loader /> : <div className="card"><Table rows={data} columns={[['الرقم', 'payment_no'], ['العميل', 'shop_name'], ['النوع', (p) => KIND[p.kind]], ['المبلغ', (p) => <b>{fmtMoney(p.amount)}</b>], ['الطريقة', (p) => METHOD[p.method]], ['الفاتورة', 'invoice_no'], ['الطلب', 'order_no'], ['المرجع', 'reference'], ['استلمها', 'received_by_name'], ['التاريخ', (p) => fmtDT(p.received_at)]]} /></div>)}
      {tab === 'rec' && <div className="card"><Table rows={(rec || []).filter((r) => Number(r.invoiced) || Number(r.paid))} columns={[['العميل', 'shop_name'], ['المفوتر', (r) => fmtMoney(r.invoiced)], ['المدفوع', (r) => fmtMoney(r.paid)], ['الرصيد المستحق', (r) => <b>{fmtMoney(Number(r.invoiced) - Number(r.paid))}</b>]]} /></div>}
      <Modal open={!!f} onClose={() => setF(null)} title="تسجيل دفعة">
        {f && <>
          <Field label="العميل"><Select value={f.customer_id || ''} onChange={(e) => setF({ ...f, customer_id: e.target.value, invoice_id: '' })} placeholder="—" options={(lookups?.customers || []).map((c) => [c.id, c.shop_name])} /></Field>
          <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(KIND)} /></Field>
          <Field label="الفاتورة (اختياري)"><Select value={f.invoice_id || ''} onChange={(e) => setF({ ...f, invoice_id: e.target.value })} placeholder="بدون" options={invs.filter((i) => i.invoice_type === 'invoice').map((i) => [i.id, `${i.invoice_no} - ${fmtMoney(i.total)} (مدفوع ${fmtMoney(i.paid)})`])} /></Field>
          <Field label="المبلغ (ر.س)"><Input dir="ltr" inputMode="decimal" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="طريقة الدفع"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={Object.entries(METHOD)} /></Field>
          <Field label="المرجع"><Input value={f.reference || ''} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Btn loading={busy} onClick={() => run(async () => { await api.post('/finance/payments', f); setF(null); reload(); }, 'تم تسجيل الدفعة')}>حفظ</Btn>
        </>}
      </Modal>
    </Page>
  );
}
