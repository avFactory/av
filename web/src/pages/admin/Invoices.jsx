import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney, fmtDate } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, useAction, useFetch, Badge } from '../../ui.jsx';

export default function Invoices() {
  const nav = useNavigate();
  const { can, lookups } = useAuth();
  const [sp] = useSearchParams();
  const { data, reload } = useFetch('/finance/invoices');
  const [f, setF] = useState(null);
  const [orders, setOrders] = useState([]);
  const [preview, setPreview] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (sp.get('new')) setF({ customer_id: sp.get('customer') || '', order_ids: sp.get('order') ? [Number(sp.get('order'))] : [], extra_lines: [] }); }, [sp]);
  useEffect(() => {
    if (!f?.customer_id) { setOrders([]); return; }
    api.get(`/orders${qs({ customer_id: f.customer_id })}`).then((r) => setOrders(r.filter((o) => ['in_production', 'ready', 'delivered'].includes(o.status))));
  }, [f?.customer_id]);
  useEffect(() => { setPreview(null); }, [f]);
  const addLine = () => setF({ ...f, extra_lines: [...f.extra_lines, { kind: 'stones', description: '', qty: '1', unit: 'وحدة', unit_price: '' }] });
  const updLine = (i, k, v) => setF({ ...f, extra_lines: f.extra_lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const vat = Number(lookups?.settings?.vat_rate ?? 15);
  const sub = preview?.lines.reduce((s, l) => s + Number(l.amount), 0) || 0;
  return (
    <Page title="الفواتير" subtitle="فواتير أجور التصنيع فقط مع ضريبة القيمة المضافة" actions={<>
      <a className="btn btn-outline-secondary" href="/api/finance/reports/revenue.xlsx">تصدير Excel</a>
      {can('invoices.manage') && <Btn onClick={() => setF({ customer_id: '', order_ids: [], extra_lines: [] })}>فاتورة جديدة</Btn>}
    </>}>
      {!data ? <Loader /> : <div className="card"><Table rows={data} onRow={(i) => nav(`/admin/invoices/${i.id}`)} columns={[
        ['الرقم', (i) => <b>{i.invoice_no}</b>], ['النوع', (i) => (i.invoice_type === 'invoice' ? 'فاتورة' : <Badge tone="warn">إشعار دائن</Badge>)], ['العميل', 'shop_name'], ['التاريخ', (i) => fmtDate(i.issue_date)],
        ['الأجور قبل الضريبة', (i) => fmtMoney(i.subtotal)], ['الضريبة', (i) => fmtMoney(i.vat_amount)], ['الإجمالي', (i) => <b>{fmtMoney(i.total)}</b>], ['المدفوع', (i) => fmtMoney(i.paid)],
        ['', (i) => (i.credited_by ? <Badge tone="bad">ملغاة بـ {i.credited_by}</Badge> : null)],
      ]} /></div>}
      <Modal open={!!f} onClose={() => setF(null)} title="فاتورة أجور تصنيع" wide>
        {f && <>
          <Field label="العميل"><Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value, order_ids: [] })} placeholder="—" options={(lookups?.customers || []).map((c) => [c.id, c.shop_name])} /></Field>
          <Field label="الطلبات (أجور التصنيع تحسب تلقائياً)">
            <div className="chips">{orders.map((o) => { const on = f.order_ids.includes(o.id); return <button type="button" key={o.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setF({ ...f, order_ids: on ? f.order_ids.filter((x) => x !== o.id) : [...f.order_ids, o.id] })}>{o.order_no} · {o.title}</button>; })}{!orders.length && <span className="muted small">لا توجد طلبات</span>}</div>
          </Field>
          <Field label="بنود مستقلة إضافية (ألماس / أحجار / خدمات) - منفصلة عن أجور التصنيع">
            {f.extra_lines.map((l, i) => (
              <div key={i} className="hrow gap wrap" style={{ marginBottom: 6 }}>
                <Select value={l.kind} onChange={(e) => updLine(i, 'kind', e.target.value)} options={[['stones', 'ألماس/أحجار'], ['service', 'خدمة'], ['other', 'أخرى']]} style={{ width: 130 }} />
                <Input placeholder="الوصف" value={l.description} onChange={(e) => updLine(i, 'description', e.target.value)} style={{ flex: 2, minWidth: 160 }} />
                <Input placeholder="الكمية" value={l.qty} onChange={(e) => updLine(i, 'qty', e.target.value)} style={{ width: 80 }} />
                <Input placeholder="الوحدة" value={l.unit} onChange={(e) => updLine(i, 'unit', e.target.value)} style={{ width: 90 }} />
                <Input placeholder="سعر الوحدة" value={l.unit_price} onChange={(e) => updLine(i, 'unit_price', e.target.value)} style={{ width: 110 }} />
                <Btn size="sm" kind="ghost" onClick={() => setF({ ...f, extra_lines: f.extra_lines.filter((_, j) => j !== i) })}>×</Btn>
              </div>
            ))}
            <button type="button" className="link small" onClick={addLine}>+ إضافة بند</button>
          </Field>
          <Field label="ملاحظات"><Input value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {preview && (
            <div>
              <Table rows={preview.lines} columns={[['البند', 'description'], ['الكمية', 'qty'], ['الوحدة', 'unit'], ['السعر', (l) => fmtMoney(l.unit_price)], ['المبلغ', (l) => fmtMoney(l.amount)]]} />
              <div className="hrow gap end mt"><span>المجموع {fmtMoney(sub)}</span><span>الضريبة {vat}% ≈ {fmtMoney(sub * vat / 100)}</span><b>الإجمالي ≈ {fmtMoney(sub * (1 + vat / 100))}</b></div>
            </div>
          )}
          <div className="hrow gap end">
            <Btn kind="ghost" loading={busy} onClick={() => run(async () => setPreview(await api.post('/finance/invoices/preview', f)))}>معاينة</Btn>
            <Btn loading={busy} disabled={!preview} onClick={() => run(async () => { const inv = await api.post('/finance/invoices', f); setF(null); reload(); nav(`/admin/invoices/${inv.id}`); }, 'صدرت الفاتورة')}>إصدار الفاتورة</Btn>
          </div>
        </>}
      </Modal>
    </Page>
  );
}
