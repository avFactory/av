import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT, LOCS } from '../../format.js';
import { Btn, Card, Field, Input, Loader, Modal, Page, Select, Table, Tabs, WeightInput, useAction, useFetch, Badge } from '../../ui.jsx';

const CATS = [['raw', 'مواد خام'], ['semi', 'نصف مصنعة'], ['finished', 'منتجات جاهزة'], ['supply', 'مستلزمات'], ['other', 'أخرى']];

export default function Inventory() {
  const { can, lookups } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'gold';
  const setTab = (t) => setSp({ tab: t });
  const { data: gold, reload } = useFetch('/inventory/gold', { live: ['gold_ledger'] });
  const [m, setM] = useState(null);
  const [run, busy] = useAction();
  const mats = gold?.materials || [];
  const op = (url, body, msg) => run(async () => { await api.post(url, body); setM(null); reload(); }, msg);
  const table = {};
  for (const r of gold?.rows || []) (table[r.material_id] ||= { name: r.name })[r.loc_type] = r.balance;
  const locs = ['vault', 'order', 'worker', 'scrap', 'finished', 'loss_suspense', 'loss_normal', 'loss_abnormal', 'delivered'];
  return (
    <Page title="المخزون" subtitle="الذهب يُحاسب منفصلاً لكل عيار ولون" actions={tab === 'gold' && <>
      {can('custody.issue', 'inventory.manage') && <Btn kind="dark" onClick={() => setM({ type: 'worker', material_id: mats[3]?.id, loss_rate_percent: '0' })}>تحويل لعامل (عهدة عامة)</Btn>}
      {can('inventory.manage') && <>
      <Btn onClick={() => setM({ type: 'in', material_id: mats[3]?.id })}>إضافة ذهب للخزنة</Btn>
      <Btn kind="ghost" onClick={() => setM({ type: 'out', material_id: mats[3]?.id, from: 'vault' })}>صرف</Btn>
      <Btn kind="ghost" onClick={() => setM({ type: 'scrap', material_id: mats[3]?.id })}>بقايا ← الخزنة</Btn>
      {can('stocktake.approve') && <Btn kind="ghost" onClick={() => setM({ type: 'convert' })}>تحويل موثق بين العيارات</Btn>}
      </>}
    </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['gold', 'الذهب حسب العيار واللون'], ['counts', 'الجرد'], ['rec', 'مطابقة الأرصدة'], ['items', 'المواد والمستلزمات'], ['products', 'المنتجات الجاهزة ونصف المصنعة'], ['moves', 'حركات المخزون']]} />
      {tab === 'gold' && (!gold ? <Loader /> : (
        <div className="card"><Table rows={Object.entries(table).map(([id, v]) => ({ id, ...v }))} empty="لا يوجد ذهب مسجل - ابدأ بإضافة رصيد افتتاحي للخزنة" columns={[
          ['المادة', (r) => <b>{r.name}</b>], ...locs.map((k) => [LOCS[k], (r) => <span className="n">{fmtW(r[k] || 0)}</span>, { className: 'n' }]),
          ['داخل المصنع', (r) => <b className="n">{fmtW(['vault', 'order', 'worker', 'scrap', 'finished', 'loss_suspense'].reduce((s, k) => s + Number(r[k] || 0), 0))}</b>, { className: 'n' }],
        ]} /></div>
      ))}
      {tab === 'gold' && <GeneralCustodies />}
      {tab === 'counts' && <Counts mats={mats} />}
      {tab === 'rec' && <Reconciliation />}
      {tab === 'items' && <Items />}
      {tab === 'products' && <ProductsStock />}
      {tab === 'moves' && <div className="card card-b"><Link className="link" to="/sup/log">فتح سجل حركات الذهب الكامل مع التصفية والتصدير ←</Link></div>}

      <Modal open={m?.type === 'worker'} onClose={() => setM(null)} title="تحويل ذهب من الخزنة إلى عامل (عهدة عامة)">
        {m?.type === 'worker' && <>
          <div className="alert alert-info small">يُصرف الذهب من الخزنة إلى العامل كرصيد في عهدته بدون طلب تصنيع. يصله إشعار ليقبل الاستلام من جواله، ويُستلم منه لاحقاً من شاشة "استلام ذهب من العامل" فيعود للخزنة مع حساب العجز.</div>
          <Field label="العامل / المكينة *"><Select value={m.worker_id || ''} onChange={(e) => setM({ ...m, worker_id: e.target.value })} placeholder="اختر" options={(lookups?.workers || []).map((w) => [w.id, `${w.kind === 'machine' ? '⚙ ' : ''}${w.full_name}${w.employee_no ? ` (${w.employee_no})` : ''}`])} /></Field>
          <Field label="المادة (العيار واللون)"><Select value={m.material_id} onChange={(e) => setM({ ...m, material_id: e.target.value })} options={mats.map((x) => [x.id, x.name])} /></Field>
          <Field label="الوزن (جم) *" hint={table[m.material_id]?.vault ? `المتاح في الخزنة: ${fmtW(table[m.material_id].vault)} جم` : 'لا يوجد رصيد في الخزنة من هذه المادة'}><WeightInput big value={m.weight || ''} onChange={(v) => setM({ ...m, weight: v })} /></Field>
          <Field label="الغرض / البيان *"><Input value={m.purpose || ''} onChange={(e) => setM({ ...m, purpose: e.target.value })} placeholder="مثال: رصيد لحام وتصليحات، تجهيز سبائك…" /></Field>
          <Field label="نسبة العجز المسموح %" hint="0 = أي نقص عند الإرجاع يُحال للمراجعة"><Input dir="ltr" inputMode="decimal" value={m.loss_rate_percent} onChange={(e) => setM({ ...m, loss_rate_percent: e.target.value })} /></Field>
          <Btn loading={busy} disabled={!m.worker_id || !m.weight || !m.purpose} onClick={() => op('/inventory/gold/to-worker', { ...m, idempotency_key: m.key || (m.key = String(Date.now()) + Math.random()) }, 'تم التحويل - بانتظار قبول العامل')}>تحويل</Btn>
        </>}
      </Modal>
      <Modal open={!!m && m.type !== 'worker'} onClose={() => setM(null)} title={{ in: 'إضافة ذهب للخزنة', out: 'صرف ذهب لخارج المصنع', scrap: 'تحويل البقايا إلى الخزنة', convert: 'تحويل موثق بين مادتين' }[m?.type]}>
        {m && m.type !== 'convert' && <>
          <Field label="المادة"><Select value={m.material_id} onChange={(e) => setM({ ...m, material_id: e.target.value })} options={mats.map((x) => [x.id, x.name])} /></Field>
          {m.type === 'out' && <Field label="من"><Select value={m.from} onChange={(e) => setM({ ...m, from: e.target.value })} options={[['vault', 'الخزنة'], ['scrap', 'البقايا (للتنقية)']]} /></Field>}
          <Field label="الوزن (جم)"><WeightInput big value={m.weight || ''} onChange={(v) => setM({ ...m, weight: v })} /></Field>
          <Field label="البيان *"><Input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder="مثال: شراء سبائك من مورد / رصيد افتتاحي" /></Field>
          <Btn loading={busy} onClick={() => op({ in: '/inventory/gold/in', out: '/inventory/gold/out', scrap: '/inventory/gold/scrap-to-vault' }[m.type], m, 'تم تسجيل الحركة')}>تسجيل</Btn>
        </>}
        {m?.type === 'convert' && <>
          <div className="alert alert-info small">لا يتم جمع أوزان مواد مختلفة. التحويل يسجل حركتين مرتبطتين، والفرق يظهر في الفروقات.</div>
          <div className="grid g2">
            <Field label="المادة المصروفة"><Select value={m.from_material_id || ''} onChange={(e) => setM({ ...m, from_material_id: e.target.value })} placeholder="—" options={mats.map((x) => [x.id, x.name])} /></Field>
            <Field label="الوزن المصروف"><WeightInput value={m.weight_out || ''} onChange={(v) => setM({ ...m, weight_out: v })} /></Field>
            <Field label="المادة الناتجة"><Select value={m.to_material_id || ''} onChange={(e) => setM({ ...m, to_material_id: e.target.value })} placeholder="—" options={mats.map((x) => [x.id, x.name])} /></Field>
            <Field label="الوزن الناتج"><WeightInput value={m.weight_in || ''} onChange={(v) => setM({ ...m, weight_in: v })} /></Field>
          </div>
          <Field label="بيان التحويل *"><Input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} /></Field>
          <Btn loading={busy} onClick={() => op('/inventory/gold/convert', m, 'تم التحويل')}>اعتماد التحويل</Btn>
        </>}
      </Modal>
    </Page>
  );
}

function GeneralCustodies() {
  const { can } = useAuth();
  const { data } = useFetch('/inventory/gold/general-custodies', { live: ['custodies', 'gold_ledger'] });
  if (!data?.length) return null;
  return (
    <Card title={`العهد العامة لدى العمال (${data.length})`} className="mt" pad={false}>
      <Table rows={data} columns={[
        ['العهدة', 'custody_no'], ['العامل', (c) => <Link className="link" to={`/sup/workers/${c.worker_id}`}>{c.worker_kind === 'machine' ? '⚙ ' : ''}{c.worker_name}</Link>], ['الغرض', 'purpose'], ['المادة', 'material_name'],
        ['الوزن', (c) => <b className="n">{fmtW(c.weight_issued)}</b>], ['نسبة العجز', (c) => `${Number(c.loss_rate_snapshot)}%`],
        ['الحالة', (c) => (c.status === 'under_review' ? <Badge tone="warn">تحت المراجعة</Badge> : c.worker_ack_at ? <Badge tone="ok">قبِلها العامل</Badge> : c.worker_rejected_at ? <Badge tone="bad">رفضها: {c.worker_reject_reason}</Badge> : <Badge tone="warn">بانتظار القبول</Badge>)],
        ['التاريخ', (c) => fmtDT(c.issued_at)], ['بواسطة', 'issued_by'],
        ['', (c) => can('custody.receive') && c.status === 'open' && <Link className="btn btn-dark btn-sm" to={`/sup/receive?worker=${c.worker_id}`}>استلام</Link>],
      ]} />
    </Card>
  );
}

function Counts({ mats }) {
  const { can } = useAuth();
  const { data, reload } = useFetch('/inventory/counts');
  const { data: items } = useFetch('/inventory/items');
  const [f, setF] = useState({ target: 'gold' });
  const [run, busy] = useAction();
  return (
    <div className="grid">
      {can('inventory.manage') && (
        <Card title="جرد جديد">
          <div className="row gap wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="النوع"><Select value={f.target} onChange={(e) => setF({ target: e.target.value })} options={[['gold', 'ذهب الخزنة'], ['item', 'صنف مخزون']]} /></Field>
            {f.target === 'gold' ? <Field label="المادة"><Select value={f.material_id || ''} onChange={(e) => setF({ ...f, material_id: e.target.value })} placeholder="—" options={mats.map((x) => [x.id, x.name])} /></Field>
              : <Field label="الصنف"><Select value={f.item_id || ''} onChange={(e) => setF({ ...f, item_id: e.target.value })} placeholder="—" options={(items || []).map((x) => [x.id, x.name])} /></Field>}
            <Field label="الكمية/الوزن الفعلي"><WeightInput value={f.counted_qty || ''} onChange={(v) => setF({ ...f, counted_qty: v })} /></Field>
            <Field label="ملاحظات"><Input value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            <Btn loading={busy} onClick={() => run(async () => { await api.post('/inventory/counts', f); setF({ target: f.target }); reload(); }, 'تم تسجيل الجرد')}>تسجيل الجرد</Btn>
          </div>
        </Card>
      )}
      <div className="card"><Table rows={data} columns={[['الرقم', 'count_no'], ['البند', (c) => c.material_name || c.item_name], ['رصيد النظام', (c) => <span className="n">{fmtW(c.system_qty)}</span>], ['الفعلي', (c) => <span className="n">{fmtW(c.counted_qty)}</span>],
        ['الفرق', (c) => <b className="n" style={{ color: Number(c.difference) ? 'var(--bad)' : 'var(--ok)' }}>{fmtW(c.difference)}</b>], ['الحالة', (c) => <Badge tone={c.status === 'approved' ? 'ok' : c.status === 'pending' ? 'warn' : 'bad'}>{{ approved: 'معتمد', pending: 'بانتظار الاعتماد', rejected: 'مرفوض' }[c.status]}</Badge>],
        ['بواسطة', 'counted_by_name'], ['التاريخ', (c) => fmtDT(c.created_at)],
        ['', (c) => c.status === 'pending' && can('stocktake.approve') && <div className="row gap"><Btn size="sm" kind="ok" onClick={() => run(async () => { await api.post(`/inventory/counts/${c.id}/approve`, {}); reload(); }, 'اعتمدت التسوية')}>اعتماد</Btn><Btn size="sm" kind="ghost" onClick={() => run(async () => { await api.post(`/inventory/counts/${c.id}/reject`, {}); reload(); })}>رفض</Btn></div>]]} /></div>
    </div>
  );
}

function Reconciliation() {
  const { data } = useFetch('/inventory/reconciliation', { live: ['gold_ledger'] });
  if (!data) return <Loader />;
  const cols = ['vault', 'orders', 'workers', 'scrap', 'finished', 'loss_normal', 'loss_abnormal', 'loss_suspense', 'delivered', 'variance'];
  const L = { vault: 'الخزنة', orders: 'تحت التشغيل', workers: 'لدى العمال', scrap: 'بقايا', finished: 'جاهز', loss_normal: 'عجز طبيعي', loss_abnormal: 'عجز غير طبيعي', loss_suspense: 'معلق', delivered: 'مسلم', variance: 'فروقات' };
  return (
    <div className="grid">
      <div className={`alert ${data.ok ? 'alert-ok' : 'alert-bad'}`}>{data.ok ? 'الأرصدة متطابقة: كل جرام له موقع معروف، وعهد العمال تطابق دفتر الحركات.' : 'يوجد عدم تطابق - راجع التفاصيل أدناه'}</div>
      <Card title="المعادلة لكل مادة: صافي الوارد = الخزنة + تحت التشغيل + لدى العمال + البقايا + الجاهز + الفقد + المسلم ± الفروقات" pad={false}>
        <Table rows={data.perMaterial.filter((m) => Number(m.net_in) || Number(m.vault))} columns={[['المادة', 'name'], ['صافي الوارد', (m) => <b className="n">{fmtW(m.net_in)}</b>], ...cols.map((k) => [L[k], (m) => <span className="n">{fmtW(m[k])}</span>]),
          ['التطابق', (m) => (Number(m.ledger_sum) === 0 ? <Badge tone="ok">✓</Badge> : <Badge tone="bad">✗</Badge>)]]} />
      </Card>
      <Card title="عهد العمال: رصيد الدفتر مقابل العهد المفتوحة" pad={false}>
        <Table rows={data.workerCheck} empty="لا توجد عهد مفتوحة" columns={[['العامل', 'full_name'], ['المادة', 'material'], ['رصيد الدفتر', (w) => <span className="n">{fmtW(w.ledger)}</span>], ['مجموع العهد', (w) => <span className="n">{fmtW(w.custodies)}</span>], ['', (w) => (w.ok ? <Badge tone="ok">متطابق</Badge> : <Badge tone="bad">غير متطابق</Badge>)]]} />
      </Card>
      {data.negatives.length > 0 && <div className="alert alert-bad">أرصدة سالبة: {data.negatives.map((n) => `${n.loc_type} ${n.name} ${n.balance}`).join('، ')}</div>}
    </div>
  );
}

function Items() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/inventory/items');
  const [f, setF] = useState(null);
  const [mv, setMv] = useState(null);
  const [hist, setHist] = useState(null);
  const [run, busy] = useAction();
  return (
    <>
      {can('inventory.manage') && <div className="row end mb"><Btn onClick={() => setF({ category: 'raw', unit: 'قطعة' })}>صنف جديد</Btn></div>}
      <div className="card"><Table rows={data} empty="لا توجد أصناف" rowClass={(i) => (i.low ? 'row-warn' : '')} columns={[['الرمز', 'sku'], ['الصنف', (i) => <b>{i.name}</b>], ['التصنيف', (i) => CATS.find((c) => c[0] === i.category)?.[1]], ['الرصيد', (i) => <span className="n">{i.qty} {i.unit}</span>], ['حد الطلب', 'min_qty'],
        ['', (i) => <div className="row gap">{can('inventory.manage') && <Btn size="sm" kind="ghost" onClick={() => setMv({ item: i, kind: 'in' })}>حركة</Btn>}<Btn size="sm" kind="ghost" onClick={() => run(async () => setHist({ item: i, rows: await api.get(`/inventory/items/${i.id}/movements`) }))}>السجل</Btn></div>]]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title="صنف جديد">
        {f && <>
          <Field label="الاسم"><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="الرمز"><Input value={f.sku || ''} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          <Field label="التصنيف"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={CATS} /></Field>
          <Field label="الوحدة"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          <Field label="حد إعادة الطلب"><Input value={f.min_qty || ''} onChange={(e) => setF({ ...f, min_qty: e.target.value })} /></Field>
          <Btn loading={busy} onClick={() => run(async () => { await api.post('/inventory/items', f); setF(null); reload(); }, 'تمت الإضافة')}>حفظ</Btn>
        </>}
      </Modal>
      <Modal open={!!mv} onClose={() => setMv(null)} title={`حركة: ${mv?.item.name}`}>
        {mv && <>
          <Field label="النوع"><Select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })} options={[['in', 'إضافة'], ['out', 'صرف'], ['return', 'إرجاع']]} /></Field>
          <Field label="الكمية"><Input inputMode="decimal" value={mv.qty || ''} onChange={(e) => setMv({ ...mv, qty: e.target.value })} /></Field>
          <Field label="البيان"><Input value={mv.note || ''} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
          <Btn loading={busy} onClick={() => run(async () => { await api.post(`/inventory/items/${mv.item.id}/move`, mv); setMv(null); reload(); }, 'تم')}>تسجيل</Btn>
        </>}
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title={`سجل ${hist?.item.name}`} wide>
        {hist && <Table rows={hist.rows} columns={[['النوع', 'kind'], ['الكمية', 'qty'], ['الطلب', 'order_no'], ['البيان', 'note'], ['بواسطة', 'user_name'], ['التاريخ', (r) => fmtDT(r.created_at)]]} />}
      </Modal>
    </>
  );
}

function ProductsStock() {
  const { data } = useFetch('/inventory/products-stock', { live: ['orders', 'gold_ledger'] });
  if (!data) return <Loader />;
  return (
    <div className="grid g2">
      <Card title="المنتجات الجاهزة بالمخزون" pad={false}><Table rows={data.finished} columns={[['المنتج', (p) => `${p.sku} - ${p.name}`], ['الكمية', 'stock_qty'], ['المادة', 'material_name'], ['وزن الذهب', (p) => <span className="n">{fmtW(p.gold_weight)}</span>]]} /></Card>
      <Card title="منتجات نصف مصنعة (قيد التصنيع)" pad={false}><Table rows={data.semi} columns={[['الطلب', (o) => <Link className="link" to={`/orders/${o.id}`}>{o.order_no}</Link>], ['المرحلة', 'stage_name'], ['المادة', 'material_name'], ['الذهب', (o) => <span className="n">{fmtW(o.gold_weight)}</span>]]} /></Card>
    </div>
  );
}
