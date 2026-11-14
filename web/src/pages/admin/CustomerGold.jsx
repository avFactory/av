import { Link } from 'react-router-dom';
import { fmtW, fmtMoney } from '../../format.js';
import { Empty, Loader, Page, Table, useFetch } from '../../ui.jsx';

/** الذهب لدى عملاء الجملة: رصيد الذهب الصافي عيار 24 لكل عميل من كشف حسابه */
export default function CustomerGold() {
  const { data } = useFetch('/admin/customer-gold', { live: ['gold_ledger', 'orders'] });
  if (!data) return <Loader />;
  const owe = data.rows.filter((r) => r.pure > 0);
  const credit = data.rows.filter((r) => r.pure <= 0);
  const cols = [
    ['العميل', (r) => <Link to={`/admin/customers/${r.id}/statement`} className="fw-bold">{r.shop_name}</Link>],
    ['الفئة', (r) => r.tier_name || '—'],
    ['الجوال', (r) => (r.phone ? <a href={`tel:${r.phone}`} dir="ltr">{r.phone}</a> : '—')],
    ['الذهب صافي 24', (r) => <b className="n" dir="ltr">{fmtW(r.pure)} جم</b>],
    ['المبالغ', (r) => <span className="n">{fmtMoney(r.money)}</span>],
    ['', (r) => <Link to={`/admin/customers/${r.id}/statement`} className="small">كشف الحساب ←</Link>],
  ];
  return (
    <Page title="الذهب لدى الجملة" subtitle={`${data.count} عميل عليهم ذهب · الإجمالي ${fmtW(data.total)} جم صافي عيار 24`} back="/admin">
      {!owe.length ? <Empty>لا يوجد ذهب لدى العملاء</Empty> : <div className="card mb"><Table rows={owe} columns={cols} /></div>}
      {credit.length > 0 && (
        <details className="card">
          <summary className="card-body py-2">عملاء لهم رصيد ذهب دائن أو أرصدة مبالغ فقط ({credit.length})</summary>
          <Table rows={credit} columns={cols} />
        </details>
      )}
    </Page>
  );
}
