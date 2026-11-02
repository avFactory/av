import { useState } from 'react';
import { qs } from '../../api.js';
import { fmtDT } from '../../format.js';
import { Btn, Field, Input, Loader, Page, Table, useFetch } from '../../ui.jsx';

export default function Audit() {
  const [f, setF] = useState({ action: '', entity: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const { data } = useFetch(`/admin/audit${qs(applied)}`);
  return (
    <Page title="سجل التدقيق" subtitle="كل العمليات: الإنشاء، التعديل، الحذف، التصحيح، الاعتماد - غير قابل للتعديل" actions={<a className="btn btn-dark" href={`/api/admin/audit.xlsx${qs(applied)}`}>Excel</a>}>
      <form className="card card-b row gap wrap mb" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
        <Field label="الإجراء"><Input value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="custody, loss, invoice…" dir="ltr" /></Field>
        <Field label="الكيان"><Input value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} dir="ltr" /></Field>
        <Field label="من"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="إلى"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Btn type="submit">بحث</Btn>
      </form>
      {!data ? <Loader /> : <div className="card"><Table rows={data} columns={[['التاريخ', (a) => fmtDT(a.created_at)], ['المستخدم', 'user_name'], ['الإجراء', (a) => <code>{a.action}</code>], ['الكيان', (a) => `${a.entity} #${a.entity_id ?? ''}`], ['التفاصيل', (a) => <code className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block', maxWidth: 520 }}>{a.details ? JSON.stringify(a.details) : ''}</code>], ['IP', 'ip']]} /></div>}
    </Page>
  );
}
