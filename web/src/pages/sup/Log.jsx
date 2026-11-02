import { useState } from 'react';
import { qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT, KINDS, LOCS, SETTLEMENT_STATUS } from '../../format.js';
import { Btn, Field, Input, Loader, Page, Select, StatusBadge, Table, useFetch } from '../../ui.jsx';

/** سجل عمليات المشرف: كل حركة ذهب تلقائياً، مع البحث والتصفية والطباعة والتصدير */
export default function Log() {
  const { lookups } = useAuth();
  const [f, setF] = useState({ worker_id: '', order: '', kind: '', stage_id: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const { data } = useFetch(`/sup/movements${qs(applied)}`, { live: ['gold_ledger'] });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Page title="سجل العمليات" subtitle="كل حركة ذهب مرتبطة بطلب وعامل ومرحلة" back="/sup"
      actions={<><Btn kind="ghost" onClick={() => window.print()}>طباعة</Btn><a className="btn btn-dark" href={`/api/sup/movements.xlsx${qs(applied)}`}>تصدير Excel</a></>}>
      <form className="card card-body grid g4 mb no-print" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
        <Field label="العامل"><Select value={f.worker_id} onChange={set('worker_id')} placeholder="الكل" options={(lookups?.workers || []).map((w) => [w.id, w.full_name])} /></Field>
        <Field label="رقم الطلب"><Input value={f.order} onChange={set('order')} /></Field>
        <Field label="نوع الحركة"><Select value={f.kind} onChange={set('kind')} placeholder="الكل" options={Object.entries(KINDS)} /></Field>
        <Field label="المرحلة"><Select value={f.stage_id} onChange={set('stage_id')} placeholder="الكل" options={(lookups?.stages || []).map((s) => [s.id, s.name])} /></Field>
        <Field label="من تاريخ"><Input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="إلى تاريخ"><Input type="date" value={f.to} onChange={set('to')} /></Field>
        <div className="hrow gap" style={{ alignSelf: 'end' }}><Btn type="submit">تطبيق</Btn><Btn type="button" kind="ghost" onClick={() => { const e = { worker_id: '', order: '', kind: '', stage_id: '', from: '', to: '' }; setF(e); setApplied(e); }}>مسح</Btn></div>
      </form>
      {!data ? <Loader /> : (
        <div className="card"><Table rows={data} rowClass={(m) => (m.reversed || m.kind === 'reversal' ? 'row-warn' : '')} columns={[
          ['الحركة', 'movement_no'], ['التاريخ', (m) => fmtDT(m.created_at)], ['النوع', (m) => KINDS[m.kind] || m.kind], ['الطلب', 'order_no'], ['العامل', 'worker_name'],
          ['المرحلة', 'stage_name'], ['المادة', 'material_name'], ['الوزن', (m) => <span className="n">{fmtW(m.weight, 4)}</span>],
          ['من → إلى', (m) => <span className="small">{LOCS[m.from_type]} ← {LOCS[m.to_type]}</span>],
          ['المشرف/المستخدم', 'user_name'], ['الاعتماد', (m) => (m.settlement_status ? <StatusBadge map={SETTLEMENT_STATUS} value={m.settlement_status} /> : '—')],
          ['العجز', (m) => (m.actual_loss ? <span className="n">{fmtW(m.actual_loss)}</span> : '—')], ['ملاحظات', (m) => <span className="small">{m.reason || m.notes || ''}{m.reversed ? ' (معكوسة)' : ''}</span>],
        ]} /></div>
      )}
    </Page>
  );
}
