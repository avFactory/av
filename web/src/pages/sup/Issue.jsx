import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, newKey, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, sub } from '../../format.js';
import { Btn, Card, Field, Input, Page, PageActions, ScanInput, WeightInput, useAction, useFetch, useToast, Badge, Kv, Tabs, Select, Table } from '../../ui.jsx';
import { fmtDT } from '../../format.js';
import WorkerPicker from '../../components/WorkerPicker.jsx';
import DiamondIssue from './DiamondIssue.jsx';

/** تسليم ذهب: (أ) لعامل واحد - طلب أو عدة طلبات، (ب) تقسيم طلب واحد على عدة عمال.
 *  لا توقيع يدوي: يصل للعامل إشعار، وقبوله من جواله هو توقيعه الإلكتروني. */
export default function Issue() {
  const [sp] = useSearchParams();
  const { can } = useAuth();
  const [mode, setMode] = useState(['split', 'general', 'diamond'].includes(sp.get('mode')) ? sp.get('mode') : 'single');
  const tabs = [['single', 'تسليم لعامل واحد'], ['split', 'تقسيم طلب على عدة عمال'], ['general', 'عهدة عامة (بدون طلب)'], ...(can('stones.manage') ? [['diamond', 'تسليم الألماس المخبري']] : [])];
  return (
    <Page title={mode === 'diamond' ? 'تسليم الألماس المخبري' : 'تسليم ذهب'} inline>
      <Tabs value={mode} onChange={setMode} tabs={tabs} />
      {mode === 'single' ? <SingleIssue sp={sp} /> : mode === 'split' ? <SplitIssue sp={sp} /> : mode === 'diamond' ? <DiamondIssue /> : <GeneralIssue sp={sp} />}
    </Page>
  );
}

const lookupOrder = (q) => api.get(q.id ? `/sup/lookup?id=${q.id}` : `/sup/lookup?code=${encodeURIComponent(q.code)}`);

function checkOrder(o, toast) {
  if (o.status !== 'in_production') { toast(`الطلب ${o.order_no} ليس قيد التصنيع`, 'bad'); return false; }
  if (!o.handles_gold) { toast(`المرحلة الحالية (${o.stage_name}) لا تتضمن تسليم ذهب`, 'bad'); return false; }
  return true;
}

function OrderBadges({ o }) {
  return (
    <div className="hrow gap wrap small" style={{ marginTop: 4 }}>
      <Badge tone="gold">{o.stage_name}</Badge><Badge>{o.material_name}</Badge><Badge>الكمية {o.quantity}</Badge>
      {Number(o.order_balance) > 0 && <Badge tone="info">رصيد الطلب {fmtW(o.order_balance)} جم</Badge>}
      {o.open_custodies?.length > 0 && <Badge tone="warn">لدى: {o.open_custodies.map((c) => c.full_name).join('، ')}</Badge>}
    </div>
  );
}

const AcceptNote = () => <div className="alert alert-info small">لا يلزم توقيع: سيصل للعامل إشعار في جواله، وقبوله للاستلام يُسجَّل كتوقيع إلكتروني بالتاريخ والوقت. لا يستطيع بدء العمل قبل القبول، ويمكنه الرفض مع ذكر السبب.</div>;

function SingleIssue({ sp }) {
  const toast = useToast();
  const [worker, setWorker] = useState(null);
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const [run, busy] = useAction();
  const { data: waiting } = useFetch('/sup/awaiting-issue', { live: ['custodies', 'orders'] });

  useEffect(() => {
    const wid = sp.get('worker');
    if (wid && !worker) api.get(`/sup/workers/${wid}`).then((p) => setWorker(p.worker)).catch(() => {});
    const oid = sp.get('order');
    if (oid && sp.get('mode') !== 'split') lookupOrder({ id: oid }).then(add).catch((e) => toast(e.message, 'bad'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function add(o) {
    if (!o || !checkOrder(o, toast)) return;
    setItems((x) => {
      if (x.some((i) => i.order.id === o.id)) { toast('الطلب مضاف مسبقاً', 'info'); return x; }
      const bal = Number(o.order_balance) > 0 ? Number(o.order_balance) + Number(o.stones?.used || 0) : '';
      return [...x, { order: o, weight: bal ? String(+bal.toFixed(4)) : '', pieces: String(o.quantity), notes: '', stones: o.stones?.used || '0' }];
    });
  }
  const scan = async (code) => { try { add(await lookupOrder({ code })); } catch (e) { toast(e.message, 'bad'); } };
  const upd = (i, k, v) => setItems((x) => x.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const total = useMemo(() => items.reduce((s, i) => s + Number(sub(i.weight, i.stones) || 0), 0), [items]);
  const valid = worker && items.length && items.every((i) => Number(i.weight) > 0 && Number(sub(i.weight, i.stones)) > 0);
  const submit = () => run(async () => {
    setDone(await api.post('/sup/issue', {
      worker_id: worker.id, note, idempotency_key: key.current,
      items: items.map((i) => ({ order_id: i.order.id, weight: i.weight, pieces: i.pieces, notes: i.notes, stones_weight: i.stones })),
    }));
  }, 'تم التسليم - بانتظار قبول العامل');
  const reset = (keepWorker) => { if (!keepWorker) setWorker(null); setItems([]); setNote(''); setDone(null); key.current = newKey(); };

  if (done) {
    return (
      <Card>
        <div className="alert alert-success mb">سُجلت {done.custodies?.length || ''} عهدة في الجلسة {done.batch_no} للعامل {worker.full_name}{done.duplicate ? ' (مسجلة مسبقاً)' : ''}. أُرسل للعامل إشعار لقبول الاستلام.</div>
        <div className="hrow gap wrap">
          <a className="btn btn-dark btn-lg" href={`/print/batch/${done.batch_id}`} target="_blank" rel="noreferrer">طباعة كشف التسليم</a>
          <Btn size="lg" onClick={() => reset(false)}>تسليم جديد</Btn>
          <Btn size="lg" kind="ghost" onClick={() => reset(true)}>تسليم آخر لنفس العامل</Btn>
          <Link className="btn btn-outline-secondary btn-lg" to={`/sup/workers/${worker.id}`}>ملف العامل</Link>
        </div>
      </Card>
    );
  }
  const step = !worker ? 1 : !items.length ? 2 : 3;
  return (
    <>
      <PageActions><div className="steps"><span className={step === 1 ? 'on' : 'done'}>1. العامل</span><span className={step === 2 ? 'on' : step > 2 ? 'done' : ''}>2. الطلبات</span><span className={step === 3 ? 'on' : ''}>3. الوزن والتأكيد</span></div></PageActions>
      {!worker ? <WorkerPicker onPick={setWorker} searchInHeader /> : (
        <div className="grid">
          <Card>
            <div className="hrow between wrap gap">
              <div><span className="muted small">المستلم</span><h3>{worker.kind === 'machine' && <span className="machine-tag">⚙ مكينة</span>}{worker.full_name} <span className="muted small">{worker.employee_no}</span></h3></div>
              <Btn kind="ghost" size="sm" onClick={() => setWorker(null)}>تغيير</Btn>
            </div>
          </Card>
          <ScanInput onScan={scan} placeholder="امسح QR الطلب أو اكتب رقمه (يمكن مسح عدة طلبات بالتتابع)" />
          {items.map((it, i) => (
            <div key={it.order.id} className="line-item sel">
              <div className="line-head">
                <div className="hrow gap">{it.order.thumb && <img src={fileUrl(it.order.thumb, 400)} alt="" className="order-thumb" />}<div><b>{it.order.order_no}</b> <span className="muted">— {it.order.title}</span><OrderBadges o={it.order} /></div></div>
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
              <div className="card-body pick-grid">
                {(waiting || []).map((o) => (
                  <button key={o.id} className="pick" onClick={() => scan(o.order_no)}>
                    {o.thumb && <img src={fileUrl(o.thumb, 400)} alt="" className="pick-img" loading="lazy" />}
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
                <div className="hrow gap wrap"><span className="muted small">إضافة سريعة:</span>
                  {(waiting || []).filter((o) => !items.some((i) => i.order.id === o.id)).slice(0, 8).map((o) => <button key={o.id} className="chip" onClick={() => scan(o.order_no)}>+ {o.order_no}</button>)}
                </div>
              )}
              <Field label="ملاحظة على الجلسة (اختياري)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <AcceptNote />
              <div className="sticky-foot">
                <Kv items={[['عدد الطلبات', items.length], ['إجمالي صافي الذهب', <span dir="ltr">{fmtW(total, 4)} جم</span>]]} />
                <Btn size="lg" loading={busy} disabled={!valid} onClick={submit}>تأكيد التسليم</Btn>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** تقسيم طلب واحد على عدة عمال */
function SplitIssue({ sp }) {
  const toast = useToast();
  const { lookups } = useAuth();
  const [order, setOrder] = useState(null);
  const [parts, setParts] = useState([]);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const [run, busy] = useAction();
  const { data: waiting } = useFetch('/sup/awaiting-issue', { live: ['custodies', 'orders'] });
  const workers = lookups?.workers || [];

  const pick = async (q) => {
    try {
      const o = await lookupOrder(q);
      if (!checkOrder(o, toast)) return;
      setOrder(o);
      setParts([{ worker_id: '', weight: '', pieces: '' }, { worker_id: '', weight: '', pieces: '' }]);
    } catch (e) { toast(e.message, 'bad'); }
  };
  useEffect(() => { if (sp.get('mode') === 'split' && sp.get('order')) pick({ id: sp.get('order') }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const stones = Number(order?.stones?.used || 0);
  const balance = Number(order?.order_balance || 0);
  const totalW = parts.reduce((s, p) => s + Number(sub(p.weight || 0, stones && p.weight ? stones / Math.max(1, parts.length) : 0)), 0);
  const totalP = parts.reduce((s, p) => s + Number(p.pieces || 0), 0);
  const remaining = +(balance - parts.reduce((s, p) => s + Number(p.weight || 0), 0)).toFixed(4);
  const upd = (i, k, v) => setParts((x) => x.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const used = new Set(parts.map((p) => String(p.worker_id)).filter(Boolean));
  const valid = order && parts.length >= 1 && parts.every((p) => p.worker_id && Number(p.weight) > 0) && used.size === parts.length;

  // توزيع تلقائي بالتساوي على العمال المختارين
  const evenSplit = () => {
    const n = parts.length;
    if (!n || !balance) return;
    const each = Math.floor((balance / n) * 1000) / 1000;
    const q = order.quantity;
    setParts(parts.map((p, i) => ({ ...p, weight: String(i === n - 1 ? +(balance - each * (n - 1)).toFixed(4) : each), pieces: String(Math.floor(q / n) + (i < q % n ? 1 : 0)) })));
  };

  const submit = () => run(async () => {
    const r = await api.post('/sup/issue-split', { order_id: order.id, note, idempotency_key: key.current, parts: parts.map((p) => ({ worker_id: p.worker_id, weight: p.weight, pieces: p.pieces || undefined, notes: p.notes })) });
    setDone(r);
  }, 'تم تقسيم الطلب - بانتظار قبول العمال');

  if (done) {
    return (
      <Card title={`تم تقسيم الطلب ${order.order_no} على ${done.parts.length} عمال`}>
        <div className="alert alert-success mb">لكل عامل عهدة مستقلة، وأُرسل لكل منهم إشعار لقبول الاستلام.</div>
        <div className="grid" style={{ gap: 8 }}>
          {done.parts.map((p) => {
            const w = workers.find((x) => x.id === Number(p.worker_id));
            return (
              <div key={p.batch_id} className="hrow between wrap gap line-item">
                <span><b>{w?.full_name}</b> — <span dir="ltr">{fmtW(p.custodies?.[0]?.weight_issued)} جم</span> · {p.custodies?.[0]?.pieces} قطعة</span>
                <a className="btn btn-outline-secondary btn-sm" href={`/print/batch/${p.batch_id}`} target="_blank" rel="noreferrer">طباعة الكشف</a>
              </div>
            );
          })}
        </div>
        <div className="hrow gap wrap mt"><Btn size="lg" onClick={() => { setOrder(null); setParts([]); setDone(null); key.current = newKey(); }}>تقسيم طلب آخر</Btn><Link className="btn btn-outline-secondary btn-lg" to={`/orders/${order.id}`}>فتح الطلب</Link></div>
      </Card>
    );
  }

  if (!order) {
    return (
      <div className="grid">
        <ScanInput onScan={(code) => pick({ code })} placeholder="امسح QR الطلب المراد تقسيمه أو اكتب رقمه" />
        <Card title="أو اختر من الطلبات بانتظار التسليم" pad={false}>
          <div className="card-body pick-grid">
            {(waiting || []).map((o) => (
              <button key={o.id} className="pick" onClick={() => pick({ id: o.id })}>
                <b>{o.order_no}</b><span className="muted">{o.title}</span><span className="small">{o.stage_name} · الكمية {o.quantity}</span>
                {Number(o.order_balance) > 0 && <span className="small">رصيد {fmtW(o.order_balance)} جم</span>}
              </button>
            ))}
            {!waiting?.length && <span className="muted">لا توجد طلبات بانتظار التسليم</span>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid">
      <Card>
        <div className="hrow between wrap gap">
          <div><b>{order.order_no}</b> <span className="muted">— {order.title}</span><OrderBadges o={order} /></div>
          <Btn kind="ghost" size="sm" onClick={() => setOrder(null)}>تغيير الطلب</Btn>
        </div>
      </Card>
      {parts.map((p, i) => (
        <div key={i} className="line-item sel">
          <div className="grid g4" style={{ alignItems: 'end' }}>
            <Field label={`العامل ${i + 1}`}>
              <Select value={p.worker_id} onChange={(e) => upd(i, 'worker_id', e.target.value)} placeholder="اختر العامل أو المكينة"
                options={workers.filter((w) => !used.has(String(w.id)) || String(w.id) === String(p.worker_id)).map((w) => [w.id, `${w.kind === 'machine' ? '⚙ ' : ''}${w.full_name}${w.employee_no ? ` (${w.employee_no})` : ''}`])} />
            </Field>
            <Field label="الوزن (جم)"><WeightInput big value={p.weight} onChange={(v) => upd(i, 'weight', v)} /></Field>
            <Field label="عدد القطع"><Input inputMode="numeric" value={p.pieces} onChange={(e) => upd(i, 'pieces', e.target.value.replace(/\D/g, ''))} /></Field>
            <div className="hrow gap"><Input placeholder="ملاحظة" value={p.notes || ''} onChange={(e) => upd(i, 'notes', e.target.value)} />{parts.length > 1 && <Btn kind="ghost" size="sm" onClick={() => setParts(parts.filter((_, j) => j !== i))}>حذف</Btn>}</div>
          </div>
        </div>
      ))}
      <div className="hrow gap wrap">
        <Btn kind="ghost" onClick={() => setParts([...parts, { worker_id: '', weight: '', pieces: '' }])}>+ إضافة عامل</Btn>
        {balance > 0 && <Btn kind="ghost" onClick={evenSplit}>توزيع رصيد الطلب بالتساوي</Btn>}
      </div>
      <Field label="ملاحظة (اختياري)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {balance > 0 && remaining < 0 && <div className="alert alert-warning small">المجموع يزيد عن رصيد الطلب بـ {fmtW(-remaining, 4)} جم — سيُصرف الفرق تلقائياً من الخزنة.</div>}
      {totalP > order.quantity && <div className="alert alert-warning small">مجموع القطع ({totalP}) أكبر من كمية الطلب ({order.quantity}).</div>}
      <AcceptNote />
      <div className="sticky-foot">
        <Kv items={[['عدد العمال', parts.length], ['المجموع', <span dir="ltr">{fmtW(parts.reduce((s, p) => s + Number(p.weight || 0), 0), 4)} جم</span>],
          balance > 0 && ['المتبقي من رصيد الطلب', <span dir="ltr" style={{ color: remaining < 0 ? 'var(--bad)' : undefined }}>{fmtW(Math.max(0, remaining), 4)} جم</span>], ['القطع', `${totalP} / ${order.quantity}`]]} />
        <Btn size="lg" loading={busy} disabled={!valid || totalW <= 0} onClick={submit}>تأكيد التقسيم والتسليم</Btn>
      </div>
    </div>
  );
}

/** عهدة عامة: ذهب من الخزنة إلى العامل كرصيد في عهدته بدون طلب تصنيع */
function GeneralIssue({ sp }) {
  const { lookups, can } = useAuth();
  const [worker, setWorker] = useState(null);
  const [f, setF] = useState({ material_id: '', weight: '', purpose: '', loss_rate_percent: '0' });
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const [run, busy] = useAction();
  const { data: list, reload } = useFetch('/inventory/gold/general-custodies', { live: ['custodies', 'gold_ledger'] });
  const mats = lookups?.materials || [];
  useEffect(() => {
    const wid = sp.get('worker');
    if (wid) api.get(`/sup/workers/${wid}`).then((p) => setWorker(p.worker)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const materialId = f.material_id || mats.find((m) => m.karat === 21)?.id || mats[0]?.id;
  const valid = worker && materialId && Number(f.weight) > 0 && f.purpose.trim();
  const submit = () => run(async () => {
    const r = await api.post('/inventory/gold/to-worker', { ...f, material_id: materialId, worker_id: worker.id, idempotency_key: key.current });
    setDone(r); reload();
  }, 'تم التسليم - بانتظار قبول العامل');
  const reset = () => { setWorker(null); setF({ material_id: '', weight: '', purpose: '', loss_rate_percent: '0' }); setDone(null); key.current = newKey(); };

  return (
    <div className="grid">
      {done ? (
        <Card>
          <div className="alert alert-success mb">سُجلت العهدة العامة {done.custody_no} للعامل {worker.full_name}: {fmtW(f.weight)} جم. أُرسل له إشعار لقبول الاستلام.</div>
          <div className="hrow gap wrap">
            <a className="btn btn-dark btn-lg" href={`/print/batch/${done.batch_id}`} target="_blank" rel="noreferrer">طباعة الكشف</a>
            <Btn size="lg" onClick={reset}>عهدة عامة جديدة</Btn>
            <Link className="btn btn-outline-secondary btn-lg" to={`/sup/workers/${worker.id}`}>ملف العامل</Link>
          </div>
        </Card>
      ) : !worker ? (
        <>
          <div className="alert alert-info small">يُصرف الذهب من الخزنة إلى العامل كرصيد في عهدته بدون طلب تصنيع (مثل: رصيد لحام، تصليحات، تجهيز). يستلمه منه المشرف لاحقاً من شاشة "استلام ذهب" فيعود للخزنة مع حساب العجز.</div>
          <WorkerPicker onPick={setWorker} searchInHeader />
        </>
      ) : (
        <>
          <Card>
            <div className="hrow between wrap gap">
              <div><span className="muted small">المستلم</span><h3>{worker.kind === 'machine' && <span className="machine-tag">⚙ مكينة</span>}{worker.full_name} <span className="muted small">{worker.employee_no}</span></h3></div>
              <Btn kind="ghost" size="sm" onClick={() => setWorker(null)}>تغيير</Btn>
            </div>
          </Card>
          <div className="line-item sel">
            <div className="grid g2">
              <Field label="المادة (العيار واللون)"><Select value={materialId || ''} onChange={(e) => setF({ ...f, material_id: e.target.value })} options={mats.map((m) => [m.id, m.name])} /></Field>
              <Field label="الوزن (جم) *"><WeightInput big value={f.weight} onChange={(v) => setF({ ...f, weight: v })} autoFocus /></Field>
              <Field label="الغرض / البيان *"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="مثال: رصيد لحام وتصليحات" /></Field>
              <Field label="نسبة العجز المسموح %" hint="0 = أي نقص عند الإرجاع يُحال للمراجعة"><Input dir="ltr" inputMode="decimal" value={f.loss_rate_percent} onChange={(e) => setF({ ...f, loss_rate_percent: e.target.value })} /></Field>
            </div>
          </div>
          <AcceptNote />
          <div className="sticky-foot">
            <Kv items={[['يُصرف من', 'الخزنة'], ['الوزن', <span dir="ltr">{fmtW(f.weight || 0)} جم</span>]]} />
            <Btn size="lg" loading={busy} disabled={!valid} onClick={submit}>تأكيد تسليم العهدة العامة</Btn>
          </div>
        </>
      )}
      {list?.length > 0 && (
        <Card title={`العهد العامة القائمة لدى العمال (${list.length})`} pad={false}>
          <Table rows={list} columns={[
            ['العامل', (c) => <Link className="link" to={`/sup/workers/${c.worker_id}`}>{c.worker_kind === 'machine' ? '⚙ ' : ''}{c.worker_name}</Link>], ['الغرض', 'purpose'], ['المادة', 'material_name'],
            ['الوزن', (c) => <b className="n">{fmtW(c.weight_issued)}</b>],
            ['الحالة', (c) => (c.status === 'under_review' ? <Badge tone="warn">تحت المراجعة</Badge> : c.worker_ack_at ? <Badge tone="ok">قبِلها العامل</Badge> : c.worker_rejected_at ? <Badge tone="bad">رفضها: {c.worker_reject_reason}</Badge> : <Badge tone="warn">بانتظار القبول</Badge>)],
            ['التاريخ', (c) => fmtDT(c.issued_at)],
            ['', (c) => can('custody.receive') && c.status === 'open' && <Link className="btn btn-dark btn-sm" to={`/sup/receive?worker=${c.worker_id}`}>استلام</Link>],
          ]} />
        </Card>
      )}
    </div>
  );
}
