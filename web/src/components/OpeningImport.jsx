import { useState } from 'react';
import { api } from '../api.js';
import { fmtW, fmtMoney } from '../format.js';
import { Badge, Btn, Modal, Table, useAction } from '../ui.jsx';

const signed = (v, f) => (v > 0 ? <span>{f(v)} <small className="text-body-secondary">عليه</small></span> : v < 0 ? <span style={{ color: 'var(--ok)' }}>{f(-v)} <small>له</small></span> : '—');

/** رفع الأرصدة الافتتاحية للعملاء من Excel: ذهب صافي عيار 24 ومبالغ */
export default function OpeningImport({ onClose, onDone }) {
  const [st, setSt] = useState({ step: 1 });
  const [run, busy] = useAction();
  const parse = (file) => run(async () => { const fd = new FormData(); fd.append('file', file); const r = await api.post('/finance/opening-import/parse', fd); setSt({ step: 2, ...r, replace: false, skip: false }); });
  const plan = st.plan || [];
  const errs = plan.filter((p) => p.status === 'error'), exists = plan.filter((p) => p.status === 'exists'), news = plan.filter((p) => p.status === 'new');
  const ok = plan.filter((p) => p.status === 'new' || (p.status === 'exists' && st.replace));
  const sum = (k) => ok.reduce((a, p) => a + p[k], 0);
  const commit = () => run(async () => {
    const r = await api.post('/finance/opening-import/commit', { rows: st.rows, replace: st.replace, skip_errors: st.skip });
    onDone?.(); onClose();
    return r;
  }, 'تم رفع الأرصدة الافتتاحية');
  return (
    <Modal open onClose={onClose} title="رفع الأرصدة الافتتاحية للعملاء (Excel)" wide>
      {st.step === 1 && <>
        <div className="alert alert-info small mb-0">
          الأعمدة: <b>اسم العميل</b>، <b>الجوال</b>، <b>الفرع</b> (اختياري)، <b>الذهب عيار 24</b> (جم صافي)، <b>المبلغ</b> (ر.س)، التاريخ والبيان (اختياري).<br />
          <b>الموجب = على العميل</b>، <b>والسالب = للعميل</b>. يُطابق العميل بالجوال ثم بالاسم، وتراجع النتيجة قبل الاعتماد. الرصيد الافتتاحي لا يحرّك ذهب الخزنة.
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <a className="btn btn-outline-secondary" href="/api/finance/opening-import/template.xlsx">⬇ تحميل النموذج</a>
          <label className="btn btn-primary">{busy ? 'جارٍ القراءة…' : 'اختيار الملف'}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files[0] && parse(e.target.files[0])} /></label>
        </div>
      </>}
      {st.step === 2 && <>
        <div className="stone-stats">
          <div className="stone-stat main"><span>الذهب عيار 24 (صافي)</span><b dir="ltr">{fmtW(sum('gold'))}</b><small>جم — {ok.length} عميل</small></div>
          <div className="stone-stat"><span>المبالغ</span><b dir="ltr">{fmtMoney(sum('money'))}</b><small>ر.س</small></div>
          <div className="stone-stat"><span>جديد</span><b>{news.length}</b><small>بدون رصيد سابق</small></div>
          <div className="stone-stat"><span>لديهم رصيد سابق</span><b>{exists.length}</b><small>{st.replace ? 'سيُستبدل' : 'سيُتجاوز'}</small></div>
          {errs.length > 0 && <div className="stone-stat"><span>أخطاء</span><b style={{ color: 'var(--bad)' }}>{errs.length}</b><small>{st.skip ? 'ستُتجاوز' : 'صححها'}</small></div>}
        </div>
        <Table rows={plan} rowClass={(p) => (p.status === 'error' ? 'row-warn' : '')} columns={[
          ['في الملف', (p) => <span>{p.input.shop}{p.input.branch ? ` — ${p.input.branch}` : ''}<div className="small text-body-secondary" dir="ltr">{p.input.phone}</div></span>],
          ['العميل في النظام', (p) => (p.shop_name ? <b>{p.shop_name}{p.branch_name ? ` — ${p.branch_name}` : ''}</b> : '—')],
          ['الذهب عيار 24', (p) => signed(p.gold, (v) => `${fmtW(v)} جم`)],
          ['المبلغ', (p) => signed(p.money, fmtMoney)],
          ['الحالة', (p) => (p.status === 'error' ? <span className="small text-danger">{p.errors.join('، ')}</span>
            : p.status === 'exists' ? <Badge tone="warn">رصيد سابق: {fmtW(p.existing.gold)} جم / {fmtMoney(p.existing.money)}</Badge> : <Badge tone="ok">جديد</Badge>)],
        ]} />
        {exists.length > 0 && <label className="d-flex gap-2"><input type="checkbox" checked={st.replace} onChange={(e) => setSt({ ...st, replace: e.target.checked })} /> استبدال الرصيد الافتتاحي الموجود ({exists.length}) بقيم الملف</label>}
        {errs.length > 0 && <label className="d-flex gap-2"><input type="checkbox" checked={st.skip} onChange={(e) => setSt({ ...st, skip: e.target.checked })} /> تجاهل الصفوف التي بها أخطاء ({errs.length}) ورفع الباقي</label>}
        <div className="hrow gap end">
          <Btn kind="ghost" onClick={() => setSt({ step: 1 })}>ملف آخر</Btn>
          <Btn loading={busy} disabled={!ok.length || (errs.length > 0 && !st.skip)} onClick={commit}>اعتماد ({ok.length})</Btn>
        </div>
      </>}
    </Modal>
  );
}
