import { useNavigate } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { COLORS, fmtMoney, METHODS } from '../../format.js';
import { Btn, Empty, Page, useAction, LinkBtn } from '../../ui.jsx';
import { useCart, OrderGate } from '../../components/StoreLayout.jsx';

export default function Cart() {
  const { cart, setCart, approved } = useCart();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const send = () => run(async () => {
    const r = await api.post('/store/orders', { items: cart });
    setCart([]);
    nav('/store/orders', { state: { cart: r.cart_ref } });
  }, 'تم إرسال الطلب للمصنع');
  return (
    <Page title="السلة" back="/store">
      {!cart.length ? <Empty><p>السلة فارغة</p><LinkBtn to="/store" kind="primary">تصفح المنتجات</LinkBtn></Empty> : (
        <div className="grid">
          {cart.map((i, n) => (
            <div key={n} className="card card-b row gap wrap between">
              <div className="row gap">
                {i.image ? <img src={fileUrl(i.image)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} /> : null}
                <div><b>{i.name}</b><div className="small muted">{i.sku} · عيار {i.karat} · {COLORS[i.color]}{i.size ? ` · مقاس ${i.size}` : ''}</div>{i.labor && <div className="small">أجور التصنيع {fmtMoney(i.labor.rate)} {METHODS[i.labor.method]}</div>}</div>
              </div>
              <div className="row gap">
                <input className="input" style={{ width: 80 }} inputMode="numeric" value={i.quantity} onChange={(e) => setCart(cart.map((x, j) => (j === n ? { ...x, quantity: Number(e.target.value.replace(/\D/g, '')) || 1 } : x)))} />
                <Btn kind="ghost" size="sm" onClick={() => setCart(cart.filter((_, j) => j !== n))}>حذف</Btn>
              </div>
            </div>
          ))}
          <div className="alert alert-info small">سيراجع المصنع الطلب ويؤكده. أجور التصنيع النهائية تحسب على الوزن النهائي الفعلي.</div>
          {!approved ? <OrderGate what="إرسال الطلب" /> : <div className="row end"><Btn size="lg" loading={busy} onClick={send}>إرسال الطلب ({cart.length} منتج)</Btn></div>}
        </div>
      )}
    </Page>
  );
}
