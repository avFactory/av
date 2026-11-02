import { Link } from 'react-router-dom';
import { fmtW, fmtMoney, LOCS } from '../../format.js';
import { Card, Loader, Stat, Table, useFetch } from '../../ui.jsx';

export default function Dashboard() {
  const { data: s } = useFetch('/admin/stats', { live: ['orders', 'gold_ledger', 'settlements'] });
  if (!s) return <Loader />;
  const maxStage = Math.max(1, ...s.byStage.map((x) => x.n));
  const mats = {};
  for (const r of s.byMaterial) { (mats[r.name] ||= {})[r.loc_type] = r.balance; }
  return (
    <div className="page">
      <div className="page-h"><h1>لوحة الإدارة العامة</h1></div>
      <h3 className="mb">الطلبات</h3>
      <div className="grid g4 mb">
        <Stat label="طلبات جديدة" value={s.new_orders} to="/orders?status=pending_review" tone="gold" />
        <Stat label="قيد التصنيع" value={s.in_production} to="/orders?status=in_production" />
        <Stat label="متأخرة" value={s.late_orders} to="/orders?late=1" tone={s.late_orders ? 'bad' : 'plain'} />
        <Stat label="مكتملة (جاهزة/مسلمة)" value={s.completed_orders} sub={`${s.ready_orders} بانتظار التسليم`} tone="ok" />
      </div>
      <h3 className="mb">الذهب (جرام)</h3>
      <div className="grid g4 mb">
        <Stat label="إجمالي الذهب في المصنع" value={fmtW(s.gold_in_factory)} unit="جم" tone="gold" sub="خزنة + طلبات + عمال + بقايا + جاهز + معلق" />
        <Stat label="لدى العمال" value={fmtW(s.gold_with_workers)} unit="جم" to="/sup/workers" />
        <Stat label="في المخزون (الخزنة)" value={fmtW(s.gold_in_vault)} unit="جم" to="/admin/inventory" sub={`تحت التشغيل ${fmtW(s.gold_in_orders)} · بقايا ${fmtW(s.gold_scrap)}`} />
        <Stat label="منتجات جاهزة" value={fmtW(s.gold_finished)} unit="جم" />
        <Stat label="العجز الطبيعي" value={fmtW(s.normal_loss)} unit="جم" tone="ok" to="/admin/reports" />
        <Stat label="العجز غير الطبيعي" value={fmtW(s.abnormal_loss)} unit="جم" tone="bad" to="/admin/reports" sub={Number(s.pending_loss) ? `${fmtW(s.pending_loss)} جم تحت المراجعة` : ''} />
        <Stat label="حالات عجز مفتوحة" value={s.open_reviews} to="/sup/review" tone={s.open_reviews ? 'warn' : 'plain'} />
        <Stat label="عدد العمال" value={s.workers} to="/admin/employees" />
      </div>
      <h3 className="mb">المالية (أجور التصنيع فقط)</h3>
      <div className="grid g4 mb">
        <Stat label="إجمالي أجور التصنيع" value={fmtMoney(s.labor_revenue)} sub="قبل الضريبة" to="/admin/reports" />
        <Stat label="إجمالي الفواتير" value={fmtMoney(s.invoiced_total)} to="/admin/invoices" />
        <Stat label="المبالغ المحصلة" value={fmtMoney(s.collected)} tone="ok" to="/admin/payments" />
        <Stat label="الفواتير المستحقة" value={fmtMoney(s.receivables)} tone={Number(s.receivables) > 0 ? 'warn' : 'plain'} />
      </div>
      <div className="grid g2">
        <Card title="الطلبات حسب المرحلة">
          {s.byStage.map((x) => (
            <div key={x.name} className="row gap small" style={{ marginBottom: 6 }}>
              <span style={{ width: 160 }}>{x.name}</span>
              <div className="progress grow"><div style={{ width: `${(100 * x.n) / maxStage}%` }} /></div>
              <b style={{ width: 30, textAlign: 'left' }}>{x.n}</b>
            </div>
          ))}
        </Card>
        <Card title="توزيع الذهب حسب المادة والموقع" pad={false}>
          <Table rows={Object.entries(mats).map(([name, v]) => ({ name, ...v }))} columns={[['المادة', 'name'], ...['vault', 'order', 'worker', 'scrap', 'finished', 'loss_suspense'].map((k) => [LOCS[k], (r) => <span className="n">{fmtW(r[k] || 0)}</span>])]} />
          <div className="card-b"><Link to="/admin/inventory?tab=rec" className="link">مطابقة الأرصدة ←</Link></div>
        </Card>
      </div>
    </div>
  );
}
