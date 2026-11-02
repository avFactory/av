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
  const total = data.reduce((s, w) => s + Number(w.open_weight), 0);
  return (
    <Page title="متابعة العمال والعهد" subtitle={`${data.length} عامل · إجمالي الذهب لدى العمال ${fmtW(total)} جم`} back="/sup" actions={<Search value={q} onChange={setQ} placeholder="بحث باسم العامل أو رقمه" />}>
      <div className="card"><Table rows={rows} onRow={(w) => nav(`/sup/workers/${w.id}`)} columns={[
        ['العامل', (w) => <b>{w.full_name}</b>], ['الرقم', 'employee_no'], ['القسم / التخصص', (w) => [w.department, w.specialty].filter(Boolean).join(' · ') || '—'],
        ['طلبات لديه', 'open_count'], ['منتهية بانتظار الاستلام', (w) => (w.finished_count ? <Badge tone="ok">{w.finished_count}</Badge> : '—')],
        ['الذهب في عهدته (جم)', (w) => <span className="n">{fmtW(w.open_weight)}</span>, { className: 'n' }],
        ['تحت المراجعة', (w) => (w.review_count ? <Badge tone="bad">{w.review_count}</Badge> : '—')],
      ]} /></div>
    </Page>
  );
}
