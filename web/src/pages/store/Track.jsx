import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDate, fmtDT, fmtMoney, fmtW, STATUS, DESIGN_STATUS, METHODS, COLORS } from '../../format.js';
import { Btn, Card, Field, Kv, Loader, Page, StatusBadge, Textarea, useAction, useFetch, ErrorBox } from '../../ui.jsx';

/** متابعة الطلب للعميل - بدون معلومات داخلية */
export default function Track() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/store/orders/${id}`, { live: ['orders'] });
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { order: o, stages, current_seq: seq, history, files, designs, invoices } = data;
  const pending = designs.find((d) => d.status === 'pending');
  const decide = (decision) => run(async () => { await api.post(`/store/orders/${o.id}/design`, { decision, note }); setNote(''); reload(); }, 'تم إرسال قراركم');
  return (
    <Page title={`الطلب ${o.order_no}`} subtitle={o.title} back="/store/orders">
      <div className="grid g2 mb">
        <Card title="تفاصيل الطلب" actions={<StatusBadge map={STATUS} value={o.status} />}>
          {o.product_image && <img src={fileUrl(o.product_image)} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />}
          <Kv items={[o.branch_name && ['الفرع', o.branch_name], ['العيار', o.karat], ['اللون', COLORS[o.color] || o.color], ['الكمية', o.quantity], ['المقاس', o.size], ['الوزن', o.final_weight ? `${fmtW(o.final_weight)} جم (نهائي)` : o.approx_weight ? `${fmtW(o.approx_weight)} جم (تقريبي)` : '—'],
            ['أجور التصنيع', o.labor_rate ? `${fmtMoney(o.labor_rate)} ${METHODS[o.labor_method] || ''}` : '—'], ['التقدير', o.labor_estimate ? fmtMoney(o.labor_estimate) : '—'],
            ['المرحلة الحالية', o.stage_name], ['موعد التسليم المتوقع', fmtDate(o.due_date)], o.design_approval_required && ['التصميم', DESIGN_STATUS[o.design_status]]]} />
        </Card>
        <Card title={`نسبة الإنجاز ${o.progress}%`}>
          <div className="progress mb"><div style={{ width: `${o.progress}%` }} /></div>
          <ol className="timeline">
            {stages.map((s) => <li key={s.seq} className={o.status === 'delivered' || s.seq < seq ? 'done' : s.seq === seq ? 'cur' : ''}>{s.name}</li>)}
            {!stages.length && <li className="cur">{STATUS[o.status]?.[0]}</li>}
          </ol>
        </Card>
      </div>
      {o.status === 'quoted' && (
        <Card title="عرض أجور التصنيع بانتظار موافقتكم" className="mb">
          <Kv items={[['طريقة الاحتساب', METHODS[o.labor_method]], ['الأجرة', fmtMoney(o.labor_rate)], ['التقدير الإجمالي', fmtMoney(o.labor_estimate)], ['موعد التسليم', fmtDate(o.due_date)], ['ملاحظات', o.quote_note]]} />
          <p className="small muted mt">العرض لأجور التصنيع فقط ولا يشمل قيمة الذهب. الأجرة النهائية تحسب على الوزن الفعلي.</p>
          <div className="hrow gap mt">
            <Btn kind="ok" loading={busy} onClick={() => run(async () => { await api.post(`/store/orders/${o.id}/quote`, { decision: 'accept' }); reload(); }, 'تمت الموافقة - تحول الطلب لأمر إنتاج')}>موافقة على العرض</Btn>
            <Btn kind="ghost" loading={busy} onClick={() => { const r = window.prompt('سبب الرفض (اختياري)'); if (r !== null) run(async () => { await api.post(`/store/orders/${o.id}/quote`, { decision: 'reject', note: r }); reload(); }, 'تم رفض العرض'); }}>رفض</Btn>
          </div>
        </Card>
      )}
      {pending && (
        <Card title="التصميم بانتظار اعتمادكم" className="mb">
          {pending.message && <p className="mb">{pending.message}</p>}
          <div className="files mb">{files.filter((f) => pending.file_ids.includes(f.id)).map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path)} alt="" /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></a>)}</div>
          <Field label="ملاحظاتكم (إلزامية عند طلب التعديل أو الرفض)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="hrow gap wrap mt">
            <Btn kind="ok" loading={busy} onClick={() => decide('approved')}>اعتماد التصميم</Btn>
            <Btn kind="ghost" loading={busy} onClick={() => decide('changes_requested')}>طلب تعديل</Btn>
            <Btn kind="danger" loading={busy} onClick={() => decide('rejected')}>رفض التصميم</Btn>
          </div>
        </Card>
      )}
      <div className="grid g2">
        <Card title="سجل المراحل">
          <ol className="timeline">{history.map((h, i) => <li key={i} className="done"><div><b>{h.stage_name || STATUS[h.event]?.[0] || ''}</b> <span className="small">{h.event === 'entered' ? 'بدأت' : h.event === 'completed' ? 'اكتملت' : ''} {h.note || ''}</span><div className="small muted">{fmtDT(h.created_at)}</div></div></li>)}</ol>
        </Card>
        <div className="grid">
          {files.length > 0 && <Card title="الملفات والصور"><div className="files">{files.map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path)} alt="" /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></a>)}</div></Card>}
          {designs.length > 0 && <Card title="سجل اعتماد التصميم">{designs.map((d) => <div key={d.id} className="small hrow between"><span>{DESIGN_STATUS[d.status] || d.status} {d.customer_note ? `- ${d.customer_note}` : ''}</span><span className="muted">{fmtDT(d.decided_at || d.sent_at)}</span></div>)}</Card>}
          {invoices.length > 0 && <Card title="الفواتير">{invoices.map((i) => <Link key={i.id} to={`/store/invoices/${i.id}`} className="link hrow between"><span>{i.invoice_no}</span><span>{fmtMoney(i.total)}</span></Link>)}</Card>}
        </div>
      </div>
    </Page>
  );
}
