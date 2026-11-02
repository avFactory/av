import { useNavigate } from 'react-router-dom';
import { fmtDate, fmtMoney } from '../../format.js';
import { Loader, Page, Table, useFetch, Badge } from '../../ui.jsx';

export default function SInvoices() {
  const nav = useNavigate();
  const { data } = useFetch('/store/invoices');
  const { data: acc } = useFetch('/store/account');
  if (!data) return <Loader />;
  return (
    <Page title="الفواتير والمدفوعات" subtitle={acc ? `الرصيد المستحق: ${fmtMoney(acc.balance)} · إجمالي المفوتر ${fmtMoney(acc.invoiced)} · المدفوع ${fmtMoney(acc.paid)}` : ''}>
      <div className="card"><Table rows={data} onRow={(i) => nav(`/store/invoices/${i.id}`)} columns={[['الرقم', 'invoice_no'], ['النوع', (i) => (i.invoice_type === 'invoice' ? 'فاتورة' : <Badge tone="warn">إشعار دائن</Badge>)], ['التاريخ', (i) => fmtDate(i.issue_date)], ['قبل الضريبة', (i) => fmtMoney(i.subtotal)], ['الضريبة', (i) => fmtMoney(i.vat_amount)], ['الإجمالي', (i) => <b>{fmtMoney(i.total)}</b>], ['المدفوع', (i) => fmtMoney(i.paid)]]} /></div>
    </Page>
  );
}
