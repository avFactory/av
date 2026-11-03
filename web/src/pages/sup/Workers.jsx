import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtW } from '../../format.js';
import { Page, Search, Table, useFetch, Loader, Badge } from '../../ui.jsx';

export default function Workers() {
  const nav = useNavigate();
  const { data } = useFetch('/sup/workers', { live: ['custodies', 'settlements'] });
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data || []).filter((w) => !q || w.full_name.includes(q) || (w.employee_no || '').includes(q)), [data, q]);
  if (!data) return <Loader />;
  const sum = (list, k) => list.reduce((s, w) => s + Number(w[k] || 0), 0);
  const people = data.filter((w) => w.kind !== 'machine');
  const machines = data.filter((w) => w.kind === 'machine');
  const cards = [
    ['لدى العمال', people, `${people.length} عامل`],
    ['لدى المكائن', machines, `${machines.length} مكينة`],
    ['الإجمالي (العمال والمكائن)', data, `${people.length} عامل و ${machines.length} مكينة`],
  ];
  return (
    <Page title="متابعة العمال والمكائن والعهد" subtitle={`${people.length} عامل · ${machines.length} مكينة`} actions={<Search value={q} onChange={setQ} placeholder="بحث باسم العامل أو رقمه" />}>
      <div className="gold-stats mb-3">
        {cards.map(([label, list, sub], i) => (
          <div key={label} className={`gold-stat${i === 2 ? ' total' : ''}`}>
            <div className="gold-stat-top">
              <span>الذهب الصافي {label}</span>
              <b><span dir="ltr">{fmtW(sum(list, 'open_pure'))}</span> <small>جم عيار 24</small></b>
            </div>
            <div className="gold-stat-sub">الوزن القائم {fmtW(sum(list, 'open_weight'))} جم · {sub}</div>
          </div>
        ))}
      </div>
      <div className="card"><Table rows={rows} onRow={(w) => nav(`/sup/workers/${w.id}`)} columns={[
        ['العامل / المكينة', (w) => <b>{w.kind === 'machine' && <span className="machine-tag">⚙ مكينة</span>}{w.full_name}</b>], ['الرقم', 'employee_no'], ['القسم / التخصص', (w) => [w.department, w.specialty].filter(Boolean).join(' · ') || '—'],
        ['طلبات لديه', 'open_count'], ['منتهية بانتظار الاستلام', (w) => (w.finished_count ? <Badge tone="ok">{w.finished_count}</Badge> : '—')],
        ['الذهب في عهدته (جم)', (w) => <span className="n">{fmtW(w.open_weight)}</span>, { className: 'n' }],
        ['الصافي عيار 24 (جم)', (w) => <span className="n fw-semibold">{fmtW(w.open_pure)}</span>, { className: 'n' }],
        ['بانتظار القبول', (w) => (w.rejected_count ? <Badge tone="bad">{w.rejected_count} مرفوض</Badge> : w.pending_ack ? <Badge tone="warn">{w.pending_ack}</Badge> : '—')],
        ['تحت المراجعة', (w) => (w.review_count ? <Badge tone="bad">{w.review_count}</Badge> : '—')],
      ]} /></div>
    </Page>
  );
}
