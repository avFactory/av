import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtDate, fmtDT, fmtMoney, fmtW, STATUS, DESIGN_STATUS, METHODS, COLORS, stoneItems } from '../../format.js';
import { Btn, Card, Field, Kv, Loader, Page, StatusBadge, Textarea, useAction, useFetch, ErrorBox } from '../../ui.jsx';

/** متابعة الطلب للعميل - بدون معلومات داخلية */
export default function Track() {
  const { id } = useParams();
  const { data, error, reload } = useFetch(`/store/orders/${id}`, { live: ['orders'] });
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const nav = useNavigate();
  const [run, busy] = useAction();
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loader />;
  const { order: o, stages, current_seq: seq, items = [], files, designs, invoices, notes = [] } = data;
  const deletable = ['pending_review', 'quoted'].includes(o.status);
  const pendingItems = items.filter((x) => ['pending_review', 'quoted'].includes(x.status));
  const del = (all) => {
    const msg = all ? `حذف الطلب كاملاً (${pendingItems.length} منتجات لم تُقبل بعد)؟` : `حذف ${o.title} (${o.order_no}) من الطلب؟`;
    if (!window.confirm(`${msg}\nلا يمكن التراجع عن الحذف.`)) return;
    run(async () => {
      await api.post(`/store/orders/${o.id}/cancel`, { all });
      const left = all ? [] : items.filter((x) => x.id !== o.id && x.status !== 'cancelled');
      nav(left.length ? `/store/orders/${left[0].id}` : '/store/orders', { replace: true });
    }, 'تم حذف الطلب');
  };
  const sendNote = () => run(async () => { await api.post(`/store/orders/${o.id}/note`, { note: msg }); setMsg(''); reload(); }, 'تم إرسال ملاحظتك للمصنع');
  const pending = designs.find((d) => d.status === 'pending');
  const decide = (decision) => run(async () => { await api.post(`/store/orders/${o.id}/design`, { decision, note }); setNote(''); reload(); }, 'تم إرسال قراركم');
  return (
    <Page title={`الطلب ${o.cart_ref || o.order_no}`} subtitle={items.length > 1 ? `${items.length} منتجات` : o.title} back="/store/orders"
      actions={deletable && <div className="d-flex gap-2 flex-wrap">
        {items.length > 1 && <Btn kind="ghost" loading={busy} onClick={() => del(false)}>🗑 حذف هذا المنتج</Btn>}
        <Btn kind="danger" loading={busy} onClick={() => del(items.length > 1 && pendingItems.length > 1)}>{items.length > 1 && pendingItems.length > 1 ? '🗑 حذف الطلب كاملاً' : '🗑 حذف الطلب'}</Btn>
      </div>}>
      {deletable && <div className="alert alert-light border small py-2">الطلب لم يُقبل بعد — يمكنك حذفه. بعد قبول المصنع وبدء التجهيز لا يمكن الحذف.</div>}
      <OrderItems items={items} current={o.id} />
      <div className="grid g2 mb">
        <Card title="تفاصيل الطلب" actions={<StatusBadge map={STATUS} value={o.status} />}>
          <Kv items={[items.length > 1 && ['البند', o.order_no], items.length > 1 && ['المنتج', o.title], o.branch_name && ['الفرع', o.branch_name], ['العيار', o.karat], ['اللون', COLORS[o.color] || o.color], ...stoneItems(o), ['الكمية', o.quantity], ['المقاس', o.size], ['الوزن', o.final_weight ? `${fmtW(o.final_weight)} جم (نهائي)` : o.approx_weight ? `${fmtW(o.approx_weight)} جم (تقريبي)` : '—'],
            ['أجور التصنيع', o.labor_rate ? `${fmtMoney(o.labor_rate)} ${METHODS[o.labor_method] || ''}` : '—'], ['التقدير', o.labor_estimate ? fmtMoney(o.labor_estimate) : '—'],
            ['المرحلة الحالية', o.stage_name], ['موعد التسليم المتوقع', fmtDate(o.due_date)], o.design_approval_required && ['التصميم', DESIGN_STATUS[o.design_status]]]} />
          {['approved', 'in_production'].includes(o.status) && (
            <div className="border-top mt-3 pt-3">
              <Field label="ملاحظة على الطلب"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} maxLength={1000} placeholder="تعديل بسيط، استفسار، طلب استعجال… تصل للمصنع فوراً" /></Field>
              <div className="hrow end mt-2"><Btn loading={busy} disabled={!msg.trim()} onClick={sendNote}>إرسال الملاحظة</Btn></div>
              {notes.length > 0 && (
                <div className="d-grid gap-2 mt-3">
                  <b className="small">ملاحظاتك السابقة</b>
                  {notes.map((n, i) => <div key={i} className="border rounded-3 p-2 small"><div>{n.note}</div><div className="muted">{fmtDT(n.created_at)}</div></div>)}
                </div>
              )}
            </div>
          )}
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
          <div className="files mb">{files.filter((f) => pending.file_ids.includes(f.id)).map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path, 400)} alt="" /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></a>)}</div>
          <Field label="ملاحظاتكم (إلزامية عند طلب التعديل أو الرفض)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="hrow gap wrap mt">
            <Btn kind="ok" loading={busy} onClick={() => decide('approved')}>اعتماد التصميم</Btn>
            <Btn kind="ghost" loading={busy} onClick={() => decide('changes_requested')}>طلب تعديل</Btn>
            <Btn kind="danger" loading={busy} onClick={() => decide('rejected')}>رفض التصميم</Btn>
          </div>
        </Card>
      )}
      {(files.length > 0 || designs.length > 0 || invoices.length > 0) && (
        <div className="grid g2">
          {files.length > 0 && <Card title="الملفات والصور"><div className="files">{files.map((f) => <a key={f.id} href={fileUrl(f.path)} target="_blank" rel="noreferrer">{f.mime?.startsWith('image') ? <img src={fileUrl(f.path, 400)} alt="" /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></a>)}</div></Card>}
          {designs.length > 0 && <Card title="سجل اعتماد التصميم">{designs.map((d) => <div key={d.id} className="small hrow between"><span>{DESIGN_STATUS[d.status] || d.status} {d.customer_note ? `- ${d.customer_note}` : ''}</span><span className="muted">{fmtDT(d.decided_at || d.sent_at)}</span></div>)}</Card>}
          {invoices.length > 0 && <Card title="الفواتير">{invoices.map((i) => <Link key={i.id} to={`/store/invoices/${i.id}`} className="link hrow between"><span>{i.invoice_no}</span><span>{fmtMoney(i.total)}</span></Link>)}</Card>}
        </div>
      )}
    </Page>
  );
}

/** المنتجات المطلوبة: صورة مصغّرة وبجانبها التفاصيل المختصرة */
function OrderItems({ items, current }) {
  const nav = useNavigate();
  if (!items.length) return null;
  return (
    <Card title={`المنتجات المطلوبة (${items.length})`} className="mb">
      <div className="order-items">
        {items.map((x) => (
          <button key={x.id} type="button" className={`order-item ${x.id === current ? 'on' : ''}`} onClick={() => x.id !== current && nav(`/store/orders/${x.id}`)}>
            <span className="order-item-img">{x.image ? <img src={fileUrl(x.image, 200)} alt="" loading="lazy" /> : '◇'}</span>
            <span className="order-item-info">
              <b>{x.title}</b>
              <span className="small muted" dir="ltr" style={{ textAlign: 'right' }}>{x.order_no}</span>
              <span className="small">عيار {x.karat} · {COLORS[x.color] || x.color} · الكمية {x.quantity}{x.size ? ` · مقاس ${x.size}` : ''}</span>
              <span className="small muted">{x.final_weight ? `الوزن ${fmtW(x.final_weight)} جم` : x.approx_weight ? `الوزن التقريبي ${fmtW(x.approx_weight)} جم` : ''}{x.stage_name ? `${x.final_weight || x.approx_weight ? ' · ' : ''}${x.stage_name}` : ''}</span>
            </span>
            <span className="order-item-st"><StatusBadge map={STATUS} value={x.status} /></span>
          </button>
        ))}
      </div>
    </Card>
  );
}
