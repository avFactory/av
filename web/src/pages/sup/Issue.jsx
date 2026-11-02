import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, newKey } from '../../api.js';
import { fmtW, sub } from '../../format.js';
import { Btn, Card, Field, Input, Page, ScanInput, SignaturePad, WeightInput, useAction, useFetch, useToast, Badge, Kv } from '../../ui.jsx';
import WorkerPicker from '../../components/WorkerPicker.jsx';

/** تسليم ذهب للعامل: 1) العامل 2) الطلبات (مسح أو اختيار) 3) الأوزان 4) التوقيع والتأكيد */
export default function Issue() {
  const [sp] = useSearchParams();
  const toast = useToast();
  const [worker, setWorker] = useState(null);
  const [items, setItems] = useState([]);
  const [sig, setSig] = useState(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const [run, busy] = useAction();
  const { data: waiting } = useFetch('/sup/awaiting-issue', { live: ['custodies', 'orders'] });

  // فتح مباشر من الصفحة الرئيسية/ملف العامل
  useEffect(() => {
    const wid = sp.get('worker');
    if (wid && !worker) api.get(`/sup/workers/${wid}`).then((p) => setWorker(p.worker)).catch(() => {});
    const oid = sp.get('order');
    if (oid) api.get(`/sup/lookup?id=${oid}`).then(add).catch((e) => toast(e.message, 'bad'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(o) {
    if (!o) return;
    if (items.some((i) => i.order.id === o.id)) return toast('الطلب مضاف مسبقاً', 'info');
    if (o.status !== 'in_production') return toast(`الطلب ${o.order_no} ليس قيد التصنيع`, 'bad');
    if (!o.handles_gold) return toast(`المرحلة الحالية (${o.stage_name}) لا تتضمن تسليم ذهب`, 'bad');
    if (o.open_custodies?.length) toast(`تنبيه: الطلب لدى ${o.open_custodies.map((c) => c.full_name).join('، ')}`, 'info');
    const bal = Number(o.order_balance) > 0 ? Number(o.order_balance) + Number(o.stones?.used || 0) : '';
    setItems((x) => [...x, { order: o, weight: bal ? String(+bal.toFixed(4)) : '', pieces: String(o.quantity), notes: '', stones: o.stones?.used || '0' }]);
  }
  const scan = async (code) => {
    try { await add(await api.get(`/sup/lookup?code=${encodeURIComponent(code)}`)); } catch (e) { toast(e.message, 'bad'); }
  };
  const upd = (i, k, v) => setItems((x) => x.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const total = useMemo(() => items.reduce((s, i) => s + Number(sub(i.weight, i.stones) || 0), 0), [items]);
  const valid = worker && items.length && items.every((i) => Number(i.weight) > 0 && Number(sub(i.weight, i.stones)) > 0);

  const submit = () => run(async () => {
    const r = await api.post('/sup/issue', {
      worker_id: worker.id, signature: sig, note, idempotency_key: key.current,
      items: items.map((i) => ({ order_id: i.order.id, weight: i.weight, pieces: i.pieces, notes: i.notes, stones_weight: i.stones })),
    });
    setDone(r);
  }, 'تم تسليم الذهب وتسجيل العهدة');

  const reset = () => { setWorker(null); setItems([]); setSig(null); setNote(''); setDone(null); key.current = newKey(); };

  if (done) {
    return (
      <Page title="تم التسليم بنجاح">
        <Card>
          <div className="alert alert-ok mb">سُجلت {done.custodies?.length || ''} عهدة في الجلسة {done.batch_no} للعامل {worker.full_name}{done.duplicate ? ' (تم التسجيل مسبقاً)' : ''}</div>
          <div className="row gap wrap">
            <a className="btn btn-dark btn-lg" href={`/print/batch/${done.batch_id}`} target="_blank" rel="noreferrer">طباعة كشف التسليم</a>
            <Btn size="lg" onClick={reset}>تسليم جديد</Btn>
            <Btn size="lg" kind="ghost" onClick={() => { setItems([]); setSig(null); setDone(null); key.current = newKey(); }}>تسليم آخر لنفس العامل</Btn>
            <Link className="btn btn-ghost btn-lg" to={`/sup/workers/${worker.id}`}>ملف العامل</Link>
          </div>
        </Card>
      </Page>
    );
  }

  const step = !worker ? 1 : !items.length ? 2 : 3;
  return (
    <Page title="تسليم ذهب للعامل" back="/sup">
      <div className="steps"><span className={step === 1 ? 'on' : 'done'}>1. العامل</span><span className={step === 2 ? 'on' : step > 2 ? 'done' : ''}>2. الطلبات</span><span className={step === 3 ? 'on' : ''}>3. الوزن والتوقيع</span></div>
      {!worker ? <WorkerPicker onPick={setWorker} /> : (
        <div className="grid">
          <Card>
            <div className="row between wrap gap">
              <div><span className="muted small">العامل المستلم</span><h3>{worker.full_name} <span className="muted small">{worker.employee_no}</span></h3></div>
              <Btn kind="ghost" size="sm" onClick={() => setWorker(null)}>تغيير العامل</Btn>
            </div>
          </Card>
          <ScanInput onScan={scan} placeholder="امسح QR الطلب أو اكتب رقمه (يمكن مسح عدة طلبات بالتتابع)" />
          {items.map((it, i) => (
            <div key={it.order.id} className="line-item sel">
              <div className="line-head">
                <div>
                  <b>{it.order.order_no}</b> <span className="muted">— {it.order.title}</span>
                  <div className="row gap wrap small mt" style={{ marginTop: 4 }}>
                    <Badge tone="gold">{it.order.stage_name}</Badge><Badge>{it.order.material_name}</Badge><Badge>الكمية {it.order.quantity}</Badge>
                    {Number(it.order.order_balance) > 0 && <Badge tone="info">رصيد الطلب {fmtW(it.order.order_balance)} جم</Badge>}
                  </div>
                </div>
                <Btn kind="ghost" size="sm" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>إزالة</Btn>
              </div>
              <div className="grid g3">
                <Field label="الوزن على الميزان (جم)" hint={Number(it.stones) > 0 ? `صافي الذهب: ${fmtW(sub(it.weight, it.stones), 4)} (بعد خصم الأحجار ${fmtW(it.stones)})` : undefined}>
                  <WeightInput big value={it.weight} onChange={(v) => upd(i, 'weight', v)} autoFocus={i === items.length - 1} />
                </Field>
                <Field label="عدد القطع"><Input inputMode="numeric" value={it.pieces} onChange={(e) => upd(i, 'pieces', e.target.value.replace(/\D/g, ''))} /></Field>
                <Field label="ملاحظات (اختياري)"><Input value={it.notes} onChange={(e) => upd(i, 'notes', e.target.value)} /></Field>
              </div>
              {Number(it.weight) > Number(it.order.order_balance) + Number(it.stones) && <div className="small muted">الفرق عن رصيد الطلب سيُصرف تلقائياً من الخزنة.</div>}
            </div>
          ))}
          {!items.length && (
            <Card title="أو اختر من الطلبات بانتظار التسليم" pad={false}>
              <div className="card-b pick-grid">
                {(waiting || []).map((o) => (
                  <button key={o.id} className="pick" onClick={() => scan(o.order_no)}>
                    <b>{o.order_no}</b><span className="muted">{o.title}</span><span className="small">{o.stage_name} · {o.material_name}</span>
                    {o.assigned_worker_name && <span className="small">مقترح: {o.assigned_worker_name}</span>}
                  </button>
                ))}
                {!waiting?.length && <span className="muted">لا توجد طلبات بانتظار التسليم</span>}
              </div>
            </Card>
          )}
          {items.length > 0 && (
            <>
              {(waiting || []).filter((o) => !items.some((i) => i.order.id === o.id)).length > 0 && (
                <div className="row gap wrap"><span className="muted small">إضافة سريعة:</span>
                  {(waiting || []).filter((o) => !items.some((i) => i.order.id === o.id)).slice(0, 8).map((o) => <button key={o.id} className="chip" onClick={() => scan(o.order_no)}>+ {o.order_no}</button>)}
                </div>
              )}
              <Card title="توقيع العامل على الاستلام">
                <SignaturePad onChange={setSig} />
                <Field label="ملاحظة على الجلسة (اختياري)" className="mt"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </Card>
              <div className="sticky-foot">
                <Kv items={[['عدد الطلبات', items.length], ['إجمالي صافي الذهب', <span dir="ltr">{fmtW(total, 4)} جم</span>]]} />
                <div className="row gap">
                  {!sig && <span className="small muted">بدون توقيع: يوقّع العامل لاحقاً من جواله</span>}
                  <Btn size="lg" loading={busy} disabled={!valid} onClick={submit}>تأكيد التسليم</Btn>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Page>
  );
}
