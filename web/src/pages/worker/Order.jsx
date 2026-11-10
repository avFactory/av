import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDT, COLORS, stoneItems } from '../../format.js';
import { Btn, Card, Field, Loader, Textarea, useAction, useFetch, Kv, ErrorBox } from '../../ui.jsx';
import { useAuth } from '../../auth.jsx';
import OrderGroupItems from '../../components/OrderGroupItems.jsx';

/** طلب مسند للعامل (مثل التصميم): مشاهدة التفاصيل، رفع الملفات، إنهاء المهمة */
export default function WOrder() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/w/orders/${id}`, { live: ['orders'] });
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const { me } = useAuth();
  if (error) return <div className="wk-body"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { order: o, files, custodies, log, group } = data;
  const isDesign = o.stage?.kind === 'design';
  const upload = (fl) => run(async () => {
    const fd = new FormData();
    for (const f of fl) fd.append('files', f);
    fd.append('kind', isDesign ? 'design' : 'execution');
    await api.post(`/w/orders/${o.id}/files`, fd);
    reload();
  }, 'تم الرفع');
  const uploadInternal = (fl) => run(async () => {
    const fd = new FormData();
    for (const f of fl) fd.append('files', f);
    await api.post(`/w/orders/${o.id}/internal`, fd);
    reload();
  }, 'تم رفع الصورة الداخلية');
  return (
    <div className="wk-body">
      <Link to="/w" className="back">→ مهامي</Link>
      <Card title={o.order_no}>
        {files.find((f) => f.mime?.startsWith('image')) && (() => { const im = files.find((f) => f.mime?.startsWith('image')); return <a href={fileUrl(im.path)} target="_blank" rel="noreferrer" className="wk-hero-img"><img src={fileUrl(im.path, 800)} alt={o.title} /></a>; })()}
        <Kv items={[['الوصف', o.title], ['المرحلة', o.stage?.name], ['المادة', o.material], o.color && ['اللون', COLORS[o.color] || o.color], ['الكمية', o.quantity], ['المقاس', o.size], ['الوزن التقريبي', o.approx_weight], ...stoneItems(o), ['ملاحظات', o.notes]]} />
      </Card>
      <OrderGroupItems items={group} current={o.id} />
      <Card title="الملفات والتصاميم">
        <div className="files">{files.map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path, 400)} alt="" /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.kind === 'internal' ? '🔒 داخلية · ' : ''}{f.original_name}</span></a>)}</div>
        {o.assigned_to_me && <label className="btn btn-outline-secondary mt">{isDesign ? 'رفع ملفات التصميم (صور / 3D)' : 'رفع صور التنفيذ'}<input type="file" multiple hidden onChange={(e) => e.target.files.length && upload(e.target.files)} /></label>}
        {me?.is_3d && <label className="btn btn-outline-dark mt ms-2">🔒 رفع صورة داخلية (3D)<input type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files.length) uploadInternal(e.target.files); e.target.value = ''; }} /></label>}
      </Card>
      {o.assigned_to_me && (
        <Card title="ملاحظة / طلب توضيح">
          <Field><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="hrow gap mt">
            <Btn kind="ghost" disabled={!note} onClick={() => run(async () => { await api.post(`/w/orders/${o.id}/note`, { note }); setNote(''); reload(); }, 'تم الحفظ')}>حفظ</Btn>
            <Btn kind="dark" disabled={!note} onClick={() => run(async () => { await api.post(`/w/orders/${o.id}/note`, { note, clarification: true }); setNote(''); reload(); }, 'أرسل للمشرف')}>طلب توضيح</Btn>
          </div>
        </Card>
      )}
      {o.assigned_to_me && !o.stage?.handles_gold && o.stage_state !== 'pending_approval' && (
        <Btn size="xl" kind="ok" loading={busy} onClick={() => run(async () => { await api.post(`/w/orders/${o.id}/finish`); reload(); }, 'تم إنهاء المهمة')}>إنهاء المرحلة</Btn>
      )}
      {o.stage_state === 'pending_approval' && <div className="alert alert-info">بانتظار اعتماد المشرف</div>}
      {custodies.length > 0 && <Card title="عهدي على هذا الطلب">{custodies.map((c) => <div key={c.id} className="hrow between small"><Link className="link" to={`/w/custody/${c.id}`}>{c.custody_no}</Link><span>{c.stage_name}</span><span dir="ltr">{c.weight_issued}</span></div>)}</Card>}
      <Card title="سجلي على الطلب">{log.map((l, i) => <div key={i} className="small hrow between"><span>{l.stage_name} · {l.note || l.event}</span><span className="muted">{fmtDT(l.created_at)}</span></div>)}</Card>
    </div>
  );
}
