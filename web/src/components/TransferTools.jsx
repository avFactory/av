import { useState } from 'react';
import { api, fileUrl } from '../api.js';
import { fmtW } from '../format.js';
import { Btn, Field, Input, Modal, WeightInput, useAction, useFetch } from '../ui.jsx';
import { t } from '../i18n.js';

/**
 * نافذة تحويل الطلب لعامل المرحلة التالية: اختيار العامل ووزن القطع على الميزان.
 * base: '/w' (العامل صاحب العهدة) أو '/sup' (المشرف)
 */
export function TransferModal({ custody, base = '/w', onClose, onDone }) {
  const { data: workers } = useFetch(base === '/w' ? '/w/workers' : '/sup/workers');
  const general = !custody.order_id;
  const [f, setF] = useState({ to_worker_id: '', weight: '', note: '', portion: 'full', mode: general ? 'same_stage' : 'next_stage' });
  const remaining = Number(custody.weight_issued) - Number(custody.weight_used || 0);
  const part = f.portion === 'part';
  const wv = Number(f.weight);
  // تحويل الكل بوزن أقل بكثير من العهدة = غالباً المقصود جزء (والخادم يرفضه حتى لا يُحسب الباقي عجزاً)
  const tooLow = !part && wv > 0 && remaining - wv > Math.max(1, remaining * 0.1);
  const partBad = part && wv > 0 && wv >= remaining;
  const [q, setQ] = useState('');
  const [run, busy] = useAction();
  const list = (Array.isArray(workers) ? workers : []).filter((w) => w.id !== custody.worker_id && (!q.trim() || `${w.full_name} ${w.employee_no || ''} ${w.specialty || ''}`.includes(q.trim())));
  const toMachine = (Array.isArray(workers) ? workers : []).find((w) => String(w.id) === String(f.to_worker_id))?.kind === 'machine';
  const submit = () => run(async () => { await api.post(`${base}/custody/${custody.id}/transfer`, part ? { ...f, mode: 'same_stage' } : f); onDone?.(); onClose(); }, toMachine ? 'تم التحويل — سُجّل الطلب على المكينة مباشرة' : 'أُرسل التحويل - بانتظار قبول العامل');
  return (
    <Modal open onClose={onClose} title={t(general ? 'تحويل العهدة العامة لعامل آخر' : 'تحويل لعامل آخر')}>
      <div className="d-grid gap-2">
        <div className="chips">{[['full', t('كل العهدة')], ['part', t('جزء منها (الباقي يبقى معك)')]].map(([k, l]) => <button key={k} type="button" className={`chip ${f.portion === k ? 'on' : ''}`} onClick={() => setF({ ...f, portion: k })}>{l}</button>)}</div>
        {!general && !part && <div className="chips">{[['next_stage', t('للمرحلة التالية')], ['same_stage', t('نفس المرحلة (إعادة إسناد)')]].map(([k, l]) => <button key={k} type="button" className={`chip ${f.mode === k ? 'on' : ''}`} onClick={() => setF({ ...f, mode: k })}>{l}</button>)}</div>}
        {part
          ? <div className="small text-body-secondary">{t('العهدة {no} · لديك {w} جم. ينتقل الوزن الذي يؤكده العامل الثاني فقط، ويبقى الباقي في عهدتك بدون عجز.', { no: custody.custody_no || custody.order_no, w: fmtW(remaining) })}{!general && t(' يبقى الطلب في مرحلته الحالية.')}</div>
          : <div className="small text-body-secondary">{t('العهدة {no} · المسلَّم {w} جم. العامل الثاني يزن ويؤكد الوزن ثم يقبل، والفرق يُحسب عجزاً على صاحب العهدة.', { no: custody.custody_no || custody.order_no, w: fmtW(remaining) })}{!general && t(f.mode === 'same_stage' ? ' يبقى الطلب في مرحلته الحالية.' : ' ينتقل الطلب للمرحلة التالية.')}</div>}
        <Field label={t('الوزن على الميزان (جم) *')}><WeightInput big value={f.weight} onChange={(v) => setF({ ...f, weight: v })} autoFocus /></Field>
        {tooLow && <div className="alert alert-warning small mb-0">{t('الوزن أقل بكثير من العهدة ({w} جم). إذا تحوّل جزءاً فقط اختر «جزء منها» حتى يبقى الباقي معك بدون عجز.', { w: fmtW(remaining) })}</div>}
        {partBad && <div className="small text-danger">{t('الجزء يجب أن يكون أقل مما لديك ({w} جم) — لتحويل الكل اختر «كل العهدة»', { w: fmtW(remaining) })}</div>}
        <Field label={t('العامل الذي يستلم *')}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث بالاسم أو الرقم أو المهنة…')} />
          <div className="tr-workers mt-1">
            {list.slice(0, 40).map((w) => (
              <button key={w.id} type="button" className={`chip ${String(f.to_worker_id) === String(w.id) ? 'on' : ''}`} onClick={() => setF({ ...f, to_worker_id: w.id })}>
                {w.kind === 'machine' ? '⚙ ' : ''}{w.full_name} <small className="opacity-75">{w.employee_no}{w.specialty ? ` · ${w.specialty}` : ''}</small>
              </button>
            ))}
            {workers && !list.length && <span className="small text-body-secondary">{t('لا يوجد عمال مطابقون')}</span>}
          </div>
        </Field>
        <Field label={t('ملاحظة')}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {toMachine && <div className="alert alert-info small mb-0">⚙ المكينة لا تحتاج قبول: يُسجل الطلب عليها فوراً بوزنك هذا، والفرق عن عهدة العامل يُحسب عجزاً عليه. استلمه من المكينة عند الانتهاء.</div>}
        <div className="hrow end"><Btn loading={busy} disabled={!f.to_worker_id || !(wv > 0) || tooLow || partBad} onClick={submit}>{toMachine ? 'تحويل للمكينة' : t('إرسال التحويل')}</Btn></div>
      </div>
    </Modal>
  );
}

/** تحويلات واردة للعامل: يزن ويؤكد الوزن ثم يقبل أو يرفض */
export function IncomingTransfers({ items, onChange }) {
  const [w, setW] = useState({});
  const [run, busy] = useAction();
  if (!items?.length) return null;
  const tr = t;
  const accept = (x) => run(async () => { await api.post(`/w/transfers/${x.id}/accept`, { weight: w[x.id] }); onChange?.(); }, 'تم قبول التحويل - العهدة الآن لديك');
  const reject = (x) => {
    const reason = window.prompt(tr('سبب الرفض (مثلاً: الوزن غير مطابق)'));
    if (!reason) return;
    run(async () => { await api.post(`/w/transfers/${x.id}/reject`, { reason }); onChange?.(); }, 'تم رفض التحويل');
  };
  return (
    <div className="d-grid gap-2">
      {items.map((x) => {
        const diff = w[x.id] ? Number(w[x.id]) - Number(x.weight) : null;
        return (
          <div key={x.id} className="card card-body tr-in">
            <div className="hrow gap">
              {x.thumb ? <img src={fileUrl(x.thumb, 400)} alt="" /> : null}
              <div className="grow"><b>↩ {tr('تحويل من {name}', { name: x.from_name })}</b><div className="small"><span dir="ltr">{tr(x.order_no)}</span> · {tr(x.title)}{x.mode === 'same_stage' && x.order_id ? ` · ${tr('نفس المرحلة')}` : ''}{x.portion === 'part' ? ` · ${tr('جزء من العهدة')}` : ''}</div>
                <div className="small text-body-secondary">{tr('الوزن المرسل')}: <b>{fmtW(x.weight)}</b> {tr('جم')}{x.note ? ` · ${x.note}` : ''}</div></div>
            </div>
            <Field label={tr('زِن القطع وأدخل الوزن على ميزانك (جم)')}>
              <WeightInput big value={w[x.id] || ''} onChange={(v) => setW({ ...w, [x.id]: v })} />
            </Field>
            {diff !== null && Math.abs(diff) > 0.0001 && <div className={`small ${diff < 0 ? 'text-danger' : 'text-warning'}`}>{x.portion === 'part' ? tr('يختلف عن المرسل بـ {d} جم — ينتقل إليك وزنك المؤكد فقط', { d: fmtW(Math.abs(diff)) }) : diff < 0 ? tr('أقل من المرسل بـ {d} جم (يُحسب عجزاً على {name})', { d: fmtW(-diff), name: x.from_name }) : tr('أكبر من المرسل بـ {d} جم (تُخصم الزيادة من العهدة العامة لـ{name})', { d: fmtW(diff), name: x.from_name })}</div>}
            <div className="hrow gap"><Btn kind="ok" loading={busy} disabled={!(Number(w[x.id]) > 0)} onClick={() => accept(x)}>{tr('✓ تأكيد الوزن وقبول العهدة')}</Btn><Btn kind="ghost" onClick={() => reject(x)}>{tr('رفض')}</Btn></div>
          </div>
        );
      })}
    </div>
  );
}
