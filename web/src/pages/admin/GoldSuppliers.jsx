import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT } from '../../format.js';
import { Badge, Btn, Field, Input, Loader, Modal, Page, Table, WeightInput, useAction, useFetch } from '../../ui.jsx';

const KIND = { gold_out: ['صرف ذهب', 'warn'], findings_in: ['استلام خامات', 'ok'], gold_in: ['استلام ذهب للخزنة', 'ok'], opening: ['رصيد افتتاحي', 'muted'] };

/** موردو الخامات: الذهب الصافي المصروف لهم مقدماً والخامات المستلمة منهم */
export default function GoldSuppliers() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/inventory/suppliers', { live: ['gold_ledger'] });
  const [m, setM] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const manage = can('inventory.manage', 'findings.manage');
  const save = (fn, msg) => run(async () => { await fn(); setM(null); reload(); }, msg);
  return (
    <Page title="الرصيد المقدم للموردين" subtitle={`الإجمالي ${fmtW(data.total)} جم صافي عيار 24`} back="/admin"
      actions={manage && <Btn kind="ghost" onClick={() => setM({ type: 'edit', name: '', supplies: '', phone: '' })}>إضافة مورد</Btn>}>
      <div className="small text-body-secondary mb-2">يزيد الرصيد عند «صرف» ذهب للمورد من المخزون، وينقص عند إضافة رصيد خامات «من مورد» في صفحة خامات المصنع (بالصافي عيار 24). الرصيد السالب يعني أن المصنع مدين للمورد.</div>
      <div className="grid g4 mb">
        {data.suppliers.map((s) => (
          <div key={s.id} className="card card-body">
            <div className="d-flex justify-content-between"><b>{s.name}</b>{!s.active && <Badge tone="muted">موقوف</Badge>}</div>
            {s.supplies && <span className="small text-body-secondary">{s.supplies}</span>}
            <div className="fs-3 fw-bold n" dir="ltr" style={Number(s.balance) < 0 ? { color: 'var(--bad)' } : undefined}>{fmtW(s.balance)} <small className="fs-6 text-body-secondary">جم</small></div>
            <span className="small text-body-secondary">صُرف <b dir="ltr">{fmtW(s.gold_out)}</b> · استُلم <b dir="ltr">{fmtW(s.received)}</b></span>
            {manage && <div className="d-flex gap-2 mt-2 flex-wrap">
              <Btn size="sm" kind="ghost" onClick={() => setM({ type: 'edit', ...s })}>تعديل</Btn>
              {can('inventory.manage') && <Btn size="sm" kind="ghost" onClick={() => setM({ type: 'opening', id: s.id, name: s.name })}>رصيد افتتاحي</Btn>}
            </div>}
          </div>
        ))}
      </div>
      <div className="card"><Table rows={data.entries} empty="لا توجد حركات" columns={[
        ['الرقم', (e) => <span dir="ltr">{e.entry_no}</span>], ['المورد', 'supplier_name'],
        ['الحركة', (e) => <Badge tone={KIND[e.kind][1]}>{KIND[e.kind][0]}</Badge>],
        ['الوزن', (e) => <span className="n">{fmtW(e.weight)} <small>ع{e.karat}</small></span>],
        ['الصافي', (e) => <b className="n">{['findings_in', 'gold_in'].includes(e.kind) ? '−' : '+'}{fmtW(e.pure)}</b>],
        ['البيان', (e) => e.note || e.finding_name || '—'], ['بواسطة', 'created_by_name'], ['التاريخ', (e) => fmtDT(e.created_at)],
      ]} /></div>
      <Modal open={!!m} onClose={() => setM(null)} title={m?.type === 'opening' ? `رصيد افتتاحي — ${m.name}` : m?.id ? 'تعديل مورد' : 'إضافة مورد'}>
        {m?.type === 'edit' && <>
          <Field label="اسم المورد *"><Input value={m.name || ''} onChange={(e) => setM({ ...m, name: e.target.value })} /></Field>
          <Field label="الخامات التي يوردها"><Input value={m.supplies || ''} onChange={(e) => setM({ ...m, supplies: e.target.value })} placeholder="سلاسل، روبتشن…" /></Field>
          <Field label="الجوال"><Input dir="ltr" value={m.phone || ''} onChange={(e) => setM({ ...m, phone: e.target.value })} /></Field>
          {m.id && <label className="d-flex gap-2 mb-3"><input type="checkbox" checked={m.active !== false} onChange={(e) => setM({ ...m, active: e.target.checked })} /> نشط</label>}
          <Btn loading={busy} disabled={!m.name} onClick={() => save(() => (m.id ? api.put(`/inventory/suppliers/${m.id}`, m) : api.post('/inventory/suppliers', m)), 'تم الحفظ')}>حفظ</Btn>
        </>}
        {m?.type === 'opening' && <>
          <Field label="الذهب الصافي عيار 24 لدى المورد (جم) *"><WeightInput big value={m.weight || ''} onChange={(v) => setM({ ...m, weight: v })} /></Field>
          <Field label="البيان *"><Input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder="رصيد مقدم قبل النظام" /></Field>
          <Btn loading={busy} disabled={!m.weight || !m.note} onClick={() => save(() => api.post(`/inventory/suppliers/${m.id}/opening`, m), 'تم التسجيل')}>تسجيل</Btn>
        </>}
      </Modal>
    </Page>
  );
}
