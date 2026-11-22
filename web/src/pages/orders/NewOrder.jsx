import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { COLORS, METHODS } from '../../format.js';
import { Btn, Card, Field, FilePicker, Input, Page, SearchSelect, Select, Textarea, WeightInput, useAction, useFetch, showAlert, askConfirm, ZoomThumb } from '../../ui.jsx';

const blankItem = (prev) => ({ product_id: '', title: '', product_type: '', karat: prev?.karat || '21', color: prev?.color || 'yellow', quantity: '1', approx_weight: '', size: '', route_id: '', notes: '', images: [] });

export default function NewOrder() {
  const { lookups } = useAuth();
  const nav = useNavigate();
  const { data: products } = useFetch('/catalog/products');
  // بيانات مشتركة لكل منتجات الطلب
  const [f, setF] = useState({ customer_id: '', due_date: '', design_approval_required: false, labor_method: '', labor_rate: '' });
  const [items, setItems] = useState([blankItem()]);
  const [openIdx, setOpenIdx] = useState(0); // المنتج المفتوح للتعديل؛ البقية مختصرة في سطر واحد
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const setItem = (i, patch) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addItem = () => {
    if (!items[openIdx]?.title?.trim()) { showAlert(`أكمل وصف المنتج ${openIdx + 1} أولاً`); return; }
    setItems((l) => [...l, blankItem(l[l.length - 1])]);
    setOpenIdx(items.length);
  };
  const removeItem = async (i) => {
    const it = items[i];
    if ((it.title || it.product_id || it.images.length) && !(await askConfirm(`حذف المنتج ${i + 1} من الطلب؟`, { danger: true, ok: 'نعم، احذفه' }))) return;
    setItems((l) => l.filter((_, j) => j !== i));
    setOpenIdx((o) => (o === i ? Math.max(0, i - 1) : o > i ? o - 1 : o));
  };
  const pickProduct = (i, id) => {
    const p = products?.find((x) => String(x.id) === String(id));
    const it = items[i];
    setItem(i, { product_id: id, title: p?.name || it.title, product_type: p?.product_type || it.product_type, approx_weight: p?.approx_weight || it.approx_weight });
  };
  const submit = (e) => {
    e.preventDefault();
    const missing = items.findIndex((x) => !x.title.trim());
    if (missing >= 0) { setOpenIdx(missing); showAlert(`اكتب وصف المنتج ${missing + 1}`); return; }
    run(async () => {
      const r = await api.post('/orders/multi', { ...f, items: items.map(({ images, ...x }) => x) });
      // صور كل منتج (مرجع للتصنيع) تُرفع على بنده بعد إنشاء الطلب
      const failed = [];
      for (const [i, it] of items.entries()) {
        if (!it.images.length) continue;
        try {
          const fd = new FormData();
          for (const x of it.images) fd.append('files', x);
          fd.append('kind', 'reference');
          fd.append('customer_visible', 'false');
          await api.post(`/orders/${r.orders[i].id}/files`, fd);
        } catch (err) { failed.push(`${r.orders[i].order_no}: ${err.message}`); }
      }
      if (failed.length) await showAlert(`أُنشئ الطلب لكن تعذر رفع بعض الصور — ارفعها من صفحة الطلب:\n${failed.join('\n')}`);
      nav(`/orders/${r.orders[0].id}`);
    }, items.length > 1 ? `تم إنشاء الطلب (${items.length} منتجات)` : 'تم إنشاء أمر الإنتاج');
  };
  const productOpts = (products || []).map((p) => [p.id, `${p.sku} - ${p.name}`, p.product_type, fileUrl((p.media || []).find((m) => m.kind === 'image')?.path, 160)]);
  const routeOpts = (lookups?.routes || []).filter((r) => r.product_type !== '__stock__').map((r) => [r.id, r.name]);
  return (
    <Page title="طلب تصنيع جديد" back="/orders">
      <form onSubmit={submit} className="grid">
        <Card title="بيانات الطلب">
          <div className="grid g3">
            <Field label="العميل (اتركه فارغاً لطلب داخلي للمخزون)"><SearchSelect value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} emptyLabel="طلب داخلي" placeholder="ابحث باسم العميل…" options={(lookups?.customers || []).map((c) => [c.id, c.shop_name])} /></Field>
            <Field label="موعد التسليم"><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
            <Field label=" "><label className="check"><input type="checkbox" checked={f.design_approval_required} onChange={set('design_approval_required')} /> يتطلب اعتماد العميل للتصميم قبل الصب</label></Field>
          </div>
        </Card>
        {items.map((it, i) => (i !== openIdx ? (
          <ItemRow key={i} i={i} it={it} product={products?.find((x) => String(x.id) === String(it.product_id))} onOpen={() => setOpenIdx(i)} onRemove={items.length > 1 ? () => removeItem(i) : null} />
        ) : (
          <Card key={i} className="new-order-item" title={items.length > 1 ? `المنتج ${i + 1}` : 'المنتج'}
            actions={items.length > 1 && <Btn size="sm" kind="ghost" onClick={() => removeItem(i)}>✕ حذف المنتج</Btn>}>
            <ProductPreview p={products?.find((x) => String(x.id) === String(it.product_id))} />
            <div className="grid g3">
              <Field label="منتج من الكتالوج (اختياري)"><SearchSelect value={it.product_id} onChange={(v) => pickProduct(i, v)} emptyLabel="— بدون منتج" placeholder="ابحث باسم المنتج أو رقمه…" options={productOpts} /></Field>
              <Field label="الوصف *"><Input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} required /></Field>
              <Field label="نوع القطعة"><Input value={it.product_type} onChange={(e) => setItem(i, { product_type: e.target.value })} placeholder="خاتم، سلسال، أسورة…" /></Field>
              <Field label="العيار"><Select value={it.karat} onChange={(e) => setItem(i, { karat: e.target.value })} options={[['18', '18'], ['21', '21'], ['24', '24']]} /></Field>
              <Field label="اللون"><Select value={it.color} onChange={(e) => setItem(i, { color: e.target.value })} options={Object.entries(COLORS)} /></Field>
              <Field label="الكمية"><Input inputMode="numeric" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></Field>
              <Field label="الوزن التقريبي (جم)"><WeightInput value={it.approx_weight} onChange={(v) => setItem(i, { approx_weight: v })} /></Field>
              <Field label="المقاس"><Input value={it.size} onChange={(e) => setItem(i, { size: e.target.value })} /></Field>
              <Field label="مسار الإنتاج"><Select value={it.route_id} onChange={(e) => setItem(i, { route_id: e.target.value })} placeholder="تلقائي حسب نوع المنتج" options={routeOpts} /></Field>
            </div>
            <Field label="ملاحظات" className="mt"><Textarea value={it.notes} onChange={(e) => setItem(i, { notes: e.target.value })} /></Field>
            <div className="mt"><FilePicker label="صور المنتج (مرجع للتصنيع — لا تظهر للعميل)" value={it.images} onChange={(v) => setItem(i, { images: v })} accept="image/*" max={10} globalPaste hint="صورة القطعة أو الرسمة أو صورة من العميل — اضغط على الصورة لتكبيرها" /></div>
          </Card>
        )))}
        <button type="button" className="add-item-btn" onClick={addItem}>＋ إضافة منتج آخر لنفس الطلب</button>
        {items.length > 1 && <p className="small text-body-secondary mb-0">الطلب برقم واحد وفيه {items.length} منتجات (بنود)، ويُتابع ويُنقل بين المراحل كطلب واحد مثل طلبات سلة المتجر.</p>}
        <Card title="أجور التصنيع (اتركها لتطبيق قواعد الأجور تلقائياً)">
          <div className="grid g3">
            <Field label="طريقة الاحتساب"><Select value={f.labor_method} onChange={set('labor_method')} placeholder="تلقائي" options={Object.entries(METHODS)} /></Field>
            <Field label="الأجرة (ر.س)"><Input inputMode="decimal" value={f.labor_rate} onChange={set('labor_rate')} disabled={!f.labor_method} /></Field>
          </div>
          <p className="small muted mt">{items.length > 1 ? 'تُطبق على كل المنتجات. ' : ''}قيمة الذهب خارج حسابات المصنع - تُحتسب أجور التصنيع فقط.</p>
        </Card>
        <div className="hrow end"><Btn size="lg" type="submit" loading={busy}>{items.length > 1 ? `إنشاء الطلب (${items.length} منتجات) وتحويله للإنتاج` : 'إنشاء وتحويل لأمر إنتاج'}</Btn></div>
      </form>
    </Page>
  );
}

const productImg = (p, w) => fileUrl((p?.media || []).find((m) => m.kind === 'image')?.path, w);

/** صورة المنتج المختار من الكتالوج: تُكبَّر بالنقر لمعرفة تفاصيله */
function ProductPreview({ p }) {
  if (!p || !productImg(p)) return null;
  return (
    <div className="product-preview d-flex align-items-center gap-3 mb-3">
      <ZoomThumb src={productImg(p, 400)} full={productImg(p)} alt={p.name} />
      <div className="small"><b>{p.sku} - {p.name}</b><div className="text-body-secondary">{p.product_type}{p.approx_weight ? ` · ${Number(p.approx_weight)} جم تقريباً` : ''}</div><div className="text-body-secondary">🔍 اضغط على الصورة لتكبيرها</div></div>
    </div>
  );
}

/** منتج مختصر في سطر واحد: الصورة (تكبر بالنقر) والوصف والتفاصيل — النقر يفتحه للتعديل */
function ItemRow({ i, it, product, onOpen, onRemove }) {
  const [own, setOwn] = useState(null);
  useEffect(() => {
    const f = it.images.find((x) => x.type?.startsWith('image/'));
    if (!f) { setOwn(null); return undefined; }
    const u = URL.createObjectURL(f); setOwn(u);
    return () => URL.revokeObjectURL(u);
  }, [it.images]);
  const thumb = own || productImg(product, 200);
  const details = [it.product_type, `عيار ${it.karat}`, COLORS[it.color], `${it.quantity || 1} قطعة`, it.approx_weight && `${Number(it.approx_weight)} جم`, it.size && `مقاس ${it.size}`, it.images.length && `${it.images.length} صورة`].filter(Boolean).join(' · ');
  return (
    <div className="item-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} title="اضغط للتعديل">
      <span className="item-no">{i + 1}</span>
      {thumb ? <ZoomThumb src={thumb} full={own || productImg(product)} /> : <span className="item-thumb-empty" />}
      <div className="item-main"><b>{it.title || <span className="text-danger">بدون وصف</span>}</b><span className="small text-body-secondary">{details}</span></div>
      <Btn size="sm" kind="ghost" onClick={(e) => { e.stopPropagation(); onOpen(); }}>✎ تعديل</Btn>
      {onRemove && <Btn size="sm" kind="ghost" onClick={(e) => { e.stopPropagation(); onRemove(); }}>✕</Btn>}
    </div>
  );
}
