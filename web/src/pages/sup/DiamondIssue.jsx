import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Btn, Card, Field, Input, Loader, ScanInput, Select, Empty, useAction, useToast } from '../../ui.jsx';
import { ShapeIcon } from '../admin/Stones.jsx';
import { useAuth } from '../../auth.jsx';

const ct = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const toNum = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/**
 * تسليم الألماس للعامل على طلب: شريط القصّات ← المقاسات ← شاشة الصرف بالقيراط.
 * الصرف يُخصم من مخزون الألماس ويُسجَّل على العامل والطلب (يُرجع أو يُسجَّل مركّباً لاحقاً من شاشة الألماس).
 */
export default function DiamondIssue() {
  const toast = useToast();
  const [lots, setLots] = useState(null);
  const [shapeId, setShapeId] = useState(null);
  const [lot, setLot] = useState(null);
  const load = () => api.get('/stones').then(setLots).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shapes = useMemo(() => {
    const m = new Map();
    for (const l of lots || []) {
      if (!m.has(l.shape_id)) m.set(l.shape_id, { id: l.shape_id, name: l.shape_name, icon: l.shape_icon, sort: l.shape_sort, stock: 0, sizes: 0 });
      const s = m.get(l.shape_id); s.stock += Number(l.stock_carats) || 0; s.sizes += 1;
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ar'));
  }, [lots]);
  useEffect(() => { if (!shapeId && shapes.length) setShapeId((shapes.find((s) => s.stock > 0) || shapes[0]).id); }, [shapes, shapeId]);
  const sizes = (lots || []).filter((l) => l.shape_id === shapeId);
  const current = lot && (lots || []).find((l) => l.id === lot.id);

  if (!lots) return <Loader />;
  if (!lots.length) return <Empty>لا توجد أصناف ألماس مخبري — أضفها من صفحة "الألماس المخبري والأحجار"</Empty>;
  return (
    <div className="grid">
      {/* شريط القصّات */}
      <div className="shape-bar" role="tablist" aria-label="نوع القصة">
        {shapes.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === shapeId} className={`shape-chip${s.id === shapeId ? ' on' : ''}`} onClick={() => { setShapeId(s.id); setLot(null); }}>
            <ShapeIcon icon={s.icon} size={22} />
            <b>{s.name}</b>
            <span dir="ltr">{ct(s.stock)} ct</span>
          </button>
        ))}
      </div>

      {!current ? (
        /* المقاسات */
        <div className="size-grid">
          {sizes.map((l) => {
            const empty = Number(l.stock_carats) <= 0;
            return (
              <button key={l.id} type="button" className={`size-card${empty ? ' empty' : ''}`} disabled={empty} onClick={() => setLot(l)}>
                <b dir="ltr">{l.size_label || '—'}</b>
                <span className="small">{[l.color, l.clarity].filter(Boolean).join(' · ') || l.stone_type}</span>
                <span className="size-stock" dir="ltr">{ct(l.stock_carats)} ct{l.stock_count ? ` · ${l.stock_count} حبة` : ''}</span>
                {empty && <span className="small text-danger">نفد المخزون</span>}
              </button>
            );
          })}
          {!sizes.length && <Empty>لا توجد مقاسات لهذه القصة</Empty>}
        </div>
      ) : (
        <IssueForm lot={current} onBack={() => setLot(null)} onDone={load} />
      )}
    </div>
  );
}

/** الشاشة الأخيرة: صرف الألماس بالقيراط لعامل على طلب */
function IssueForm({ lot, onBack, onDone }) {
  const toast = useToast();
  const [run, busy] = useAction();
  const { lookups } = useAuth();
  const [allWorkers, setWorkers] = useState(null);
  // عمال صرف الألماس فقط (حسب الأرقام الوظيفية المحددة في الإعدادات، الافتراضي 116 و117 و118 و119)
  const key = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '').replace(/^0+/, '');
  const allowed = (lookups?.settings?.diamond_worker_nos || []).map(key).filter(Boolean);
  const workers = allWorkers && (allowed.length ? allWorkers.filter((w) => allowed.includes(key(w.employee_no))) : allWorkers);
  const [workerId, setWorkerId] = useState('');
  const [open, setOpen] = useState([]);
  const [order, setOrder] = useState(null);
  const [f, setF] = useState({ carats: '', count: '', note: '' });
  useEffect(() => { api.get('/sup/workers').then(setWorkers).catch(() => setWorkers([])); }, []);
  useEffect(() => {
    setOpen([]);
    if (!workerId) return;
    api.get(`/sup/workers/${workerId}/open`).then((cs) => {
      const seen = new Map();
      for (const c of cs || []) if (c.order_id && !seen.has(c.order_id)) seen.set(c.order_id, { id: c.order_id, order_no: c.order_no, title: c.title });
      setOpen([...seen.values()]);
    }).catch(() => setOpen([]));
  }, [workerId]);
  const scan = async (code) => {
    try {
      const o = await api.get(`/sup/lookup?code=${encodeURIComponent(code)}`);
      setOrder({ id: o.id, order_no: o.order_no, title: o.title });
      if (!workerId && o.assigned_worker_id) setWorkerId(String(o.assigned_worker_id));
    } catch (e) { toast(e.message, 'bad'); }
  };
  const over = Number(f.carats) > Number(lot.stock_carats) || (Number(f.count) || 0) > Number(lot.stock_count || 0);
  const ok = workerId && order && Number(f.carats) > 0 && !over;
  const submit = () => run(async () => {
    await api.post(`/stones/${lot.id}/move`, { kind: 'issue', carats: f.carats, count: f.count || 0, worker_id: workerId, order_id: order.id, note: f.note });
    setF({ carats: '', count: '', note: '' });
    await onDone();
  }, `تم صرف ${f.carats} قيراط`).catch(() => {});
  const worker = (workers || []).find((w) => String(w.id) === String(workerId));

  return (
    <div className="grid g2 diamond-issue">
      <Card title={<span className="d-inline-flex align-items-center gap-2"><ShapeIcon icon={lot.shape_icon} size={22} />{lot.shape_name} — <span dir="ltr">{lot.size_label}</span></span>}
        actions={<Btn kind="ghost" size="sm" onClick={onBack}>تغيير المقاس</Btn>}>
        <div className="d-flex flex-wrap gap-3 mb-3">
          <div className="stat-mini"><span>المتوفر في المخزن</span><b dir="ltr">{ct(lot.stock_carats)} ct</b></div>
          <div className="stat-mini"><span>عدد الحبات</span><b>{lot.stock_count || 0}</b></div>
          <div className="stat-mini"><span>لدى العمال</span><b dir="ltr">{ct(lot.with_workers_carats)} ct</b></div>
        </div>
        <div className="small text-body-secondary">{[lot.lot_no, lot.stone_type, lot.color, lot.clarity].filter(Boolean).join(' · ')}</div>
      </Card>
      <Card title="صرف الألماس المخبري">
        <div className="grid">
          <Field label="العامل *" hint={workers && allowed.length ? (workers.length ? `عمال الألماس المخبري: ${allowed.join('، ')}` : `لا يوجد عامل نشط بالأرقام ${allowed.join('، ')} — عدّلها من الإعدادات`) : undefined}>
            <Select value={workerId} onChange={(e) => { setWorkerId(e.target.value); setOrder(null); }} placeholder={workers ? 'اختر العامل' : 'جارٍ التحميل…'}
              options={(workers || []).map((w) => [w.id, `${w.full_name}${w.employee_no ? ` (${w.employee_no})` : ''}${w.open_count ? ` — لديه ${w.open_count} طلب` : ''}`])} />
          </Field>
          <Field label="الطلب *">
            {order
              ? <div className="d-flex align-items-center gap-2"><b dir="ltr">{order.order_no}</b><span className="text-body-secondary">{order.title}</span><Btn kind="ghost" size="sm" onClick={() => setOrder(null)}>تغيير</Btn></div>
              : <>
                {open.length > 0 && <div className="d-flex flex-wrap gap-2 mb-2">{open.map((o) => <button key={o.id} type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setOrder(o)}><span dir="ltr">{o.order_no}</span> — {o.title}</button>)}</div>}
                <ScanInput onScan={scan} autoFocus={false} placeholder={worker ? 'أو امسح QR طلب آخر / اكتب رقمه' : 'امسح QR الطلب أو اكتب رقمه'} />
              </>}
          </Field>
          <div className="grid g2">
            <Field label="الوزن بالقيراط *" hint={`المتوفر ${ct(lot.stock_carats)} ct`}>
              <Input className="form-control form-control-lg" dir="ltr" inputMode="decimal" value={f.carats} onChange={(e) => setF({ ...f, carats: toNum(e.target.value) })} placeholder="0.00" />
            </Field>
            <Field label="عدد الحبات"><Input dir="ltr" inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <Field label="ملاحظة (اختياري)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          {over && <div className="alert alert-warning small mb-0">الكمية أكبر من المتوفر في المخزن.</div>}
          <Btn size="lg" loading={busy} disabled={!ok} onClick={submit}>صرف {f.carats ? `${f.carats} قيراط` : 'الألماس المخبري'}{worker ? ` إلى ${worker.full_name}` : ''}</Btn>
        </div>
      </Card>
    </div>
  );
}
