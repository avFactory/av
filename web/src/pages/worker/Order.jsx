import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDT } from '../../format.js';
import { Btn, Card, Field, Loader, Textarea, useAction, useFetch, Kv, ErrorBox } from '../../ui.jsx';

/** طلب مسند للعامل (مثل التصميم): مشاهدة التفاصيل، رفع الملفات، إنهاء المهمة */
export default function WOrder() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/w/orders/${id}`, { live: ['orders'] });
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  if (error) return <div className="wk-body"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { order: o, files, custodies, log } = data;
  const isDesign = o.stage?.kind === 'design';
  const upload = (fl) => run(async () => {
    const fd = new FormData();
    for (const f of fl) fd.append('files', f);
    fd.append('kind', isDesign ? 'design' : 'execution');
    await api.post(`/w/orders/${o.id}/files`, fd);
    reload();
  }, 'تم الرفع');
  return (
    <div className="wk-body">
      <Link to="/w" className="back">→ مهامي</Link>
      <Card title={o.order_no}>
        <Kv items={[['الوصف', o.title], ['المرحلة', o.stage?.name], ['المادة', o.material], ['الكمية', o.quantity], ['المقاس', o.size], ['الوزن التقريبي', o.approx_weight], ['ملاحظات', o.notes]]} />
      </Card>
      <Card title="الملفات والتصاميم">
        <div className="files">{files.map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path)} alt="" /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></a>)}</div>
        {o.assigned_to_me && <label className="btn btn-ghost mt">{isDesign ? 'رفع ملفات التصميم (صور / 3D)' : 'رفع صور التنفيذ'}<input type="file" multiple hidden onChange={(e) => e.target.files.length && upload(e.target.files)} /></label>}
      </Card>
      {o.assigned_to_me && (
        <Card title="ملاحظة / طلب توضيح">
          <Field><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row gap mt">
            <Btn kind="ghost" disabled={!note} onClick={() => run(async () => { await api.post(`/w/orders/${o.id}/note`, { note }); setNote(''); reload(); }, 'تم الحفظ')}>حفظ</Btn>
            <Btn kind="dark" disabled={!note} onClick={() => run(async () => { await api.post(`/w/orders/${o.id}/note`, { note, clarification: true }); setNote(''); reload(); }, 'أرسل للمشرف')}>طلب توضيح</Btn>
          </div>
        </Card>
      )}
      {o.assigned_to_me && !o.stage?.handles_gold && o.stage_state !== 'pending_approval' && (
        <Btn size="xl" kind="ok" loading={busy} onClick={() => run(async () => { await api.post(`/w/orders/${o.id}/finish`); reload(); }, 'تم إنهاء المهمة')}>إنهاء المرحلة</Btn>
      )}
      {o.stage_state === 'pending_approval' && <div className="alert alert-info">بانتظار اعتماد المشرف</div>}
      {custodies.length > 0 && <Card title="عهدي على هذا الطلب">{custodies.map((c) => <div key={c.id} className="row between small"><Link className="link" to={`/w/custody/${c.id}`}>{c.custody_no}</Link><span>{c.stage_name}</span><span dir="ltr">{c.weight_issued}</span></div>)}</Card>}
      <Card title="سجلي على الطلب">{log.map((l, i) => <div key={i} className="small row between"><span>{l.stage_name} · {l.note || l.event}</span><span className="muted">{fmtDT(l.created_at)}</span></div>)}</Card>
    </div>
  );
}
