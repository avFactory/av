import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import StatementTable, { StatementSummary, SUB_ST, money2, gold3 } from '../../components/StatementView.jsx';
import { fmtDT } from '../../format.js';
import { Badge, Btn, Card, Field, Input, Loader, Modal, Page, ReasonModal, Select, Textarea, WeightInput, useAction, useFetch } from '../../ui.jsx';

const KINDS = [['opening', 'رصيد افتتاحي'], ['gold_payment', 'سداد ذهب من العميل'], ['money_adjust', 'تسوية مبالغ'], ['gold_adjust', 'تسوية ذهب']];
const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/** مراجعة مستندات السداد: اعتماد (يُضاف للحساب) أو رفض بسبب */
export function SubmissionsList({ list, onDone, showCustomer }) {
  const { can } = useAuth();
  const [rej, setRej] = useState(null);
  const [run, busy] = useAction();
  if (!list.length) return null;
  return (
    <>
      <div className="d-grid gap-2">
        {list.map((s) => (
          <div key={s.id} className={`sub-row ${s.status}`}>
            <a href={fileUrl(s.document_path)} target="_blank" rel="noreferrer" className="sub-doc">
              {s.mime?.startsWith('image') ? <img src={fileUrl(s.document_path, 200)} alt="" /> : <span>PDF</span>}
            </a>
            <div className="sub-main">
              <b>{s.kind === 'money' ? `مبلغ ${money2(s.amount)} ر.س` : `ذهب ${gold3(s.weight)} جم عيار ${s.karat}`}</b>
              <span className="small text-body-secondary">{showCustomer && <><Link to={`/admin/customers/${s.customer_id}/statement`}>{s.shop_name}</Link>{s.branch_name ? ` — ${s.branch_name}` : ''} · </>}
                <span dir="ltr">{s.submission_no}</span>{s.paid_at ? ` · بتاريخ ${String(s.paid_at).slice(0, 10)}` : ''}{s.reference ? ` · مرجع ${s.reference}` : ''} · رُفع {fmtDT(s.created_at)}</span>
              {s.note && <span className="small">{s.note}</span>}
              {s.review_note && <span className="small text-body-secondary">ملاحظة المراجعة: {s.review_note}</span>}
            </div>
            <div className="sub-act">
              <Badge tone={SUB_ST[s.status][1]}>{SUB_ST[s.status][0]}</Badge>
              {s.status === 'pending' && can('payments.manage') && <>
                <Btn size="sm" kind="ok" loading={busy} onClick={() => window.confirm(`اعتماد المستند ${s.submission_no} وإضافته لحساب العميل؟`) && run(async () => { await api.post(`/finance/submissions/${s.id}/approve`, {}); onDone(); }, 'تم الاعتماد وإضافته للحساب')}>اعتماد</Btn>
                <Btn size="sm" kind="ghost" onClick={() => setRej(s)}>رفض</Btn>
              </>}
            </div>
          </div>
        ))}
      </div>
      <ReasonModal open={!!rej} title={`رفض المستند ${rej?.submission_no || ''}`} label="سبب الرفض (يظهر للعميل)" danger busy={busy} onClose={() => setRej(null)}
        onSubmit={(reason) => run(async () => { await api.post(`/finance/submissions/${rej.id}/reject`, { reason }); setRej(null); onDone(); }, 'تم الرفض')} />
    </>
  );
}

/** كشف حساب العميل للموظفين */
export default function CustomerStatement() {
  const { id } = useParams();
  const { can } = useAuth();
  const [p, setP] = useState({ from: '', to: '' });
  const { data: st, reload } = useFetch(`/finance/customers/${id}/statement${qs(p)}`, { deps: [p.from, p.to], live: ['payments', 'invoices'] });
  const [e, setE] = useState(null);
  const [rev, setRev] = useState(null);
  const [run, busy] = useAction();
  if (!st) return <Loader />;
  const c = st.customer;
  const saveEntry = () => run(async () => {
    const f = new FormData();
    const gw = e.gold_dir === 'credit' ? { gold_credit: e.gold } : { gold_debit: e.gold };
    const mw = e.money_dir === 'credit' ? { money_credit: e.money } : { money_debit: e.money };
    const body = { kind: e.kind, entry_date: e.date, description: e.description, karat: e.karat, ...(e.kind === 'gold_payment' ? { gold_credit: e.gold } : { ...(e.money ? mw : {}), ...(e.gold ? gw : {}) }) };
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== '') f.append(k, v);
    if (e.file) f.append('document', e.file);
    await api.post(`/finance/customers/${id}/entries`, f);
    setE(null); reload();
  }, 'تم تسجيل القيد');
  const pending = st.submissions.filter((s) => s.status === 'pending');
  const entryRows = st.rows.filter((r) => r.entry_id);

  return (
    <Page title={`كشف حساب — ${c.shop_name}`} back={`/admin/customers/${id}`} actions={<>
      <a className="btn btn-outline-secondary no-print" href={`/api/finance/customers/${id}/statement.xlsx${qs(p)}`}>Excel</a>
      <Btn kind="ghost" onClick={() => window.print()}>طباعة</Btn>
      {can('payments.manage') && <Btn onClick={() => setE({ kind: 'opening', date: '', money: '', money_dir: 'debit', gold: '', gold_dir: 'debit', karat: '21', description: '', file: null })}>قيد جديد / رصيد افتتاحي</Btn>}
    </>}>
      <div className="print-only st-print-head"><b>كشف حساب العميل: {c.shop_name}</b>{c.vat_number && <span> · الرقم الضريبي {c.vat_number}</span>}<span> · الفترة: {p.from || 'من البداية'} — {p.to || 'حتى اليوم'}</span></div>
      <div className="hrow gap wrap mb no-print" style={{ alignItems: 'end' }}>
        <Field label="من"><Input type="date" value={p.from} onChange={(x) => setP({ ...p, from: x.target.value })} /></Field>
        <Field label="إلى"><Input type="date" value={p.to} onChange={(x) => setP({ ...p, to: x.target.value })} /></Field>
        {(p.from || p.to) && <Btn kind="ghost" onClick={() => setP({ from: '', to: '' })}>كل الفترات</Btn>}
      </div>
      <StatementSummary st={st} />
      {pending.length > 0 && <Card className="mb no-print" title={`مستندات سداد بانتظار المراجعة (${pending.length})`}><SubmissionsList list={pending} onDone={reload} /></Card>}
      <Card pad={false} className="mb"><StatementTable st={st} staff /></Card>
      {can('payments.manage') && entryRows.length > 0 && (
        <details className="card mb no-print"><summary className="p-3 small">القيود اليدوية ({entryRows.length}) — إلغاء قيد خاطئ</summary>
          <div className="p-2 d-grid gap-1">{entryRows.map((r) => <div key={r.entry_id} className="hrow between small border rounded-3 p-2"><span><span dir="ltr">{r.ref}</span> · {r.date} · {r.description}</span><Btn size="sm" kind="ghost" onClick={() => setRev(r)}>إلغاء</Btn></div>)}</div>
        </details>
      )}
      {st.submissions.some((s) => s.status !== 'pending') && (
        <details className="card no-print"><summary className="p-3 small">سجل مستندات السداد</summary><div className="p-2"><SubmissionsList list={st.submissions.filter((s) => s.status !== 'pending')} onDone={reload} /></div></details>
      )}

      <Modal open={!!e} onClose={() => setE(null)} title="قيد على حساب العميل">
        {e && <>
          <Field label="نوع القيد"><div className="chips">{KINDS.map(([k, l]) => <button key={k} type="button" className={`chip ${e.kind === k ? 'on' : ''}`} onClick={() => setE({ ...e, kind: k })}>{l}</button>)}</div></Field>
          <div className="grid g2">
            <Field label="التاريخ"><Input type="date" value={e.date} onChange={(x) => setE({ ...e, date: x.target.value })} /></Field>
            {e.kind !== 'gold_payment' && e.kind !== 'gold_adjust' && (
              <Field label="المبلغ (ر.س)"><div className="d-flex gap-2"><Input dir="ltr" inputMode="decimal" value={e.money} onChange={(x) => setE({ ...e, money: num(x.target.value) })} />
                <Select value={e.money_dir} onChange={(x) => setE({ ...e, money_dir: x.target.value })} options={[['debit', 'مدين (عليه)'], ['credit', 'دائن (له)']]} style={{ maxWidth: 130 }} /></div></Field>
            )}
            {e.kind !== 'money_adjust' && <>
              <Field label={e.kind === 'gold_payment' ? 'وزن الذهب المسدد (جم)' : 'وزن الذهب (جم)'}><div className="d-flex gap-2"><WeightInput value={e.gold} onChange={(v) => setE({ ...e, gold: v })} />
                {e.kind !== 'gold_payment' && <Select value={e.gold_dir} onChange={(x) => setE({ ...e, gold_dir: x.target.value })} options={[['debit', 'مدين (عليه)'], ['credit', 'دائن (له)']]} style={{ maxWidth: 130 }} />}</div></Field>
              <Field label="العيار"><div className="chips">{['18', '21', '24'].map((k) => <button key={k} type="button" className={`chip ${e.karat === k ? 'on' : ''}`} onClick={() => setE({ ...e, karat: k })}>{k}</button>)}</div></Field>
            </>}
          </div>
          <Field label="البيان"><Textarea value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} rows={2} /></Field>
          <Field label="مستند (اختياري)"><input type="file" accept="image/*,.pdf" className="form-control" onChange={(x) => setE({ ...e, file: x.target.files[0] || null })} /></Field>
          {e.kind === 'gold_payment' && <div className="alert alert-light border small py-2">سداد الذهب يُسجَّل دائناً للعميل ويدخل وزنه خزنة المصنع بالعيار المحدد.</div>}
          {e.kind === 'opening' && <div className="alert alert-light border small py-2">الرصيد الافتتاحي: ما على العميل (مدين) أو له (دائن) من النظام السابق — مرة واحدة لكل عميل، ولا يؤثر على مخزون الذهب.</div>}
          <div className="hrow end mt"><Btn loading={busy} disabled={!(Number(e.money) > 0 || Number(e.gold) > 0)} onClick={saveEntry}>تسجيل</Btn></div>
        </>}
      </Modal>
      <ReasonModal open={!!rev} title={`إلغاء القيد ${rev?.ref || ''}`} label="سبب الإلغاء" danger busy={busy} onClose={() => setRev(null)}
        onSubmit={(reason) => run(async () => { await api.post(`/finance/entries/${rev.entry_id}/reverse`, { reason }); setRev(null); reload(); }, 'تم إلغاء القيد')} />
    </Page>
  );
}
