import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fileUrl, qs } from '../../api.js';
import { fmtW, fmtMoney, METHODS } from '../../format.js';
import { Loader, Search, useFetch, Empty, LinkBtn } from '../../ui.jsx';

const PAGE = 48;
import { useCart } from '../../components/StoreLayout.jsx';

const CATS = [['', 'الكل', '✦'], ['gold', 'ذهب', '◯'], ['diamond', 'ألماس مخبري', '💎'], ['pearl', 'لؤلؤ', '⚪'], ['stone', 'أحجار', '◆'], ['bullion', 'سبائك', '🪙']];
const catBadges = (p) => [p.has_diamond && 'ألماس مخبري', p.has_pearl && 'لؤلؤ', p.has_stone && 'أحجار', p.has_bullion && (p.bullion_type === 'coin' ? 'جنيهات' : 'سبائك'), p.is_gold && 'ذهب'].filter(Boolean);

export default function Catalog() {
  const [f, setF] = useState({ q: '', type: '', karat: '', cat: '' });
  const { apiBase, approved, loginUrl } = useCart();
  // الصفحة الأولى ثم تحميل المزيد تلقائياً عند الوصول لآخر القائمة
  const { data: first } = useFetch(`${apiBase}/products${qs({ ...f, limit: PAGE })}`, { deps: [apiBase] });
  const [more, setMore] = useState({ key: '', items: [], hasMore: false, loading: false });
  const key = `${apiBase}${qs(f)}`;
  const items = first ? [...first.products, ...(more.key === key ? more.items : [])] : [];
  const hasMore = first ? (more.key === key && more.items.length ? more.hasMore : first.has_more) : false;
  const sentinel = useRef(null);
  const loadMore = async () => {
    if (more.loading || !hasMore) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const r = await api.get(`${apiBase}/products${qs({ ...f, limit: PAGE, offset: items.length })}`);
      setMore((m) => ({ key, items: [...(m.key === key ? m.items : []), ...r.products], hasMore: r.has_more, loading: false }));
    } catch { setMore((m) => ({ ...m, loading: false })); }
  };
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return undefined;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  });
  const data = first;
  return (
    <div className="page">
      <div className="hero mb d-none d-md-flex">
        <div className="hrow gap"><img src="/logo-white.png" alt="AV" style={{ height: 64, width: 'auto' }} /><div><h2>مصنع AV للمجوهرات — الجملة من المصنع مباشرة</h2><p>أجور تصنيع واضحة لكل جرام أو قطعة — قيمة الذهب خارج الفاتورة.</p></div></div>
        <LinkBtn to="/store/custom" kind="primary" size="lg">اطلب تصميمك الخاص</LinkBtn>
      </div>
      {/* التصنيف حسب الخامة: الذهب يشمل القطع التي فيها زركون */}
      <div className="cat-tabs mb" role="tablist" aria-label="التصنيف">
        {CATS.map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={f.cat === k} className={`cat-tab${f.cat === k ? ' on' : ''}`} onClick={() => setF({ ...f, cat: k })}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
      </div>
      <div className="hrow gap wrap mb">
        <Search value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="ابحث باسم المنتج أو رقمه" />
        <div className="chips">
          <button className={`chip ${!f.type ? 'on' : ''}`} onClick={() => setF({ ...f, type: '' })}>الكل</button>
          {(data?.types || []).map((t) => <button key={t} className={`chip ${f.type === t ? 'on' : ''}`} onClick={() => setF({ ...f, type: t })}>{t}</button>)}
        </div>
        <div className="chips">{['', '18', '21', '24'].map((k) => <button key={k} className={`chip ${f.karat === k ? 'on' : ''}`} onClick={() => setF({ ...f, karat: k })}>{k ? `عيار ${k}` : 'كل العيارات'}</button>)}</div>
      </div>
      {data && data.total != null && <div className="small text-body-secondary mb-2">{data.total} منتج</div>}
      {!data ? <Loader /> : !items.length ? <Empty>لا توجد منتجات مطابقة{(f.q || f.type || f.karat || f.cat) && <div className="mt-2"><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setF({ q: '', type: '', karat: '', cat: '' })}>عرض كل المنتجات</button></div>}</Empty> : (
        <><div className="products">
          {items.map((p) => (
            <Link key={p.id} to={`/store/products/${p.id}`} className="product">
              <div className="img">{p.media[0]?.kind === 'image' ? <img src={fileUrl(p.media[0].path, 400)} alt={p.name} loading="lazy" decoding="async" /> : '◇'}</div>
              <div className="info">
                <b>{p.name}</b>
                <span className="small muted">{p.sku} · {p.product_type} · عيار {p.karats.join('/')}</span>
                <span className="d-flex flex-wrap gap-1">{catBadges(p).map((c) => <span key={c} className="badge rounded-pill text-bg-light border fw-normal">{c}</span>)}</span>
                <span className="small">الوزن التقريبي {fmtW(p.final_weight || p.approx_weight)} جم</span>
                {p.labor && <span><b style={{ color: 'var(--gold-ink)' }}>{fmtMoney(p.labor.rate)}</b> <span className="small muted">{METHODS[p.labor.method]}</span></span>}
                {!approved && <span className="small muted">أجور التصنيع تظهر بعد تسجيل الدخول</span>}
                <span className="small muted">{p.in_stock || (p.availability === 'available' && p.stock_qty > 0) ? (p.stock_qty ? `متوفر (${p.stock_qty})` : 'متوفر') : 'يصنع حسب الطلب'}</span>
              </div>
            </Link>
          ))}
        </div>
        {hasMore && <div ref={sentinel} className="text-center py-4">{more.loading ? <Loader /> : <button type="button" className="btn btn-outline-secondary" onClick={loadMore}>عرض المزيد</button>}</div>}
        </>
      )}
    </div>
  );
}
