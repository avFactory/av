import { useState } from 'react';
import { api, fileUrl, qs } from '../../api.js';
import StatementTable, { StatementSummary, SUB_ST, money2, gold3 } from '../../components/StatementView.jsx';
import { fmtDT } from '../../format.js';
import { Badge, Btn, Card, Field, Input, Loader, Page, Select, Tabs, Textarea, WeightInput, useAction, useFetch } from '../../ui.jsx';

const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');
const EMPTY = { kind: 'money', amount: '', method: 'transfer', weight: '', karat: '21', reference: '', paid_at: '', note: '', file: null };

/** كشف حساب العميل في المتجر + رفع مستندات السداد */
export default function Statement() {
  const [p, setP] = useState({ from: '', to: '', branch: '' });
  const { data: st, reload } = useFetch(`/store/statement${qs(p)}`, { deps: [p.from, p.to, p.branch] });
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  if (!st) return <Loader />;
  const submit = () => run(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (k !== 'file' && v !== '' && v != null) fd.append(k, v);
    fd.append('document', f.file);
    await api.post('/store/submissions', fd);
    setF(null); reload();
  }, 'تم رفع المستند — سيُضاف لحسابكم بعد مراجعة المصنع');
  const brs = st.branches || [];
  const tabs = brs.length ? [['', 'كل الفروع'], ...(st.customer.branches_only ? [] : [['main', 'الحساب الرئيسي']]), ...brs.map((b) => [String(b.id), b.name])] : null;
  const ok = f && f.file && (f.kind === 'money' ? Number(f.amount) > 0 : Number(f.weight) > 0);
  return (
    <Page title={`كشف الحساب${st.my_branch ? ` — ${st.my_branch}` : ''}`} actions={<>
      <Btn kind="ghost" onClick={() => window.print()}>طباعة</Btn>
      <Btn onClick={() => setF({ ...EMPTY })}>رفع مستند سداد</Btn>
    </>}>
      <div className="print-only st-print-head"><b>كشف حساب: {st.customer.shop_name}</b><span> · الفترة: {p.from || 'من البداية'} — {p.to || 'حتى اليوم'}</span></div>
      {tabs && <div className="no-print"><Tabs value={p.branch} onChange={(v) => setP({ ...p, branch: v })} tabs={tabs} /></div>}
      <div className="hrow gap wrap mb no-print" style={{ alignItems: 'end' }}>
        <Field label="من"><Input type="date" value={p.from} onChange={(x) => setP({ ...p, from: x.target.value })} /></Field>
        <Field label="إلى"><Input type="date" value={p.to} onChange={(x) => setP({ ...p, to: x.target.value })} /></Field>
        {(p.from || p.to) && <Btn kind="ghost" onClick={() => setP({ from: '', to: '' })}>كل الفترات</Btn>}
      </div>
      <StatementSummary st={st} />
      {f && (
        <Card className="mb no-print" title="رفع مستند سداد" actions={<Btn size="sm" kind="ghost" onClick={() => setF(null)}>إلغاء</Btn>}>
          <Field label="نوع السداد"><div className="chips">{[['money', 'تحويل / دفع مبلغ'], ['gold', 'تسليم ذهب']].map(([k, l]) => <button key={k} type="button" className={`chip ${f.kind === k ? 'on' : ''}`} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div></Field>
          <div className="grid g2">
            {f.kind === 'money' ? <>
              <Field label="المبلغ (ر.س) *"><Input dir="ltr" inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: num(x.target.value) })} /></Field>
            </> : <>
              <Field label="وزن الذهب (جم) *"><WeightInput value={f.weight} onChange={(v) => setF({ ...f, weight: v })} /></Field>
              <Field label="العيار"><div className="chips">{['18', '21', '24'].map((k) => <button key={k} type="button" className={`chip ${f.karat === k ? 'on' : ''}`} onClick={() => setF({ ...f, karat: k })}>{k}</button>)}</div></Field>
            </>}
          </div>
          <Field label="المستند (صورة الحوالة أو سند التسليم) *"><input type="file" accept="image/*,.pdf" className="form-control" onChange={(x) => setF({ ...f, file: x.target.files[0] || null })} /></Field>
          <Field label="ملاحظات"><Textarea value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} rows={2} /></Field>
          <div className="hrow end mt"><Btn loading={busy} disabled={!ok} onClick={submit}>رفع المستند</Btn></div>
        </Card>
      )}
      {st.submissions.length > 0 && (
        <Card className="mb no-print" title="مستندات السداد المرفوعة">
          <div className="d-grid gap-2">{st.submissions.map((s) => (
            <div key={s.id} className={`sub-row ${s.status}`}>
              <a href={fileUrl(s.document_path)} target="_blank" rel="noreferrer" className="sub-doc">{s.mime?.startsWith('image') ? <img src={fileUrl(s.document_path, 200)} alt="" /> : <span>PDF</span>}</a>
              <div className="sub-main">
                <b>{s.kind === 'money' ? `مبلغ ${money2(s.amount)} ر.س` : `ذهب ${gold3(s.weight)} جم عيار ${s.karat}`}</b>
                <span className="small text-body-secondary"><span dir="ltr">{s.submission_no}</span> · {fmtDT(s.created_at)}{s.reference ? ` · ${s.reference}` : ''}</span>
                {s.review_note && <span className="small">{s.status === 'rejected' ? 'سبب الرفض: ' : ''}{s.review_note}</span>}
              </div>
              <div className="sub-act"><Badge tone={SUB_ST[s.status][1]}>{SUB_ST[s.status][0]}</Badge></div>
            </div>
          ))}</div>
        </Card>
      )}
      <Card pad={false}><StatementTable st={st} /></Card>
    </Page>
  );
}
