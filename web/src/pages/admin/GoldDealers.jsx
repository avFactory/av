import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT } from '../../format.js';
import { Badge, Btn, Field, Input, Loader, Modal, Page, Table, WeightInput, useAction, useFetch } from '../../ui.jsx';

/** جمل الصافي: رصيد ذهب المصنع (صافي 24) لدى ديوان الذهب والجنيه العربي وغيرهم */
export default function GoldDealers() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/inventory/dealers', { live: ['gold_ledger'] });
  const [m, setM] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const save = (url, body, msg) => run(async () => { await api.post(url, body); setM(null); reload(); }, msg);
  return (
    <Page title="الذهب لدى جمل الصافي" subtitle={`الإجمالي ${fmtW(data.total)} جم صافي عيار 24`} back="/admin"
      actions={can('inventory.manage') && <Btn kind="ghost" onClick={() => setM({ type: 'new' })}>إضافة جمل</Btn>}>
      <div className="small text-body-secondary mb-2">يزيد الرصيد عند اعتماد سداد عميل عن طريق الجمل، وينقص عند سحب الذهب للخزنة من «المخزون ← إضافة ذهب للخزنة ← من جمل الصافي».</div>
      <div className="grid g4 mb">
        {data.dealers.map((d) => (
          <div key={d.id} className="card card-body">
            <div className="d-flex justify-content-between"><b>{d.name}</b>{!d.active && <Badge tone="muted">موقوف</Badge>}</div>
            <div className="fs-3 fw-bold n" dir="ltr">{fmtW(d.balance)} <small className="fs-6 text-body-secondary">جم</small></div>
            {d.phone && <a className="small" href={`tel:${d.phone}`} dir="ltr">{d.phone}</a>}
            {can('inventory.manage') && <Btn size="sm" kind="ghost" className="mt-2" onClick={() => setM({ type: 'deposit', id: d.id, name: d.name })}>إيداع / رصيد افتتاحي</Btn>}
          </div>
        ))}
      </div>
      <div className="card"><Table rows={data.entries} empty="لا توجد حركات" columns={[
        ['الرقم', (e) => <span dir="ltr">{e.entry_no}</span>], ['الجمل', 'dealer_name'],
        ['الحركة', (e) => (e.kind === 'deposit' ? <Badge tone="ok">إيداع</Badge> : <Badge tone="warn">سحب للخزنة</Badge>)],
        ['الوزن الصافي', (e) => <b className="n" style={e.reversed ? { textDecoration: 'line-through' } : undefined}>{e.kind === 'deposit' ? '+' : '−'}{fmtW(e.weight)}</b>],
        ['العميل', (e) => e.shop_name || '—'], ['البيان', (e) => <>{e.note}{e.reversed && <Badge tone="bad">ملغي</Badge>}</>],
        ['بواسطة', 'created_by_name'], ['التاريخ', (e) => fmtDT(e.created_at)],
      ]} /></div>
      <Modal open={!!m} onClose={() => setM(null)} title={m?.type === 'new' ? 'إضافة جمل صافي' : `إيداع لدى ${m?.name || ''}`}>
        {m?.type === 'new' && <>
          <Field label="الاسم *"><Input value={m.name || ''} onChange={(e) => setM({ ...m, name: e.target.value })} /></Field>
          <Field label="الجوال"><Input dir="ltr" value={m.phone || ''} onChange={(e) => setM({ ...m, phone: e.target.value })} /></Field>
          <Btn loading={busy} disabled={!m.name} onClick={() => save('/inventory/dealers', m, 'تمت الإضافة')}>حفظ</Btn>
        </>}
        {m?.type === 'deposit' && <>
          <Field label="الوزن الصافي عيار 24 (جم) *"><WeightInput big value={m.weight || ''} onChange={(v) => setM({ ...m, weight: v })} /></Field>
          <Field label="البيان *"><Input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder="مثال: رصيد افتتاحي / ذهب مشترى باقٍ لدى الجمل" /></Field>
          <Btn loading={busy} disabled={!m.weight || !m.note} onClick={() => save(`/inventory/dealers/${m.id}/deposit`, m, 'تم الإيداع')}>تسجيل</Btn>
        </>}
      </Modal>
    </Page>
  );
}
