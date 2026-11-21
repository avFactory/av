import { useState } from 'react';
import { api } from '../api.js';
import { Btn, Field, Input, Modal, useAction } from '../ui.jsx';

const toNum = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/** تعديل صرف ألماس: القيراط والعدد مع سبب — يُسجَّل تصحيحاً (عكس الصرف وصرف جديد) */
export default function StoneIssueEdit({ mv, onClose, onDone }) {
  const [f, setF] = useState({ carats: String(Number(mv.carats)), count: String(mv.count ?? 0), reason: '' });
  const [run, busy] = useAction();
  const changed = Number(f.carats) !== Number(mv.carats) || Number(f.count || 0) !== Number(mv.count || 0);
  const save = () => run(async () => { await api.post(`/stones/movements/${mv.id}/edit`, f); onDone?.(); onClose(); }, 'تم تعديل الصرف');
  return (
    <Modal open onClose={onClose} title="تعديل صرف الألماس">
      <div className="small text-body-secondary">{[mv.shape_name, mv.size_label].filter(Boolean).join(' ')} · {mv.order_no || '—'} · {mv.worker_name || '—'} — الصرف الحالي <b dir="ltr">{Number(mv.carats)} ct</b>{mv.count ? ` · ${mv.count} حبة` : ''}</div>
      <div className="grid g2">
        <Field label="القيراط الصحيح *"><Input className="form-control form-control-lg" dir="ltr" inputMode="decimal" value={f.carats} onChange={(e) => setF({ ...f, carats: toNum(e.target.value) })} autoFocus /></Field>
        <Field label="عدد الحبات"><Input dir="ltr" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: toNum(e.target.value).replace('.', '') })} /></Field>
      </div>
      <Field label="سبب التعديل *"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="مثال: خطأ في إدخال الوزن" /></Field>
      <div className="small text-body-secondary">يُسجَّل تصحيحاً موثقاً: يُعكس الصرف الأصلي ويُصرف بالقيم الصحيحة، ويصل العامل إشعار.</div>
      <Btn loading={busy} disabled={!(Number(f.carats) > 0) || !f.reason || !changed} onClick={save}>حفظ التعديل</Btn>
    </Modal>
  );
}
