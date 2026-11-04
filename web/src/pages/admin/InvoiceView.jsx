import { useParams, Link } from 'react-router-dom';
import { api, qrUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney, fmtDT } from '../../format.js';
import { Btn, Loader, useAction, useFetch, ReasonModal, ErrorBox } from '../../ui.jsx';
import { useState } from 'react';

const KIND = { labor: 'أجور تصنيع', stage_labor: 'أجرة مرحلة', stones: 'ألماس مخبري/أحجار', service: 'خدمة', other: 'أخرى' };

/** عرض الفاتورة الضريبية (للطباعة / PDF) مع رمز QR للفوترة الإلكترونية */
export default function InvoiceView({ store, print }) {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, reload } = useFetch(store ? `/store/invoices/${id}` : `/finance/invoices/${id}`);
  const [credit, setCredit] = useState(false);
  const [run, busy] = useAction();
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { invoice: i, lines, payments, company } = data;
  const paid = payments.reduce((s, p) => s + (p.kind === 'refund' ? -1 : 1) * Number(p.amount), 0);
  return (
    <div className={print ? '' : 'page'}>
      <div className="hrow gap end no-print mb" style={{ padding: print ? 12 : 0 }}>
        {!print && !store && <Link to="/admin/invoices" className="btn btn-outline-secondary">→ الفواتير</Link>}
        <Btn onClick={() => window.print()}>طباعة / حفظ PDF</Btn>
        {!store && <a className="btn btn-outline-secondary" href={`/api/finance/invoices/${i.id}/xml`}>XML (UBL)</a>}
        {!store && can('invoices.manage') && i.invoice_type === 'invoice' && !i.credited_by && <Btn kind="danger" onClick={() => setCredit(true)}>إلغاء بإشعار دائن</Btn>}
      </div>
      <div className="doc-sheet">
        <div className="doc-head">
          <div>
            <img src="/logo.png" alt="AV" className="doc-logo" />
            <h2>{i.invoice_type === 'invoice' ? 'فاتورة ضريبية' : 'إشعار دائن'}</h2>
            <div><b>{company.name}</b></div>
            <div className="small">الرقم الضريبي: {company.vat_number || '—'} · السجل: {company.cr_number || '—'}</div>
            <div className="small">{company.address}</div>
          </div>
          <img src={qrUrl(i.qr_tlv)} alt="QR الفوترة الإلكترونية" style={{ width: 120, height: 120 }} />
        </div>
        <div className="kv mb">
          <div><dt>رقم الفاتورة</dt><dd>{i.invoice_no}</dd></div>
          <div><dt>التاريخ</dt><dd>{fmtDT(i.issue_date)}</dd></div>
          <div><dt>العميل</dt><dd>{i.shop_name}</dd></div>
          <div><dt>الرقم الضريبي للعميل</dt><dd>{i.customer_vat || '—'}</dd></div>
          {i.credit_for_no && <div><dt>مرجع الفاتورة الأصلية</dt><dd>{i.credit_for_no}</dd></div>}
          {i.credited_by && <div><dt>ملغاة بإشعار دائن</dt><dd>{i.credited_by}</dd></div>}
          <div><dt>UUID</dt><dd className="small" dir="ltr">{i.uuid}</dd></div>
        </div>
        <div className="table-wrap"><table className="table keep">
          <thead><tr><th>#</th><th>البند</th><th>النوع</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>المبلغ</th></tr></thead>
          <tbody>
            {lines.map((l, n) => <tr key={l.id}><td>{n + 1}</td><td>{l.description}</td><td>{KIND[l.kind]}</td><td className="n">{l.qty}</td><td>{l.unit}</td><td className="n">{fmtMoney(l.unit_price)}</td><td className="n">{fmtMoney(l.amount)}</td></tr>)}
            <tr><td colSpan={6}>الإجمالي قبل الضريبة</td><td className="n">{fmtMoney(i.subtotal)}</td></tr>
            <tr><td colSpan={6}>ضريبة القيمة المضافة ({Number(i.vat_rate)}%)</td><td className="n">{fmtMoney(i.vat_amount)}</td></tr>
            <tr><td colSpan={6}><b>الإجمالي شامل الضريبة</b></td><td className="n"><b>{fmtMoney(i.total)}</b></td></tr>
            {!!payments.length && <tr><td colSpan={6}>المدفوع</td><td className="n">{fmtMoney(paid)}</td></tr>}
          </tbody>
        </table></div>
        <p className="small mt">الفاتورة تشمل أجور التصنيع والبنود المذكورة فقط، ولا تشمل قيمة الذهب.</p>
        {i.notes && <p className="small">{i.notes}</p>}
      </div>
      <ReasonModal open={credit} title="إصدار إشعار دائن" danger busy={busy} onClose={() => setCredit(false)} onSubmit={(reason) => run(async () => { await api.post(`/finance/invoices/${i.id}/credit`, { reason }); setCredit(false); reload(); }, 'صدر إشعار دائن')} />
    </div>
  );
}
