import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, newKey, fileUrl } from '../../api.js';
import { calcLoss, fmtW, fmtPct, sub, WORK_STATE, SETTLEMENT_STATUS } from '../../format.js';
import { Btn, Card, Field, Input, Page, PageActions, ScanInput, WeightInput, useAction, useToast, Badge, Kv, Loader, Empty, StatusBadge, Textarea } from '../../ui.jsx';
import WorkerPicker from '../../components/WorkerPicker.jsx';

/** استلام ذهب من العامل: كل العهد في شاشة واحدة، وزن مستقل لكل طلب، حساب العجز تلقائياً */
export default function Receive() {
  const [sp] = useSearchParams();
  const toast = useToast();
  const [worker, setWorker] = useState(null);
  const [open, setOpen] = useState(null);
  const [lines, setLines] = useState({});
  const [done, setDone] = useState(null);
  const key = useRef(newKey());
  const [run, busy] = useAction();

  useEffect(() => {
    const wid = sp.get('worker');
    if (wid) api.get(`/sup/workers/${wid}`).then((p) => setWorker(p.worker)).catch(() => {});
  }, [sp]);
  useEffect(() => {
    if (!worker) return;
    setOpen(null);
    api.get(`/sup/workers/${worker.id}/open`).then((rows) => {
      setOpen(rows);
      // تحديد تلقائي للطلبات التي أنهاها العامل مع تعبئة ما صرّح به كاقتراح
      const init = {};
      for (const c of rows) if (c.work_state === 'finished') init[c.id] = lineFrom(c);
      setLines(init);
    });
  }, [worker]);

  const lineFrom = (c) => ({
    returned: c.worker_declared_returned != null ? String(+(Number(c.worker_declared_returned) + Number(c.stones_now || 0)).toFixed(4)) : '',
    stones: c.stones_now || '0', reason: '', pieces: String(c.pieces), notes: '', showStones: Number(c.stones_now) > 0,
  });
  const toggle = (c) => setLines((l) => { const n = { ...l }; if (n[c.id]) delete n[c.id]; else n[c.id] = lineFrom(c); return n; });
  const upd = (id, k, v) => setLines((l) => ({ ...l, [id]: { ...l[id], [k]: v } }));
  const scan = async (code) => {
    try {
      const o = await api.get(`/sup/lookup?code=${encodeURIComponent(code)}`);
      const c = open?.find((x) => x.order_id === o.id);
      if (!c) return toast(`الطلب ${o.order_no} ليس في عهدة هذا العامل`, 'bad');
      if (!lines[c.id]) toggle(c);
      document.getElementById(`c-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { toast(e.message, 'bad'); }
  };

  const calc = useMemo(() => {
    const out = {};
    for (const c of open || []) {
      const l = lines[c.id];
      if (!l || l.returned === '') continue;
      const ret = sub(l.returned, l.stones || 0);
      out[c.id] = { ...calcLoss(c.weight_issued, ret, 0, c.loss_rate_snapshot), ret };
    }
    return out;
  }, [open, lines]);
  const selected = (open || []).filter((c) => lines[c.id]);
  const problems = selected.filter((c) => calc[c.id] && calc[c.id].gain > 0);
  const valid = selected.length && selected.every((c) => lines[c.id].returned !== '' && calc[c.id] && calc[c.id].ret >= 0)
    && problems.every((c) => lines[c.id].reason.trim());

  const submit = () => run(async () => {
    const r = await api.post('/sup/receive', {
      worker_id: worker.id, idempotency_key: key.current,
      items: selected.map((c) => ({ custody_id: c.id, returned_weight: lines[c.id].returned, scrap_weight: '0', stones_weight: lines[c.id].stones || '0', reason: lines[c.id].reason, pieces_returned: lines[c.id].pieces, notes: lines[c.id].notes })),
    });
    setDone(r);
  }, 'تم الاستلام وتسجيل التسويات');

  const reset = () => { setWorker(null); setOpen(null); setLines({}); setDone(null); key.current = newKey(); };

  if (done) {
    return (
      <Page title="تم الاستلام">
        <Card title={`جلسة ${done.batch_no || ''}`}>
          <div className="grid">
            {(done.results || []).map((r) => (
              <div key={r.settlement.id} className={`line-item ${r.settlement.status === 'pending_review' ? 'alarm' : ''}`}>
                <div className="line-head">
                  <b>{r.order_no}</b>
                  <StatusBadge map={SETTLEMENT_STATUS} value={r.settlement.status} />
                </div>
                <div className="calc">
                  <div><span>المرتجع</span><b>{fmtW(r.settlement.returned_weight)}</b></div>
                  <div><span>العجز الفعلي</span><b>{fmtW(r.settlement.actual_loss)}</b></div>
                  <div><span>المسموح</span><b>{fmtW(r.settlement.allowed_loss)}</b></div>
                  <div className={Number(r.settlement.abnormal_loss) > 0 ? 'bad' : 'ok'}><span>على حساب العامل</span><b>{fmtW(r.settlement.abnormal_loss)}</b></div>
                </div>
                {r.advanced?.stage && <span className="small muted">انتقل الطلب إلى: {r.advanced.stage.name}</span>}
                {r.advanced?.blocked && <span className="small muted">{r.advanced.blocked}</span>}
                {r.settlement.status === 'pending_review' && <span className="small">أحيلت الحالة للمراجعة والاعتماد قبل إغلاق التسوية.</span>}
              </div>
            ))}
            {done.duplicate && <div className="alert alert-info">هذه الجلسة مسجلة مسبقاً - لم يتم تكرار الوزن</div>}
          </div>
          <div className="hrow gap wrap mt">
            <a className="btn btn-dark btn-lg" href={`/print/batch/${done.batch_id}`} target="_blank" rel="noreferrer">طباعة كشف الاستلام</a>
            <Btn size="lg" onClick={reset}>استلام جديد</Btn>
            {(done.results || []).some((r) => r.settlement.status === 'pending_review') && <Link to="/sup/review" className="btn btn-outline-secondary btn-lg">مراجعة العجز</Link>}
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="استلام ذهب من العامل" inline>
      <PageActions><div className="steps"><span className={!worker ? 'on' : 'done'}>1. العامل</span><span className={worker && !selected.length ? 'on' : selected.length ? 'done' : ''}>2. اختيار الطلبات</span><span className={selected.length ? 'on' : ''}>3. الوزن والتأكيد</span></div></PageActions>
      {!worker ? <WorkerPicker onPick={setWorker} mode="receive" searchInHeader /> : (
        <div className="grid">
          <Card>
            <div className="hrow between wrap gap">
              <div><span className="muted small">استلام من</span><h3>{worker.full_name} <span className="muted small">{worker.employee_no}</span></h3></div>
              <div className="hrow gap"><Link to={`/sup/workers/${worker.id}`} className="btn btn-outline-secondary btn-sm">ملف العامل</Link><Btn kind="ghost" size="sm" onClick={reset}>تغيير العامل</Btn></div>
            </div>
          </Card>
          {!open ? <Loader /> : !open.length ? <Empty>لا توجد عهدة مفتوحة لدى هذا العامل</Empty> : (
            <>
              {open.length > 1 && <ScanInput onScan={scan} placeholder="امسح QR الطلب لتحديده (اختياري)" autoFocus={false} />}
              {open.map((c) => {
                const l = lines[c.id];
                const k = calc[c.id];
                const alarm = k && k.gain > 0;
                return (
                  <div key={c.id} id={`c-${c.id}`} className={`line-item ${l ? 'sel' : ''} ${alarm ? 'alarm' : ''}`}>
                    <label className="line-head check" style={{ cursor: 'pointer' }}>
                      <span className="hrow gap">
                        <input type="checkbox" checked={!!l} onChange={() => toggle(c)} />
                        {c.thumb && <img src={fileUrl(c.thumb)} alt="" className="order-thumb" />}
                        <span><b>{c.order_no}</b> <span className="muted">— {c.title}</span></span>
                      </span>
                      <span className="hrow gap wrap">
                        <Badge tone="gold">{c.stage_name}</Badge>
                        <Badge tone={c.work_state === 'finished' ? 'ok' : 'muted'}>{WORK_STATE[c.work_state]}</Badge>
                        {!c.worker_ack_at && <Badge tone={c.worker_rejected_at ? 'bad' : 'warn'}>{c.worker_rejected_at ? `رفضها العامل: ${c.worker_reject_reason}` : 'لم يقبلها العامل بعد'}</Badge>}
                      </span>
                    </label>
                    <div className="calc">
                      <div><span>الوزن المستلم من المصنع</span><b>{fmtW(c.weight_issued)}</b></div>
                      <div><span>المادة</span><b style={{ direction: 'rtl' }}>{c.material_name}</b></div>
                      <div><span>نسبة العجز المسموح</span><b>{fmtPct(c.loss_rate_snapshot)}</b></div>
                    </div>
                    {l && (
                      <>
                        <div className="grid g3">
                          <Field label="الوزن الفعلي المرتجع (جم)" hint={Number(l.stones) > 0 ? `صافي الذهب: ${fmtW(k?.ret ?? 0, 4)}` : 'الوزن على الميزان'}>
                            <WeightInput big value={l.returned} onChange={(v) => upd(c.id, 'returned', v)} autoFocus />
                          </Field>
                          <Field label="عدد القطع المستلمة"><Input inputMode="numeric" value={l.pieces} onChange={(e) => upd(c.id, 'pieces', e.target.value.replace(/\D/g, ''))} /></Field>
                        </div>
                        {l.showStones ? (
                          <Field label="وزن الأحجار المركبة ضمن الوزن (جم)" hint="1 قيراط = 0.2 جرام - محسوب تلقائياً من حركات الأحجار"><WeightInput value={l.stones} onChange={(v) => upd(c.id, 'stones', v)} /></Field>
                        ) : <button className="link small" style={{ justifySelf: 'start' }} onClick={() => upd(c.id, 'showStones', true)}>القطعة تحتوي أحجاراً؟</button>}
                        {k && (
                          <div className="calc">
                            <div><span>العجز الفعلي</span><b>{fmtW(k.actual, 4)}</b></div>
                            <div className="ok"><span>المسموح (المستلم × النسبة)</span><b>{fmtW(k.allowed, 4)}</b></div>
                            <div className={k.abnormal > 0 ? 'bad' : 'ok'}><span>يبقى على حساب العامل</span><b>{fmtW(k.abnormal, 4)}</b></div>
                            {k.gain > 0 && <div className="bad"><span>زيادة في الوزن</span><b>{fmtW(k.gain, 4)}</b></div>}
                          </div>
                        )}
                        {alarm && (
                          <>
                            <div className="alert alert-danger">الوزن المرتجع أكبر من المسلَّم للعامل — سجّل ملاحظة وستحال الحالة للاعتماد.</div>
                            <Field label="الملاحظة *"><Textarea value={l.reason} onChange={(e) => upd(c.id, 'reason', e.target.value)} /></Field>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {selected.length > 0 && (
                <>
                  <div className="sticky-foot">
                    <Kv items={[['طلبات مختارة', selected.length], ['تحتاج مراجعة', problems.length]]} />
                    <Btn size="lg" kind={problems.length ? 'danger' : 'primary'} loading={busy} disabled={!valid} onClick={submit}>
                      {problems.length ? 'تأكيد الاستلام وإحالة للمراجعة' : 'تأكيد الاستلام'}
                    </Btn>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Page>
  );
}
