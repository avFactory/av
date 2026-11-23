import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtMoney, fmtDT } from '../../format.js';
import { Badge, Btn, Card, Input, Loader, Page, Table, useAction, useFetch, askConfirm, showAlert } from '../../ui.jsx';

const thisMonth = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);

/** سلف العجز الشهرية: العجز الزائد عن نسب المراحل على كل عامل يُقيَّم بسعر الذهب ويُسجَّل سلفة تُخصم من الراتب */
export default function LossAdvances() {
  const { can } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const { data, reload } = useFetch(`/admin/loss-advances?month=${month}`, { deps: [month] });
  const [price, setPrice] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (data && price === '') setPrice(String(data.gold24 || '')); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Loader />;
  const adv = (w) => data.advances.find((a) => a.worker_id === w.worker_id);
  const value = (w) => Number(w.charged_pure) * Number(price || 0);
  const totalCharged = data.workers.reduce((a, w) => a + Number(w.charged), 0);
  const record = async (w) => {
    const pending = w.under_review > 0;
    if (pending && !await askConfirm(`لدى ${w.full_name} عجز تحت المراجعة (${w.under_review}). تسجيله الآن يشمل العجز الحالي كما هو. متابعة؟`)) return;
    if (!pending && !await askConfirm(`تسجيل سلفة ${fmtMoney(value(w))} على ${w.full_name} لشهر ${month}؟`)) return;
    run(async () => { await api.post('/admin/loss-advances', { worker_id: w.worker_id, month, price_per_gram: price, include_pending: pending }); reload(); }, 'تم تسجيل السلفة').catch(() => {});
  };
  // تثبيت العجز المعلق في حساب العامل (أو كل العمال) لهذا الشهر
  const held = data.held || [];
  const heldOf = (wid) => held.filter((h) => h.worker_id === wid && h.month === month);
  const fix = async (w) => {
    const all = !w;
    const ended = month < thisMonth();
    const msg = all ? `تثبيت عجز شهر ${month} على كل العمال والمكائن؟ يخرج العجز المعلق من حساباتهم إلى العجز (الطبيعي حتى المسموح، والباقي غير طبيعي).` : `تثبيت عجز شهر ${month} على ${w.full_name}؟`;
    if (!await askConfirm(`${msg}${ended ? '' : '\n\n⚠ الشهر لم ينتهِ بعد — أي عجز بعد التثبيت يبقى معلقاً حتى تثبيت جديد.'}`, { title: 'إقفال عجز الشهر', ok: 'نعم، ثبّت' })) return;
    run(async () => {
      const r = await api.post('/admin/loss-advances/fix', { month, ...(all ? {} : { worker_id: w.worker_id }) });
      reload();
      if (r.skipped?.length) showAlert(`لم يُثبَّت لبعض العمال:\n${r.skipped.map((x) => x.reason).join('\n')}`);
    }, 'تم تثبيت العجز').catch(() => {});
  };
  const cancel = async (a) => { if (await askConfirm('إلغاء هذه السلفة؟')) run(async () => { await api.del(`/admin/loss-advances/${a.id}`); reload(); }, 'تم الإلغاء').catch(() => {}); };
  return (
    <Page title="سلف العجز" subtitle="إجمالي عجز الشهر ناقص المسموح (الوزن المستلم × نسبة مهنة العامل) يبقى على حسابه، ثم يُسجَّل سلفة تُخصم من الراتب"
      actions={<div className="d-flex gap-2 align-items-end">
        <label className="d-grid small">الشهر<Input type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} /></label>
        <label className="d-grid small">سعر جرام عيار 24 (ر.س)<Input dir="ltr" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 140 }} /></label>
      </div>}>
      <div className="gold-stats mb-3">
        <div className="gold-stat"><div className="gold-stat-top"><span>العجز على العمال هذا الشهر</span><b><span dir="ltr">{fmtW(totalCharged)}</span> <small>جم</small></b></div></div>
        <div className="gold-stat"><div className="gold-stat-top"><span>القيمة التقديرية</span><b>{fmtMoney(data.workers.reduce((a, w) => a + value(w), 0))}</b></div></div>
        <div className="gold-stat total"><div className="gold-stat-top"><span>سلف مسجلة</span><b>{data.advances.length} · {fmtMoney(data.advances.reduce((a, x) => a + Number(x.amount), 0))}</b></div></div>
      </div>
      {held.length > 0 && (
        <Card className="mb" title={`العجز المعلق في حسابات العمال (${held.length})`} actions={can('loss.advances', 'loss.approve') && held.some((h) => h.month === month) && <Btn size="sm" loading={busy} onClick={() => fix(null)}>تثبيت عجز الشهر للكل</Btn>}>
          <div className="small text-body-secondary mb-2">العجز يبقى في حساب العامل/الماكينة بعد الاستلام، وأي زيادة لاحقة تُخصم منه. عند إقفال الشهر يُثبَّت عليه ويخرج من حسابه.</div>
          <Table rows={held} columns={[
            ['العامل / الماكينة', (h) => <Link className="link" to={`/sup/workers/${h.worker_id}`}>{h.kind === 'machine' ? '⚙ ' : ''}<b>{h.full_name}</b> <span className="text-body-secondary small">{h.employee_no}</span></Link>],
            ['الشهر', 'month'], ['العيار', 'material_name'], ['التسويات', 'settlements'],
            ['العجز المعلق', (h) => <b className={`n ${Number(h.held) > 0 ? 'text-danger' : ''}`}>{fmtW(h.held)}</b>],
            ['المسموح', (h) => <span className="n">{fmtW(h.allowed)}</span>],
            ['', (h) => (h.under_review > 0 ? <Badge tone="warn">{h.under_review} تحت المراجعة</Badge>
              : can('loss.advances', 'loss.approve') && h.month === month && <Btn size="sm" kind="ghost" loading={busy} onClick={() => fix({ worker_id: h.worker_id, full_name: h.full_name })}>تثبيت عليه</Btn>)],
          ]} />
        </Card>
      )}
      <Card pad={false}>
        <Table rows={data.workers} empty="لا يوجد عجز في هذا الشهر" columns={[
          ['العامل', (w) => <Link className="link" to={`/sup/workers/${w.worker_id}`}><b>{w.full_name}</b> <span className="text-body-secondary small">{w.employee_no}</span></Link>],
          ['التسويات', 'settlements'],
          ['إجمالي العجز', (w) => <span className="n">{fmtW(w.actual)}</span>],
          ['المسموح', (w) => <span className="n">{fmtW(w.allowed)}</span>],
          ['على حساب العامل', (w) => <b className={`n ${Number(w.charged) > 0 ? 'text-danger' : ''}`}>{fmtW(w.charged)}</b>],
          ['الحالة', (w) => (heldOf(w.worker_id).length ? <Badge tone="warn">معلق في حسابه</Badge> : (data.closings || []).some((k) => k.worker_id === w.worker_id) ? <Badge tone="ok">مثبت</Badge> : '—')],
          ['صافي عيار 24', (w) => <span className="n">{fmtW(w.charged_pure)}</span>],
          ['القيمة', (w) => (Number(w.charged) > 0 ? fmtMoney(adv(w) ? adv(w).amount : value(w)) : '—')],
          ['', (w) => {
            const a = adv(w);
            if (a) return <span className="d-flex gap-2 align-items-center"><Badge tone="ok">سلفة مسجلة</Badge><span className="small text-body-secondary">{fmtDT(a.created_at)}</span>{can('loss.advances') && <button type="button" className="btn btn-link btn-sm text-danger p-0" onClick={() => cancel(a)}>إلغاء</button>}</span>;
            if (!(Number(w.charged) > 0)) return null;
            return <span className="d-flex gap-2 align-items-center">{w.under_review > 0 && <Badge tone="warn">{w.under_review} تحت المراجعة</Badge>}{can('loss.advances') && <Btn size="sm" loading={busy} disabled={!(Number(price) > 0)} onClick={() => record(w)}>تسجيل سلفة</Btn>}</span>;
          }],
        ]} />
      </Card>
    </Page>
  );
}
