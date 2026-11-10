import { useState } from 'react';
import { api } from '../api.js';
import { fmtW } from '../format.js';
import { Btn, Field, Input, Modal, Select, Textarea, WeightInput, useAction } from '../ui.jsx';
import { printLabels } from './PrintLabelsBtn.jsx';

export const SHORTAGE_KINDS = { diamond: 'ألماس', chain: 'سلاسل / روبتشن', findings: 'خامات (أقفال، كور...)', stones: 'أحجار / زركون / لؤلؤ', gold: 'ذهب', other: 'أخرى' };

/**
 * نقل قطع من الطلب للنواقص: العدد، الوزن المؤكد على الميزان، نوع النواقص، والبيان (إلزامي).
 * إن كان الطلب لدى عامل تُخصم القطع من عهدته.
 */
export function ShortageModal({ item, custody, onClose, onDone }) {
  const [f, setF] = useState({ quantity: String(item?.quantity || ''), weight: '', kind: '', reason: '' });
  const [run, busy] = useAction();
  const [done, setDone] = useState(null);
  if (!item) return null;
  const q = Number(f.quantity || 0);
  const ok = q >= 1 && q <= item.quantity && f.kind && f.reason.trim() && (custody ? Number(f.weight) > 0 : true);
  const submit = () => run(async () => {
    const r = await api.post(`/orders/${item.id}/shortage`, f);
    setDone(r);
    onDone?.(r);
  }, 'تم النقل للنواقص');
  return (
    <Modal open onClose={onClose} title={`نقل للنواقص — ${item.product_type || item.title}`}>
      {done ? (
        <div className="d-grid gap-3">
          <div className="alert alert-success mb-0">
            {done.same ? <>انتقل الطلب <b dir="ltr">{done.order_no}</b> للنواقص.</>
              : <>فُصلت القطع في طلب جديد <b dir="ltr">{done.order_no}</b> وهو الآن في النواقص، والطلب الأصلي يكمل مراحله.</>}
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <Btn onClick={() => printLabels([done.order_id]).catch(() => {})}>🏷 طباعة الباركود الجديد</Btn>
            <Btn kind="ghost" onClick={onClose}>إغلاق</Btn>
          </div>
        </div>
      ) : (
        <div className="d-grid gap-2">
          <div className="small text-body-secondary">البند <b dir="ltr">{item.order_no}</b> · الكمية {item.quantity}</div>
          {custody && <div className="alert alert-warning py-2 small mb-0">الطلب لدى <b>{custody.worker_name}</b> ({fmtW(custody.weight_issued)} جم): استلم منه القطع الناقصة وزِنها — يُخصم وزنها من عهدته ويُسجَّل على الطلب الجديد.</div>}
          <div className="grid g2">
            <Field label="عدد القطع الناقصة *" hint={`من ${item.quantity}`}><Input inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={`الوزن المؤكد على الميزان (جم)${custody ? ' *' : ''}`} hint={custody ? 'وزن القطع المستلمة من العامل' : 'وزن القطع (إن كان فيها ذهب)'}><WeightInput value={f.weight} onChange={(v) => setF({ ...f, weight: v })} /></Field>
          </div>
          <Field label="نوع النواقص *"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="اختر" options={Object.entries(SHORTAGE_KINDS)} /></Field>
          <Field label="البيان *" hint="مثال: لا يوجد روبتشن 45 سم / ألماس راوند 1.5 مم غير متوفر"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <div className="small text-body-secondary">{q && q < item.quantity ? `سيُخفض البند إلى ${item.quantity - q} قطعة، وتُفصل ${q} قطعة في طلب جديد برقم وباركود جديدين.` : 'يُفصل البند كاملاً في طلب جديد برقم وباركود جديدين (إن كان الطلب متعدد المنتجات).'} ويرى العميل القطع في حالة "النواقص".</div>
          <div className="hrow end"><Btn kind="danger" loading={busy} disabled={!ok} onClick={submit}>نقل للنواقص</Btn></div>
        </div>
      )}
    </Modal>
  );
}

/** سحب الطلب من العامل (غياب أو ضرورة): وزن القطع المستلمة وسبب إلزامي، ويبقى الطلب في مرحلته لعامل آخر */
export function WithdrawModal({ custody, onClose, onDone }) {
  const [f, setF] = useState({ returned_weight: '', reason: '' });
  const [run, busy] = useAction();
  if (!custody) return null;
  const submit = () => run(async () => { await api.post(`/sup/custody/${custody.id}/withdraw`, f); onDone?.(); onClose(); }, 'تم سحب الطلب من العامل');
  return (
    <Modal open onClose={onClose} title={`سحب الطلب من ${custody.worker_name}`}>
      <div className="d-grid gap-2">
        <div className="small">العهدة <b dir="ltr">{custody.custody_no}</b> · المسلَّم {fmtW(custody.weight_issued)} جم</div>
        <Field label="الوزن المستلم على الميزان (جم) *" hint="الأحجار المركبة تُخصم تلقائياً، والفرق يُحسب عجزاً على العامل كالمعتاد"><WeightInput big value={f.returned_weight} onChange={(v) => setF({ ...f, returned_weight: v })} autoFocus /></Field>
        <Field label="سبب السحب *"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="مثال: العامل غائب" /></Field>
        <div className="small text-body-secondary">يبقى الطلب في نفس مرحلته بدون عامل، ويمكن تسليمه لعامل آخر مباشرة. يصل للعامل إشعار بالسحب.</div>
        <div className="hrow end"><Btn kind="danger" loading={busy} disabled={!(Number(f.returned_weight) >= 0 && f.returned_weight !== '' && f.reason.trim())} onClick={submit}>سحب واستلام</Btn></div>
      </div>
    </Modal>
  );
}
