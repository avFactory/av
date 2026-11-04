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
  return (
    <Page title="السلة" back="/store">
      {!cart.length ? <Empty><p>السلة فارغة</p><LinkBtn to="/store" kind="primary">تصفح المنتجات</LinkBtn></Empty> : (
        <div className="grid">
          {cart.map((i, n) => (
            <div key={n} className="card card-body hrow gap wrap between">
              <div className="hrow gap">
                {i.kind === 'custom' ? <span className="cart-custom-ic">✎</span> : i.image ? <img src={fileUrl(i.image)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} /> : null}
                <div><b>{i.name}</b>{i.kind === 'custom' && <span className="badge text-bg-warning ms-2">تصميم خاص</span>}<div className="small muted">{i.kind === 'custom' ? `${i.file_count || 0} ملف` : i.sku} · عيار {i.karat} · {COLORS[i.color]}{i.size ? ` · مقاس ${i.size}` : ''}</div>{i.labor && <div className="small">أجور التصنيع {fmtMoney(i.labor.rate)} {METHODS[i.labor.method]}</div>}</div>
              </div>
              <div className="hrow gap">
                <input className="form-control" style={{ width: 80 }} inputMode="numeric" value={i.quantity} onChange={(e) => setCart(cart.map((x, j) => (j === n ? { ...x, quantity: Number(e.target.value.replace(/\D/g, '')) || 1 } : x)))} />
                <Btn kind="ghost" size="sm" onClick={() => remove(n)}>حذف</Btn>
              </div>
            </div>
          ))}
          <div className="alert alert-info small">سيراجع المصنع الطلب ويؤكده. أجور التصنيع النهائية تحسب على الوزن النهائي الفعلي.{cart.some((i) => i.kind === 'custom') && ' طلبات التصميم الخاص يُرسل لها عرض أجور التصنيع للموافقة.'}</div>
          <div><LinkBtn to="/store/custom" kind="ghost">+ طلب تصميم خاص آخر</LinkBtn> <LinkBtn to="/store" kind="ghost">+ متابعة التسوق</LinkBtn></div>
          {!approved ? <OrderGate what="إرسال الطلب" /> : <div className="hrow end"><Btn size="lg" loading={busy} onClick={send}>إرسال الطلب ({cart.length} منتج)</Btn></div>}
        </div>
      )}
    </Page>
  );
}
