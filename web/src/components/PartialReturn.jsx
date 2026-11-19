import { useState } from 'react';
import { api } from '../api.js';
import { fmtW } from '../format.js';
import { Btn, Field, Input, Modal, WeightInput, useAction } from '../ui.jsx';

/** استلام جزء من عهدة العامل للمشرف: يُوزن الجزء ويبقى الباقي لدى العامل */
export default function PartialReturnModal({ custody: c, onClose, onDone }) {
  const [f, setF] = useState({ weight: '', pieces: '', note: '' });
  const [run, busy] = useAction();
  if (!c) return null;
  const avail = Number(c.weight_issued);
  const left = avail - (Number(f.weight) || 0);
  const ok = Number(f.weight) > 0 && left > 0.00005;
  const submit = () => run(async () => {
    await api.post(`/sup/custody/${c.id}/partial-return`, f);
    onDone?.(); onClose();
  }, 'تم استلام الجزء — الباقي ما زال لدى العامل');
  return (
    <Modal open onClose={onClose} title={`استلام جزء من عهدة ${c.worker_name || ''}`}>
      <div className="alert alert-info small mb-0">زِن الجزء الذي يسلّمه العامل الآن. يعود {c.order_id ? 'لرصيد الطلب' : c.finding_id ? 'لمخزون الخامات' : 'للخزنة'}، وتبقى العهدة مفتوحة بالباقي. العجز يُحسب عند الاستلام الكامل على المتبقي فقط.</div>
      <div className="d-flex justify-content-between"><span>{c.order_no || c.custody_no}</span><span>لدى العامل الآن: <b dir="ltr">{fmtW(avail)} جم</b></span></div>
      <Field label="الوزن المستلم (جم) *"><WeightInput big value={f.weight} onChange={(v) => setF({ ...f, weight: v })} autoFocus /></Field>
      {Number(c.pieces) > 0 && <Field label="عدد القطع المستلمة"><Input inputMode="numeric" value={f.pieces} onChange={(e) => setF({ ...f, pieces: e.target.value.replace(/\D/g, '') })} /></Field>}
      <Field label="البيان"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="مثال: ذهب زائد عن حاجة القطعة" /></Field>
      {Number(f.weight) > 0 && <div className={left > 0.00005 ? 'text-body-secondary' : 'text-danger'}>{left > 0.00005 ? <>يبقى لدى العامل <b dir="ltr">{fmtW(left)} جم</b></> : 'الوزن يساوي كل العهدة أو أكثر — استخدم «استلام ذهب» للاستلام الكامل'}</div>}
      <Btn loading={busy} disabled={!ok} onClick={submit}>استلام الجزء</Btn>
    </Modal>
  );
}
