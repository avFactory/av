import { Link } from 'react-router-dom';
import { fmtW, fmtMoney, LOCS } from '../../format.js';
import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Card, Field, Loader, Modal, Select, Stat, Table, WeightInput, useAction, useFetch } from '../../ui.jsx';

export default function Dashboard() {
  const { me, can } = useAuth();
  // كل قسم حسب صلاحيته في «الأدوار والصلاحيات ← لوحة الإحصائيات»
  const canGold = can('dashboard.gold'), canOrg = can('dashboard.org'), canFin = can('dashboard.finance');
  const { data: s } = useFetch('/admin/stats', { live: ['orders', 'gold_ledger', 'settlements'] });
  const { data: cg } = useFetch(canGold ? '/admin/customer-gold' : null, { live: ['gold_ledger'] });
  const { data: dl } = useFetch(canGold ? '/inventory/dealers' : null, { live: ['gold_ledger'] });
  const { data: sp } = useFetch(canGold ? '/inventory/suppliers' : null, { live: ['gold_ledger'] });
  const { data: og, reload: reloadOg } = useFetch(canOrg ? '/admin/org-gold' : null, { live: ['gold_ledger', 'orders'] });
  const isAdmin = me?.role_code === 'admin';
  const [bm, setBm] = useState(null); // تعديل مخزون فرع
  const [showOrg, setShowOrg] = useState(false);
  const [run, busy] = useAction();
  if (!s) return <Loader />;
  const maxStage = Math.max(1, ...s.byStage.map((x) => x.n));
  const mats = {};
  for (const r of s.byMaterial || []) { (mats[r.name] ||= {})[r.loc_type] = r.balance; }
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
      {(canGold || canOrg) && <h3 className="mb">الذهب (جرام صافي عيار 24)</h3>}
      {canGold && <div className="grid g4 mb">
        <Stat label="إجمالي الذهب في المصنع" value={fmtW(s.gold_in_factory)} unit="جم" tone="gold" sub="خزنة + طلبات + عمال + مكائن + خامات + بقايا + جاهز + معلق" />
        <Stat label="لدى العمال" value={fmtW(s.gold_with_people)} unit="جم" to="/sup/workers" />
        <Stat label="في المكائن" value={fmtW(s.gold_in_machines)} unit="جم" to="/sup/workers" />
        <Stat label="في الخامات" value={fmtW(s.gold_in_findings)} unit="جم" to="/admin/findings" sub="سلاسل، أقفال، كور سحب…" />
        <Stat label="في المخزون (الخزنة)" value={fmtW(s.gold_in_vault)} unit="جم" to="/admin/inventory" sub={`تحت التشغيل ${fmtW(s.gold_in_orders)} · بقايا ${fmtW(s.gold_scrap)}`} />
        <Stat label="الذهب لدى جمل الصافي" value={dl ? fmtW(dl.total) : '…'} unit="جم" to="/admin/gold-dealers" sub={dl ? dl.dealers.filter((d) => d.active).map((d) => `${d.name} ${fmtW(d.balance)}`).join(' · ') : ''} />
        <Stat label="الذهب لدى الجملة" value={cg ? fmtW(cg.total) : '…'} unit="جم" tone="gold" to="/admin/customer-gold" sub={cg ? `${cg.count} عميل` : ''} />
        <Stat label="رصيد مقدم للموردين" value={sp ? fmtW(sp.total) : '…'} unit="جم" to="/admin/suppliers" sub={sp ? sp.suppliers.filter((x) => x.active).map((x) => `${x.name} ${fmtW(x.balance)}`).join(' · ') : ''} />
      </div>}
      {canOrg && <div className="grid g4 mb">
        <Stat label="الذهب الجاهز للتسليم" value={og ? fmtW(og.ready.pure) : '…'} unit="جم" tone="ok" to="/orders?status=ready" sub={og ? `${og.ready.count} طلب جاهز · الوزن الفعلي ${fmtW(og.ready.weight)}` : ''} />
        {['taiba', 'store'].map((k) => {
          const b = og?.branches[k];
          return <Stat key={k} label={`مخزون ${b?.name || ''}`} value={b ? fmtW(b.pure) : '…'} unit="جم"
            sub={b ? `${b.karat !== 24 ? `${fmtW(b.weight)} جم عيار ${b.karat}` : 'عيار 24'}${b.updated_at ? ` · ${new Date(b.updated_at).toLocaleDateString('ar-SA-u-nu-latn')}` : ''}` : ''}
            onClick={isAdmin && b ? () => setBm({ key: k, name: b.name, weight: String(b.weight || ''), karat: String(b.karat) }) : undefined} />;
        })}
        <Stat label="ذهب المؤسسة" value={og ? fmtW(og.total) : '…'} unit="جم" tone="gold" sub="المصنع والفروع والعملاء والجمل والموردين" onClick={og ? () => setShowOrg(true) : undefined} />
      </div>}
      <Modal open={!!bm} onClose={() => setBm(null)} title={`مخزون ${bm?.name || ''}`}>
        {bm && <>
          <Field label="الوزن (جم)"><WeightInput big value={bm.weight} onChange={(v) => setBm({ ...bm, weight: v })} /></Field>
          <Field label="العيار"><Select value={bm.karat} onChange={(e) => setBm({ ...bm, karat: e.target.value })} options={[['24', '24'], ['21', '21'], ['18', '18']]} /></Field>
          <Btn loading={busy} onClick={() => run(async () => { await api.put(`/admin/branch-stock/${bm.key}`, { weight: bm.weight || '0', karat: bm.karat }); setBm(null); reloadOg(); }, 'تم التحديث')}>حفظ</Btn>
        </>}
      </Modal>
      <Modal open={showOrg} onClose={() => setShowOrg(false)} title="ذهب المؤسسة (صافي عيار 24)">
        {og && <Table rows={[
          ['المصنع (خزنة، طلبات، عمال، مكائن، خامات، بقايا)', og.parts.factory, '/admin/inventory', `يشمل الجاهز للتسليم ${fmtW(og.ready.pure)}`],
          [og.branches.taiba.name, og.parts.taiba], [og.branches.store.name, og.parts.store],
          ['لدى عملاء الجملة', og.parts.customers, '/admin/customer-gold'],
          ['لدى جمل الصافي', og.parts.dealers, '/admin/gold-dealers'],
          ['رصيد مقدم للموردين', og.parts.suppliers, '/admin/suppliers'],
        ].map(([label, v, to, note]) => ({ label, v, to, note }))} columns={[
          ['البند', (x) => <>{x.to ? <Link to={x.to} onClick={() => setShowOrg(false)}>{x.label}</Link> : x.label}{x.note && <div className="small text-body-secondary">{x.note}</div>}</>],
          ['الصافي (جم)', (x) => <b className="n" dir="ltr">{fmtW(x.v)}</b>],
        ]} />}
        {og && <div className="d-flex justify-content-between fs-5 fw-bold border-top pt-2 mt-2"><span>الإجمالي</span><span className="n" dir="ltr">{fmtW(og.total)} جم</span></div>}
      </Modal>
      {canFin && <>
      <h3 className="mb">المالية (أجور التصنيع فقط)</h3>
      <div className="grid g4 mb">
        <Stat label="إجمالي أجور التصنيع" value={fmtMoney(s.labor_revenue)} sub="قبل الضريبة" to="/admin/reports" />
        <Stat label="إجمالي الفواتير" value={fmtMoney(s.invoiced_total)} to="/admin/invoices" />
        <Stat label="المبالغ المحصلة" value={fmtMoney(s.collected)} tone="ok" to="/admin/payments" />
        <Stat label="الفواتير المستحقة" value={fmtMoney(s.receivables)} tone={Number(s.receivables) > 0 ? 'warn' : 'plain'} />
      </div>
      </>}
      <div className="grid g2">
        <Card title="الطلبات حسب المرحلة">
          {s.byStage.map((x) => (
            <div key={x.name} className="hrow gap small" style={{ marginBottom: 6 }}>
              <span style={{ width: 160 }}>{x.name}</span>
              <div className="progress grow"><div style={{ width: `${(100 * x.n) / maxStage}%` }} /></div>
              <b style={{ width: 30, textAlign: 'left' }}>{x.n}</b>
            </div>
          ))}
        </Card>
        {canGold && <Card title="توزيع الذهب حسب المادة والموقع (صافي عيار 24)" pad={false}>
          <Table rows={Object.entries(mats).map(([name, v]) => ({ name, ...v }))} columns={[['المادة', 'name'], ...['vault', 'order', 'worker', 'scrap', 'finished', 'loss_suspense'].map((k) => [LOCS[k], (r) => <span className="n">{fmtW(r[k] || 0)}</span>])]} />
          <div className="card-body"><Link to="/admin/inventory?tab=rec" className="link">مطابقة الأرصدة ←</Link></div>
        </Card>}
      </div>
    </div>
  );
}
