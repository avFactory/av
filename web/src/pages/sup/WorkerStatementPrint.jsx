import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { fmtDate, fmtDT } from '../../format.js';
import { Loader, ErrorBox } from '../../ui.jsx';
import { useAuth } from '../../auth.jsx';
import { StmtSummary, StmtTable } from '../../components/WorkerStatement.jsx';

/** نسخة الطباعة الرسمية لكشف حساب العامل (A4 أفقي): ترويسة المصنع، بيانات العامل، الملخص، الجدول، التواقيع */
export default function WorkerStatementPrint() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { lookups } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const qs = new URLSearchParams([...sp].filter(([k]) => k !== 'auto')).toString();
  useEffect(() => { api.get(`/sup/workers/${id}/statement${qs ? `?${qs}` : ''}`).then(setData).catch(setErr); }, [id, qs]);
  useEffect(() => {
    if (!data || sp.get('auto') !== '1') return;
    const after = () => { try { window.parent.postMessage('page-printed', location.origin); } catch { /* */ } };
    window.addEventListener('afterprint', after, { once: true });
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data, sp]);
  if (err) return <ErrorBox error={err} />;
  if (!data) return <Loader />;
  const w = data.worker;
  const one = !!sp.get('material') || new Set(data.rows.map((r) => r.material_id)).size <= 1;
  const company = lookups?.settings?.company?.name || 'مصنع AV للمجوهرات';
  const matName = sp.get('material') ? (lookups?.materials || []).find((m) => String(m.id) === sp.get('material'))?.name : 'كل العيارات';
  return (
    <div className="stmt-print" dir="rtl">
      <header className="sp-head">
        <div className="sp-brand"><img src="/logo.png" alt="" /><div><b>{company}</b><small>كشف حساب ذهب</small></div></div>
        <div className="sp-title"><h1>كشف حساب {w.kind === 'machine' ? 'ماكينة' : 'عامل'}</h1><small>طُبع {fmtDT(new Date())}</small></div>
      </header>
      <section className="sp-info">
        <div><span>{w.kind === 'machine' ? 'الماكينة' : 'العامل'}</span><b>{w.full_name}</b></div>
        <div><span>الرقم</span><b dir="ltr">{w.employee_no || '—'}</b></div>
        <div><span>التخصص / القسم</span><b>{[w.specialty, w.department].filter(Boolean).join(' · ') || '—'}</b></div>
        <div><span>الفترة</span><b>{data.from || data.to ? `${data.from ? fmtDate(data.from) : 'البداية'} — ${data.to ? fmtDate(data.to) : 'اليوم'}` : 'كل الفترات'}</b></div>
        <div><span>العيار</span><b>{matName}</b></div>
      </section>
      <StmtSummary data={data} />
      <StmtTable data={data} one={one} />
      <section className="sp-final">
        الرصيد النهائي لدى <b>{w.full_name}</b>: {data.totals.balances.length ? data.totals.balances.map((b) => <span key={b.material_id}><b dir="ltr">{Number(b.weight).toFixed(3)}</b> جم {b.name}</span>) : <b>0.000</b>}
        <span>= <b dir="ltr">{Number(data.totals.balance_pure).toFixed(3)}</b> جم صافي عيار 24</span>
      </section>
      <section className="sp-sign">
        <div><span>توقيع {w.kind === 'machine' ? 'المسؤول عن الماكينة' : 'العامل'}</span></div>
        <div><span>توقيع المشرف</span></div>
        <div><span>اعتماد الإدارة</span></div>
      </section>
      <footer className="sp-foot">مدين (له) = ذهب دخل حسابه (مسلَّم منا أو محوّل له من عامل آخر) · دائن (منه) = ذهب خرج من حسابه (مستلم منه لنا أو محوّل لعامل آخر أو عجز مثبت)</footer>
    </div>
  );
}
