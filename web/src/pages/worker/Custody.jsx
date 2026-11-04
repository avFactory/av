import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtW, fmtDT, fmtPct, WORK_STATE, calcLoss, CUSTODY_STATUS, COLORS, stoneItems } from '../../format.js';
import { Btn, Card, Field, Input, Loader, Textarea, WeightInput, useAction, useFetch, Badge, Kv, StatusBadge, Modal } from '../../ui.jsx';

/** شاشة العهدة للعامل: تأكيد الاستلام، بدء/إيقاف العمل، تسجيل الأوزان، رفع الصور، إنهاء المرحلة */
export default function WCustody() {
  const { id } = useParams();
  const { data: tasks, reload } = useFetch('/w/tasks', { live: ['custodies'] });
  const c = tasks?.custodies.find((x) => String(x.id) === id);
  const { data: od, reload: reloadOrder } = useFetch(c?.order_id ? `/w/orders/${c.order_id}` : null, { deps: [c?.order_id] });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [decl, setDecl] = useState(null);
  const [pause, setPause] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  if (!tasks) return <Loader />;
  if (!c) return <div className="wk-body"><div className="alert alert-info">العهدة غير موجودة أو تم استلامها. <Link to="/w" className="link">مهامي</Link></div></div>;
  const d = decl || { returned: c.worker_declared_returned ?? '', scrap: c.worker_declared_scrap ?? '', used: c.worker_declared_used ?? '' };
  const act = (path, body, msg) => run(async () => { await api.post(`/w/custody/${c.id}/${path}`, body); reload(); }, msg);
  const upload = (files) => run(async () => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    await api.post(`/w/orders/${c.order_id}/files`, fd);
    reloadOrder();
  }, 'تم رفع الصور');
  const mainImg = (od?.files || []).find((f) => f.mime?.startsWith('image')) || (c.thumb ? { path: c.thumb } : null);
  const k = d.returned !== '' ? calcLoss(c.weight_issued, d.returned, d.scrap || 0, 0) : null;
  return (
    <div className="wk-body">
      <Link to="/w" className="back">→ مهامي</Link>
      <Card title={<span>{c.order_no}</span>} actions={c.status === 'open' ? <Badge tone="gold">{WORK_STATE[c.work_state]}</Badge> : <StatusBadge map={CUSTODY_STATUS} value={c.status} />}>
        {mainImg && <a href={fileUrl(mainImg.path)} target="_blank" rel="noreferrer" className="wk-hero-img"><img src={fileUrl(mainImg.path)} alt={c.title} /></a>}
        <Kv items={[['الوصف', c.title], ['المرحلة الحالية', c.stage_name], ['المادة', c.material_name], ['الوزن المسلم لك', <span dir="ltr">{fmtW(c.weight_issued)} جم</span>],
          c.kind === 'general' && ['نوع العهدة', 'عهدة عامة (رصيد بدون طلب)'],
          c.kind !== 'general' && ['عدد القطع', c.pieces], ['المقاس', c.size], ['تاريخ التسليم', fmtDT(c.issued_at)], c.order_notes && ['ملاحظات الطلب', c.order_notes], od?.order?.color && ['اللون', COLORS[od.order.color] || od.order.color], ...(od?.order ? stoneItems(od.order) : [])]} />
      </Card>
      {od?.files?.length > 0 && (
        <Card title="التصاميم والصور">
          <div className="files">{od.files.map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path)} alt={f.original_name} /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></a>)}</div>
        </Card>
      )}
      {c.status === 'open' && !c.worker_ack_at && (
        <Card title="قبول استلام العهدة">
          {c.worker_rejected_at && <div className="alert alert-danger mb">رفضتَ هذا التسليم: {c.worker_reject_reason} — بانتظار تصحيح المشرف.</div>}
          <p className="mb">أقر باستلام <b dir="ltr">{fmtW(c.weight_issued)} جم</b> من {c.material_name}{c.kind === 'general' ? <> كعهدة عامة: {c.purpose}</> : <> و<b>{c.pieces}</b> قطعة للطلب {c.order_no}</>}.</p>
          <p className="small muted mb">ضغطك على "قبول" يُسجَّل كتوقيعك الإلكتروني على العهدة بالتاريخ والوقت.</p>
          <div className="grid g2">
            <Btn size="xl" kind="ok" loading={busy} onClick={() => act('ack', {}, 'تم قبول العهدة')}>✓ قبول الاستلام</Btn>
            <Btn size="xl" kind="ghost" onClick={() => setRejectOpen(true)}>رفض (الوزن أو الطلب غير صحيح)</Btn>
          </div>
        </Card>
      )}
      {c.status === 'open' && c.worker_ack_at && c.work_state !== 'finished' && (
        <>
          <div className="grid g2">
            {c.work_state === 'not_started' && <Btn size="xl" onClick={() => act('start', {}, 'بدأ العمل')} loading={busy}>بدء العمل</Btn>}
            {c.work_state === 'in_progress' && <Btn size="xl" kind="ghost" onClick={() => setPause(true)}>إيقاف مؤقت</Btn>}
            {c.work_state === 'paused' && <Btn size="xl" onClick={() => act('resume', {}, 'تم الاستئناف')} loading={busy}>استئناف العمل</Btn>}
          </div>
          <div className="small text-body-secondary">بعد الانتهاء سلّم القطعة والبقايا للمشرف، وهو يزنها ويعتمد الوزن الفعلي.</div>
          <Btn size="xl" kind="ok" loading={busy} disabled={c.work_state === 'not_started'} onClick={() => { if (window.confirm('إنهاء المرحلة وتسليمها للمشرف؟')) act('finish', {}, 'تم إنهاء المرحلة - سلّم القطعة للمشرف'); }}>إنهاء المرحلة وتسليمها</Btn>
        </>
      )}
      {c.work_state === 'finished' && c.status === 'open' && <div className="alert alert-success">أنهيت المرحلة. سلّم القطعة والبقايا للمشرف ليزنها ويعتمد الوزن الفعلي.</div>}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="رفض استلام العهدة">
        <Field label="ما الخطأ؟ *"><Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="مثال: الوزن الفعلي 39.5 جم" autoFocus /></Field>
        <Btn kind="danger" disabled={!rejectReason} loading={busy} onClick={() => act('reject', { reason: rejectReason }, 'أُبلغ المشرف بالرفض').then(() => { setRejectOpen(false); setRejectReason(''); })}>إرسال الرفض للمشرف</Btn>
      </Modal>
      <Modal open={pause} onClose={() => setPause(false)} title="إيقاف العمل">
        <Field label="سبب الإيقاف *"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        <Btn disabled={!reason} loading={busy} onClick={() => act('pause', { reason }, 'تم الإيقاف').then(() => { setPause(false); setReason(''); })}>تأكيد الإيقاف</Btn>
      </Modal>
    </div>
  );
}
