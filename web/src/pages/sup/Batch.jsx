import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT, fmtPct, SETTLEMENT_STATUS } from '../../format.js';
import { Btn, Loader, SignaturePad, useAction, useFetch, ErrorBox } from '../../ui.jsx';

/** كشف جماعي للتسليم/الاستلام قابل للطباعة مع توقيع العامل */
export default function Batch({ print }) {
  const { id } = useParams();
  const { lookups } = useAuth();
  const { data, error, reload } = useFetch(`/sup/batches/${id}`);
  const [sig, setSig] = useState(null);
  const [run, busy] = useAction();
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
        <div className="grid g2 mt">
          <div><div className="muted small">توقيع العامل {b.signed_at ? `(${fmtDT(b.signed_at)})` : ''}</div><div className="sig-box">{b.signature_path ? <img src={fileUrl(b.signature_path)} alt="توقيع العامل" /> : null}</div></div>
          <div><div className="muted small">توقيع المشرف</div><div className="sig-box" /></div>
        </div>
        {!b.signature_path && (
          <div className="no-print mt">
            <b>توقيع العامل على الكشف</b>
            <SignaturePad onChange={setSig} />
            <Btn className="mt" loading={busy} disabled={!sig} onClick={() => run(async () => { await api.post(`/sup/batches/${b.id}/sign`, { signature: sig }); reload(); }, 'تم حفظ التوقيع')}>حفظ التوقيع</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
