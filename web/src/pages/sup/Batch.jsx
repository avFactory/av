import { useParams } from 'react-router-dom';
import { fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT, fmtPct, SETTLEMENT_STATUS } from '../../format.js';
import { Btn, Loader, useFetch, ErrorBox } from '../../ui.jsx';

/** كشف جماعي للتسليم/الاستلام قابل للطباعة مع توقيع العامل */
export default function Batch({ print }) {
  const { id } = useParams();
  const { lookups } = useAuth();
  const { data, error } = useFetch(`/sup/batches/${id}`, { live: ['custodies'] });
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { batch: b, lines } = data;
  const issue = b.kind === 'issue';
  const total = (k) => lines.reduce((s, l) => s + Number(l[k] || 0), 0);
  return (
    <div className={print ? '' : 'page'}>
      <div className="row gap end no-print" style={{ padding: 12 }}><Btn onClick={() => window.print()}>طباعة / حفظ PDF</Btn></div>
      <div className="doc-sheet">
        <div className="doc-head">
          <div><img src="/logo.png" alt="AV" className="doc-logo" /><h2>{issue ? 'كشف تسليم ذهب لعامل' : 'كشف استلام ذهب من عامل'}</h2><div>{lookups?.settings?.company?.name || 'مصنع AV للمجوهرات'}</div></div>
          <div style={{ textAlign: 'left' }}><b>{b.batch_no}</b><div>{fmtDT(b.created_at)}</div></div>
        </div>
        <div className="kv mb">
          <div><dt>العامل</dt><dd>{b.worker_name} ({b.employee_no || '—'})</dd></div>
          <div><dt>المشرف</dt><dd>{b.supervisor_name}</dd></div>
          {b.note && <div><dt>ملاحظة</dt><dd>{b.note}</dd></div>}
        </div>
        <div className="table-wrap"><table className="table keep">
          <thead><tr>{issue
            ? ['#', 'رقم العهدة', 'الطلب', 'الوصف', 'المرحلة', 'المادة', 'الوزن (جم)', 'القطع', 'نسبة العجز'].map((h) => <th key={h}>{h}</th>)
            : ['#', 'التسوية', 'الطلب', 'المرحلة', 'المادة', 'المستلم', 'المرتجع', 'البقايا', 'العجز', 'المسموح', 'غير الطبيعي', 'الحالة'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, i) => (issue ? (
              <tr key={i}><td>{i + 1}</td><td>{l.doc_no}</td><td>{l.order_no}</td><td>{l.title}</td><td>{l.stage_name}</td><td>{l.material_name}</td><td className="n">{fmtW(l.weight, 4)}</td><td>{l.pieces}</td><td>{fmtPct(l.rate)}</td></tr>
            ) : (
              <tr key={i}><td>{i + 1}</td><td>{l.doc_no}</td><td>{l.order_no}</td><td>{l.stage_name}</td><td>{l.material_name}</td><td className="n">{fmtW(l.weight_issued, 4)}</td><td className="n">{fmtW(l.returned_weight, 4)}</td>
                <td className="n">{fmtW(l.scrap_weight, 4)}</td><td className="n">{fmtW(l.actual_loss, 4)}</td><td className="n">{fmtW(l.allowed_loss, 4)}</td><td className="n">{fmtW(l.abnormal_loss, 4)}</td><td>{SETTLEMENT_STATUS[l.status]?.[0]}</td></tr>
            )))}
            <tr><td colSpan={issue ? 6 : 5}><b>الإجمالي (كل طلب مسجل كحركة مستقلة)</b></td>
              {issue ? <><td className="n"><b>{fmtW(total('weight'), 4)}</b></td><td colSpan={2} /></> : <><td className="n"><b>{fmtW(total('weight_issued'), 4)}</b></td><td className="n"><b>{fmtW(total('returned_weight'), 4)}</b></td><td className="n"><b>{fmtW(total('scrap_weight'), 4)}</b></td><td className="n"><b>{fmtW(total('actual_loss'), 4)}</b></td><td /><td className="n"><b>{fmtW(total('abnormal_loss'), 4)}</b></td><td /></>}
            </tr>
          </tbody>
        </table></div>
        <div className="mt">
          <b>{issue ? 'القبول الإلكتروني من العامل (بمثابة التوقيع)' : 'تسليم العامل وقبوله'}</b>
          <table className="table keep mt"><tbody>
            {lines.map((l, i) => (
              <tr key={i}><td>{l.order_no}</td><td>{issue
                ? (l.worker_ack_at ? `✓ قبِل العامل الاستلام في ${fmtDT(l.worker_ack_at)}` : l.worker_rejected_at ? `✗ رفض العامل: ${l.worker_reject_reason}` : l.status === 'reversed' ? 'ملغاة' : '⏳ بانتظار قبول العامل')
                : `${l.worker_handover_at ? `أنهى العامل المرحلة وسلّمها في ${fmtDT(l.worker_handover_at)}` : 'استلم المشرف مباشرة'}`}</td></tr>
            ))}
          </tbody></table>
          {b.signature_path && <div className="mt"><span className="muted small">توقيع يدوي مسجل سابقاً ({fmtDT(b.signed_at)})</span><div className="sig-box"><img src={fileUrl(b.signature_path)} alt="توقيع" /></div></div>}
          <div className="small muted mt">المشرف: {b.supervisor_name} · تاريخ الجلسة {fmtDT(b.created_at)}</div>
        </div>
      </div>
    </div>
  );
}
