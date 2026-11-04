import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import PrintLabelsBtn from '../../components/PrintLabelsBtn.jsx';
import { fmtW, fmtDate, STATUS, DESIGN_STATUS } from '../../format.js';
import { Btn, LinkBtn, Loader, Page, Search, Select, StatusBadge, Table, useAction, useFetch, Badge } from '../../ui.jsx';

/** تجميع بنود الطلب الواحد (نفس رقم الطلب من السلة أو بعد التقسيم) في صف واحد قابل للفتح */
function groupRows(data, open) {
  const groups = new Map();
  for (const o of data) {
    const k = o.cart_ref || `#${o.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const out = [];
  for (const [k, items] of groups) {
    if (items.length === 1) { out.push(items[0]); continue; }
    items.sort((a, b) => a.id - b.id);
    out.push({ id: `g:${k}`, group: true, ref: k, items, open: !!open[k] });
    if (open[k]) for (const o of items) out.push({ ...o, child: true });
  }
  return out;
}

export default function Orders() {
  const nav = useNavigate();
  const { can, lookups } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const f = { status: sp.get('status') || '', stage_id: sp.get('stage_id') || '', late: sp.get('late') || '', q };
  const { data } = useFetch(`/orders${qs(f)}`, { live: ['orders'] });
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const [sel, setSel] = useState([]);
  const [open, setOpen] = useState({});
  const [run, busy] = useAction();
  const startAll = (g) => run(async () => {
    const r = await api.post('/orders/group/start', { ref: g.ref });
    if (r.skipped?.length) window.alert(`بدأ إنتاج ${r.started.length} بند.\nلم يبدأ:\n${r.skipped.map((x) => `${x.order_no}: ${x.reason}`).join('\n')}`);
  }, 'تم بدء إنتاج الطلب');
  const rows = data ? groupRows(data, open) : null;
  const G = (fn, gfn) => (o) => (o.group ? gfn(o) : fn(o));
  const sum = (items, k) => items.reduce((a, o) => a + Number(o[k] || 0), 0);
  return (
    <Page title="الطلبات وأوامر الإنتاج" actions={<>
      {sel.length > 0 && <PrintLabelsBtn ids={sel}>طباعة ملصقات ({sel.length})</PrintLabelsBtn>}
      {can('orders.manage') && <LinkBtn to="/orders/new" kind="primary">طلب تصنيع جديد</LinkBtn>}
    </>}>
      <div className="hrow gap wrap mb">
        <Search value={q} onChange={setQ} placeholder="رقم الطلب، الوصف، المحل" />
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="كل الحالات" options={Object.entries(STATUS).map(([k, v]) => [k, v[0]])} style={{ width: 180 }} />
        <Select value={f.stage_id} onChange={(e) => set('stage_id', e.target.value)} placeholder="كل المراحل" options={(lookups?.stages || []).map((s) => [s.id, s.name])} style={{ width: 200 }} />
        <label className="check"><input type="checkbox" checked={!!f.late} onChange={(e) => set('late', e.target.checked ? '1' : '')} /> المتأخرة فقط</label>
      </div>
      {!data ? <Loader /> : (
        <div className="card"><Table rows={rows} onRow={(o) => (o.group ? setOpen((x) => ({ ...x, [o.ref]: !x[o.ref] })) : nav(`/orders/${o.id}`))}
          rowClass={(o) => (o.group ? `row-group ${o.open ? 'open' : ''}` : `${o.child ? 'row-child' : ''} ${o.late ? 'row-warn' : ''}`)} columns={[
          ['', G((o) => <input type="checkbox" checked={sel.includes(o.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} />,
            (g) => { const ids = g.items.map((o) => o.id); const all = ids.every((i) => sel.includes(i)); return <input type="checkbox" checked={all} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => (e.target.checked ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))))} />; })],
          ['', G((o) => (o.thumb ? <img src={fileUrl(o.thumb)} alt="" className="order-thumb" loading="lazy" /> : <span className="order-thumb empty" aria-hidden="true">◇</span>),
            (g) => { const t = g.items.find((o) => o.thumb)?.thumb; return t ? <img src={fileUrl(t)} alt="" className="order-thumb" loading="lazy" /> : <span className="order-thumb empty" aria-hidden="true">◇</span>; })],
          ['رقم الطلب', G((o) => <b className={o.child ? 'child-no' : ''}>{o.child && <span aria-hidden="true">↳ </span>}{o.order_no}</b>,
            (g) => <span className="d-inline-flex align-items-center gap-2"><span className="grp-caret" aria-hidden="true">{g.open ? '▾' : '◂'}</span><b>{g.ref}</b><Badge tone="gold">{g.items.length} بنود</Badge></span>)],
          ['الوصف', G((o) => o.title, (g) => <span className="small">{g.items.map((o) => `${o.title} ×${o.quantity}`).join('، ')}</span>)],
          ['العميل', G((o) => (o.shop_name ? <>{o.shop_name}{o.branch_name && <div className="small text-body-secondary">{o.branch_name}</div>}</> : <span className="muted">داخلي</span>),
            (g) => (g.items[0].shop_name ? <>{g.items[0].shop_name}{g.items[0].branch_name && <div className="small text-body-secondary">{g.items[0].branch_name}</div>}</> : <span className="muted">داخلي</span>))],
          ['المادة', G((o) => o.material_name, (g) => [...new Set(g.items.map((o) => o.material_name))].join('، '))],
          ['الحالة', G((o) => <StatusBadge map={STATUS} value={o.status} />, (g) => {
            const c = {}; g.items.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; });
            const ks = Object.keys(c);
            return ks.length === 1 ? <StatusBadge map={STATUS} value={ks[0]} /> : <span className="d-flex flex-wrap gap-1">{ks.map((k) => <span key={k} className="small"><StatusBadge map={STATUS} value={k} /> {c[k]}</span>)}</span>;
          })],
          ['المرحلة', G((o) => o.stage_name || '—', () => '')], ['العامل', G((o) => o.worker_name || '—', () => '')],
          ['التصميم', G((o) => (o.design_status !== 'not_required' ? <Badge tone={o.design_status === 'approved' ? 'ok' : 'warn'}>{DESIGN_STATUS[o.design_status]}</Badge> : '—'), () => '')],
          ['الوزن', G((o) => <span className="n">{fmtW(o.final_weight || o.approx_weight)}</span>, (g) => <span className="n">{fmtW(sum(g.items, 'approx_weight'))}</span>)],
          ['موعد التسليم', G((o) => (o.late ? <Badge tone="bad">{fmtDate(o.due_date)}</Badge> : fmtDate(o.due_date)),
            (g) => (can('orders.manage') && g.items.some((o) => ['pending_review', 'approved'].includes(o.status))
              ? <span onClick={(e) => e.stopPropagation()}><Btn size="sm" loading={busy} onClick={() => startAll(g)}>بدء إنتاج الطلب</Btn></span> : ''))],
        ]} /></div>
      )}
    </Page>
  );
}
