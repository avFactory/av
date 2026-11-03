import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { fmtDT } from '../../format.js';
import { Btn, Card, Loader, Page, useAction, useToast } from '../../ui.jsx';
import { castingCalc, karatConvert } from '../../../../server/src/lib/castingFormulas.js';

const fmt = (v) => (!v || Math.abs(v) < 0.005 ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const toNum = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');

/** خانة قابلة للتعديل تحفظ عند الخروج منها */
function Cell({ value, onSave, numeric, list, wide }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => { const nv = numeric ? toNum(v) : String(v).trim(); if (String(nv) !== String(value ?? '')) onSave(nv); };
  return (
    <input className={`form-control form-control-sm casting-in${wide ? ' wide' : ''}`} value={v} dir={numeric ? 'ltr' : 'auto'} inputMode={numeric ? 'decimal' : undefined} list={list}
      onChange={(e) => setV(numeric ? toNum(e.target.value) : e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

/** صفحة الصب — نفس ورقة "صب" في Excel: أشجار الشمع، الذهب المستحق، الخلطة، وعجز الصب */
export default function Casting() {
  const [sp] = useSearchParams();
  const orderId = sp.get('order');
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [order, setOrder] = useState(null);
  const [onlyOrder, setOnlyOrder] = useState(!!orderId);
  const [conv, setConv] = useState('10');
  const [run, busy] = useAction();

  const load = () => api.get(`/casting${onlyOrder && orderId ? `?order=${orderId}` : '?days=60'}`).then(setRows).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, [onlyOrder, orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (orderId) api.get(`/sup/lookup?id=${orderId}`).then(setOrder).catch(() => setOrder(null)); }, [orderId]);

  const save = async (t, patch) => {
    try {
      const nt = await api.put(`/casting/${t.id}`, patch);
      setRows((rs) => rs.map((x) => (x.id === t.id ? nt : x)));
    } catch (e) { toast(e.message, 'bad'); }
  };
  const add = () => run(async () => {
    const nt = await api.post('/casting', { tree_no: '', karat: 18, color: 'اصفر', order_ids: orderId ? [orderId] : [] });
    setRows((rs) => [...(rs || []), nt]);
  });
  const remove = (t) => {
    if (!window.confirm(`حذف الشجرة ${t.tree_no}؟`)) return;
    run(async () => { await api.del(`/casting/${t.id}`); setRows((rs) => rs.filter((x) => x.id !== t.id)); }, 'تم الحذف').catch(() => {});
  };
  const linkHere = (t) => run(async () => { const nt = await api.put(`/casting/${t.id}`, { add_orders: [orderId] }); setRows((rs) => rs.map((x) => (x.id === t.id ? nt : x))); }, 'تم ربط الطلب بالشجرة').catch(() => {});

  const calc = useMemo(() => (rows || []).map((t) => ({ t, c: castingCalc(t) })), [rows]);
  const tot = useMemo(() => calc.reduce((a, { t, c }) => ({
    wax: a.wax + (Number(t.wax) || 0), zircon: a.zircon + (Number(t.zircon) || 0), due: a.due + c.due, need24: a.need24 + c.need24, alloy: a.alloy + c.alloy, need18: a.need18 + c.need18,
    before: a.before + (Number(t.gold_before) || 0), after: a.after + (Number(t.gold_after) || 0), loss: a.loss + c.loss,
  }), { wax: 0, zircon: 0, due: 0, need24: 0, alloy: 0, need18: 0, before: 0, after: 0, loss: 0 }), [calc]);
  const cv = karatConvert(conv);

  return (
    <Page title="الصب" subtitle="أشجار الشمع: الذهب المستحق والخلطة وعجز الصب — نفس ورقة الصب في Excel"
      actions={<Btn loading={busy} onClick={add}>+ شجرة جديدة{orderId ? ' لهذا الطلب' : ''}</Btn>}>
      {orderId && (
        <div className="alert alert-light border d-flex flex-wrap gap-2 align-items-center">
          <span>الطلب: <Link className="link fw-bold" to={`/orders/${orderId}`}>{order?.order_no || `#${orderId}`}</Link> {order?.title ? `— ${order.title}` : ''} {order?.stage_name ? <span className="text-body-secondary">({order.stage_name})</span> : null}</span>
          <label className="check ms-auto"><input type="checkbox" checked={onlyOrder} onChange={(e) => setOnlyOrder(e.target.checked)} /> أشجار هذا الطلب فقط</label>
        </div>
      )}
      <datalist id="tree-colors"><option value="اصفر" /><option value="ابيض" /><option value="وردي" /></datalist>
      {!rows ? <Loader /> : (
        <div className="card mb">
          <div className="table-responsive">
            <table className="table table-bordered table-sm align-middle casting-table keep mb-0">
              <thead>
                <tr>
                  <th>رقم الشجرة</th><th>لون الشجرة</th><th className="pink">الزركون</th><th className="pink">شجرة شمع</th><th>العيار</th>
                  <th>الذهب المستحق</th><th>مطلوب 24</th><th>الخلطة</th><th>المطلوب 18</th>
                  <th className="pink">الذهب الفعلي قبل</th><th className="pink">الذهب الفعلي بعد</th><th>عجز الذهب الفعلي</th>
                  <th>تاريخ التسليم</th><th>تاريخ الاستلام</th><th>الطلبات</th><th />
                </tr>
              </thead>
              <tbody>
                {calc.map(({ t, c }) => (
                  <tr key={t.id}>
                    <td><Cell value={t.tree_no === '—' ? '' : t.tree_no} onSave={(v) => save(t, { tree_no: v })} /></td>
                    <td><Cell value={t.color} list="tree-colors" onSave={(v) => save(t, { color: v })} /></td>
                    <td className="pink"><Cell numeric value={t.zircon} onSave={(v) => save(t, { zircon: v })} /></td>
                    <td className="pink"><Cell numeric value={t.wax} onSave={(v) => save(t, { wax: v })} /></td>
                    <td>
                      <select className="form-select form-select-sm casting-karat" value={t.karat} onChange={(e) => save(t, { karat: Number(e.target.value) })}>
                        <option value={18}>18</option><option value={21}>21</option>
                      </select>
                    </td>
                    <td className="n">{fmt(c.due)}</td><td className="n">{fmt(c.need24)}</td><td className="n">{fmt(c.alloy)}</td><td className="n">{fmt(c.need18)}</td>
                    <td className="pink"><Cell numeric value={t.gold_before} onSave={(v) => save(t, { gold_before: v })} /></td>
                    <td className="pink"><Cell numeric value={t.gold_after} onSave={(v) => save(t, { gold_after: v })} /></td>
                    <td className={`n fw-bold ${c.loss > 0.005 ? 'text-danger' : ''}`}>{fmt(c.loss)}</td>
                    <td className="small text-nowrap">{t.issued_at ? fmtDT(t.issued_at) : ''}</td>
                    <td className="small text-nowrap">{t.received_at ? fmtDT(t.received_at) : ''}</td>
                    <td className="small">
                      <div className="d-flex flex-wrap gap-1">
                        {t.orders.map((o) => (
                          <span key={o.id} className="badge rounded-pill bg-body-secondary text-body d-inline-flex align-items-center gap-1">
                            <Link to={`/orders/${o.id}`} className="text-reset" dir="ltr">{o.order_no.replace(/^ORD-\d{4}-0*/, '#')}</Link>
                            <button type="button" className="btn-close" style={{ fontSize: '.5rem' }} aria-label="فك الربط" onClick={() => save(t, { remove_orders: [o.id] })} />
                          </span>
                        ))}
                        {orderId && !t.orders.some((o) => String(o.id) === String(orderId)) && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => linkHere(t)}>+ ربط الطلب</button>}
                      </div>
                    </td>
                    <td><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(t)} aria-label="حذف">حذف</button></td>
                  </tr>
                ))}
                {!calc.length && <tr><td colSpan={16} className="text-center text-body-secondary py-4">لا توجد أشجار — اضغط "+ شجرة جديدة"</td></tr>}
              </tbody>
              {calc.length > 0 && (
                <tfoot>
                  <tr className="casting-total">
                    <th colSpan={2}>المجموع</th><td className="n">{fmt(tot.zircon)}</td><td className="n">{fmt(tot.wax)}</td><td />
                    <td className="n">{fmt(tot.due)}</td><td className="n">{fmt(tot.need24)}</td><td className="n">{fmt(tot.alloy)}</td><td className="n">{fmt(tot.need18)}</td>
                    <td className="n">{fmt(tot.before)}</td><td className="n">{fmt(tot.after)}</td><td className="n">{fmt(tot.loss)}</td><td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
      <div className="grid g2">
        <Card title="تحويل العيار">
          <div className="d-flex flex-wrap gap-3 align-items-end">
            <label className="d-grid small">الوزن (عيار 24)<input className="form-control" dir="ltr" style={{ width: 120 }} value={conv} onChange={(e) => setConv(toNum(e.target.value))} /></label>
            <div><div className="small text-body-secondary">عيار 18</div><b className="fs-5" dir="ltr">{fmt(cv.k18)}</b></div>
            <div><div className="small text-body-secondary">عيار 21</div><b className="fs-5" dir="ltr">{fmt(cv.k21)}</b></div>
          </div>
        </Card>
        <Card title="طريقة الحساب">
          <ul className="small mb-0">
            <li>الذهب المستحق = (الشمع − الزركون) × 16 لعيار 18، أو × 18 لعيار 21</li>
            <li>مطلوب 24 = الذهب المستحق × 0.752 (عيار 18) أو × 0.875 (عيار 21) ÷ 2</li>
            <li>الخلطة = مطلوب 24 ÷ 752 (أو 875) × 1000 − مطلوب 24 &nbsp;·&nbsp; المطلوب 18 = الذهب المستحق ÷ 2</li>
            <li>عجز الذهب الفعلي = الذهب قبل + الزركون − الذهب بعد. تاريخ التسليم والاستلام يُسجلان تلقائياً عند إدخال الوزن.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
