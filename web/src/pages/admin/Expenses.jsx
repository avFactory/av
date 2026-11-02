import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney, fmtDate } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Table, useAction, useFetch } from '../../ui.jsx';

export default function Expenses() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/finance/expenses');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  return (
    <Page title="المصاريف التشغيلية" subtitle={`الإجمالي: ${fmtMoney(data.reduce((s, e) => s + Number(e.amount), 0))}`} actions={can('expenses.manage') && <Btn onClick={() => setF({ expense_date: new Date().toISOString().slice(0, 10) })}>مصروف جديد</Btn>}>
      <div className="card"><Table rows={data} columns={[['التاريخ', (e) => fmtDate(e.expense_date)], ['التصنيف', 'category'], ['الوصف', 'description'], ['المستفيد', 'paid_to'], ['المبلغ', (e) => fmtMoney(e.amount)], ['الضريبة', (e) => fmtMoney(e.vat_amount)], ['بواسطة', 'created_by_name'],
        ['', (e) => can('expenses.manage') && <Btn size="sm" kind="ghost" onClick={() => window.confirm('حذف المصروف؟') && run(async () => { await api.del(`/finance/expenses/${e.id}`); reload(); }, 'تم الحذف')}>حذف</Btn>]]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title="مصروف جديد">
        {f && <>
          {[['category', 'التصنيف *', 'رواتب، كهرباء، صيانة…'], ['description', 'الوصف'], ['paid_to', 'المستفيد'], ['amount', 'المبلغ *'], ['vat_amount', 'ضريبة المدخلات']].map(([k, l, ph]) => <Field key={k} label={l}><Input value={f[k] || ''} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          <Field label="التاريخ"><Input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
          <Btn loading={busy} onClick={() => run(async () => { await api.post('/finance/expenses', f); setF(null); reload(); }, 'تم الحفظ')}>حفظ</Btn>
        </>}
      </Modal>
    </Page>
  );
}
