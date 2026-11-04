import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileUrl, qrUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import PrintLabelsBtn from '../../components/PrintLabelsBtn.jsx';
import { fmtW, fmtDT, fmtDate, fmtMoney, fmtPct, STATUS, CUSTODY_STATUS, SETTLEMENT_STATUS, DESIGN_STATUS, METHODS, COLORS, LOCS, stoneItems } from '../../format.js';
import { Btn, Card, Field, Input, Kv, LinkBtn, Loader, Modal, Page, Select, StatusBadge, Table, Tabs, Textarea, WeightInput, useAction, useFetch, Badge, ErrorBox, ReasonModal } from '../../ui.jsx';

/** رابط تتبع عام للطلب (عرض فقط بدون تسجيل دخول): نسخ أو إرسال واتساب */
function TrackLinkBtn({ o }) {
  const [open, setOpen] = useState(false);
  const url = `${location.origin}/t/${o.qr_token}`;
  const phone = String(o.branch_phone || o.customer_phone || '').replace(/\D/g, '').replace(/^0/, '966');
  const msg = `مصنع AV للمجوهرات\nتتبع طلبكم ${o.order_no} (${o.title}):\n${url}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); } catch { window.prompt('انسخ الرابط', url); } setOpen(false); };
  return (
    <div className="dropdown">
      <button type="button" className="btn btn-outline-secondary dropdown-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>رابط التتبع</button>
      {open && (
        <div className="dropdown-menu show p-2" style={{ minWidth: 280, position: "absolute", top: "100%", left: 0, right: "auto", zIndex: 1050 }}>
          <div className="small text-body-secondary mb-2">رابط عرض فقط بدون تسجيل دخول — يُظهر المرحلة التي وصل لها الطلب</div>
          <input className="form-control form-control-sm mb-2" dir="ltr" readOnly value={url} onFocus={(e) => e.target.select()} />
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-sm btn-primary" onClick={copy}>نسخ الرابط</button>
            <a className="btn btn-sm btn-success" href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>إرسال واتساب{phone ? '' : ' (اختر الرقم)'}</a>
            <a className="btn btn-sm btn-outline-secondary" href={url} target="_blank" rel="noreferrer">فتح</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { can, lookups } = useAuth();
  const { data, error, reload } = useFetch(`/orders/${id}`, { live: ['orders', 'custodies', 'settlements'] });
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const [f, setF] = useState({});
  const [run, busy] = useAction();
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { order: o, stages, log, files, custodies, gold, goldFlow, designs, stones, invoices, stonesGrams, suggestedLabor, siblings = [] } = data;
  const orderBal = gold.find((g) => g.loc_type === 'order')?.balance || '0';
  const cur = stages.find((s) => s.seq === o.stage_seq);
  const openCust = custodies.filter((c) => ['open', 'under_review'].includes(c.status));
  const act = (path, body, msg) => run(async () => { const r = await api.post(`/orders/${o.id}/${path}`, body); setModal(null); setF({}); reload(); return r; }, msg);
  const open = (m, init = {}) => { setF(init); setModal(m); };
  const setv = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const upload = (e) => run(async () => {
    const fd = new FormData();
    for (const x of e.target.files) fd.append('files', x);
    fd.append('kind', f.kind || 'design');
    fd.append('customer_visible', 'false');
    await api.post(`/orders/${o.id}/files`, fd);
    reload();
  }, 'تم رفع الملفات');

  const inProd = o.status === 'in_production';
  return (
    <Page title={<span>{o.order_no} <StatusBadge map={STATUS} value={o.status} /></span>} subtitle={`${o.title}${o.shop_name ? ' · ' + o.shop_name + (o.branch_name ? ' — ' + o.branch_name : '') : ' · طلب داخلي'}`} back="/orders"
      actions={<>
        <PrintLabelsBtn ids={[o.id]} />
        <TrackLinkBtn o={o} />
        {o.status === 'pending_review' && can('orders.quote') && o.source === 'store_custom' && <Btn onClick={() => open('quote', { labor_method: suggestedLabor?.method || 'per_gram', labor_rate: suggestedLabor?.rate || '', approx_weight: o.approx_weight || '', due_date: o.due_date?.slice(0, 10) || '' })}>إرسال عرض أجور</Btn>}
        {['pending_review', 'approved'].includes(o.status) && can('orders.manage') && <Btn onClick={() => act('start', {}, 'تم تحويل الطلب لأمر إنتاج')} loading={busy}>بدء الإنتاج</Btn>}
        {['pending_review', 'approved'].includes(o.status) && o.product_id && can('orders.manage') && <Btn kind="ghost" onClick={() => act('from-stock', {}, 'تمت التلبية من المخزون الجاهز')}>تلبية من المخزون الجاهز</Btn>}
        {['pending_review', 'quoted', 'approved'].includes(o.status) && can('orders.manage') && <Btn kind="ghost" onClick={() => setModal('reject')}>رفض</Btn>}
        {!['delivered', 'cancelled', 'rejected'].includes(o.status) && can('orders.manage') && <Btn kind="ghost" onClick={() => setModal('cancel')}>إلغاء</Btn>}
      </>}>
      <div className="grid g3 mb" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
        <Card title="الطلب">
          <Kv items={[o.shop_name && ['العميل', o.branch_name ? `${o.shop_name} — ${o.branch_name}` : o.shop_name],
            o.shop_name && ['رقم التواصل', (o.branch_phone || o.customer_phone) ? <a href={`tel:${o.branch_phone || o.customer_phone}`} dir="ltr">{o.branch_phone || o.customer_phone}</a> : null],
            ['المادة', o.material_name], ['العيار / اللون', `${o.karat} · ${COLORS[o.color] || o.color}`], ['الكمية', o.quantity], ['المقاس', o.size], ['نوع القطعة', o.product_type], ...stoneItems(o),
            ['الوزن التقريبي', fmtW(o.approx_weight)], ['الوزن النهائي', o.final_weight ? `${fmtW(o.final_weight)} (ذهب ${fmtW(o.final_gold_weight)})` : '—'], ['موعد التسليم', fmtDate(o.due_date)],
            ['المسار', o.route_name], ['تصميم', DESIGN_STATUS[o.design_status]], ['المصدر', { internal: 'داخلي', store_catalog: 'المتجر - منتج', store_custom: 'المتجر - تصميم خاص' }[o.source]], ['ملاحظات', o.notes]]} />
        </Card>
        <Card title="أجور التصنيع والذهب">
          <Kv items={[['طريقة الأجرة', METHODS[o.labor_method] || '—'], ['الأجرة', o.labor_rate ? fmtMoney(o.labor_rate) : '—'], ['التقدير', o.labor_estimate ? fmtMoney(o.labor_estimate) : '—'],
            o.labor_method === 'manual' && ['اعتماد الأجرة اليدوية', o.labor_manual_approved_by ? 'معتمدة' : <Badge tone="warn">بانتظار الاعتماد</Badge>],
            ['ذهب مخصص للطلب', fmtW(goldFlow.allocated)], ['رصيد الطلب (تحت التشغيل)', fmtW(orderBal)], ['لدى العمال', fmtW(openCust.reduce((s, c) => s + Number(c.weight_issued), 0))],
            ['بقايا مستردة', fmtW(Number(goldFlow.scrap) + Number(goldFlow.recovered))], ['عجز طبيعي', fmtW(goldFlow.normal_loss)], ['عجز غير طبيعي', fmtW(Number(goldFlow.abnormal_loss) + Number(goldFlow.abnormal_pending))],
            Number(stonesGrams.used) > 0 && ['أحجار مركبة', `${fmtW(stonesGrams.used)} جم`]]} />
          <div className="hrow gap wrap mt">
            {can('orders.manage') && !['delivered', 'cancelled'].includes(o.status) && <Btn size="sm" kind="ghost" onClick={() => open('labor', { labor_method: o.labor_method || '', labor_rate: o.labor_rate || '' })}>تعديل الأجرة</Btn>}
            {o.labor_method === 'manual' && !o.labor_manual_approved_by && can('labor.approve_manual') && <Btn size="sm" onClick={() => act('approve-manual-labor', {}, 'تم اعتماد الأجرة')}>اعتماد الأجرة اليدوية</Btn>}
          </div>
        </Card>
        <div className="card card-body d-grid gap-2" style={{ textAlign: 'center', alignContent: 'start' }}>
          {o.thumb && <a href={fileUrl(o.thumb)} target="_blank" rel="noreferrer" className="order-hero"><img src={fileUrl(o.thumb)} alt={o.title} /></a>}
          <img src={qrUrl(o.qr_token)} alt="QR" style={{ width: 110, height: 110, justifySelf: 'center' }} /><div className="small muted">QR الطلب</div>
        </div>
      </div>

      {inProd || o.status === 'ready' ? (
        <Card title={<span>المرحلة الحالية: {o.stage_name}</span>} actions={<span className="small muted">{o.worker_name ? `العامل: ${o.worker_name}` : ''}</span>}>
          <div className="progress mb"><div style={{ width: `${Math.round(((o.stage_seq - 1) / Math.max(1, stages.length - 1)) * 100)}%` }} /></div>
          <div className="hrow gap wrap">
            {cur?.handles_gold && !openCust.length && can('custody.issue') && <LinkBtn kind="primary" to={`/sup/issue?order=${o.id}${o.assigned_worker_id ? `&worker=${o.assigned_worker_id}` : ''}`}>تسليم الذهب لعامل</LinkBtn>}
            {can('custody.receive') && openCust.filter((c) => c.status === 'open').map((c) => <LinkBtn key={c.id} kind="dark" to={`/sup/receive?worker=${c.worker_id}`}>استلام من {c.worker_name}</LinkBtn>)}
            {(can('custody.issue') || can('orders.manage')) && inProd && <Btn kind="ghost" onClick={() => open('allocate', { source: 'vault' })}>تسجيل ذهب على الطلب</Btn>}
            {can('orders.advance') && inProd && <Btn kind="ghost" onClick={() => open('assign', { worker_id: o.assigned_worker_id || '' })}>إسناد لعامل</Btn>}
            {cur?.kind === 'final_weight' && can('orders.advance') && !openCust.length && (!cur.handles_gold || custodies.some((c) => c.stage_id === cur.id && c.status === 'closed')) && <Btn onClick={() => open('final', { weight: orderBal })}>{o.final_weight ? 'تعديل الوزن النهائي' : 'تسجيل الوزن النهائي'}</Btn>}
            {cur?.kind === 'invoicing' && can('invoices.manage') && <LinkBtn kind="primary" to={`/admin/invoices?new=1&customer=${o.customer_id}&order=${o.id}`}>إصدار فاتورة الأجور</LinkBtn>}
            {o.status === 'ready' && can('orders.advance', 'orders.manage') && <Btn kind="ok" onClick={() => open('deliver')}>تسليم الطلب للعميل وإقفاله</Btn>}
            {inProd && can('orders.advance') && cur?.kind !== 'delivery_ready' && <Btn kind="dark" loading={busy} onClick={() => act('advance', {}, 'انتقل الطلب للمرحلة التالية')}>{o.stage_state === 'pending_approval' ? 'اعتماد وإنهاء المرحلة' : 'نقل للمرحلة التالية'}</Btn>}
            {inProd && can('orders.manage') && <Btn kind="ghost" size="sm" onClick={() => open('force')}>تجاوز المرحلة (بسبب)</Btn>}
          </div>
          {cur?.kind === 'final_weight' && inProd && (o.final_weight
            ? <div className="alert alert-success mt">الوزن النهائي: <b>{fmtW(o.final_weight)}</b> جم (صافي ذهب {fmtW(o.final_gold_weight)}) — يمكن النقل للمرحلة التالية</div>
            : <div className="alert alert-warning mt">{cur.handles_gold && !custodies.some((c) => c.stage_id === cur.id && c.status === 'closed') ? 'سلّم الطلب لعامل الجودة للتشييك، وبعد استلامه سجّل الوزن النهائي ثم انقله للفوترة.' : openCust.length ? 'بانتظار استلام الذهب من العامل، ثم تسجيل الوزن النهائي.' : 'سجّل الوزن النهائي قبل نقل الطلب للفوترة.'}</div>)}
          {o.stage_state === 'pending_approval' && <div className="alert alert-info mt">أنهى العامل المرحلة وهي بانتظار اعتماد المشرف</div>}
          {cur?.kind === 'design_approval' && o.design_status !== 'approved' && <div className="alert alert-warning mt">بانتظار اعتماد العميل للتصميم — لا يمكن بدء الصب قبل الاعتماد</div>}
        </Card>
      ) : null}

      {(siblings.length > 1 || (['pending_review', 'quoted'].includes(o.status) && o.quantity > 1 && can('orders.manage'))) && (
        <OrderItems o={o} siblings={siblings} canManage={can('orders.manage')} busy={busy} routes={lookups?.routes || []}
          onSplit={() => open('split', { quantity: '', route_id: o.route_id ? String(o.route_id) : '' })}
          onStartAll={() => run(async () => { const r = await api.post('/orders/group/start', { ref: o.cart_ref }); reload(); if (r.skipped?.length) window.alert(`لم يبدأ:\n${r.skipped.map((x) => `${x.order_no}: ${x.reason}`).join('\n')}`); }, 'تم بدء إنتاج الطلب')} />
      )}

      <div className="mt">
        <Tabs value={tab} onChange={setTab} tabs={[['overview', 'مراحل الإنتاج'], ['custody', `العهد والتسويات (${custodies.length})`], ['files', `الملفات والتصميم (${files.length})`], ['stones', 'الأحجار'], ['log', 'السجل'], ['finance', 'الفواتير']]} />
        {tab === 'overview' && (
          <Card>
            <ol className="timeline">
              {stages.map((s) => <li key={s.seq} className={s.seq < o.stage_seq || o.status === 'delivered' ? 'done' : s.seq === o.stage_seq ? 'cur' : ''}><div><b>{s.name}</b>{s.handles_gold && <span className="small muted"> · عهدة ذهب</span>}{s.requires_approval && <span className="small muted"> · اعتماد مشرف</span>}</div></li>)}
            </ol>
          </Card>
        )}
        {tab === 'custody' && (
          <div className="card"><Table rows={custodies} columns={[
            ['العهدة', 'custody_no'], ['المرحلة', 'stage_name'], ['العامل', 'worker_name'], ['الوزن', (c) => <span className="n">{fmtW(c.weight_issued)}</span>], ['النسبة', (c) => fmtPct(c.loss_rate_snapshot)],
            ['المرتجع', (c) => <span className="n">{fmtW(c.returned_weight)}</span>], ['البقايا', (c) => <span className="n">{fmtW(c.scrap_weight)}</span>], ['العجز', (c) => <span className="n">{fmtW(c.actual_loss)}</span>],
            ['غير الطبيعي', (c) => <span className="n">{fmtW(c.abnormal_loss)}</span>], ['العهدة', (c) => <StatusBadge map={CUSTODY_STATUS} value={c.status} />],
            ['التسوية', (c) => (c.settlement_status ? <StatusBadge map={SETTLEMENT_STATUS} value={c.settlement_status} /> : '—')], ['التاريخ', (c) => fmtDT(c.issued_at)],
          ]} /></div>
        )}
        {tab === 'files' && (
          <div className="grid">
            <Card title="الملفات" actions={can('orders.manage', 'design.manage', 'orders.advance') && (
              <div className="hrow gap">
                <Select value={f.kind || 'design'} onChange={setv('kind')} options={[['design', 'تصميم'], ['model3d', 'ملف 3D'], ['reference', 'مرجع'], ['sketch', 'رسم يدوي'], ['execution', 'صورة تنفيذ'], ['other', 'أخرى']]} style={{ width: 140 }} />
                <label className="btn btn-outline-secondary btn-sm">رفع ملفات<input type="file" multiple hidden onChange={upload} /></label>
              </div>
            )}>
              <div className="files">{files.map((x) => (
                <a key={x.id} href={fileUrl(x.path)} target="_blank" rel="noreferrer">{x.mime?.startsWith('image') ? <img src={fileUrl(x.path)} alt="" /> : <div className="doc">{(x.original_name || '').split('.').pop()?.toUpperCase()}</div>}
                  <span>{x.original_name}<br /><span className="muted">{x.kind}{x.customer_visible ? ' · ظاهر للعميل' : ''}</span></span></a>
              ))}</div>
            </Card>
            {can('design.manage') && o.customer_id && (
              <Card title="اعتماد التصميم من العميل" actions={<Badge tone={o.design_status === 'approved' ? 'ok' : 'warn'}>{DESIGN_STATUS[o.design_status]}</Badge>}>
                <div className="hrow gap wrap">
                  <Btn onClick={() => open('design', { file_ids: files.filter((x) => ['design', 'model3d'].includes(x.kind)).map((x) => x.id) })} disabled={!files.some((x) => ['design', 'model3d'].includes(x.kind))}>إرسال التصميم للعميل</Btn>
                  {designs.some((d) => d.status === 'pending') && <Btn kind="ghost" onClick={() => open('designRecord', { decision: 'approved' })}>تسجيل قرار العميل (هاتفياً/حضورياً)</Btn>}
                </div>
                <Table rows={designs} columns={[['أرسل', (d) => fmtDT(d.sent_at)], ['بواسطة', 'sent_by_name'], ['الحالة', (d) => DESIGN_STATUS[d.status] || d.status], ['ملاحظة العميل', 'customer_note'], ['تاريخ القرار', (d) => fmtDT(d.decided_at)]]} />
              </Card>
            )}
          </div>
        )}
        {tab === 'stones' && <div className="card"><Table rows={stones} empty="لا توجد أحجار مرتبطة" columns={[['الدفعة', 'lot_no'], ['النوع', 'stone_type'], ['الحركة', (s) => ({ issue: 'تسليم', return: 'مرتجع', used: 'مركب', lost: 'مفقود', reversal: 'عكس' }[s.kind] || s.kind)], ['قيراط', 'carats'], ['العدد', 'count'], ['العامل', 'worker_name'], ['التاريخ', (s) => fmtDT(s.created_at)]]} /></div>}
        {tab === 'log' && <div className="card"><Table rows={log} columns={[['التاريخ', (l) => fmtDT(l.created_at)], ['المرحلة', 'stage_name'], ['الحدث', 'event'], ['العامل', 'worker_name'], ['المستخدم', 'user_name'], ['ملاحظة', 'note'], ['للعميل', (l) => (l.customer_visible ? '✓' : '')]]} /></div>}
        {tab === 'finance' && <div className="card"><Table rows={invoices} empty="لا توجد فواتير" columns={[['الفاتورة', (i) => <Link className="link" to={`/admin/invoices/${i.id}`}>{i.invoice_no}</Link>], ['النوع', (i) => (i.invoice_type === 'invoice' ? 'فاتورة' : 'إشعار دائن')], ['الإجمالي', (i) => fmtMoney(i.total)]]} /></div>}
        {tab === 'overview' && gold.length > 0 && <Card title="أرصدة ذهب الطلب" className="mt"><Kv items={gold.map((g) => [`${LOCS[g.loc_type]} - ${g.name}`, `${fmtW(g.balance, 4)} جم`])} /></Card>}
      </div>

      <Modal open={modal === 'allocate'} onClose={() => setModal(null)} title="تسجيل ذهب على الطلب">
        <Field label="الوزن (جم)"><WeightInput big value={f.weight || ''} onChange={setv('weight')} autoFocus /></Field>
        <Field label="المصدر"><Select value={f.source} onChange={setv('source')} options={[['vault', 'من خزنة المصنع'], ['customer', 'ذهب مستلم من العميل']]} /></Field>
        <Field label="ملاحظة"><Input value={f.note || ''} onChange={setv('note')} /></Field>
        <Btn loading={busy} onClick={() => act('allocate', f, 'تم تسجيل الذهب على الطلب')}>تسجيل</Btn>
      </Modal>
      <Modal open={modal === 'assign'} onClose={() => setModal(null)} title="إسناد الطلب لعامل">
        <Field label="العامل"><Select value={f.worker_id} onChange={setv('worker_id')} placeholder="بدون" options={(lookups?.workers || []).map((w) => [w.id, `${w.full_name} (${w.employee_no || ''})`])} /></Field>
        <Btn loading={busy} onClick={() => act('assign', f, 'تم الإسناد')}>حفظ</Btn>
      </Modal>
      <Modal open={modal === 'final'} onClose={() => setModal(null)} title="الوزن النهائي">
        <p className="small muted">رصيد ذهب الطلب: {fmtW(orderBal, 4)} جم{Number(stonesGrams.used) > 0 ? ` · أحجار مركبة ${fmtW(stonesGrams.used)} جم (تخصم تلقائياً)` : ''}</p>
        <Field label="الوزن النهائي على الميزان (جم)"><WeightInput big value={f.weight || ''} onChange={setv('weight')} autoFocus /></Field>
        <Field label="سبب الفرق (إلزامي عند الاختلاف عن الرصيد)"><Input value={f.note || ''} onChange={setv('note')} /></Field>
        <Btn loading={busy} onClick={() => act('final-weight', f, 'تم تسجيل الوزن النهائي')}>حفظ</Btn>
      </Modal>
      <Modal open={modal === 'deliver'} onClose={() => setModal(null)} title="تسليم الطلب للعميل">
        <p>سيخرج الذهب ({fmtW(orderBal, 4)} جم) من المصنع ويُقفل الطلب.</p>
        <Field label="ملاحظة التسليم (اسم المستلم...)"><Input value={f.note || ''} onChange={setv('note')} /></Field>
        <Btn kind="ok" loading={busy} onClick={() => act('deliver', f, 'تم التسليم وإقفال الطلب')}>تأكيد التسليم</Btn>
      </Modal>
      <Modal open={modal === 'quote'} onClose={() => setModal(null)} title="عرض أجور التصنيع للعميل">
        <div className="grid g2">
          <Field label="طريقة الاحتساب"><Select value={f.labor_method} onChange={setv('labor_method')} options={Object.entries(METHODS).filter(([k]) => k !== 'manual')} /></Field>
          <Field label="الأجرة (ر.س)"><Input inputMode="decimal" value={f.labor_rate} onChange={setv('labor_rate')} /></Field>
          <Field label="الوزن التقريبي"><WeightInput value={f.approx_weight} onChange={setv('approx_weight')} /></Field>
          <Field label="موعد التسليم المتوقع"><Input type="date" value={f.due_date} onChange={setv('due_date')} /></Field>
        </div>
        <Field label="ملاحظات العرض"><Textarea value={f.note || ''} onChange={setv('note')} /></Field>
        <p className="small muted">العرض لأجور التصنيع فقط ولا يشمل قيمة الذهب.</p>
        <Btn loading={busy} onClick={() => act('quote', f, 'تم إرسال العرض للعميل')}>إرسال العرض</Btn>
      </Modal>
      <Modal open={modal === 'labor'} onClose={() => setModal(null)} title="أجور تصنيع الطلب">
        <Field label="الطريقة"><Select value={f.labor_method} onChange={setv('labor_method')} placeholder="—" options={Object.entries(METHODS)} /></Field>
        <Field label="الأجرة (ر.س)" hint={f.labor_method === 'manual' ? 'الأجرة اليدوية تتطلب اعتماد الإدارة قبل الفوترة' : ''}><Input inputMode="decimal" value={f.labor_rate} onChange={setv('labor_rate')} /></Field>
        <Btn loading={busy} onClick={() => run(async () => { await api.put(`/orders/${o.id}`, f); setModal(null); reload(); }, 'تم الحفظ')}>حفظ</Btn>
      </Modal>
      <Modal open={modal === 'design'} onClose={() => setModal(null)} title="إرسال التصميم للعميل">
        <p className="small">سيتم إرسال {f.file_ids?.length} ملف للعميل لاعتمادها إلكترونياً.</p>
        <Field label="رسالة للعميل"><Textarea value={f.message || ''} onChange={setv('message')} /></Field>
        <Btn loading={busy} onClick={() => act('design/send', f, 'أرسل التصميم للعميل')}>إرسال</Btn>
      </Modal>
      <Modal open={modal === 'designRecord'} onClose={() => setModal(null)} title="تسجيل قرار العميل">
        <Field label="القرار"><Select value={f.decision} onChange={setv('decision')} options={[['approved', 'معتمد'], ['changes_requested', 'تعديل مطلوب'], ['rejected', 'مرفوض']]} /></Field>
        <Field label="توثيق القرار (كيف ومتى) *"><Textarea value={f.note || ''} onChange={setv('note')} /></Field>
        <Btn loading={busy} onClick={() => act('design/record', f, 'تم التسجيل')}>حفظ</Btn>
      </Modal>
      <SplitModal open={modal === 'split'} o={o} f={f} setF={setF} busy={busy} routes={lookups?.routes || []} onClose={() => setModal(null)}
        onSubmit={() => run(async () => { const r = await api.post(`/orders/${o.id}/split`, f); setModal(null); setF({}); reload(); return r; }, 'تم فصل الكمية في بند جديد')} />
      <ReasonModal open={modal === 'cancel'} title="إلغاء الطلب" label="سبب الإلغاء (يعاد رصيد ذهب الطلب للخزنة)" danger busy={busy} onClose={() => setModal(null)} onSubmit={(reason) => act('cancel', { reason }, 'تم الإلغاء')} />
      <ReasonModal open={modal === 'reject'} title="رفض الطلب" label="سبب الرفض (يظهر للعميل)" danger busy={busy} onClose={() => setModal(null)} onSubmit={(reason) => act('reject', { reason }, 'تم الرفض')} />
      <ReasonModal open={modal === 'force'} title="تجاوز شروط المرحلة" label="سبب التجاوز (يسجل في سجل التدقيق)" danger busy={busy} onClose={() => setModal(null)} onSubmit={(reason) => act('advance', { force: true, reason }, 'تم التجاوز')} />
    </Page>
  );
}

/** بنود الطلب الواحد: كل بند أمر إنتاج مستقل (يمكن أن يختلف مساره: صب / بدون صب …) */
function OrderItems({ o, siblings, canManage, busy, onSplit, onStartAll }) {
  const nav = useNavigate();
  const list = siblings.length ? siblings : [{ id: o.id, order_no: o.order_no, title: o.title, quantity: o.quantity, status: o.status, approx_weight: o.approx_weight, route_name: o.route_name, stage_name: o.stage_name }];
  const canSplit = canManage && ['pending_review', 'quoted'].includes(o.status) && o.quantity > 1;
  const startable = canManage && o.cart_ref && siblings.some((x) => ['pending_review', 'approved'].includes(x.status));
  return (
    <Card className="mb" title={<span>بنود الطلب {o.cart_ref && <b dir="ltr">{o.cart_ref}</b>} <span className="small text-body-secondary fw-normal">({list.length})</span></span>}
      actions={<>
        {canSplit && <Btn size="sm" kind="ghost" onClick={onSplit}>✂ تقسيم الكمية</Btn>}
        {startable && <Btn size="sm" loading={busy} onClick={onStartAll}>بدء إنتاج الطلب كاملاً</Btn>}
      </>}>
      <Table rows={list} onRow={(x) => x.id !== o.id && nav(`/orders/${x.id}`)} rowClass={(x) => (x.id === o.id ? 'row-current' : '')} columns={[
        ['البند', (x) => <b dir="ltr">{x.order_no}</b>], ['الوصف', 'title'], ['الكمية', 'quantity'],
        ['الوزن التقريبي', (x) => <span className="n">{fmtW(x.approx_weight)}</span>], ['المسار', (x) => x.route_name || '—'],
        ['الحالة', (x) => <StatusBadge map={STATUS} value={x.status} />], ['المرحلة', (x) => x.stage_name || '—'],
      ]} />
      {canSplit && <div className="small text-body-secondary mt-2">التقسيم يفصل جزءاً من كمية هذا البند في بند مستقل بمساره الخاص (مثلاً جزء يحتاج صب وجزء لا) — متاح قبل بدء الإنتاج.</div>}
    </Card>
  );
}

function SplitModal({ open, o, f, setF, busy, routes, onClose, onSubmit }) {
  const q = Number(f.quantity || 0);
  const ok = q >= 1 && q < o.quantity;
  return (
    <Modal open={open} onClose={onClose} title={`تقسيم كمية ${o.order_no}`}>
      <div className="small text-body-secondary mb-2">الكمية الحالية: <b>{o.quantity}</b>. الجزء المفصول يصبح بنداً جديداً بنفس رقم الطلب، ويُقسم الوزن التقريبي والأجرة بالنسبة.</div>
      <div className="grid g2">
        <Field label="الكمية المفصولة *"><Input inputMode="numeric" value={f.quantity || ''} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/\D/g, '') })} autoFocus /></Field>
        <Field label="مسار الإنتاج للجزء المفصول"><Select value={f.route_id || ''} onChange={(e) => setF({ ...f, route_id: e.target.value })} options={routes.map((r) => [String(r.id), r.name])} /></Field>
      </div>
      {q > 0 && <div className="alert alert-light py-2 small">بعد التقسيم: هذا البند <b>{Math.max(0, o.quantity - q)}</b> قطعة، والبند الجديد <b>{q}</b> قطعة.</div>}
      <div className="hrow end"><Btn loading={busy} disabled={!ok} onClick={onSubmit}>تقسيم</Btn></div>
    </Modal>
  );
}
