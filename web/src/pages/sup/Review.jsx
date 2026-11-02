import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT, fmtPct, SETTLEMENT_STATUS } from '../../format.js';
import { Btn, Card, Field, Loader, Modal, Page, Select, StatusBadge, Tabs, Textarea, WeightInput, useAction, useFetch, Empty, Kv } from '../../ui.jsx';

const DECISIONS = [['no_fault', 'لا مسؤولية - فقد مبرر'], ['accept_loss', 'اعتماد الفقد'], ['recovered', 'تم استرداد العجز'], ['worker_responsible', 'مسؤولية العامل (بعد التحقيق)']];

export default function Review() {
  const { can } = useAuth();
  const [tab, setTab] = useState('open');
  const { data, reload } = useFetch(`/sup/reviews${tab === 'all' ? '?all=1' : ''}`, { live: ['settlements'] });
  const [act, setAct] = useState(null);
  const [f, setF] = useState({});
  const [run, busy] = useAction();
  const submit = () => run(async () => {
    if (act.mode === 'investigation') await api.post(`/sup/reviews/${act.s.id}/investigation`, f);
    else await api.post(`/sup/reviews/${act.s.id}`, { decision: act.mode, notes: f.notes });
    setAct(null); setF({}); reload();
  }, 'تم تسجيل القرار');
  const reverse = (s) => {
    const reason = window.prompt('سبب تصحيح التسوية (سيتم عكس حركاتها وإعادة فتح العهدة):');
    if (reason) run(async () => { await api.post(`/sup/settlements/${s.id}/reverse`, { reason }); reload(); }, 'تم التصحيح بحركة عكسية');
  };
  return (
    <Page title="مراجعة العجز" subtitle="العجز غير الطبيعي ليس دليلاً تلقائياً على مسؤولية العامل" back="/sup">
      <Tabs value={tab} onChange={setTab} tabs={[['open', 'بانتظار القرار'], ['all', 'كل الحالات']]} />
      {!data ? <Loader /> : !data.length ? <Empty>لا توجد حالات</Empty> : (
        <div className="grid">
          {data.map((s) => (
            <Card key={s.id} title={<span>{s.settlement_no} · <Link className="link" to={`/orders/${s.order_id}`}>{s.order_no}</Link> · {s.worker_name}</span>} actions={<StatusBadge map={SETTLEMENT_STATUS} value={s.status} />}>
              <div className="calc mb">
                <div><span>المستلم</span><b>{fmtW(s.weight_issued)}</b></div>
                <div><span>المرتجع</span><b>{fmtW(s.returned_weight)}</b></div>
                <div><span>البقايا</span><b>{fmtW(s.scrap_weight)}</b></div>
                <div><span>العجز الفعلي</span><b>{fmtW(s.actual_loss)}</b></div>
                <div><span>المسموح ({fmtPct(s.rate_snapshot)})</span><b>{fmtW(s.allowed_loss)}</b></div>
                <div className={Number(s.abnormal_loss) > 0 ? 'bad' : ''}><span>غير الطبيعي</span><b>{fmtW(s.abnormal_loss)}</b></div>
                {Number(s.gain_weight) > 0 && <div className="bad"><span>زيادة</span><b>{fmtW(s.gain_weight)}</b></div>}
                {Number(s.recovered_weight) > 0 && <div className="ok"><span>مسترد</span><b>{fmtW(s.recovered_weight)}</b></div>}
              </div>
              <Kv items={[['المرحلة', s.stage_name], ['المادة', s.material_name], ['السبب المسجل', s.reason], ['استلمها', `${s.received_by_name} · ${fmtDT(s.received_at)}`],
                s.review_notes && ['ملاحظات المراجعة', `${s.review_notes} (${s.reviewed_by_name || ''})`], s.investigation_result && ['نتيجة التحقيق', `${s.investigation_result} (${s.resolved_by_name || ''})`],
                s.review_decision && ['القرار', DECISIONS.find((d) => d[0] === s.review_decision)?.[1]]]} />
              <div className="hrow gap wrap mt">
                {s.status === 'pending_review' && can('loss.approve') && <Btn kind="ok" onClick={() => setAct({ s, mode: 'approve' })}>اعتماد التسوية</Btn>}
                {s.status === 'pending_review' && can('loss.review') && <Btn kind="ghost" onClick={() => setAct({ s, mode: 'investigate' })}>إحالة للتحقيق</Btn>}
                {['pending_review', 'investigating'].includes(s.status) && can('loss.investigate') && <Btn kind="dark" onClick={() => { setF({ decision: 'no_fault', recovered_weight: '0' }); setAct({ s, mode: 'investigation' }); }}>تسجيل نتيجة التحقيق</Btn>}
                {s.status !== 'reversed' && can('custody.reverse') && <Btn kind="ghost" size="sm" onClick={() => reverse(s)}>تصحيح التسوية</Btn>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!act} onClose={() => setAct(null)} title={act?.mode === 'approve' ? 'اعتماد التسوية' : act?.mode === 'investigate' ? 'إحالة للتحقيق' : 'نتيجة التحقيق'}>
        {act?.mode === 'investigation' ? (
          <>
            <Field label="نتيجة التحقيق *"><Textarea value={f.result || ''} onChange={(e) => setF({ ...f, result: e.target.value })} /></Field>
            <Field label="القرار"><Select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} options={DECISIONS} /></Field>
            <Field label="وزن مسترد بعد التحقيق (جم)" hint={`الحد الأقصى ${fmtW(act.s.abnormal_loss)}`}><WeightInput value={f.recovered_weight} onChange={(v) => setF({ ...f, recovered_weight: v })} /></Field>
          </>
        ) : <Field label={act?.mode === 'investigate' ? 'سبب الإحالة *' : 'ملاحظات الاعتماد'}><Textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>}
        <div className="hrow gap end"><Btn kind="ghost" onClick={() => setAct(null)}>إلغاء</Btn><Btn loading={busy} onClick={submit}>حفظ القرار</Btn></div>
      </Modal>
    </Page>
  );
}
