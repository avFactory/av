import { useNavigate } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { COLORS, fmtMoney, METHODS } from '../../format.js';
import { Btn, Empty, Page, useAction, LinkBtn } from '../../ui.jsx';
import { delFiles, getFiles } from '../../fileStore.js';
import { useCart, OrderGate } from '../../components/StoreLayout.jsx';

export default function Cart() {
  const { cart, setCart, approved } = useCart();
  const nav = useNavigate();
  const [run, busy] = useAction();
  // المنتجات الجاهزة تُرسل معاً، ثم طلبات التصميم الخاص (مع ملفاتها) تحت رقم السلة نفسه
  const send = () => run(async () => {
    const ready = cart.filter((i) => i.kind !== 'custom');
    const custom = cart.filter((i) => i.kind === 'custom');
    let ref = '';
    if (ready.length) ref = (await api.post('/store/orders', { items: ready })).cart_ref;
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
    nav('/store/orders', { state: { cart: ref } });
  }, 'تم إرسال الطلب للمصنع');
  const remove = (n) => { const it = cart[n]; if (it.kind === 'custom') delFiles(it.key); setCart(cart.filter((_, j) => j !== n)); };
  const setQty = (n, q) => setCart(cart.map((x, j) => (j === n ? { ...x, quantity: Math.max(1, Math.min(999, Number(q) || 1)) } : x)));
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
                  <div className="cart-name">{i.name}{i.kind === 'custom' && <span className="badge text-bg-warning ms-2">تصميم خاص</span>}</div>
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
                  <button type="button" onClick={() => setQty(n, (Number(i.quantity) || 1) - 1)} disabled={Number(i.quantity) <= 1} aria-label="إنقاص">−</button>
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
              {!approved ? <OrderGate what="إرسال الطلب" /> : <Btn size="lg" className="w-100" loading={busy} onClick={send}>إرسال الطلب للمصنع</Btn>}
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}
