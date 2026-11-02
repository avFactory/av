import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fileUrl, qs } from '../../api.js';
import { fmtW, fmtMoney, METHODS } from '../../format.js';
import { Loader, Search, useFetch, Empty, LinkBtn } from '../../ui.jsx';
import { useCart } from '../../components/StoreLayout.jsx';

export default function Catalog() {
  const [f, setF] = useState({ q: '', type: '', karat: '' });
  const { apiBase, approved, loginUrl } = useCart();
  const { data } = useFetch(`${apiBase}/products${qs(f)}`, { deps: [apiBase] });
  return (
    <div className="page">
      <div className="hero mb d-none d-md-flex">
        <div className="hrow gap"><img src="/logo-gold.png" alt="AV" style={{ height: 64, width: 'auto' }} /><div><h2>مصنع AV للمجوهرات — الجملة من المصنع مباشرة</h2><p>أجور تصنيع واضحة لكل جرام أو قطعة — قيمة الذهب خارج الفاتورة.</p></div></div>
        <LinkBtn to="/store/custom" kind="primary" size="lg">اطلب تصميمك الخاص</LinkBtn>
      </div>
      <div className="hrow gap wrap mb">
        <Search value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="ابحث باسم المنتج أو رقمه" />
        <div className="chips">
          <button className={`chip ${!f.type ? 'on' : ''}`} onClick={() => setF({ ...f, type: '' })}>الكل</button>
          {(data?.types || []).map((t) => <button key={t} className={`chip ${f.type === t ? 'on' : ''}`} onClick={() => setF({ ...f, type: t })}>{t}</button>)}
        </div>
        <div className="chips">{['', '18', '21', '22', '24'].map((k) => <button key={k} className={`chip ${f.karat === k ? 'on' : ''}`} onClick={() => setF({ ...f, karat: k })}>{k ? `عيار ${k}` : 'كل العيارات'}</button>)}</div>
      </div>
      {!data ? <Loader /> : !data.products.length ? <Empty>لا توجد منتجات مطابقة</Empty> : (
        <div className="products">
          {data.products.map((p) => (
            <Link key={p.id} to={`/store/products/${p.id}`} className="product">
              <div className="img">{p.media[0]?.kind === 'image' ? <img src={fileUrl(p.media[0].path)} alt={p.name} loading="lazy" /> : '◇'}</div>
              <div className="info">
                <b>{p.name}</b>
                <span className="small muted">{p.sku} · {p.product_type} · عيار {p.karats.join('/')}</span>
                <span className="small">الوزن التقريبي {fmtW(p.final_weight || p.approx_weight)} جم</span>
                {p.labor && <span><b style={{ color: 'var(--gold-ink)' }}>{fmtMoney(p.labor.rate)}</b> <span className="small muted">{METHODS[p.labor.method]}</span></span>}
                {!approved && <span className="small muted">أجور التصنيع تظهر بعد تسجيل الدخول</span>}
                <span className="small muted">{p.in_stock || (p.availability === 'available' && p.stock_qty > 0) ? (p.stock_qty ? `متوفر (${p.stock_qty})` : 'متوفر') : 'يصنع حسب الطلب'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
