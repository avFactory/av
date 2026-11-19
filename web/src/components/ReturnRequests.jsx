import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtW, fmtDT } from '../format.js';
import { Btn, Card, Field, Input, Modal, WeightInput, useAction, useFetch } from '../ui.jsx';

/** طلبات العمال تسليم جزء من العهدة للمشرف: يزن المشرف ويؤكد أو يرفض */
export default function ReturnRequests({ worker }) {
  const { data, reload } = useFetch(`/sup/return-requests${worker ? `?worker=${worker}` : ''}`, { live: ['custodies'] });
  const [m, setM] = useState(null);
  const [run, busy] = useAction();
  if (!data?.length) return null;
  return (
    <Card title={`↩ عمال يسلّمون جزءاً من عهدتهم (${data.length})`} className="mb">
      <div className="d-grid gap-2">
        {data.map((q) => (
          <div key={q.id} className="hrow between wrap gap border rounded-3 p-2">
            <span><Link to={`/sup/workers/${q.worker_id}`} className="fw-bold">{q.worker_name}</Link> — {q.label} · يسلّم <b dir="ltr">{fmtW(q.weight)} جم</b> من <span dir="ltr">{fmtW(q.remaining)}</span>{q.note ? ` · ${q.note}` : ''} <small className="text-body-secondary">{fmtDT(q.created_at)}</small></span>
            <span className="d-flex gap-2">
              <Btn size="sm" kind="dark" onClick={() => setM({ q, mode: 'accept', weight: String(Number(q.weight)) })}>زِن وأكّد</Btn>
              <Btn size="sm" kind="ghost" onClick={() => setM({ q, mode: 'reject', reason: '' })}>رفض</Btn>
            </span>
          </div>
        ))}
      </div>
      <Modal open={!!m} onClose={() => setM(null)} title={m?.mode === 'accept' ? `استلام من ${m?.q.worker_name}` : 'رفض الطلب'}>
        {m?.mode === 'accept' && <>
          <div className="small text-body-secondary">كتب العامل {fmtW(m.q.weight)} جم. اكتب الوزن الفعلي على الميزان.</div>
          <Field label="الوزن على الميزان (جم) *"><WeightInput big value={m.weight} onChange={(v) => setM({ ...m, weight: v })} autoFocus /></Field>
          <Btn loading={busy} disabled={!(Number(m.weight) > 0)} onClick={() => run(async () => { await api.post(`/sup/return-requests/${m.q.id}/accept`, { weight: m.weight }); setM(null); reload(); }, 'تم الاستلام — الباقي ما زال لدى العامل')}>تأكيد الاستلام</Btn>
        </>}
        {m?.mode === 'reject' && <>
          <Field label="السبب *"><Input value={m.reason} onChange={(e) => setM({ ...m, reason: e.target.value })} autoFocus /></Field>
          <Btn kind="danger" loading={busy} disabled={!m.reason} onClick={() => run(async () => { await api.post(`/sup/return-requests/${m.q.id}/reject`, { reason: m.reason }); setM(null); reload(); }, 'تم الرفض')}>رفض</Btn>
        </>}
      </Modal>
    </Card>
  );
}
