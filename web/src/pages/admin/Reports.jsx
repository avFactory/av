import { useState } from 'react';
import { qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtMoney, fmtPct } from '../../format.js';
import { Card, Field, Input, Loader, Page, Table, Tabs, useFetch } from '../../ui.jsx';

export default function Reports() {
  const { can } = useAuth();
  const [tab, setTab] = useState('worker');
  const [range, setRange] = useState({ from: '', to: '' });
  const isLoss = ['worker', 'stage', 'order', 'material'].includes(tab);
  const { data } = useFetch(isLoss ? `/reports/losses/${tab}${qs(range)}` : tab === 'perf' ? `/reports/workers${qs(range)}` : tab === 'revenue' ? `/finance/reports/revenue${qs(range)}` : null, { deps: [tab] });
  const tabs = [['worker', 'العجز حسب العامل'], ['stage', 'العجز حسب المرحلة'], ['order', 'العجز حسب الطلب'], ['material', 'العجز حسب المادة'], ['perf', 'أداء العمال']];
  if (can('finance.view')) tabs.push(['revenue', 'الإيرادات والمصروفات']);
  return (
    <Page title="التقارير" actions={<>
      <Field label="من"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
      <Field label="إلى"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      {isLoss && <a className="btn btn-dark" style={{ alignSelf: 'end' }} href={`/api/reports/losses/${tab}.xlsx${qs(range)}`}>Excel</a>}
      <button className="btn btn-outline-secondary" style={{ alignSelf: 'end' }} onClick={() => window.print()}>طباعة</button>
    </>}>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {!data ? <Loader /> : isLoss ? (
        <div className="card"><Table rows={data} columns={[
          ['البيان', (r) => <b>{r.label}</b>], ['تسويات', 'settlements'], ['المسلم', (r) => <span className="n">{fmtW(r.issued)}</span>], ['المرتجع', (r) => <span className="n">{fmtW(r.returned)}</span>],
          ['البقايا', (r) => <span className="n">{fmtW(r.scrap)}</span>], ['العجز الفعلي', (r) => <span className="n">{fmtW(r.actual_loss)}</span>], ['طبيعي', (r) => <span className="n">{fmtW(r.normal_loss)}</span>],
          ['غير طبيعي', (r) => <b className="n" style={{ color: Number(r.abnormal_loss) ? 'var(--bad)' : undefined }}>{fmtW(r.abnormal_loss)}</b>], ['مسترد', (r) => <span className="n">{fmtW(r.recovered)}</span>],
          ['نسبة العجز', (r) => fmtPct(r.loss_pct)], ['حالات مفتوحة', 'open_cases'], ['مسؤولية العامل (بعد تحقيق)', 'worker_responsible'],
        ]} /><div className="card-body small muted">العجز غير الطبيعي لا يعني تلقائياً مسؤولية العامل؛ المسؤولية تحدد فقط بنتيجة التحقيق.</div></div>
      ) : tab === 'perf' ? (
        <div className="card"><Table rows={data} columns={[['العامل', (r) => <b>{r.full_name}</b>], ['الرقم', 'employee_no'], ['القسم', 'department'], ['مراحل منجزة', 'completed'], ['جارية', 'open'], ['وزن معالج', (r) => fmtW(r.weight_processed)], ['عجز غير طبيعي', (r) => fmtW(r.abnormal_loss)], ['نسبة العجز', (r) => fmtPct(r.loss_pct)], ['متوسط المدة (س)', 'avg_hours'], ['متأخرة', 'late_count']]} /></div>
      ) : (
        <div className="grid g2">
          <Card title="الإيرادات الشهرية (أجور التصنيع)" pad={false}><Table rows={data.monthly} columns={[['الشهر', 'm'], ['أجور التصنيع', (r) => fmtMoney(r.labor)], ['بنود أخرى', (r) => fmtMoney(r.other)], ['الضريبة', (r) => fmtMoney(r.vat)], ['الإجمالي', (r) => fmtMoney(r.total)]]} /></Card>
          <Card title="التحصيل والمصروفات" pad={false}>
            <Table rows={data.collected} columns={[['الشهر', 'm'], ['المحصل', (r) => fmtMoney(r.amount)]]} />
            <Table rows={data.expenses} columns={[['الشهر', 'm'], ['المصروفات', (r) => fmtMoney(r.amount)], ['ضريبة المدخلات', (r) => fmtMoney(r.vat)]]} />
          </Card>
        </div>
      )}
    </Page>
  );
}
