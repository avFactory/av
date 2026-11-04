import { useState } from 'react';
import { qs } from '../../api.js';
import { fmtDT } from '../../format.js';
import { Btn, Input, Loader, Modal, Page, Table, useFetch } from '../../ui.jsx';

// أسماء عربية للكيانات والأفعال والحقول الشائعة في السجل
const ENT = {
  product: 'منتج', order: 'طلب', order_group: 'طلب', custody: 'عهدة', custody_batch: 'دفعة عهد', customer: 'عميل', user: 'مستخدم', employee: 'موظف',
  invoice: 'فاتورة', payment: 'دفعة', settlement: 'تسوية', stage: 'مرحلة', route: 'مسار', role: 'دور', department: 'قسم', settings: 'الإعدادات',
  labor_rate: 'أجرة', stone_lot: 'ألماس', stock_count: 'جرد', cart: 'سلة', worker_advance: 'سلفة', branch: 'فرع', expense: 'مصروف', material: 'مادة',
};
const VERB = {
  create: 'إنشاء', update: 'تعديل', delete: 'حذف', archive: 'أرشفة', visibility: 'إظهار/إخفاء', import: 'استيراد', approve: 'اعتماد', reject: 'رفض', cancel: 'إلغاء',
  start: 'بدء', split: 'تقسيم', group_start: 'بدء طلب كامل', issue: 'تسليم', receive: 'استلام', reverse: 'تصحيح', review: 'مراجعة', order: 'طلب', custom: 'تصميم خاص',
  register: 'تسجيل', login: 'دخول', failed: 'فاشل', change_password: 'تغيير كلمة المرور', note: 'ملاحظة', order_note: 'ملاحظة طلب', order_cancel: 'حذف طلب',
  self_update: 'تعديل بياناته', documents: 'مستندات', quote: 'عرض أجور', deliver: 'تسليم للعميل', advance: 'نقل مرحلة', allocate: 'تخصيص ذهب',
};
const ACT = { login: 'تسجيل دخول', 'login.failed': 'دخول فاشل', change_password: 'تغيير كلمة المرور', register: 'تسجيل محل جديد' };
const actionLabel = (a) => ACT[a] || a.split('.').map((p, i) => (i === 0 ? (ENT[p] || VERB[p] || p) : (VERB[p] || p))).join(' — ');

const FIELD = {
  name: 'الاسم', sku: 'رقم المنتج', title: 'الوصف', product_type: 'النوع', karats: 'العيارات', colors: 'الألوان', sizes: 'المقاسات', description: 'الوصف',
  approx_weight: 'الوزن التقريبي', final_weight: 'الوزن النهائي', labor_method: 'طريقة الأجرة', labor_rate: 'الأجرة', availability: 'التوفر', active: 'ظاهر',
  diamonds: 'الألماس', pearl_weight: 'اللؤلؤ', stone_weight: 'الحجر', zircon_weight: 'الزركون', route_id: 'المسار', stock_qty: 'المخزون', quantity: 'الكمية',
  due_date: 'موعد التسليم', notes: 'ملاحظات', status: 'الحالة', role: 'الدور', full_name: 'الاسم', phone: 'الجوال', shop_name: 'اسم المحل', rate: 'النسبة',
  gold24: 'سعر الذهب', from: 'من مرحلة', to: 'إلى', force: 'تجاوز', order_no: 'رقم الطلب', custody: 'العهدة', count: 'العدد', which: 'الرابط', decision: 'القرار', amount: 'المبلغ', month: 'الشهر', grams: 'الجرامات', new_order: 'البند الجديد', started: 'بدأ', skipped: 'لم يبدأ', password_changed: 'تغيير كلمة المرور', settlements: 'التسويات', worker_id: 'العامل', reason: 'السبب', note: 'ملاحظة', username: 'اسم المستخدم', worker: 'العامل', items: 'البنود', orders: 'الطلبات', quantity_moved: 'الكمية',
};
const SKIP = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'media', 'files', 'remove_media', 'main_media', 'main_new', 'password_hash']);
const VAL = { per_gram: 'لكل جرام', per_piece: 'لكل قطعة', fixed: 'مبلغ ثابت', manual: 'يدوي', made_to_order: 'حسب الطلب', available: 'متوفر', unavailable: 'غير متوفر', yellow: 'أصفر', white: 'أبيض', rose: 'روز', true: 'نعم', false: 'لا' };
const norm0 = (v) => (v == null || v === '' ? '' : Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));
const norm = (v) => { const s = norm0(v); return VAL[s] || s; };
const short = (v, n = 40) => { const s = norm(v).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s || '—'; };

/** التغييرات فقط: الحقل — القيمة القديمة ← الجديدة */
function changes(d) {
  if (!d || typeof d !== 'object') return [];
  if (d.before && d.after && typeof d.before === 'object' && typeof d.after === 'object') {
    return Object.keys(d.after).filter((k) => !SKIP.has(k) && k in d.before && norm(d.before[k]) !== norm(d.after[k]))
      .map((k) => ({ k, label: FIELD[k] || k, from: d.before[k], to: d.after[k] }));
  }
  return Object.entries(d).filter(([k, v]) => !SKIP.has(k) && v != null && v !== '' && (typeof v !== 'object' || Array.isArray(v)))
    .filter(([k, v]) => !(k === 'force' && v === false)).map(([k, v]) => ({ k, label: FIELD[k] || k, to: v }));
}

function Summary({ a, onOpen }) {
  const c = changes(a.details);
  if (!a.details) return <span className="text-body-secondary">—</span>;
  return (
    <div className="audit-sum">
      <div className="audit-lines">
        {c.slice(0, 3).map((x) => (
          <div key={x.k} className="small"><b>{x.label}:</b> {'from' in x ? <><span className="text-body-secondary text-decoration-line-through">{short(x.from, 24)}</span> ← </> : null}<span>{short(x.to)}</span></div>
        ))}
        {!c.length && <span className="small text-body-secondary">لا تغيير في الحقول</span>}
      </div>
      <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onOpen(a)}>{c.length > 3 ? `+${c.length - 3} — ` : ''}التفاصيل</button>
    </div>
  );
}

export default function Audit() {
  const [f, setF] = useState({ q: '', from: '', to: '' });
  const [applied, setApplied] = useState({});
  const [open, setOpen] = useState(null);
  const { data } = useFetch(`/admin/audit${qs(applied)}`);
  const go = (e) => { e?.preventDefault(); setApplied({ action: f.q, from: f.from, to: f.to }); };
  return (
    <Page title="سجل التدقيق" inline actions={
      <form className="audit-filters" onSubmit={go}>
        <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="الإجراء (product، order، login…)" dir="ltr" />
        <label className="small">من <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="small">إلى <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <Btn type="submit">بحث</Btn>
        <a className="btn btn-outline-secondary" href={`/api/admin/audit.xlsx${qs(applied)}`}>Excel</a>
      </form>}>
      <div className="small text-body-secondary mb-2">كل العمليات في النظام (إنشاء، تعديل، حذف، اعتماد، دخول) — غير قابل للتعديل.</div>
      {!data ? <Loader /> : (
        <div className="card audit-table"><Table rows={data} empty="لا توجد عمليات" columns={[
          ['التاريخ', (a) => <span className="text-nowrap small">{fmtDT(a.created_at)}</span>],
          ['المستخدم', (a) => a.user_name || <span className="text-body-secondary">—</span>],
          ['الإجراء', (a) => <span className={`audit-act ${/failed|delete|reject|cancel|reverse/.test(a.action) ? 'bad' : ''}`}>{actionLabel(a.action)}</span>],
          ['الكيان', (a) => <span className="text-nowrap">{ENT[a.entity] || a.entity}{a.entity_id ? <span className="text-body-secondary" dir="ltr"> #{a.entity_id}</span> : ''}</span>],
          ['التغييرات', (a) => <Summary a={a} onOpen={setOpen} />],
          ['IP', (a) => <span className="small text-body-secondary" dir="ltr">{a.ip}</span>],
        ]} /></div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${actionLabel(open.action)} — ${fmtDT(open.created_at)}` : ''} wide>
        {open && <>
          <div className="small text-body-secondary mb-2">{open.user_name || '—'} · {ENT[open.entity] || open.entity} #{open.entity_id} · <span dir="ltr">{open.ip}</span></div>
          {changes(open.details).length > 0 && (
            <Table rows={changes(open.details).map((x) => ({ ...x, id: x.k }))} columns={[
              ['الحقل', (x) => <b>{x.label}</b>],
              ...('from' in (changes(open.details)[0] || {}) ? [['قبل', (x) => <span className="audit-val">{norm(x.from) || '—'}</span>]] : []),
              ['بعد', (x) => <span className="audit-val">{norm(x.to) || '—'}</span>],
            ]} />
          )}
          <details className="mt-2"><summary className="small text-body-secondary">البيانات الخام</summary>
            <pre className="audit-raw" dir="ltr">{JSON.stringify(open.details, null, 2)}</pre>
          </details>
        </>}
      </Modal>
    </Page>
  );
}
