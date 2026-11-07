import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import InvoiceDoc from '../components/InvoiceDoc.jsx';
import { Loader } from '../ui.jsx';

/** الفاتورة برابط عام (من رمز QR المطبوع عليها): عرض وطباعة فقط بدون تسجيل دخول */
export default function PublicInvoice() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch(`/api/public/invoice/${encodeURIComponent(token)}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); }).catch((e) => setErr(e.message || 'تعذر فتح الفاتورة'));
  }, [token]);
  useEffect(() => { document.documentElement.setAttribute('data-bs-theme', 'light'); }, []);
  if (err) return <div className="container py-5 text-center"><h1 className="h5">{err}</h1></div>;
  if (!d) return <Loader />;
  return (
    <div className="inv-wrap">
      <div className="text-center mb-3 no-print"><button type="button" className="btn btn-dark" onClick={() => window.print()}>طباعة / حفظ PDF</button></div>
      <InvoiceDoc data={d} />
    </div>
  );
}
