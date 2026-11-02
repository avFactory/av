import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT, fmtPct, CUSTODY_STATUS, SETTLEMENT_STATUS, WORK_STATE, KINDS } from '../../format.js';
import { Card, LinkBtn, Loader, Page, Stat, StatusBadge, Table, Tabs, useFetch, Badge, ReasonModal, useAction } from '../../ui.jsx';

/** ملف العامل: كل بياناته وعهده وإدارتها من صفحة واحدة */
export default function WorkerProfile() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, reload } = useFetch(`/sup/workers/${id}`, { live: ['custodies', 'settlements', 'gold_ledger'] });
  const { data: perf } = useFetch(`/admin/employees/${id}/performance`);
  const [tab, setTab] = useState('open');
  const [rev, setRev] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const { worker: w, custodies, totals, balances, assigned, recent, stones } = data;
  const open = custodies.filter((c) => c.status === 'open');
  const review = custodies.filter((c) => c.status === 'under_review');
  const closed = custodies.filter((c) => c.status === 'closed');
  const late = custodies.filter((c) => c.late);
  const working = open.filter((c) => ['in_progress', 'paused'].includes(c.work_state));
  const finished = open.filter((c) => c.work_state === 'finished');
  const doReverse = (reason) => run(async () => { await api.post(`/sup/custodies/${rev}/reverse`, { reason }); setRev(null); reload(); }, 'تم إلغاء التسليم بحركة عكسية');

  const cols = [
    ['الطلب', (c) => <Link to={`/orders/${c.order_id}`} className="link">{c.order_no}</Link>], ['الوصف', 'title'], ['المرحلة', 'stage_name'], ['المادة', 'material_name'],
    ['الوزن المستلم', (c) => <span className="n">{fmtW(c.weight_issued)}</span>], ['نسبة العجز', (c) => fmtPct(c.loss_rate_snapshot)],
    ['الحالة', (c) => (c.status === 'open' ? <Badge tone={c.work_state === 'finished' ? 'ok' : 'gold'}>{WORK_STATE[c.work_state]}</Badge> : <StatusBadge map={CUSTODY_STATUS} value={c.status} />)],
    ['التسليم', (c) => fmtDT(c.issued_at)],
  ];
  const closedCols = [
    ...cols.slice(0, 5), ['المرتجع', (c) => <span className="n">{fmtW(c.returned_weight)}</span>], ['البقايا', (c) => <span className="n">{fmtW(c.scrap_weight)}</span>],
    ['العجز الطبيعي', (c) => <span className="n">{fmtW(c.normal_loss)}</span>], ['غير الطبيعي', (c) => <span className="n">{fmtW(c.abnormal_loss)}</span>],
    ['التسوية', (c) => <StatusBadge map={SETTLEMENT_STATUS} value={c.settlement_status} />], ['الاستلام', (c) => fmtDT(c.received_at)],
  ];
  return (
    <Page title={w.full_name} subtitle={`${w.employee_no || ''} · ${[w.department, w.specialty].filter(Boolean).join(' · ') || 'عامل'}`} back="/sup/workers"
      actions={<>
        {can('custody.issue') && <LinkBtn kind="primary" size="lg" to={`/sup/issue?worker=${w.id}`}>تسليم ذهب</LinkBtn>}
        {can('custody.receive') && open.length > 0 && <LinkBtn kind="dark" size="lg" to={`/sup/receive?worker=${w.id}`}>استلام ذهب ({open.length})</LinkBtn>}
      </>}>
      <div className="grid g4 mb">
        <Stat label="الذهب في عهدته الآن" value={fmtW(open.reduce((s, c) => s + Number(c.weight_issued), 0))} unit="جم" tone="gold" sub={balances.map((b) => `${b.name}: ${fmtW(b.balance)}`).join(' · ')} />
        <Stat label="إجمالي ما استلمه" value={fmtW(totals.received_total)} unit="جم" />
        <Stat label="إجمالي ما أعاده" value={fmtW(totals.returned_total)} unit="جم" />
        <Stat label="بقايا مستردة" value={fmtW(totals.scrap_total)} unit="جم" />
        <Stat label="العجز الطبيعي" value={fmtW(totals.normal_loss_total)} unit="جم" tone="ok" />
        <Stat label="العجز غير الطبيعي" value={fmtW(totals.abnormal_loss_total)} unit="جم" tone={Number(totals.abnormal_loss_total) > 0 ? 'bad' : 'plain'} />
        <Stat label="طلبات متأخرة" value={late.length} tone={late.length ? 'warn' : 'plain'} />
        <Stat label="نسبة العجز الكلية" value={perf?.loss_pct ? fmtPct(perf.loss_pct) : '—'} sub={perf?.avg_hours ? `متوسط مدة المرحلة ${perf.avg_hours} ساعة` : ''} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        ['open', `الطلبات المسندة / لديه (${open.length + assigned.length})`], ['working', `يعمل عليها (${working.length})`], ['finished', `منتهية بانتظار الاستلام (${finished.length})`],
        ['review', `تحت المراجعة (${review.length})`], ['closed', `منتهية ومسلمة (${closed.length})`], ['stones', 'الأحجار لديه'], ['recent', 'آخر الحركات'],
      ]} />
      {tab === 'open' && (
        <div className="grid">
          <div className="card"><Table rows={open} empty="لا توجد عهدة مفتوحة" rowClass={(c) => (c.late ? 'row-warn' : '')} columns={[...cols,
            ['', (c) => <div className="row gap">
              {can('custody.receive') && <LinkBtn size="sm" kind="dark" to={`/sup/receive?worker=${w.id}`}>استلام</LinkBtn>}
              {can('custody.reverse') && <button className="btn btn-ghost btn-sm" onClick={() => setRev(c.id)}>إلغاء تسليم خاطئ</button>}
            </div>]]} /></div>
          {assigned.length > 0 && <Card title="مسندة إليه بدون ذهب بعد" pad={false}><Table rows={assigned} columns={[['الطلب', (o) => <Link className="link" to={`/orders/${o.id}`}>{o.order_no}</Link>], ['الوصف', 'title'], ['المرحلة', 'stage_name'],
            ['', (o) => can('custody.issue') && <LinkBtn size="sm" kind="primary" to={`/sup/issue?worker=${w.id}&order=${o.id}`}>تسليم</LinkBtn>]]} /></Card>}
        </div>
      )}
      {tab === 'working' && <div className="card"><Table rows={working} columns={cols} empty="لا يوجد" /></div>}
      {tab === 'finished' && <div className="card"><Table rows={finished} columns={cols} empty="لا يوجد" /></div>}
      {tab === 'review' && <div className="card"><Table rows={review} columns={closedCols} empty="لا يوجد" /></div>}
      {tab === 'closed' && <div className="card"><Table rows={closed} columns={closedCols} empty="لا يوجد" /></div>}
      {tab === 'stones' && <div className="card"><Table rows={stones} empty="لا توجد أحجار في عهدته" columns={[['الدفعة', 'lot_no'], ['النوع', 'stone_type'], ['الطلب', 'order_no'], ['قيراط', (s) => <span className="n">{s.carats}</span>], ['العدد', 'count']]} /></div>}
      {tab === 'recent' && <div className="card"><Table rows={recent} columns={[['رقم الحركة', 'movement_no'], ['النوع', (m) => KINDS[m.kind] || m.kind], ['الطلب', 'order_no'], ['المرحلة', 'stage_name'], ['الوزن', (m) => <span className="n">{fmtW(m.weight)}</span>], ['التاريخ', (m) => fmtDT(m.created_at)]]} /></div>}
      <ReasonModal open={!!rev} title="إلغاء تسليم خاطئ (حركة عكسية)" label="سبب الإلغاء" danger busy={busy} onClose={() => setRev(null)} onSubmit={doReverse} />
    </Page>
  );
}
