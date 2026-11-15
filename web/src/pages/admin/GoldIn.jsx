import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtW } from '../../format.js';
import { Btn, Field, Input, Loader, ModeTiles, Search, Select, WeightInput, useFetch } from '../../ui.jsx';

/** إضافة ذهب للخزنة من: عميل (سداد ذهب في كشفه) / جمل الصافي (من رصيد المصنع لديهم) / شراء */
export default function GoldIn({ m, setM, mats, busy, onSubmit }) {
  const { data: src } = useFetch('/inventory/gold/sources');
  const [q, setQ] = useState('');
  const source = m.source || 'customer';
  const mat24 = mats.find((x) => Number(x.karat) === 24)?.id;
  const pick = (s) => setM({ ...m, source: s, customer_id: '', branch_id: '', dealer_id: '', material_id: s === 'dealer' && mat24 ? mat24 : m.material_id });
  const cust = src?.customers.find((c) => String(c.id) === String(m.customer_id));
  const dealer = src?.dealers.find((d) => String(d.id) === String(m.dealer_id));
  const list = (src?.customers || []).filter((c) => !q.trim() || c.shop_name.includes(q.trim()));
  const ok = m.weight && m.material_id && (source === 'customer' ? m.customer_id && (!cust?.branches_only || m.branch_id) : source === 'dealer' ? m.dealer_id : m.note);
  return <>
    <ModeTiles value={source} onChange={pick} tiles={[
      ['customer', '🏪', 'من عميل', 'تسليم ذهب يُقيد في كشفه'],
      ['dealer', '🏦', 'من جمل الصافي', 'ديوان الذهب، الجنيه العربي…'],
      ['purchase', '🛒', 'شراء', 'شراء ذهب من مورد'],
    ]} />
    {!src && source !== 'purchase' ? <Loader /> : source === 'customer' ? (
      !m.customer_id ? <>
        <Search value={q} onChange={setQ} placeholder="ابحث باسم العميل" />
        <div className="list-group mt-2 mb-3" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {list.map((c) => (
            <button key={c.id} type="button" className="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onClick={() => setM({ ...m, customer_id: c.id, branch_id: '' })}>
              <span>{c.shop_name}</span>
              {c.pure > 0 ? <span className="badge text-bg-warning">عليه {fmtW(c.pure)} جم صافي</span> : c.pure < 0 ? <span className="badge text-bg-light border">له {fmtW(-c.pure)} جم</span> : null}
            </button>
          ))}
          {!list.length && <div className="list-group-item text-body-secondary small">لا يوجد عملاء</div>}
        </div>
      </> : (
        <div className="alert alert-light border d-flex justify-content-between align-items-center">
          <div><b>{cust?.shop_name}</b><div className="small text-body-secondary">{cust?.pure > 0 ? `عليه ${fmtW(cust.pure)} جم صافي عيار 24` : 'لا يوجد ذهب مستحق عليه'} · <Link to={`/admin/customers/${cust?.id}/statement`} target="_blank">كشف الحساب</Link></div></div>
          <Btn size="sm" kind="ghost" onClick={() => setM({ ...m, customer_id: '', branch_id: '' })}>تغيير</Btn>
        </div>
      )
    ) : source === 'dealer' ? (
      <div className="mode-tiles mb-3">
        {src.dealers.map((d) => (
          <button key={d.id} type="button" className={`mode-tile${String(m.dealer_id) === String(d.id) ? ' on' : ''}`} onClick={() => setM({ ...m, dealer_id: d.id })}>
            <span className="mt-tx"><b>{d.name}</b><small>رصيد المصنع: <b className="n" dir="ltr">{fmtW(d.balance)}</b> جم صافي</small></span>
          </button>
        ))}
        {!src.dealers.length && <div className="small text-body-secondary">لا يوجد جمل — أضفهم من <Link to="/admin/gold-dealers">صفحة جمل الصافي</Link></div>}
      </div>
    ) : null}
    {cust?.branches?.length > 0 && (
      <Field label={`الفرع${cust.branches_only ? ' *' : ''}`}><Select value={m.branch_id || ''} onChange={(e) => setM({ ...m, branch_id: e.target.value })} placeholder={cust.branches_only ? 'اختر الفرع' : 'الحساب الرئيسي'} options={cust.branches.map((b) => [b.id, b.name])} /></Field>
    )}
    <Field label="المادة"><Select value={m.material_id} onChange={(e) => setM({ ...m, material_id: e.target.value })} options={mats.map((x) => [x.id, x.name])} /></Field>
    <Field label="الوزن (جم) *" hint={dealer ? `المتاح لدى ${dealer.name}: ${fmtW(dealer.balance)} جم صافي` : undefined}><WeightInput big value={m.weight || ''} onChange={(v) => setM({ ...m, weight: v })} /></Field>
    <Field label={source === 'purchase' ? 'البيان *' : 'ملاحظات'}><Input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder={source === 'purchase' ? 'مثال: شراء سبائك من مورد / رصيد افتتاحي' : ''} /></Field>
    <Btn loading={busy} disabled={!ok} onClick={() => onSubmit({ ...m, source })}>تسجيل</Btn>
  </>;
}
