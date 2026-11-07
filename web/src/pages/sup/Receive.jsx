import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, newKey, fileUrl } from '../../api.js';
import { calcLoss, fmtW, fmtPct, sub, WORK_STATE, SETTLEMENT_STATUS } from '../../format.js';
import { Btn, Card, Field, Input, Page, Select, PageActions, ScanInput, WeightInput, useAction, useToast, Badge, Kv, Loader, Empty, StatusBadge, Textarea } from '../../ui.jsx';
import WorkerPicker from '../../components/WorkerPicker.jsx';

/** استلام ذهب من العامل: كل العهد في شاشة واحدة، وزن مستقل لكل طلب، حساب العجز تلقائياً */
export default function Receive() {
  const [sp] = useSearchParams();
  const toast = useToast();
  const [worker, setWorker] = useState(null);
  const [open, setOpen] = useState(null);
  const [lines, setLines] = useState({});
  const [finds, setFinds] = useState(null);
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
    api.get(`/findings/worker/${worker.id}`).then(setFinds).catch(() => setFinds([]));
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
    stones: c.stones_now || '0', reason: '', pieces: String(c.pieces), notes: '', showStones: Number(c.stones_now) > 0, adds: [],
  });
  // خامات أضافها العامل على الطلب من عهدة الخامات لديه (سلسلة، قفل…)
  const addedOf = (l) => (l?.adds || []).reduce((t, a) => t + (Number(a.weight) || 0), 0);
  const updAdd = (id, i, k, v) => setLines((ls) => {
    const l = ls[id];
    const adds = l.adds.map((a, j) => {
      if (j !== i) return a;
      const n = { ...a, [k]: v };
      const src = (finds || []).find((x) => String(x.id) === String(n.source_custody_id));
      if ((k === 'pieces' || k === 'source_custody_id') && src?.unit_weight && n.pieces) n.weight = String(+(Number(src.unit_weight) * Number(n.pieces)).toFixed(3));
      return n;
    });
    return { ...ls, [id]: { ...l, adds } };
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
      const added = addedOf(l);
      out[c.id] = { ...calcLoss((Number(c.weight_issued) + added).toFixed(4), ret, 0, c.loss_rate_snapshot), ret, added };
    }
    return out;
  }, [open, lines]);
  const selected = (open || []).filter((c) => lines[c.id]);
  const problems = selected.filter((c) => calc[c.id] && calc[c.id].gain > 0);
  // مجموع ما يُضاف من كل عهدة خامات لا يتجاوز المتبقي فيها
  const usedBySrc = {};
  for (const c of selected) for (const a of lines[c.id].adds || []) if (a.source_custody_id) usedBySrc[a.source_custody_id] = (usedBySrc[a.source_custody_id] || 0) + (Number(a.weight) || 0);
  const overSrc = (finds || []).filter((x) => (usedBySrc[x.id] || 0) > Number(x.available) + 1e-9);
  const addsOk = selected.every((c) => (lines[c.id].adds || []).every((a) => a.source_custody_id && Number(a.weight) > 0)) && !overSrc.length;
  const valid = addsOk && selected.length && selected.every((c) => lines[c.id].returned !== '' && calc[c.id] && calc[c.id].ret >= 0)
    && problems.every((c) => lines[c.id].reason.trim());

  const submit = () => run(async () => {
    const r = await api.post('/sup/receive', {
      worker_id: worker.id, idempotency_key: key.current,
      items: selected.map((c) => ({ custody_id: c.id, returned_weight: lines[c.id].returned, scrap_weight: '0', stones_weight: lines[c.id].stones || '0', reason: lines[c.id].reason, pieces_returned: lines[c.id].pieces, notes: lines[c.id].notes,
        additions: (lines[c.id].adds || []).map((a) => ({ source_custody_id: a.source_custody_id, weight: a.weight, pieces: a.pieces || 0 })) })),
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
                        {c.thumb && <img src={fileUrl(c.thumb, 400)} alt="" className="order-thumb" />}
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
                        {c.order_id && (() => {
                          const srcs = (finds || []).filter((x) => x.material_id === c.material_id);
                          if (!srcs.length && !l.adds?.length) return null;
                          return (
                            <div className="finds-box">
                              <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                                <b className="small">🔗 خامات أضافها العامل على القطعة <span className="text-body-secondary fw-normal">(من عهدة الخامات لديه — يُخصم وزنها منها ويُضاف للطلب)</span></b>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => upd(c.id, 'adds', [...(l.adds || []), { source_custody_id: srcs.length === 1 ? String(srcs[0].id) : '', pieces: '1', weight: srcs.length === 1 && srcs[0].unit_weight ? String(+Number(srcs[0].unit_weight).toFixed(3)) : '' }])}>+ إضافة خامة</button>
                              </div>
                              {(l.adds || []).map((a, i) => (
                                <div key={i} className="finds-row">
                                  <Select value={a.source_custody_id} onChange={(e) => updAdd(c.id, i, 'source_custody_id', e.target.value)} placeholder="اختر الخامة"
                                    options={srcs.map((x) => [String(x.id), `${x.name} — متبقي ${fmtW(x.available)} جم${x.pieces_left ? ` / ${x.pieces_left} ق` : ''}`])} />
                                  <Input inputMode="numeric" placeholder="قطع" value={a.pieces} onChange={(e) => updAdd(c.id, i, 'pieces', e.target.value.replace(/\D/g, ''))} />
                                  <WeightInput value={a.weight} onChange={(v) => updAdd(c.id, i, 'weight', v)} />
                                  <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => upd(c.id, 'adds', l.adds.filter((_, j) => j !== i))}>حذف</button>
                                </div>
                              ))}
                              {overSrc.length > 0 && <div className="small text-danger">الوزن المضاف أكبر من المتبقي في: {overSrc.map((x) => x.name).join('، ')}</div>}
                            </div>
                          );
                        })()}
                        {k && (
                          <div className="calc">
                            {k.added > 0 && <div><span>المسلَّم + الخامات</span><b>{fmtW(Number(c.weight_issued) + k.added, 4)}</b></div>}
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
