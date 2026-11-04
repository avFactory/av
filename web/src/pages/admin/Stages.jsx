import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtDT, fmtPct } from '../../format.js';
import { Btn, Card, Field, Input, Loader, Modal, Page, Select, Table, Tabs, useAction, useFetch, Badge } from '../../ui.jsx';

const KINDS = [['normal', 'عادية'], ['intake', 'استلام الطلب'], ['design', 'تصميم'], ['design_approval', 'اعتماد التصميم من العميل'], ['final_weight', 'الوزن النهائي'], ['invoicing', 'الفوترة'], ['delivery_ready', 'جاهز للتسليم'], ['delivered', 'تم التسليم']];
const FIELDS = [['photo', 'صورة التنفيذ إلزامية']];

export default function Stages() {
  const { can, lookups } = useAuth();
  const { data, reload } = useFetch('/admin/stages');
  const { data: routes, reload: reloadRoutes } = useFetch('/admin/routes');
  const [tab, setTab] = useState('stages');
  const [s, setS] = useState(null);
  const [rate, setRate] = useState(null);
  const [hist, setHist] = useState(null);
  const [route, setRoute] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const active = data.filter((x) => x.active);
  const move = (i, d) => { const ids = active.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; run(async () => { await api.put('/admin/stages-order', { ids }); reload(); }); };
  const saveStage = () => run(async () => { if (s.id) await api.put(`/admin/stages/${s.id}`, s); else await api.post('/admin/stages', s); setS(null); reload(); }, 'تم الحفظ');
  return (
    <Page title="مراحل الإنتاج ونسب العجز" inline actions={<div className="page-tabs-row">
      <Tabs value={tab} onChange={setTab} tabs={[['stages', 'المراحل ونسب العجز'], ['routes', 'مسارات الإنتاج']]} />
      {can('stages.manage') && (tab === 'stages'
        ? <Btn onClick={() => setS({ name: '', kind: 'normal', handles_gold: true, requires_weight: true, requires_approval: false, required_fields: [], customer_visible: true, worker_ids: [] })}>إضافة مرحلة</Btn>
        : <Btn onClick={() => setRoute({ name: '', product_type: '', stage_ids: active.map((x) => x.id), is_default: false })}>مسار جديد</Btn>)}
    </div>}>
      {tab === 'stages' && <div className="small text-body-secondary mb-2">النسب تبدأ بصفر حتى يحددها مدير المصنع. تغيير النسبة لا يؤثر بأثر رجعي على العهد القائمة.</div>}
      {tab === 'stages' && (
        <>
          <div className="card"><Table rows={data} rowClass={(x) => (x.active ? '' : 'row-warn')} columns={[
            ['#', (x) => (x.active ? active.findIndex((a) => a.id === x.id) + 1 : '—')], ['المرحلة', (x) => <b>{x.name}</b>], ['النوع', (x) => KINDS.find((k) => k[0] === x.kind)?.[1]],
            ['نسبة العجز الطبيعي', (x) => <span className="hrow gap"><b dir="ltr">{fmtPct(x.loss_rate)}</b>{can('loss_rates.manage') && <button className="link small" onClick={() => setRate({ stage: x, rate_percent: x.loss_rate, note: '' })}>تعديل</button>}<button className="link small" onClick={() => run(async () => setHist({ stage: x, rows: await api.get(`/admin/stages/${x.id}/rates`) }))}>السجل</button></span>],
            ['عهدة ذهب', (x) => (x.handles_gold ? '✓' : '')], ['وزن إلزامي', (x) => (x.requires_weight ? '✓' : '')], ['اعتماد المشرف', (x) => (x.requires_approval ? '✓' : '')],
            ['المدة المتوقعة', (x) => (x.expected_hours ? `${x.expected_hours} س` : '—')], ['العمال', (x) => x.worker_ids?.length || 0], ['الحالة', (x) => (x.active ? <Badge tone="ok">فعالة</Badge> : <Badge>محذوفة</Badge>)],
            ['', (x) => can('stages.manage') && x.active && <div className="hrow gap">
              {active.findIndex((a) => a.id === x.id) > 0 && <Btn size="sm" kind="ghost" onClick={() => move(active.findIndex((a) => a.id === x.id), -1)}>↑</Btn>}
              {active.findIndex((a) => a.id === x.id) < active.length - 1 && <Btn size="sm" kind="ghost" onClick={() => move(active.findIndex((a) => a.id === x.id), 1)}>↓</Btn>}
              <Btn size="sm" kind="ghost" onClick={() => setS({ ...x })}>تعديل</Btn>
              <Btn size="sm" kind="ghost" onClick={() => window.confirm(`حذف مرحلة ${x.name}؟`) && run(async () => { await api.del(`/admin/stages/${x.id}`); reload(); reloadRoutes(); }, 'تم الحذف')}>حذف</Btn>
            </div>],
          ]} /></div>
          <SpecialtyRates />
        </>
      )}
      {tab === 'routes' && (
        <>
          <div className="grid">
            {(routes || []).map((r) => (
              <Card key={r.id} title={<span>{r.name} {r.is_default && <Badge tone="gold">افتراضي</Badge>} {r.product_type && <Badge>{r.product_type === '__stock__' ? 'بيع من المخزون' : r.product_type}</Badge>}</span>}
                actions={can('stages.manage') && <Btn size="sm" kind="ghost" onClick={() => setRoute({ ...r, stage_ids: r.stages.map((x) => x.stage_id) })}>تعديل</Btn>}>
                <div className="chips">{r.stages.map((x) => <span key={x.seq} className="chip">{x.seq}. {x.name}</span>)}</div>
              </Card>
            ))}
          </div>
        </>
      )}
      <Modal open={!!s} onClose={() => setS(null)} title={s?.id ? 'تعديل مرحلة' : 'مرحلة جديدة'} wide>
        {s && <>
          <div className="grid g3">
            <Field label="اسم المرحلة"><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
            <Field label="نوع المرحلة"><Select value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value })} options={KINDS} /></Field>
            <Field label="مدة الإنجاز المتوقعة (ساعات)"><Input inputMode="decimal" value={s.expected_hours ?? ''} onChange={(e) => setS({ ...s, expected_hours: e.target.value })} /></Field>
          </div>
          <div className="hrow gap wrap">
            {[['handles_gold', 'تتضمن تسليم/استلام ذهب'], ['requires_weight', 'وزن إلزامي'], ['requires_approval', 'تحتاج اعتماد المشرف'], ['customer_visible', 'تظهر للعميل في المتابعة']].map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={!!s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{l}</label>)}
          </div>
          <Field label="حقول مطلوبة من العامل">{FIELDS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={(s.required_fields || []).includes(k)} onChange={(e) => setS({ ...s, required_fields: e.target.checked ? [...(s.required_fields || []), k] : s.required_fields.filter((x) => x !== k) })} />{l}</label>)}</Field>
          <Field label="العمال المحددون لهذه المرحلة">
            <div className="chips">{(lookups?.workers || []).map((w) => { const on = (s.worker_ids || []).includes(w.id); return <button type="button" key={w.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setS({ ...s, worker_ids: on ? s.worker_ids.filter((x) => x !== w.id) : [...(s.worker_ids || []), w.id] })}>{w.full_name}</button>; })}</div>
          </Field>
          <p className="small muted">نسبة العجز تُعدّل من زر "تعديل" في عمود النسبة لتسجيل التاريخ واسم المدير.</p>
          <div className="hrow end"><Btn loading={busy} onClick={saveStage}>حفظ</Btn></div>
        </>}
      </Modal>
      <Modal open={!!rate} onClose={() => setRate(null)} title={`نسبة العجز الطبيعي - ${rate?.stage.name}`}>
        {rate && <>
          <Field label="النسبة المئوية %" hint="مثال: 0.2 تعني 0.2% (2 جرام لكل 1000 جرام)"><Input dir="ltr" inputMode="decimal" value={rate.rate_percent} onChange={(e) => setRate({ ...rate, rate_percent: e.target.value })} /></Field>
          <Field label="ملاحظة / سبب التغيير"><Input value={rate.note} onChange={(e) => setRate({ ...rate, note: e.target.value })} /></Field>
          <div className="alert alert-info small">تطبق النسبة الجديدة على العهد التي تُسلَّم من الآن فقط.</div>
          <Btn loading={busy} onClick={() => run(async () => { await api.post(`/admin/stages/${rate.stage.id}/rate`, rate); setRate(null); reload(); }, 'تم اعتماد النسبة')}>اعتماد النسبة</Btn>
        </>}
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title={`سجل نسب ${hist?.stage.name}`}>
        {hist && <Table rows={hist.rows} empty="لم تحدد نسبة بعد (0%)" columns={[['النسبة', (r) => fmtPct(r.rate_percent)], ['من تاريخ', (r) => fmtDT(r.effective_from)], ['بواسطة', 'set_by_name'], ['ملاحظة', 'note']]} />}
      </Modal>
      <Modal open={!!route} onClose={() => setRoute(null)} title="مسار إنتاج" wide>
        {route && <>
          <div className="grid g3">
            <Field label="اسم المسار"><Input value={route.name} onChange={(e) => setRoute({ ...route, name: e.target.value })} /></Field>
            <Field label="نوع المنتج (للاختيار التلقائي)"><Input value={route.product_type || ''} onChange={(e) => setRoute({ ...route, product_type: e.target.value })} placeholder="خاتم، سلسال…" /></Field>
            <Field label=" "><label className="check"><input type="checkbox" checked={!!route.is_default} onChange={(e) => setRoute({ ...route, is_default: e.target.checked })} /> المسار الافتراضي</label></Field>
          </div>
          <Field label="المراحل بالترتيب (اضغط للإضافة/الإزالة)">
            <div className="chips">{active.map((x) => { const i = route.stage_ids.indexOf(x.id); return <button type="button" key={x.id} className={`chip ${i >= 0 ? 'on' : ''}`} onClick={() => setRoute({ ...route, stage_ids: i >= 0 ? route.stage_ids.filter((y) => y !== x.id) : [...route.stage_ids, x.id] })}>{i >= 0 ? `${i + 1}. ` : ''}{x.name}</button>; })}</div>
          </Field>
          <div className="hrow end"><Btn loading={busy} onClick={() => run(async () => { if (route.id) await api.put(`/admin/routes/${route.id}`, route); else await api.post('/admin/routes', route); setRoute(null); reloadRoutes(); }, 'تم الحفظ')}>حفظ</Btn></div>
        </>}
      </Modal>
    </Page>
  );
}

/** نسب العجز حسب مهنة العامل: المسموح = الوزن المستلم من العامل × نسبة مهنته (تتقدم على نسبة المرحلة) */
function SpecialtyRates() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/admin/specialty-rates');
  const [rows, setRows] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setRows(data.map((r) => ({ specialty: r.specialty, rate_percent: String(+r.rate_percent), workers: r.workers }))); }, [data]);
  if (!rows) return null;
  const edit = can('loss_rates.manage');
  const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card title="نسب العجز حسب مهنة العامل" className="mt-3">
      <div className="small text-body-secondary mb-2">العجز المسموح = الوزن المستلم من العامل × نسبة مهنته. على حساب العامل = إجمالي عجز الشهر − إجمالي المسموح. العامل الذي لا تطابق مهنته أي سطر تُطبق عليه نسبة المرحلة. (تُطبق على العهد الجديدة)</div>
      <Table rows={rows.map((r, i) => ({ ...r, _i: i }))} empty="لا توجد نسب" columns={[
        ['المهنة', (r) => (edit ? <Input value={r.specialty} onChange={(e) => upd(r._i, 'specialty', e.target.value)} style={{ maxWidth: 200 }} /> : <b>{r.specialty}</b>)],
        ['النسبة %', (r) => (edit ? <Input dir="ltr" inputMode="decimal" value={r.rate_percent} onChange={(e) => upd(r._i, 'rate_percent', e.target.value.replace(/[^\d.]/g, ''))} style={{ maxWidth: 110 }} /> : <b dir="ltr">{fmtPct(r.rate_percent)}</b>)],
        ['عدد العمال', (r) => r.workers ?? '—'],
        ['', (r) => edit && <button type="button" className="link small text-danger" onClick={() => setRows(rows.filter((_, j) => j !== r._i))}>حذف</button>],
      ]} />
      {edit && <div className="hrow gap mt">
        <Btn kind="ghost" onClick={() => setRows([...rows, { specialty: '', rate_percent: '' }])}>إضافة مهنة</Btn>
        <Btn loading={busy} onClick={() => run(async () => { await api.put('/admin/specialty-rates', { rates: rows.filter((r) => r.specialty.trim()) }); reload(); }, 'تم حفظ النسب')}>حفظ النسب</Btn>
      </div>}
    </Card>
  );
}
