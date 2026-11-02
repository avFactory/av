import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDate, STATUS, DESIGN_STATUS } from '../../format.js';
import { LinkBtn, Loader, Page, Search, Select, StatusBadge, Table, useFetch, Badge } from '../../ui.jsx';

export default function Orders() {
  const nav = useNavigate();
  const { can, lookups } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const f = { status: sp.get('status') || '', stage_id: sp.get('stage_id') || '', late: sp.get('late') || '', q };
  const { data } = useFetch(`/orders${qs(f)}`, { live: ['orders'] });
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const [sel, setSel] = useState([]);
  return (
    <Page title="الطلبات وأوامر الإنتاج" actions={<>
      {sel.length > 0 && <a className="btn btn-ghost" href={`/print/labels?auto=1&ids=${sel.join(',')}`} target="_blank" rel="noreferrer">طباعة ملصقات ({sel.length})</a>}
      {can('orders.manage') && <LinkBtn to="/orders/new" kind="primary">طلب تصنيع جديد</LinkBtn>}
    </>}>
      <div className="row gap wrap mb">
        <Search value={q} onChange={setQ} placeholder="رقم الطلب، الوصف، المحل" />
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="كل الحالات" options={Object.entries(STATUS).map(([k, v]) => [k, v[0]])} style={{ width: 180 }} />
        <Select value={f.stage_id} onChange={(e) => set('stage_id', e.target.value)} placeholder="كل المراحل" options={(lookups?.stages || []).map((s) => [s.id, s.name])} style={{ width: 200 }} />
        <label className="check"><input type="checkbox" checked={!!f.late} onChange={(e) => set('late', e.target.checked ? '1' : '')} /> المتأخرة فقط</label>
      </div>
      {!data ? <Loader /> : (
        <div className="card"><Table rows={data} onRow={(o) => nav(`/orders/${o.id}`)} rowClass={(o) => (o.late ? 'row-warn' : '')} columns={[
          ['', (o) => <input type="checkbox" checked={sel.includes(o.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} />],
          ['رقم الطلب', (o) => <b>{o.order_no}</b>], ['الوصف', 'title'], ['العميل', (o) => o.shop_name || <span className="muted">داخلي</span>], ['المادة', 'material_name'],
          ['الحالة', (o) => <StatusBadge map={STATUS} value={o.status} />], ['المرحلة', (o) => o.stage_name || '—'], ['العامل', 'worker_name'],
          ['التصميم', (o) => (o.design_status !== 'not_required' ? <Badge tone={o.design_status === 'approved' ? 'ok' : 'warn'}>{DESIGN_STATUS[o.design_status]}</Badge> : '—')],
          ['الوزن', (o) => <span className="n">{fmtW(o.final_weight || o.approx_weight)}</span>], ['موعد التسليم', (o) => (o.late ? <Badge tone="bad">{fmtDate(o.due_date)}</Badge> : fmtDate(o.due_date))],
        ]} /></div>
      )}
    </Page>
  );
}
