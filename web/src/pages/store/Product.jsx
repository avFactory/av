import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fileUrl } from '../../api.js';
import { fmtW, fmtMoney, METHODS, COLORS } from '../../format.js';
import { Btn, Field, Input, Loader, Page, Textarea, useFetch, useToast, ErrorBox } from '../../ui.jsx';
import { useCart } from '../../components/StoreLayout.jsx';
import { useAuth } from '../../auth.jsx';
import ImageZoom from '../../components/ImageZoom.jsx';
import { SafeBlock } from '../../components/ErrorBoundary.jsx';

export default function Product() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { cart, setCart, apiBase, approved, loginUrl } = useCart();
  const { data: p, error } = useFetch(`${apiBase}/products/${id}`, { deps: [apiBase] });
  const [img, setImg] = useState(0);
  const { lookups } = useAuth();
  const [sel, setSel] = useState({ karat: null, color: null, size: '', quantity: '', notes: '' });
  if (error) return <div className="page"><ErrorBox error={error} /><div className="mt-3"><Btn kind="secondary" onClick={() => nav(-1)}>→ رجوع للمتجر</Btn></div></div>;
  if (!p) return <Loader />;
  // أقل كمية: الألماس المخبري حد، والذهب حد آخر (من الإعدادات)
  const mo = lookups?.settings?.min_order || { gold: 5, diamond: 2 };
  const minQ = (p.diamond_details || []).length ? mo.diamond : mo.gold;
  const qtyVal = sel.quantity === '' ? String(minQ) : sel.quantity;
  const karat = sel.karat ?? p.karats[0];
  const color = sel.color ?? p.colors[0];
  const media = p.media[img];
  const add = () => {
    if (p.sizes.length && !sel.size) return toast('اختر المقاس', 'bad');
    if ((Number(qtyVal) || 0) < minQ) return toast(`أقل كمية لهذا المنتج ${minQ} قطع`, 'bad');
    setCart([...cart, { product_id: p.id, name: p.name, sku: p.sku, product_type: p.product_type, karat, color, size: sel.size, quantity: Number(qtyVal), min: minQ, notes: sel.notes, image: p.media[0]?.path, labor: p.labor }]);
    toast('أضيف إلى السلة');
    // الرجوع لنفس مكان العميل في المتجر (نفس الفلاتر وموضع التمرير)
    if ((window.history.state?.idx ?? 0) > 0) nav(-1); else nav('/store');
  };
  return (
    <Page title={p.name} subtitle={`${p.sku} · ${p.product_type}`} back="/store">
      <div className="grid g2">
        <div>
          <div className="gallery">{media ? (media.kind === 'video' ? <video src={fileUrl(media.path)} controls /> : (
            <SafeBlock resetKey={media.path} fallback={<img src={fileUrl(media.path, 800)} alt={p.name} />}>
            <ImageZoom src={fileUrl(media.path)} preview={fileUrl(media.path, 800)} alt={p.name} images={p.media.filter((m) => m.kind === 'image').map((m) => fileUrl(m.path))}
              previews={p.media.filter((m) => m.kind === 'image').map((m) => fileUrl(m.path, 800))}
              onIndex={(n) => { const imgs = p.media.map((m, j) => [m, j]).filter(([m]) => m.kind === 'image'); if (imgs[n]) setImg(imgs[n][1]); }} />
            </SafeBlock>
          )) : '◇'}</div>
          {media?.kind === 'image' && <div className="small text-body-secondary mt-1">للتكبير: الأزرار، عجلة الماوس، النقر المزدوج، أو بإصبعين على الجوال — واسحب للتحريك</div>}
          <div className="thumbs">{p.media.map((m, i) => (m.kind === 'image' ? <img key={i} src={fileUrl(m.path, 200)} alt="" className={i === img ? 'on' : ''} onClick={() => setImg(i)} /> : <button key={i} className="chip" onClick={() => setImg(i)}>فيديو</button>))}</div>
        </div>
        <div className="card card-body grid">
          {p.description && <p>{p.description}</p>}
          <div className="kv">
            <div><dt>الوزن التقريبي</dt><dd>{fmtW(p.approx_weight)} جم</dd></div>
            {p.final_weight && <div><dt>الوزن النهائي</dt><dd>{fmtW(p.final_weight)} جم</dd></div>}
            {(p.diamond_details || []).map((d, i) => (
              <div key={`d${i}`}><dt>الألماس المخبري{p.diamond_details.length > 1 ? ` ${i + 1}` : ''}</dt><dd>{d.shape} <bdi dir="ltr">{d.size}</bdi>{[d.color, d.clarity].filter(Boolean).length ? ` ${[d.color, d.clarity].filter(Boolean).join(' ')}` : ''}<div className="small text-body-secondary"><bdi dir="ltr">{Number(d.carats)} ct</bdi>{d.count ? ` · ${d.count} حبة` : ''}</div></dd></div>
            ))}
            {Number(p.pearl_weight) > 0 && <div><dt>وزن اللؤلؤ</dt><dd>{fmtW(p.pearl_weight)} جم</dd></div>}
            {Number(p.stone_weight) > 0 && <div><dt>وزن الحجر</dt><dd>{fmtW(p.stone_weight)} جم</dd></div>}
            {Number(p.zircon_weight) > 0 && <div><dt>وزن الزركون</dt><dd>{fmtW(p.zircon_weight)} جم</dd></div>}
            {p.bullion_type && <div><dt>{p.bullion_type === 'coin' ? 'جنيهات' : 'سبائك'}</dt><dd>{p.bullion_weight ? `${Number(p.bullion_weight)} جم ${p.bullion_type === 'coin' ? 'للجنيه' : 'للسبيكة'} (للقطعة)` : '—'}</dd></div>}
            <div><dt>التوفر</dt><dd>{p.availability === 'available' && p.stock_qty > 0 ? `متوفر (${p.stock_qty})` : 'يصنع حسب الطلب'}</dd></div>
            {p.lead_days != null && <div><dt>مدة التنفيذ المتوقعة</dt><dd>{p.lead_days} يوم عمل <span className="small text-body-secondary">من اعتماد الطلب (الجمعة عطلة)</span></dd></div>}
            {p.labor && <div><dt>أجور التصنيع</dt><dd style={{ color: 'var(--gold-ink)' }}>{fmtMoney(p.labor.rate)} {METHODS[p.labor.method]}</dd></div>}
            {p.labor && <div><dt>تقدير أجرة القطعة</dt><dd>{fmtMoney(p.labor.estimate)}</dd></div>}
            {!approved && <div><dt>أجور التصنيع</dt><dd><Link to={loginUrl} className="link">سجّل الدخول لعرض الأجور</Link></dd></div>}
          </div>
          <Field label="العيار"><div className="chips">{p.karats.map((k) => <button key={k} className={`chip ${karat === k ? 'on' : ''}`} onClick={() => setSel({ ...sel, karat: k })}>{k}</button>)}</div></Field>
          <Field label="اللون"><div className="chips">{p.colors.map((c) => <button key={c} className={`chip ${color === c ? 'on' : ''}`} onClick={() => setSel({ ...sel, color: c })}>{COLORS[c]}</button>)}</div></Field>
          {p.sizes.length > 0 && <Field label="المقاس"><div className="chips">{p.sizes.map((s) => <button key={s} className={`chip ${sel.size === s ? 'on' : ''}`} onClick={() => setSel({ ...sel, size: s })}>{s}</button>)}</div></Field>}
          <Field label="الكمية" hint={`أقل كمية للطلب: ${minQ} قطع`}><Input inputMode="numeric" value={qtyVal} onChange={(e) => setSel({ ...sel, quantity: e.target.value.replace(/\D/g, '') })} style={{ maxWidth: 120 }} /></Field>
          <Field label="ملاحظات"><Textarea value={sel.notes} onChange={(e) => setSel({ ...sel, notes: e.target.value })} /></Field>
          <Btn size="lg" onClick={add}>إضافة إلى السلة</Btn>
          <p className="small muted">الأسعار المعروضة أجور تصنيع فقط ولا تشمل قيمة الذهب.</p>
        </div>
      </div>
    </Page>
  );
}
