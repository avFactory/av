import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { COLORS, fmtMoney, METHODS } from '../../format.js';
import { Btn, Empty, Field, Page, SearchSelect, Select, useAction, useFetch, LinkBtn, showAlert } from '../../ui.jsx';
import { delFiles, getFiles } from '../../fileStore.js';
import { useCart, OrderGate } from '../../components/StoreLayout.jsx';
import { useAuth } from '../../auth.jsx';

export default function Cart() {
  const { cart, setCart, approved, seller } = useCart();
  const { data: customers } = useFetch(seller ? '/sales/customers' : null);
  const [cust, setCust] = useState({ id: '', branch: '' });
  const custRow = (customers || []).find((c) => String(c.id) === String(cust.id));
  const { lookups } = useAuth();
  const nav = useNavigate();
  const [run, busy] = useAction();
  // المنتجات الجاهزة تُرسل معاً، ثم طلبات التصميم الخاص (مع ملفاتها) تحت رقم السلة نفسه
  const send = () => run(async () => {
    const ready = cart.filter((i) => i.kind !== 'custom');
    const custom = cart.filter((i) => i.kind === 'custom');
    // السلة تُقسم: طلب للمتوفر في المخزون وطلب لما يحتاج تصنيعاً (التصاميم الخاصة تنضم لطلب التصنيع)
    let ref = '', stockRef = null;
    if (ready.length) {
      const r = await api.post('/store/orders', { items: ready });
      stockRef = r.stock_ref; ref = r.make_ref || '';
    }
    let left = custom;
    for (const c of custom) {
      const fd = new FormData();
      Object.entries(c.fields || {}).forEach(([k, v]) => fd.append(k, v ?? ''));
      fd.set('quantity', String(c.quantity || 1));
      fd.append('from_cart', '1');
      fd.append('cart_ref', ref);
      const files = await getFiles(c.key);
      files.forEach((x) => fd.append('files', x.file));
      fd.append('file_kinds', JSON.stringify(files.map((x) => x.kind)));
      ref = (await api.post('/store/custom', fd)).cart_ref || ref;
      await delFiles(c.key);
      left = left.filter((x) => x !== c);
      setCart(left);
    }
    setCart([]);
    nav('/store/orders', { state: { cart: ref || stockRef } });
    if (stockRef && ref) await showAlert(`قُسم طلبك إلى طلبين:\n• ${stockRef} — المنتجات المتوفرة في المخزون\n• ${ref} — المنتجات التي تحتاج تصنيعاً`, { title: 'تم إرسال الطلب للمصنع' });
  }, 'تم إرسال الطلب للمصنع');
  // مدير المبيعات: يرسل السلة باسم العميل المختار (المنتجات الجاهزة فقط)
  const sendForCustomer = () => run(async () => {
    if (!cust.id) { await showAlert('اختر العميل أولاً'); return; }
    if (cart.some((i) => i.kind === 'custom')) { await showAlert('طلبات التصميم الخاص لا تُرسل من هنا — احذفها من السلة وأضفها من «طلب تصنيع جديد» في النظام'); return; }
    const r = await api.post('/sales/orders', { customer_id: cust.id, branch_id: cust.branch || null, items: cart });
    setCart([]); setCust({ id: '', branch: '' });
    const refs = [r.stock_ref && `• ${r.stock_ref} — المتوفر في المخزون`, r.make_ref && `• ${r.make_ref} — يحتاج تصنيعاً`].filter(Boolean).join('\n');
    await showAlert(`أُرسل الطلب باسم ${r.customer}${r.branch ? ` — ${r.branch}` : ''}:\n${refs}\n\nوصل العميلَ إشعارٌ بالطلب.`, { title: 'تم إرسال الطلب للمصنع' });
    nav('/store');
  });
  const remove = (n) => { const it = cart[n]; if (it.kind === 'custom') delFiles(it.key); setCart(cart.filter((_, j) => j !== n)); };
  const minOf = (x) => x.min || (x.kind === 'custom' ? (lookups?.settings?.min_order?.diamond ?? 2) : 1);
  const setQty = (n, q) => setCart(cart.map((x, j) => (j === n ? { ...x, quantity: Math.max(minOf(x), Math.min(9999, Number(q) || minOf(x))) } : x)));
  const lineLabor = (i) => (i.labor?.estimate ? Number(i.labor.estimate) * (i.labor.method === 'fixed' ? 1 : Number(i.quantity) || 1) : 0);
  const pieces = cart.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  const laborTotal = cart.reduce((a, i) => a + lineLabor(i), 0);
  const byType = cart.reduce((m, i) => { const t = i.kind === 'custom' ? 'تصميم خاص' : (i.product_type || 'منتجات'); m[t] = (m[t] || 0) + (Number(i.quantity) || 0); return m; }, {});
  return (
    <Page title="السلة" subtitle={cart.length ? `${cart.length} صنف · ${pieces} قطعة` : undefined} back="/store">
      {!cart.length ? <Empty><p>السلة فارغة</p><LinkBtn to="/store" kind="primary">تصفح المنتجات</LinkBtn></Empty> : (
        <div className="cart-layout">
          <div className="cart-list">
            {cart.map((i, n) => (
              <div key={n} className="cart-row">
                {i.kind === 'custom' ? <span className="cart-custom-ic">✎</span> : i.image ? <img className="cart-img" src={fileUrl(i.image, 400)} alt="" /> : <span className="cart-custom-ic">◇</span>}
                <div className="cart-info">
                  <div className="cart-name">{i.name}{i.kind === 'custom' ? <span className="badge text-bg-warning ms-2">تصميم خاص</span>
                    : i.stock != null && (i.stock >= (Number(i.quantity) || 1) ? <span className="badge text-bg-success ms-2">متوفر</span> : <span className="badge text-bg-light border ms-2">يحتاج تصنيع</span>)}</div>
                  <div className="cart-meta">
                    {i.kind === 'custom' ? <span>{i.file_count || 0} ملف</span> : <span dir="ltr">{i.sku}</span>}
                    <span>عيار {i.karat}</span>{i.color && <span>{COLORS[i.color]}</span>}{i.size && <span>مقاس {i.size}</span>}
                  </div>
                  {i.labor && <div className="cart-labor">أجور التصنيع <b>{fmtMoney(i.labor.rate)}</b> {METHODS[i.labor.method]}</div>}
                  {i.notes && <div className="small text-body-secondary">📝 {i.notes}</div>}
                </div>
                <div className="cart-qty" role="group" aria-label="الكمية">
                  <button type="button" onClick={() => setQty(n, (Number(i.quantity) || 1) + 1)} aria-label="زيادة">+</button>
                  <input inputMode="numeric" value={i.quantity} onChange={(e) => setQty(n, e.target.value.replace(/\D/g, ''))} aria-label="الكمية" />
                  <button type="button" onClick={() => setQty(n, (Number(i.quantity) || 1) - 1)} disabled={Number(i.quantity) <= minOf(i)} aria-label="إنقاص">−</button>
                </div>
                <div className="cart-line">{lineLabor(i) > 0 ? <><span className="small text-body-secondary">تقديري</span><b>{fmtMoney(lineLabor(i))}</b></> : <span className="small text-body-secondary">{i.kind === 'custom' ? 'عرض أجور لاحقاً' : '—'}</span>}</div>
                <button type="button" className="cart-del" onClick={() => remove(n)} title="حذف من السلة" aria-label="حذف">✕</button>
              </div>
            ))}
            <div className="d-flex gap-2 flex-wrap"><LinkBtn to="/store" kind="ghost">+ متابعة التسوق</LinkBtn><LinkBtn to="/store/custom" kind="ghost">+ طلب تصميم خاص</LinkBtn></div>
          </div>
          <aside className="cart-summary card">
            <div className="card-body d-grid gap-2">
              <h3 className="h6 m-0">ملخص الطلب</h3>
              {Object.entries(byType).map(([t, q]) => <div key={t} className="d-flex justify-content-between small"><span>{t}</span><b>{q}</b></div>)}
              <hr className="my-1" />
              <div className="d-flex justify-content-between"><span>الأصناف</span><b>{cart.length}</b></div>
              <div className="d-flex justify-content-between"><span>عدد القطع</span><b>{pieces}</b></div>
              {laborTotal > 0 && <div className="d-flex justify-content-between"><span>أجور تقديرية</span><b>{fmtMoney(laborTotal)}</b></div>}
              <div className="small text-body-secondary">سيراجع المصنع الطلب ويؤكده. الأجور النهائية تحسب على الوزن الفعلي.{cart.some((i) => i.kind === 'custom') && ' طلبات التصميم الخاص يُرسل لها عرض أجور للموافقة.'}</div>
              {seller ? (
                <div className="d-grid gap-2 sales-pick">
                  <Field label="اختر العميل *"><SearchSelect value={cust.id} onChange={(v) => setCust({ id: v, branch: '' })} placeholder="ابحث باسم المحل أو صاحبه أو الجوال…" options={(customers || []).map((c) => [c.id, c.shop_name, [c.owner_name, c.phone, c.city].filter(Boolean).join(' ')])} /></Field>
                  {custRow && <div className="small text-body-secondary">{[custRow.owner_name, custRow.phone, custRow.city].filter(Boolean).join(' · ')}</div>}
                  {custRow?.branches?.length > 0 && <Field label="الفرع"><Select value={cust.branch} onChange={(e) => setCust({ ...cust, branch: e.target.value })} placeholder="الحساب الرئيسي" options={custRow.branches.map((b) => [b.id, b.name])} /></Field>}
                  <Btn size="lg" className="w-100" loading={busy} disabled={!cust.id} onClick={sendForCustomer}>إرسال الطلب باسم العميل</Btn>
                  <div className="small text-body-secondary">الأجور النهائية تُحسب حسب أجور العميل المختار.</div>
                </div>
              ) : !approved ? <OrderGate what="إرسال الطلب" /> : <Btn size="lg" className="w-100" loading={busy} onClick={send}>إرسال الطلب للمصنع</Btn>}
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}
