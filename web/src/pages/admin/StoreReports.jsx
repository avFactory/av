import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fileUrl, qs } from '../../api.js';
import { fmtW, fmtMoney, fmtDT, STATUS } from '../../format.js';
import { Badge, Btn, Card, Field, Input, Loader, Page, Search, Stat, Table, Tabs, useFetch } from '../../ui.jsx';

const d0 = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const PRESETS = (() => {
  const t = new Date(); const y = t.getFullYear(), m = t.getMonth();
  const wk = new Date(t); wk.setDate(t.getDate() - ((t.getDay() + 1) % 7)); // الأسبوع يبدأ السبت
  const q = new Date(t); q.setMonth(m - 2, 1);
  return [
    ['today', 'اليوم', d0(t), d0(t)], ['week', 'هذا الأسبوع', d0(wk), d0(t)], ['month', 'هذا الشهر', d0(new Date(y, m, 1)), d0(t)],
    ['last', 'الشهر الماضي', d0(new Date(y, m - 1, 1)), d0(new Date(y, m, 0))], ['q', 'آخر 3 أشهر', d0(q), d0(t)],
    ['year', 'هذه السنة', d0(new Date(y, 0, 1)), d0(t)], ['all', 'منذ البداية', '2024-01-01', d0(t)],
  ];
})();
const SOURCE = { store_catalog: 'من المتجر', store_custom: 'تصميم خاص', internal: 'داخلي' };
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');

/** تصدير جدول إلى CSV يفتح في Excel (مع حماية من صيغ Excel) */
function exportCsv(name, cols, rows) {
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map((c) => esc(c[0])).join(','), ...rows.map((r) => cols.map((c) => esc(typeof c[1] === 'function' ? c[1](r) : r[c[1]])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** جدول تقرير: بحث، ترتيب، وتصدير */
function ReportTable({ title, name, rows, columns, csv, search, sorts, empty }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(sorts?.[0]?.[0] || null);
  const list = useMemo(() => {
    let l = rows || [];
    if (q.trim() && search) l = l.filter((r) => search(r).toLowerCase().includes(q.trim().toLowerCase()));
    const s = sorts?.find((x) => x[0] === sort);
    return s ? [...l].sort(s[2]) : l;
  }, [rows, q, sort, sorts, search]);
  return (
    <Card title={title} pad={false} actions={<Btn size="sm" kind="ghost" disabled={!list.length} onClick={() => exportCsv(name, csv, list)}>تصدير Excel</Btn>}>
      {(search || sorts) && <div className="d-flex gap-2 flex-wrap align-items-center p-2 border-bottom">
        {search && <div style={{ minWidth: 220 }}><Search value={q} onChange={setQ} placeholder="بحث" /></div>}
        {sorts && <div className="chips">{sorts.map(([k, l]) => <button key={k} type="button" className={`chip ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{l}</button>)}</div>}
        <span className="small text-body-secondary ms-auto">{list.length} سجل</span>
      </div>}
      <Table rows={list} columns={columns} empty={empty || 'لا توجد بيانات في هذه الفترة'} />
    </Card>
  );
}

function Bars({ rows, value, label, fmt }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  return rows.map((r) => (
    <div key={label(r)} className="hrow gap small" style={{ marginBottom: 6 }}>
      <span style={{ width: 120 }} className="text-truncate">{label(r)}</span>
      <div className="progress grow"><div style={{ width: `${(100 * (Number(r[value]) || 0)) / max}%` }} /></div>
      <b style={{ minWidth: 70, textAlign: 'left' }} dir="ltr">{fmt ? fmt(r[value]) : r[value]}</b>
    </div>
  ));
}

const GROUP_COLS = (keyLabel) => [[keyLabel, (r) => <b>{r.key}</b>], ['الطلبات', 'orders'], ['القطع', (r) => <b>{r.pieces}</b>], ['العملاء', 'customers'],
  ['الأجور المقدرة', (r) => fmtMoney(r.labor_estimate)], ['الذهب المسلّم (صافي)', (r) => <span className="n">{fmtW(r.delivered_pure)}</span>]];
const GROUP_CSV = (keyLabel) => [[keyLabel, 'key'], ['الطلبات', 'orders'], ['القطع', 'pieces'], ['العملاء', 'customers'], ['الأجور المقدرة', 'labor_estimate'], ['الذهب المسلم صافي 24', 'delivered_pure']];

export default function StoreReports() {
  const [p, setP] = useState({ preset: 'month', from: PRESETS[2][2], to: PRESETS[2][3] });
  const [tab, setTab] = useState('products');
  const { data: d } = useFetch(`/reports/store${qs({ from: p.from, to: p.to })}`, { deps: [p.from, p.to] });
  const k = d?.kpi;
  const totalStatus = d ? d.statuses.reduce((a, x) => a + x.items, 0) : 0;
  return (
    <Page title="تقارير المتجر" subtitle={d ? `من ${d.from} إلى ${d.to} · ${d.days} يوم` : ''}>
      <div className="card card-body mb">
        <div className="chips mb-2">{PRESETS.map(([key, l, f, t]) => <button key={key} type="button" className={`chip ${p.preset === key ? 'on' : ''}`} onClick={() => setP({ preset: key, from: f, to: t })}>{l}</button>)}</div>
        <div className="d-flex gap-2 flex-wrap">
          <Field label="من"><Input type="date" value={p.from} onChange={(e) => setP({ ...p, preset: '', from: e.target.value })} /></Field>
          <Field label="إلى"><Input type="date" value={p.to} onChange={(e) => setP({ ...p, preset: '', to: e.target.value })} /></Field>
        </div>
      </div>
      {!d ? <Loader /> : <>
        <h3 className="mb">المبيعات</h3>
        <div className="grid g4 mb">
          <Stat label="الطلبات" value={k.orders} tone="gold" sub={`${k.items} بند · متوسط ${k.avg_pieces} قطعة للطلب`} />
          <Stat label="القطع المطلوبة" value={k.pieces} sub={`ملغى/مرفوض ${k.cancelled_items} بند (${k.cancel_rate}%)`} />
          <Stat label="العملاء المشترون" value={k.customers} sub={`عملاء جدد ${k.new_customers} · بانتظار الموافقة ${k.pending_customers}`} />
          <Stat label="الأجور المقدرة للطلبات" value={fmtMoney(k.labor_estimate)} sub="قبل الضريبة" />
        </div>
        <h3 className="mb">التسليم والتحصيل</h3>
        <div className="grid g4 mb">
          <Stat label="الذهب المسلّم" value={fmtW(k.delivered_pure)} unit="جم" tone="ok" sub={`صافي عيار 24 · الفعلي ${fmtW(k.delivered_weight)} · ${k.delivered_pieces} قطعة`} />
          <Stat label="الفواتير" value={fmtMoney(k.invoiced_total)} to="/admin/invoices" sub={`${k.invoices} فاتورة · قبل الضريبة ${fmtMoney(k.invoiced_subtotal)}`} />
          <Stat label="المحصّل" value={fmtMoney(k.collected)} tone="ok" to="/admin/payments" />
          <Stat label="مدة التنفيذ" value={k.avg_days} unit="يوم" sub={`الالتزام بالموعد ${k.on_time_rate == null ? '—' : `${k.on_time_rate}%`} (${k.on_time} من ${k.with_due})`} />
        </div>
        <div className="grid g2 mb">
          <Card title={`القطع المطلوبة ${d.grain === 'month' ? 'شهرياً' : 'يومياً'}`}>
            {d.trend.some((x) => x.pieces) ? <Bars rows={d.trend} value="pieces" label={(r) => r.period} /> : <div className="text-body-secondary small">لا توجد طلبات</div>}
          </Card>
          <Card title={`الذهب المسلّم ${d.grain === 'month' ? 'شهرياً' : 'يومياً'} (صافي)`}>
            {d.trend.some((x) => Number(x.delivered_pure)) ? <Bars rows={d.trend} value="delivered_pure" label={(r) => r.period} fmt={fmtW} /> : <div className="text-body-secondary small">لا يوجد تسليم</div>}
          </Card>
        </div>

        <Tabs value={tab} onChange={setTab} tabs={[['products', 'المنتجات الأكثر طلباً'], ['customers', 'حسب العميل'], ['types', 'حسب الصنف والعيار'],
          ['segments', 'الفئات والمدن والمصدر'], ['status', 'حالات الطلبات'], ['trend', 'حسب الفترة'], ['unsold', `منتجات بلا طلب (${d.unsold.length})`], ['dormant', `عملاء متوقفون (${d.dormant.length})`]]} />

        {tab === 'products' && <ReportTable title="المنتجات الأكثر طلباً" name={`المنتجات-${d.from}-${d.to}`} rows={d.products}
          search={(r) => `${r.name} ${r.sku} ${r.product_type}`}
          sorts={[['pieces', 'الأكثر قطعاً', (a, b) => b.pieces - a.pieces], ['orders', 'الأكثر طلبات', (a, b) => b.orders - a.orders], ['customers', 'الأكثر عملاء', (a, b) => b.customers - a.customers], ['labor', 'الأعلى أجوراً', (a, b) => b.labor_estimate - a.labor_estimate]]}
          columns={[['#', (r) => d.products.indexOf(r) + 1], ['المنتج', (r) => <span className="d-flex gap-2 align-items-center">
            {r.image ? <img src={fileUrl(r.image, 200)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} /> : null}
            <span><b>{r.name}</b><div className="small text-body-secondary" dir="ltr">{r.sku}</div></span></span>],
            ['الصنف', 'product_type'], ['القطع', (r) => <b>{r.pieces}</b>], ['الطلبات', 'orders'], ['العملاء', 'customers'],
            ['الأجور المقدرة', (r) => fmtMoney(r.labor_estimate)], ['المسلّم (صافي)', (r) => <span className="n">{fmtW(r.delivered_pure)}</span>], ['آخر طلب', (r) => <span className="small">{fmtDT(r.last_at)}</span>]]}
          csv={[['الرمز', 'sku'], ['المنتج', 'name'], ['الصنف', 'product_type'], ['القطع', 'pieces'], ['الطلبات', 'orders'], ['العملاء', 'customers'], ['الأجور المقدرة', 'labor_estimate'], ['الذهب المسلم صافي 24', 'delivered_pure']]} />}

        {tab === 'customers' && <ReportTable title="المبيعات حسب العميل" name={`العملاء-${d.from}-${d.to}`} rows={d.customers}
          search={(r) => `${r.shop_name} ${r.city || ''} ${r.tier_name || ''}`}
          sorts={[['pieces', 'الأكثر قطعاً', (a, b) => b.pieces - a.pieces], ['invoiced', 'الأعلى فواتير', (a, b) => b.invoiced - a.invoiced], ['gold', 'الأكثر ذهباً مسلّماً', (a, b) => b.delivered_pure - a.delivered_pure], ['paid', 'الأعلى تحصيلاً', (a, b) => b.paid - a.paid]]}
          columns={[['العميل', (r) => <Link to={`/admin/customers/${r.id}/statement`} className="fw-bold">{r.shop_name}</Link>], ['المدينة', (r) => r.city || '—'], ['الفئة', (r) => r.tier_name || '—'],
            ['الطلبات', 'orders'], ['القطع', (r) => <b>{r.pieces}</b>], ['الصنف الأكثر', (r) => r.top_type || '—'], ['المسلّم', (r) => <span className="n">{r.delivered_pieces} قطعة · {fmtW(r.delivered_pure)} جم</span>],
            ['الفواتير', (r) => fmtMoney(r.invoiced)], ['المحصّل', (r) => fmtMoney(r.paid)], ['آخر طلب', (r) => (r.last_at ? <span className="small">{fmtDT(r.last_at)}</span> : '—')]]}
          csv={[['العميل', 'shop_name'], ['المدينة', 'city'], ['الفئة', 'tier_name'], ['الطلبات', 'orders'], ['القطع', 'pieces'], ['الصنف الأكثر', 'top_type'], ['قطع مسلمة', 'delivered_pieces'], ['ذهب مسلم صافي 24', 'delivered_pure'], ['الفواتير', 'invoiced'], ['المحصل', 'paid']]} />}

        {tab === 'types' && <div className="grid">
          <div className="grid g2">
            <Card title="القطع حسب الصنف"><Bars rows={d.byType} value="pieces" label={(r) => r.key} /></Card>
            <Card title="القطع حسب العيار واللون"><Bars rows={[...d.byKarat, ...d.byColor.map((x) => ({ ...x, key: { yellow: 'أصفر', white: 'أبيض', rose: 'روز' }[x.key] || x.key }))]} value="pieces" label={(r) => r.key} /></Card>
          </div>
          <ReportTable title="حسب الصنف" name="الأصناف" rows={d.byType} columns={GROUP_COLS('الصنف')} csv={GROUP_CSV('الصنف')} />
          <ReportTable title="حسب العيار" name="العيارات" rows={d.byKarat} columns={GROUP_COLS('العيار')} csv={GROUP_CSV('العيار')} />
        </div>}

        {tab === 'segments' && <div className="grid">
          <ReportTable title="حسب فئة العميل" name="الفئات" rows={d.byTier} columns={GROUP_COLS('الفئة')} csv={GROUP_CSV('الفئة')} />
          <ReportTable title="حسب المدينة" name="المدن" rows={d.byCity} columns={GROUP_COLS('المدينة')} csv={GROUP_CSV('المدينة')} />
          <ReportTable title="حسب مصدر الطلب" name="المصدر" rows={d.bySource.map((x) => ({ ...x, key: SOURCE[x.key] || x.key }))} columns={GROUP_COLS('المصدر')} csv={GROUP_CSV('المصدر')} />
        </div>}

        {tab === 'status' && <Card title="حالة طلبات الفترة الآن">
          {d.statuses.length ? d.statuses.sort((a, b) => b.items - a.items).map((s) => (
            <div key={s.status} className="hrow gap small" style={{ marginBottom: 8 }}>
              <span style={{ width: 140 }}><Badge tone={STATUS[s.status]?.[1]}>{STATUS[s.status]?.[0] || s.status}</Badge></span>
              <div className="progress grow"><div style={{ width: pct(s.items, totalStatus) }} /></div>
              <b style={{ minWidth: 140, textAlign: 'left' }}>{s.items} بند · {s.pieces} قطعة · {pct(s.items, totalStatus)}</b>
            </div>
          )) : <div className="text-body-secondary small">لا توجد طلبات</div>}
          <Link className="small" to="/orders">فتح الطلبات ←</Link>
        </Card>}

        {tab === 'trend' && <ReportTable title={d.grain === 'month' ? 'حسب الشهر' : 'حسب اليوم'} name={`الفترات-${d.from}-${d.to}`} rows={[...d.trend].reverse()}
          columns={[['الفترة', (r) => <b dir="ltr">{r.period}</b>], ['الطلبات', 'orders'], ['القطع', 'pieces'], ['الذهب المسلّم (صافي)', (r) => <span className="n">{fmtW(r.delivered_pure)}</span>], ['الفواتير قبل الضريبة', (r) => fmtMoney(r.invoiced)]]}
          csv={[['الفترة', 'period'], ['الطلبات', 'orders'], ['القطع', 'pieces'], ['الذهب المسلم صافي 24', 'delivered_pure'], ['الفواتير قبل الضريبة', 'invoiced']]} />}

        {tab === 'unsold' && <ReportTable title="منتجات نشطة لم تُطلب في هذه الفترة" name="منتجات-بلا-طلب" rows={d.unsold} search={(r) => `${r.name} ${r.sku} ${r.product_type}`}
          columns={[['المنتج', (r) => <b>{r.name}</b>], ['الرمز', (r) => <span dir="ltr">{r.sku}</span>], ['الصنف', 'product_type'], ['أُضيف', (r) => <span className="small">{fmtDT(r.created_at)}</span>], ['آخر طلب على الإطلاق', (r) => (r.last_at ? <span className="small">{fmtDT(r.last_at)}</span> : <Badge tone="warn">لم يُطلب أبداً</Badge>)]]}
          csv={[['المنتج', 'name'], ['الرمز', 'sku'], ['الصنف', 'product_type'], ['أضيف', 'created_at'], ['آخر طلب', 'last_at']]} />}

        {tab === 'dormant' && <ReportTable title="عملاء طلبوا سابقاً ولم يطلبوا في هذه الفترة" name="عملاء-متوقفون" rows={d.dormant} search={(r) => `${r.shop_name} ${r.city || ''}`}
          columns={[['العميل', (r) => <Link to={`/admin/customers/${r.id}/statement`} className="fw-bold">{r.shop_name}</Link>], ['المدينة', (r) => r.city || '—'],
            ['الجوال', (r) => (r.phone ? <a href={`tel:${r.phone}`} dir="ltr">{r.phone}</a> : '—')], ['طلبات سابقة', 'orders_before'], ['آخر طلب', (r) => <span className="small">{fmtDT(r.last_at)}</span>]]}
          csv={[['العميل', 'shop_name'], ['المدينة', 'city'], ['الجوال', 'phone'], ['طلبات سابقة', 'orders_before'], ['آخر طلب', 'last_at']]} />}
      </>}
    </Page>
  );
}
