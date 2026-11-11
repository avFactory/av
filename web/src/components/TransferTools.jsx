import { useState } from 'react';
import { api, fileUrl } from '../api.js';
import { fmtW } from '../format.js';
import { Btn, Field, Input, Modal, WeightInput, useAction, useFetch } from '../ui.jsx';

/**
 * نافذة تحويل الطلب لعامل المرحلة التالية: اختيار العامل ووزن القطع على الميزان.
 * base: '/w' (العامل صاحب العهدة) أو '/sup' (المشرف)
 */
export function TransferModal({ custody, base = '/w', onClose, onDone }) {
  const { data: workers } = useFetch(base === '/w' ? '/w/workers' : '/sup/workers');
  const [f, setF] = useState({ to_worker_id: '', weight: '', note: '' });
  const [q, setQ] = useState('');
  const [run, busy] = useAction();
  const list = (Array.isArray(workers) ? workers : []).filter((w) => w.id !== custody.worker_id && (!q.trim() || `${w.full_name} ${w.employee_no || ''} ${w.specialty || ''}`.includes(q.trim())));
  const submit = () => run(async () => { await api.post(`${base}/custody/${custody.id}/transfer`, f); onDone?.(); onClose(); }, 'أُرسل التحويل - بانتظار قبول العامل');
  return (
    <Modal open onClose={onClose} title="تحويل لعامل المرحلة التالية">
      <div className="d-grid gap-2">
        <div className="small text-body-secondary">العهدة <b dir="ltr">{custody.custody_no || custody.order_no}</b> · المسلَّم {fmtW(custody.weight_issued)} جم. العامل الثاني يزن القطع ويؤكد الوزن ثم يقبل، والفرق يُحسب عجزاً على صاحب العهدة.</div>
        <Field label="الوزن على الميزان (جم) *"><WeightInput big value={f.weight} onChange={(v) => setF({ ...f, weight: v })} autoFocus /></Field>
        <Field label="العامل التالي *">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم أو المهنة…" />
          <div className="tr-workers mt-1">
            {list.slice(0, 40).map((w) => (
              <button key={w.id} type="button" className={`chip ${String(f.to_worker_id) === String(w.id) ? 'on' : ''}`} onClick={() => setF({ ...f, to_worker_id: w.id })}>
                {w.kind === 'machine' ? '⚙ ' : ''}{w.full_name} <small className="opacity-75">{w.employee_no}{w.specialty ? ` · ${w.specialty}` : ''}</small>
              </button>
            ))}
            {workers && !list.length && <span className="small text-body-secondary">لا يوجد عمال مطابقون</span>}
          </div>
        </Field>
        <Field label="ملاحظة"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="hrow end"><Btn loading={busy} disabled={!f.to_worker_id || !(Number(f.weight) > 0)} onClick={submit}>إرسال التحويل</Btn></div>
      </div>
    </Modal>
  );
}

/** تحويلات واردة للعامل: يزن ويؤكد الوزن ثم يقبل أو يرفض */
export function IncomingTransfers({ items, onChange }) {
  const [w, setW] = useState({});
  const [run, busy] = useAction();
  if (!items?.length) return null;
  const accept = (t) => run(async () => { await api.post(`/w/transfers/${t.id}/accept`, { weight: w[t.id] }); onChange?.(); }, 'تم قبول التحويل - العهدة الآن لديك');
  const reject = (t) => {
    const reason = window.prompt('سبب الرفض (مثلاً: الوزن غير مطابق)');
    if (!reason) return;
    run(async () => { await api.post(`/w/transfers/${t.id}/reject`, { reason }); onChange?.(); }, 'تم رفض التحويل');
  };
  return (
    <div className="d-grid gap-2">
      {items.map((t) => {
        const diff = w[t.id] ? Number(w[t.id]) - Number(t.weight) : null;
        return (
          <div key={t.id} className="card card-body tr-in">
            <div className="hrow gap">
              {t.thumb ? <img src={fileUrl(t.thumb, 400)} alt="" /> : null}
              <div className="grow"><b>↩ تحويل من {t.from_name}</b><div className="small"><span dir="ltr">{t.order_no}</span> · {t.title}</div>
                <div className="small text-body-secondary">الوزن المرسل: <b>{fmtW(t.weight)}</b> جم{t.note ? ` · ${t.note}` : ''}</div></div>
            </div>
            <Field label="زِن القطع وأدخل الوزن على ميزانك (جم)">
              <WeightInput big value={w[t.id] || ''} onChange={(v) => setW({ ...w, [t.id]: v })} />
            </Field>
            {diff !== null && Math.abs(diff) > 0.0001 && <div className={`small ${diff < 0 ? 'text-danger' : 'text-warning'}`}>{diff < 0 ? `أقل من المرسل بـ ${fmtW(-diff)} جم (يُحسب عجزاً على ${t.from_name})` : `أكبر من المرسل بـ ${fmtW(diff)} جم (تُخصم الزيادة من العهدة العامة لـ${t.from_name})`}</div>}
            <div className="hrow gap"><Btn kind="ok" loading={busy} disabled={!(Number(w[t.id]) > 0)} onClick={() => accept(t)}>✓ تأكيد الوزن وقبول العهدة</Btn><Btn kind="ghost" onClick={() => reject(t)}>رفض</Btn></div>
          </div>
        );
      })}
    </div>
  );
}
