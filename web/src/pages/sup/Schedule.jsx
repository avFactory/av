import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fileUrl, qs } from '../../api.js';
import { STATUS } from '../../format.js';
import { Badge, Card, Loader, Page, StatusBadge, Tabs, useFetch } from '../../ui.jsx';

// التواريخ بصيغة YYYY-MM-DD وحساباتها بتوقيت UTC (بدون أثر للمنطقة الزمنية)
const D = (s) => new Date(`${s}T00:00:00Z`);
const S = (d) => d.toISOString().slice(0, 10);
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const todayISO = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// الأسبوع يبدأ السبت، والجمعة عطلة
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const fromSat = (s) => (D(s).getUTCDay() + 1) % 7; // السبت = 0
const isFri = (s) => D(s).getUTCDay() === 5;
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function range(view, a) {
  const d = D(a);
  if (view === 'day') return [a, a];
  if (view === 'week') { const s = add(a, -fromSat(a)); return [s, add(s, 6)]; } // الأسبوع من السبت إلى الجمعة
  if (view === 'month') { const s = `${a.slice(0, 7)}-01`; const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return [s, S(e)]; }
  return [`${a.slice(0, 4)}-01-01`, `${a.slice(0, 4)}-12-31`];
}
function shift(view, a, n) {
  if (view === 'day') return add(a, n);
  if (view === 'week') return add(a, 7 * n);
  const d = D(a);
  if (view === 'month') return S(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
  return S(new Date(Date.UTC(d.getUTCFullYear() + n, 0, 1)));
}
function label(view, a, [f, t]) {
  const d = D(a);
  if (view === 'day') return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (view === 'week') { const x = D(f), y = D(t); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} — ${y.getUTCDate()} ${MONTHS[y.getUTCMonth()]} ${y.getUTCFullYear()}`; }
  if (view === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `سنة ${d.getUTCFullYear()}`;
}
// لون الطلب في الجدول حسب حالته
const tone = (o) => (o.late ? 'late' : o.status === 'delivered' ? 'done' : o.status === 'ready' ? 'ready' : o.status === 'in_production' ? 'prod' : 'wait');

function Chip({ o }) {
  return (
    <Link to={`/orders/${o.id}`} className={`sch-chip ${tone(o)}`} title={`${o.order_no} — ${o.title}${o.shop_name ? ` — ${o.shop_name}` : ''}`}>
      <b dir="ltr">{o.order_no.replace(/^ORD-\d{4}-0*/, '#')}</b> <span>{o.shop_name || o.title}</span>
    </Link>
  );
}

function OrderRow({ o }) {
  return (
    <Link to={`/orders/${o.id}`} className={`sch-row ${tone(o)}`}>
      {o.thumb ? <img src={fileUrl(o.thumb, 200)} alt="" loading="lazy" /> : <span className="sch-noimg">◇</span>}
      <span className="sch-main">
        <b>{o.title}</b>
        <span className="small text-body-secondary"><span dir="ltr">{o.order_no}</span>{o.shop_name ? ` · ${o.shop_name}${o.branch_name ? ` — ${o.branch_name}` : ''}` : ' · داخلي'} · الكمية {o.quantity}</span>
        <span className="small">{o.stage_name || '—'}{o.worker_name ? ` · ${o.worker_name}` : ''}</span>
      </span>
      <span className="sch-st">{o.late && <Badge tone="bad">متأخر</Badge>} <StatusBadge map={STATUS} value={o.status} /></span>
    </Link>
  );
}

/** جدول الطلبات حسب موعد التسليم: يومي / أسبوعي / شهري / سنوي */
export default function Schedule() {
  const nav = useNavigate();
  const [view, setView] = useState('week');
  const [a, setA] = useState(todayISO());
  const [f, t] = range(view, a);
  const { data } = useFetch(`/orders/schedule${qs({ from: f, to: t })}`, { live: ['orders'], deps: [f, t] });
  const rows = data?.rows || [];
  const byDay = rows.reduce((m, o) => { (m[o.due] ||= []).push(o); return m; }, {});
  const count = (k) => rows.filter((o) => (k === 'late' ? o.late : o.status === k)).length;
  const today = data?.today || todayISO();
  const go = (v, d) => { setView(v); setA(d); };

  return (
    <Page title="جدول الطلبات" inline actions={
      <div className="page-tabs-row">
        <Tabs value={view} onChange={setView} tabs={[['day', 'يومي'], ['week', 'أسبوعي'], ['month', 'شهري'], ['year', 'سنوي']]} />
        <div className="sch-nav">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setA(shift(view, a, -1))} aria-label="السابق">›</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setA(todayISO())}>اليوم</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setA(shift(view, a, 1))} aria-label="التالي">‹</button>
          <b className="sch-label">{label(view, a, [f, t])}</b>
        </div>
      </div>}>
      {!data ? <Loader /> : <>
        <div className="sch-stats">
          <div><span>طلبات بموعد تسليم في الفترة</span><b>{rows.length}</b></div>
          <div className="done"><span>سُلّمت</span><b>{count('delivered')}</b></div>
          <div className="ready"><span>جاهزة</span><b>{count('ready')}</b></div>
          <div className="prod"><span>قيد التصنيع</span><b>{count('in_production')}</b></div>
          <div className="late"><span>متأخرة</span><b>{count('late')}</b></div>
        </div>

        {data.overdue.length > 0 && (
          <details className="card sch-overdue mb-3">
            <summary>⚠ طلبات تجاوزت موعد التسليم ولم تُسلَّم: <b>{data.overdue.length}</b></summary>
            <div className="sch-list p-2">{data.overdue.map((o) => <OrderRow key={o.id} o={{ ...o, title: `${o.title} — كان موعده ${o.due}` }} />)}</div>
          </details>
        )}

        {view === 'day' && (
          <Card pad={false}>
            {!rows.length ? <div className="text-center text-body-secondary py-5">لا توجد طلبات بموعد تسليم في هذا اليوم</div>
              : <div className="sch-list p-2">{rows.map((o) => <OrderRow key={o.id} o={o} />)}</div>}
          </Card>
        )}

        {view === 'week' && (
          <div className="sch-week">
            {Array.from({ length: 7 }, (_, i) => add(f, i)).map((d) => (
              <div key={d} className={`sch-day ${d === today ? 'today' : ''} ${isFri(d) ? 'holiday' : ''}`}>
                <button type="button" className="sch-dh" onClick={() => go('day', d)}><span>{DAYS[D(d).getUTCDay()]}{isFri(d) ? ' — عطلة' : ''}</span><b>{D(d).getUTCDate()} {MONTHS[D(d).getUTCMonth()]}</b>{byDay[d]?.length ? <span className="sch-n">{byDay[d].length}</span> : null}</button>
                <div className="sch-chips">{(byDay[d] || []).map((o) => <Chip key={o.id} o={o} />)}</div>
              </div>
            ))}
          </div>
        )}

        {view === 'month' && (() => {
          const start = add(f, -fromSat(f));
          const cells = [];
          for (let d = start; d <= t || D(d).getUTCDay() !== 6; d = add(d, 1)) cells.push(d);
          return (
            <div className="sch-month">
              {WEEK.map((i) => <div key={i} className={`sch-mh ${i === 5 ? 'holiday' : ''}`}>{DAYS[i]}{i === 5 ? ' (عطلة)' : ''}</div>)}
              {cells.map((d) => {
                const list = byDay[d] || [];
                const out = d < f || d > t;
                return (
                  <div key={d} className={`sch-cell ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${isFri(d) ? 'holiday' : ''}`}>
                    <button type="button" className="sch-cd" onClick={() => go('day', d)}>{D(d).getUTCDate()}{list.length ? <span className="sch-n">{list.length}</span> : null}</button>
                    {!out && list.slice(0, 3).map((o) => <Chip key={o.id} o={o} />)}
                    {!out && list.length > 3 && <button type="button" className="sch-more" onClick={() => go('day', d)}>+{list.length - 3} أخرى</button>}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {view === 'year' && (
          <div className="sch-year">
            {MONTHS.map((m, i) => {
              const key = `${a.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`;
              const list = rows.filter((o) => o.due.startsWith(key));
              const c = (fn) => list.filter(fn).length;
              return (
                <button type="button" key={m} className={`sch-mcard ${today.startsWith(key) ? 'today' : ''}`} onClick={() => go('month', `${key}-01`)}>
                  <b>{m}</b>
                  <span className="sch-big">{list.length} <small>طلب</small></span>
                  <span className="sch-bar">
                    {list.length > 0 && ['done', 'ready', 'prod', 'wait', 'late'].map((k) => { const n = c((o) => tone(o) === k); return n ? <i key={k} className={k} style={{ flex: n }} /> : null; })}
                  </span>
                  <span className="small text-body-secondary">سُلّم {c((o) => o.status === 'delivered')} · متأخر {c((o) => o.late)}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="sch-legend small text-body-secondary mt-3">
          {[['done', 'سُلّم'], ['ready', 'جاهز'], ['prod', 'قيد التصنيع'], ['wait', 'بانتظار المراجعة/الاعتماد'], ['late', 'متأخر']].map(([k, l]) => <span key={k}><i className={k} />{l}</span>)}
          <span className="ms-auto"><button type="button" className="btn btn-link btn-sm p-0" onClick={() => nav('/orders?late=1')}>كل الطلبات المتأخرة ←</button></span>
        </div>
      </>}
    </Page>
  );
}
