import { useParams, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Loader, useAction, useFetch, ReasonModal, ErrorBox } from '../../ui.jsx';
import { useState } from 'react';
import InvoiceDoc from '../../components/InvoiceDoc.jsx';

/** عرض الفاتورة الضريبية (للطباعة / PDF) مع رمز QR للفوترة الإلكترونية */
export default function InvoiceView({ store, print }) {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, reload } = useFetch(store ? `/store/invoices/${id}` : `/finance/invoices/${id}`);
  const [credit, setCredit] = useState(false);
  const [run, busy] = useAction();
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { invoice: i } = data;
  return (
    <div className={print ? '' : 'page'}>
      <div className="hrow gap end no-print mb" style={{ padding: print ? 12 : 0 }}>
        {!print && !store && <Link to="/admin/invoices" className="btn btn-outline-secondary">→ الفواتير</Link>}
        <Btn onClick={() => window.print()}>طباعة / حفظ PDF</Btn>
        {data.link && <a className="btn btn-outline-secondary" href={data.link} target="_blank" rel="noreferrer">رابط الفاتورة</a>}
        {!store && <a className="btn btn-outline-secondary" href={`/api/finance/invoices/${i.id}/xml`}>XML (UBL)</a>}
        {!store && can('invoices.manage') && i.invoice_type === 'invoice' && !i.credited_by && <Btn kind="danger" onClick={() => setCredit(true)}>إلغاء بإشعار دائن</Btn>}
      </div>
      <div className="inv-wrap"><InvoiceDoc data={data} /></div>
      <ReasonModal open={credit} title="إصدار إشعار دائن" danger busy={busy} onClose={() => setCredit(false)} onSubmit={(reason) => run(async () => { await api.post(`/finance/invoices/${i.id}/credit`, { reason }); setCredit(false); reload(); }, 'صدر إشعار دائن')} />
    </div>
  );
}
