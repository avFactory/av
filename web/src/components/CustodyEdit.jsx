import { useState } from 'react';
import { api } from '../api.js';
import { fmtW } from '../format.js';
import { Btn, Field, Input, Modal, WeightInput, useAction } from '../ui.jsx';

/** تعديل عهدة مفتوحة (للمدير فقط): الوزن والأحجار والقطع، والفرق يُسوّى بحركة موثقة */
export default function CustodyEditModal({ custody: c, onClose, onDone }) {
  const issued = Number(c.weight_issued) + Number(c.weight_used || 0); // المعروض في صفحة العامل = المتبقي
  const [f, setF] = useState({ gross_weight: String(Number(c.gross_weight || issued)), stones_weight: String(Number(c.stones_weight || 0)), pieces: c.pieces ?? '', reason: '' });
  const [run, busy] = useAction();
  const net = (Number(f.gross_weight) || 0) - (c.order_id ? Number(f.stones_weight) || 0 : 0);
  const diff = net - issued;
  const submit = () => run(async () => { await api.put(`/sup/custodies/${c.id}`, f); onDone?.(); onClose(); }, 'تم تعديل العهدة');
  return (
    <Modal open onClose={onClose} title={`تعديل العهدة ${c.custody_no}`}>
      <div className={`alert small mb-0 ${c.worker_ack_at ? 'alert-warning' : 'alert-info'}`}>
        {c.worker_ack_at ? 'قبِل العامل هذه العهدة — التعديل يُسجَّل بحركة تسوية ويصله إشعار بالوزن الجديد.' : 'لم يقبل العامل العهدة بعد — يصله الوزن الجديد ليقبله.'}
        {' '}الفرق ينتقل بين العامل و{c.order_id ? 'رصيد الطلب (والخزنة عند النقص)' : c.finding_id ? 'مخزون الخامات' : 'الخزنة'}.
      </div>
      <div>{c.order_no} · الوزن الحالي: <b dir="ltr">{fmtW(issued)} جم</b></div>
      <div className="grid g2">
        <Field label={c.order_id ? 'الوزن على الميزان (جم) *' : 'الوزن (جم) *'}><WeightInput big value={f.gross_weight} onChange={(v) => setF({ ...f, gross_weight: v })} autoFocus /></Field>
        {c.order_id && <Field label="وزن الأحجار (جم)"><WeightInput value={f.stones_weight} onChange={(v) => setF({ ...f, stones_weight: v })} /></Field>}
        <Field label="عدد القطع"><Input inputMode="numeric" value={f.pieces} onChange={(e) => setF({ ...f, pieces: e.target.value.replace(/\D/g, '') })} /></Field>
      </div>
      <div>صافي الذهب الجديد: <b dir="ltr">{fmtW(net)} جم</b> {Math.abs(diff) > 0.00005 && <span style={{ color: diff > 0 ? 'var(--bad)' : 'var(--ok)' }} dir="ltr">({diff > 0 ? '+' : ''}{fmtW(diff)})</span>}</div>
      <Field label="سبب التعديل *"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="مثال: خطأ في الوزن عند التسليم" /></Field>
      <Btn loading={busy} disabled={!(net > 0) || !f.reason} onClick={submit}>حفظ التعديل</Btn>
    </Modal>
  );
}
