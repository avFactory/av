import { useMemo, useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtDT, fmtMoney } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, useAction, useFetch, Textarea, Search, Badge, Empty, Kv } from '../../ui.jsx';

const MK = { in: 'إضافة', issue: 'تسليم لعامل', return: 'مرتجع من عامل', used: 'مستخدم (مركب)', lost: 'مفقود', adjust_in: 'تسوية زيادة', adjust_out: 'تسوية نقص', reversal: 'عكس حركة' };
const ICONS = [['round', 'دائري'], ['oval', 'بيضاوي'], ['pear', 'دمعة'], ['heart', 'قلب'], ['marquise', 'ماركيز'], ['square', 'مربع'], ['emerald', 'زمردي'], ['baguette', 'باجيت'], ['other', 'آخر']];
const ct = (v, d = 2) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: 4 });

/** أيقونة شكل القصّة */
export function ShapeIcon({ icon, size = 26 }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' };
  const shapes = {
    round: <circle cx="12" cy="12" r="8.5" {...p} />,
    oval: <ellipse cx="12" cy="12" rx="6.5" ry="9" {...p} />,
    pear: <path d="M12 2.8C9 7.5 6 10.6 6 14.6a6 6 0 0 0 12 0c0-4-3-7.1-6-11.8Z" {...p} />,
    heart: <path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" {...p} />,
    marquise: <path d="M12 2.5C17 7 17 17 12 21.5 7 17 7 7 12 2.5Z" {...p} />,
    square: <rect x="4.5" y="4.5" width="15" height="15" rx="1" {...p} />,
    emerald: <path d="M8 3.5h8l3.5 3.5v10L16 20.5H8L4.5 17V7Z" {...p} />,
    baguette: <rect x="8" y="2.5" width="8" height="19" rx="1" {...p} />,
    other: <path d="M6 4h12l3.5 5L12 21 2.5 9Z M2.5 9h19 M9 4l3 17 3-17" {...p} />,
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{shapes[icon] || shapes.other}</svg>;
}

export default function Stones() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/stones', { live: ['orders', 'custodies'] });
  const { data: shapes, reload: reloadShapes } = useFetch('/stones/shapes');
  const [q, setQ] = useState('');
  const [shapeF, setShapeF] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [lot, setLot] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [mv, setMv] = useState(null);
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [run, busy] = useAction();
  const reloadAll = () => { reload(); reloadShapes(); };
  const openLot = (l) => run(async () => setLot(await api.get(`/stones/${l.id}`)));

  const groups = useMemo(() => {
    const g = new Map();
    for (const s of shapes || []) if (s.active) g.set(s.id, { shape: s, items: [], total: 0, workers: 0 });
    for (const l of data || []) {
      if (!g.has(l.shape_id)) g.set(l.shape_id, { shape: { id: l.shape_id, name: l.shape_name, icon: l.shape_icon }, items: [], total: 0, workers: 0 });
      const grp = g.get(l.shape_id);
      grp.total += Number(l.stock_carats);
      grp.workers += Number(l.with_workers_carats);
      grp.items.push(l);
    }
    return [...g.values()];
  }, [data, shapes]);

  if (!data || !shapes) return <Loader />;
  const total = data.reduce((s, l) => s + Number(l.stock_carats), 0);
  const withWorkers = data.reduce((s, l) => s + Number(l.with_workers_carats), 0);
  const out = data.filter((l) => Number(l.stock_carats) <= 0).length;
  const low = data.filter((l) => l.min_carats && Number(l.stock_carats) > 0 && Number(l.stock_carats) < Number(l.min_carats)).length;
  const match = (l) => !q || `${l.shape_name} ${l.size_label || ''} ${l.stone_type} ${l.color || ''} ${l.clarity || ''} ${l.lot_no}`.toLowerCase().includes(q.toLowerCase());
  const shown = groups
    .filter((g) => !shapeF || String(g.shape.id) === shapeF)
    .map((g) => ({ ...g, list: g.items.filter((l) => match(l) && (!hideEmpty || Number(l.stock_carats) > 0)) }))
    .filter((g) => g.list.length || (!q && !hideEmpty && g.items.length));

  return (
    <Page title="مخزون الألماس والأحجار" subtitle="مصنّف حسب القصّة · الوزن بالقيراط · كل حركة مرتبطة بطلب وعامل ومرحلة"
      actions={<>
        {can('stones.manage') && <Btn kind="ghost" onClick={() => setImp({ step: 1 })}>استيراد من Excel</Btn>}
        <a className="btn btn-ghost" href="/api/stones/inventory.xlsx">تصدير Excel</a>
        {can('stones.manage') && <Btn kind="ghost" onClick={() => setShapesOpen(true)}>التصنيفات</Btn>}
        {can('stones.manage') && <Btn onClick={() => setNewItem({ shape_id: shapes[0]?.id, stone_type: 'ألماس' })}>صنف جديد</Btn>}
      </>}>
      <div className="stone-stats mb">
        <div className="stone-stat main"><span>إجمالي المخزون (غير مركّب)</span><b dir="ltr">{ct(total)}</b><small>قيراط</small></div>
        <div className="stone-stat"><span>لدى العمال</span><b dir="ltr">{ct(withWorkers)}</b><small>قيراط</small></div>
        <div className="stone-stat"><span>عدد الأصناف</span><b>{data.length}</b><small>في {groups.filter((g) => g.items.length).length} تصنيفات</small></div>
        <div className={`stone-stat ${out ? 'warn' : ''}`}><span>أصناف نفدت</span><b>{out}</b><small>{low ? `${low} منخفضة` : 'لا أصناف منخفضة'}</small></div>
      </div>

      <div className="shape-chips mb">
        <button className={`shape-chip ${!shapeF ? 'on' : ''}`} onClick={() => setShapeF('')}><b>الكل</b><span dir="ltr">{ct(total)} ct</span></button>
        {groups.filter((g) => g.items.length).map((g) => (
          <button key={g.shape.id} className={`shape-chip ${shapeF === String(g.shape.id) ? 'on' : ''}`} onClick={() => setShapeF(String(g.shape.id))}>
            <ShapeIcon icon={g.shape.icon} size={22} /><b>{g.shape.name}</b><span dir="ltr">{ct(g.total)} ct</span>
          </button>
        ))}
      </div>
      <div className="row gap wrap mb">
        <Search value={q} onChange={setQ} placeholder="ابحث بالمقاس أو النوع أو رقم الصنف…" />
        <label className="check"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> إخفاء الأصناف المنتهية</label>
      </div>

      {!data.length && <Empty><p>لا توجد أصناف بعد.</p>{can('stones.manage') && <Btn className="mt" onClick={() => setImp({ step: 1 })}>استيراد مخزونك من ملف Excel</Btn>}</Empty>}
      <div className="grid">
        {shown.map((g) => {
          const max = Math.max(...g.items.map((l) => Number(l.stock_carats)), 0.0001);
          const share = total ? (100 * g.total) / total : 0;
          return (
            <section key={g.shape.id} className="shape-group">
              <header>
                <div className="row gap"><span className="shape-ic"><ShapeIcon icon={g.shape.icon} /></span>
                  <div><h3>{g.shape.name}</h3><span className="muted small">{g.items.length} صنف{g.workers ? ` · ${ct(g.workers)} قيراط لدى العمال` : ''}</span></div>
                </div>
                <div className="shape-total"><b dir="ltr">{ct(g.total)}</b> <span>قيراط</span><div className="share"><div style={{ width: `${share}%` }} /></div><small>{share.toFixed(1)}% من المخزون</small></div>
              </header>
              <div className="stone-grid">
                {g.list.map((l) => {
                  const stock = Number(l.stock_carats);
                  const st = stock <= 0 ? 'out' : l.min_carats && stock < Number(l.min_carats) ? 'low' : 'ok';
                  return (
                    <button key={l.id} className={`stone-tile ${st}`} onClick={() => openLot(l)}>
                      <span className="size" dir="ltr">{l.size_label || '—'}</span>
                      {(l.stone_type !== 'ألماس' || l.color || l.clarity) && <span className="sub">{[l.stone_type !== 'ألماس' && l.stone_type, l.color, l.clarity].filter(Boolean).join(' · ')}</span>}
                      <span className="qty" dir="ltr">{stock > 0 ? ct(stock) : '—'}</span>
                      <span className="unit">{stock > 0 ? 'قيراط' : 'نفد'}</span>
                      <span className="bar"><i style={{ width: `${Math.max(2, (100 * stock) / max)}%` }} /></span>
                      {(Number(l.with_workers_carats) > 0 || l.stock_count > 0) && <span className="meta">{l.stock_count > 0 ? `${l.stock_count} حبة` : ''}{Number(l.with_workers_carats) > 0 ? ` · لدى العمال ${ct(l.with_workers_carats)}` : ''}</span>}
                      {st === 'low' && <span className="flag">منخفض</span>}
                    </button>
                  );
                })}
                {!g.list.length && <span className="muted small">لا أصناف مطابقة</span>}
              </div>
            </section>
          );
        })}
      </div>

      <LotModal lot={lot} onClose={() => setLot(null)} can={can} busy={busy} run={run}
        onMove={(l) => setMv({ lot: l, kind: 'in' })} onEdit={(l) => setEdit({ ...l })}
        onReverse={(m) => { const reason = window.prompt('سبب عكس الحركة'); if (reason) run(async () => { await api.post(`/stones/movements/${m.id}/reverse`, { reason }); setLot(await api.get(`/stones/${lot.lot.id}`)); reload(); }, 'تم العكس'); }} />
      <MoveModal mv={mv} setMv={setMv} busy={busy} onSave={() => run(async () => { await api.post(`/stones/${mv.lot.id}/move`, mv); setMv(null); reload(); if (lot) setLot(await api.get(`/stones/${lot.lot.id}`)); }, 'تم تسجيل الحركة')} />
      <ItemModal title="صنف جديد" item={newItem} setItem={setNewItem} shapes={shapes} busy={busy} isNew
        onSave={() => run(async () => { const fd = new FormData(); for (const [k, v] of Object.entries(newItem)) if (k !== 'files' && v != null && v !== '') fd.append(k, v); for (const x of newItem.files || []) fd.append('files', x); await api.post('/stones', fd); setNewItem(null); reloadAll(); }, 'تمت إضافة الصنف')} />
      <ItemModal title="تعديل الصنف" item={edit} setItem={setEdit} shapes={shapes} busy={busy}
        onSave={() => run(async () => { await api.put(`/stones/${edit.id}`, edit); setEdit(null); reloadAll(); if (lot) setLot(await api.get(`/stones/${lot.lot.id}`)); }, 'تم الحفظ')} />
      <ImportModal imp={imp} setImp={setImp} shapes={shapes} busy={busy} run={run} onDone={reloadAll} />
      <ShapesModal open={shapesOpen} onClose={() => setShapesOpen(false)} shapes={shapes} busy={busy} run={run} reload={reloadAll} />
    </Page>
  );
}

function LotModal({ lot, onClose, can, onMove, onEdit, onReverse }) {
  if (!lot) return null;
  const l = lot.lot;
  return (
    <Modal open onClose={onClose} title={`${l.shape_name} ${l.size_label || ''} — ${l.lot_no}`} wide>
      <div className="stone-stats">
        <div className="stone-stat main"><span>في المخزن</span><b dir="ltr">{ct(l.stock_carats)}</b><small>قيراط · {l.stock_count} حبة</small></div>
        <div className="stone-stat"><span>لدى العمال</span><b dir="ltr">{ct(l.with_workers_carats)}</b><small>قيراط</small></div>
        <div className="stone-stat"><span>مستخدم في الطلبات</span><b dir="ltr">{ct(l.used_carats)}</b><small>قيراط</small></div>
      </div>
      <Kv items={[['النوع', l.stone_type], ['اللون', l.color], ['النقاء', l.clarity], ['الشهادة', l.certificate_no], ['حد التنبيه', l.min_carats ? `${ct(l.min_carats)} قيراط` : '—'], ['السعر', l.unit_price ? fmtMoney(l.unit_price) : '—'], ['ملاحظات', l.notes]]} />
      {can('stones.manage') && <div className="row gap"><Btn onClick={() => onMove(l)}>تسجيل حركة</Btn><Btn kind="ghost" onClick={() => onEdit(l)}>تعديل البيانات</Btn></div>}
      {lot.media.length > 0 && <div className="files">{lot.media.map((m) => <a key={m.id} href={fileUrl(m.path)} target="_blank" rel="noreferrer"><img src={fileUrl(m.path)} alt="" /></a>)}</div>}
      <Table rows={lot.movements} empty="لا توجد حركات" rowClass={(m) => (m.reversed ? 'row-warn' : '')} columns={[['الحركة', (m) => MK[m.kind]], ['قيراط', (m) => <span className="n">{ct(m.carats)}</span>], ['العدد', 'count'], ['الطلب', 'order_no'], ['العامل', 'worker_name'], ['ملاحظة', 'note'], ['بواسطة', 'user_name'], ['التاريخ', (m) => fmtDT(m.created_at)],
        ['', (m) => can('stones.manage') && m.kind !== 'reversal' && !m.reversed && <Btn size="sm" kind="ghost" onClick={() => onReverse(m)}>عكس</Btn>]]} />
    </Modal>
  );
}

function MoveModal({ mv, setMv, busy, onSave }) {
  const { lookups } = useAuth();
  const { data: orders } = useFetch(mv ? '/orders?status=in_production' : null);
  if (!mv) return null;
  return (
    <Modal open onClose={() => setMv(null)} title={`حركة: ${mv.lot.shape_name} ${mv.lot.size_label || ''}`}>
      <Field label="نوع الحركة"><Select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })} options={Object.entries(MK).filter(([k]) => k !== 'reversal')} /></Field>
      {['issue', 'return', 'used', 'lost'].includes(mv.kind) && <>
        <Field label="الطلب"><Select value={mv.order_id || ''} onChange={(e) => setMv({ ...mv, order_id: e.target.value })} placeholder="—" options={(orders || []).map((o) => [o.id, `${o.order_no} - ${o.title}`])} /></Field>
        <Field label="العامل"><Select value={mv.worker_id || ''} onChange={(e) => setMv({ ...mv, worker_id: e.target.value })} placeholder="—" options={(lookups?.workers || []).map((w) => [w.id, w.full_name])} /></Field>
      </>}
      <div className="grid g2">
        <Field label="قيراط"><Input dir="ltr" inputMode="decimal" value={mv.carats || ''} onChange={(e) => setMv({ ...mv, carats: e.target.value })} /></Field>
        <Field label="العدد (حبات)"><Input inputMode="numeric" value={mv.count || ''} onChange={(e) => setMv({ ...mv, count: e.target.value })} /></Field>
      </div>
      <Field label="ملاحظة / سبب"><Input value={mv.note || ''} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
      <Btn loading={busy} onClick={onSave}>تسجيل</Btn>
    </Modal>
  );
}

function ItemModal({ title, item, setItem, shapes, busy, onSave, isNew }) {
  if (!item) return null;
  const set = (k) => (e) => setItem({ ...item, [k]: e.target.value });
  return (
    <Modal open onClose={() => setItem(null)} title={title} wide>
      <div className="grid g3">
        <Field label="التصنيف (القصّة) *"><Select value={item.shape_id || ''} onChange={set('shape_id')} options={shapes.filter((s) => s.active).map((s) => [s.id, s.name])} /></Field>
        <Field label="المقاس *" hint="مثال: 1.3 mm أو 0.25"><Input dir="ltr" value={item.size_label || ''} onChange={set('size_label')} /></Field>
        <Field label="النوع"><Input value={item.stone_type || ''} onChange={set('stone_type')} placeholder="ألماس، ألماس طبيعي، زركون…" /></Field>
        <Field label="اللون"><Input value={item.color || ''} onChange={set('color')} /></Field>
        <Field label="النقاء"><Input value={item.clarity || ''} onChange={set('clarity')} placeholder="VS, SI…" /></Field>
        <Field label="حد التنبيه (قيراط)"><Input dir="ltr" inputMode="decimal" value={item.min_carats || ''} onChange={set('min_carats')} /></Field>
        {isNew && <Field label="الرصيد الافتتاحي (قيراط)"><Input dir="ltr" inputMode="decimal" value={item.carats || ''} onChange={set('carats')} /></Field>}
        {isNew && <Field label="العدد (حبات)"><Input inputMode="numeric" value={item.count || ''} onChange={set('count')} /></Field>}
        <Field label="رقم الشهادة"><Input value={item.certificate_no || ''} onChange={set('certificate_no')} /></Field>
        <Field label="السعر (عند الحاجة)"><Input dir="ltr" value={item.unit_price || ''} onChange={set('unit_price')} /></Field>
      </div>
      {isNew && <Field label="الصور والشهادة"><input type="file" multiple onChange={(e) => setItem({ ...item, files: e.target.files })} /></Field>}
      <Field label="ملاحظات"><Textarea value={item.notes || ''} onChange={set('notes')} /></Field>
      {!isNew && <p className="small muted">تعديل البيانات لا يغير الرصيد. الرصيد يتغير بالحركات فقط (إضافة، تسليم، تسوية جرد...).</p>}
      <div className="row end"><Btn loading={busy} onClick={onSave}>حفظ</Btn></div>
    </Modal>
  );
}

function ImportModal({ imp, setImp, shapes, busy, run, onDone }) {
  if (!imp) return null;
  const parse = (file) => run(async () => {
    const fd = new FormData();
    fd.append('file', file);
    const { rows } = await api.post('/stones/import/parse', fd);
    const { plan } = await api.post('/stones/import/preview', { rows });
    setImp({ step: 2, rows, plan, note: 'رصيد افتتاحي من ملف المخزون' });
  });
  const changeShape = (i, shape) => run(async () => {
    const rows = imp.rows.map((r, j) => (j === i ? { ...r, shape } : r));
    const { plan } = await api.post('/stones/import/preview', { rows });
    setImp({ ...imp, rows, plan });
  });
  const totals = imp.plan ? { target: imp.plan.reduce((s, p) => s + Number(p.target), 0), create: imp.plan.filter((p) => p.action === 'create').length, adjust: imp.plan.filter((p) => p.action === 'adjust').length } : null;
  return (
    <Modal open onClose={() => setImp(null)} title="استيراد مخزون الألماس من Excel" wide>
      {imp.step === 1 && <>
        <div className="alert alert-info small">ارفع ملف Excel أو CSV فيه عمود باسم الصنف (مثل "راوند 1.3 mm" أو "اوفال 0.25") وعمود بالرصيد بالقيراط. يتعرف النظام على القصّة والمقاس تلقائياً، وتراجع النتيجة قبل الاعتماد. إعادة الاستيراد لاحقاً (جرد) تسوّي الفروقات فقط بحركات موثقة.</div>
        <label className="btn btn-primary btn-lg" style={{ justifySelf: 'start' }}>{busy ? 'جارٍ القراءة…' : 'اختيار الملف'}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files[0] && parse(e.target.files[0])} /></label>
      </>}
      {imp.step === 2 && <>
        <div className="stone-stats">
          <div className="stone-stat main"><span>إجمالي الرصيد في الملف</span><b dir="ltr">{ct(totals.target)}</b><small>قيراط · {imp.plan.length} صنف</small></div>
          <div className="stone-stat"><span>أصناف جديدة</span><b>{totals.create}</b><small>ستُنشأ</small></div>
          <div className="stone-stat"><span>أصناف موجودة بفرق</span><b>{totals.adjust}</b><small>تسوية جرد</small></div>
        </div>
        <div className="alert alert-warn small">راجع الأرقام مقابل ملفك الأصلي. إن صُنِّف صنف خطأً غيّر تصنيفه من القائمة.</div>
        <Table rows={imp.plan.map((p, i) => ({ ...p, i }))} columns={[
          ['الاسم في الملف', 'name'], ['التصنيف', (p) => <Select value={p.shape} onChange={(e) => changeShape(p.i, e.target.value)} options={shapes.map((s) => [s.name, s.name])} style={{ minWidth: 110 }} />],
          ['المقاس', (p) => <span dir="ltr">{p.size_label || '—'}</span>], ['الحالي', (p) => <span className="n">{ct(p.current)}</span>], ['الرصيد الجديد', (p) => <b className="n">{ct(p.target)}</b>],
          ['الفرق', (p) => <span className="n" style={{ color: p.diff > 0 ? 'var(--ok)' : p.diff < 0 ? 'var(--bad)' : undefined }}>{p.diff > 0 ? '+' : ''}{ct(p.diff)}</span>],
          ['الإجراء', (p) => <Badge tone={p.action === 'create' ? 'info' : p.action === 'adjust' ? 'warn' : 'muted'}>{{ create: 'صنف جديد', adjust: 'تسوية', none: 'بدون تغيير' }[p.action]}</Badge>],
        ]} />
        <Field label="البيان (يسجل على الحركات)"><Input value={imp.note} onChange={(e) => setImp({ ...imp, note: e.target.value })} /></Field>
        <div className="row gap end">
          <Btn kind="ghost" onClick={() => setImp({ step: 1 })}>ملف آخر</Btn>
          <Btn loading={busy} onClick={() => run(async () => { const r = await api.post('/stones/import/commit', { rows: imp.rows, note: imp.note }); setImp(null); onDone(); return r; }, 'تم اعتماد المخزون')}>اعتماد الاستيراد</Btn>
        </div>
      </>}
    </Modal>
  );
}

function ShapesModal({ open, onClose, shapes, busy, run, reload }) {
  const [rows, setRows] = useState(null);
  const [nw, setNw] = useState({ name: '', icon: 'round' });
  if (!open) return null;
  const list = rows || shapes.map((s) => ({ ...s }));
  const upd = (i, k, v) => setRows(list.map((s, j) => (j === i ? { ...s, [k]: v, dirty: true } : s)));
  return (
    <Modal open onClose={() => { setRows(null); onClose(); }} title="تصنيفات القصّة" wide>
      <Table rows={list} columns={[
        ['', (s) => <span style={{ color: 'var(--gold)' }}><ShapeIcon icon={s.icon} /></span>],
        ['الاسم', (s) => <Input value={s.name} onChange={(e) => upd(list.indexOf(s), 'name', e.target.value)} />],
        ['الشكل', (s) => <Select value={s.icon} onChange={(e) => upd(list.indexOf(s), 'icon', e.target.value)} options={ICONS} />],
        ['الترتيب', (s) => <Input style={{ width: 70 }} inputMode="numeric" value={s.sort_order} onChange={(e) => upd(list.indexOf(s), 'sort_order', e.target.value)} />],
        ['الأصناف', 'items'], ['فعال', (s) => <input type="checkbox" checked={s.active} onChange={(e) => upd(list.indexOf(s), 'active', e.target.checked)} />],
      ]} />
      <div className="row gap end"><Btn loading={busy} disabled={!list.some((s) => s.dirty)} onClick={() => run(async () => { for (const s of list.filter((x) => x.dirty)) await api.put(`/stones/shapes/${s.id}`, s); setRows(null); reload(); }, 'تم الحفظ')}>حفظ التعديلات</Btn></div>
      <div className="row gap wrap" style={{ alignItems: 'flex-end' }}>
        <Field label="تصنيف جديد"><Input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="مثال: برنسيس" /></Field>
        <Field label="الشكل"><Select value={nw.icon} onChange={(e) => setNw({ ...nw, icon: e.target.value })} options={ICONS} /></Field>
        <Btn kind="ghost" disabled={!nw.name} onClick={() => run(async () => { await api.post('/stones/shapes', nw); setNw({ name: '', icon: 'round' }); setRows(null); reload(); }, 'تمت الإضافة')}>إضافة</Btn>
      </div>
    </Modal>
  );
}
