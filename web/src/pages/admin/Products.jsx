import { useEffect, useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { COLORS, METHODS, fmtW, fmtMoney } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, Textarea, useAction, useFetch, Badge, FilePicker } from '../../ui.jsx';

const AV = { available: 'متوفر', made_to_order: 'حسب الطلب', unavailable: 'غير متوفر' };

export default function Products() {
  const { lookups } = useAuth();
  const { data, reload } = useFetch('/catalog/products');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  const { data: types } = useFetch('/catalog/product-types');
  // معاينة رقم المنتج التالي عند اختيار نوع القطعة لمنتج جديد
  const [nextSku, setNextSku] = useState('');
  useEffect(() => {
    if (!f || f.id || !f.product_type) { setNextSku(''); return; }
    api.get(`/catalog/next-sku?type=${encodeURIComponent(f.product_type)}`).then((r) => setNextSku(r.sku)).catch(() => setNextSku(''));
  }, [f?.id, f?.product_type, !!f]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k, v) => { const a = f[k] || []; setF({ ...f, [k]: a.includes(v) ? a.filter((x) => x !== v) : [...a, v] }); };
  const save = () => run(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) {
      if (['files', 'media', 'id', 'diamonds', 'has_diamonds', 'main'].includes(k) || k.startsWith('show_') || v == null) continue;
      fd.append(k, Array.isArray(v) ? v.join(',') : v);
    }
    fd.append('diamonds', JSON.stringify(f.has_diamonds === false ? [] : (f.diamonds || []).filter((d) => d.lot_id)));
    for (const k of ['pearl_weight', 'stone_weight', 'zircon_weight']) if (f[k] == null) fd.append(k, '');
    for (const x of f.files || []) fd.append('files', x);
    if (f.main?.new != null) fd.append('main_new', String(f.main.new)); else if (f.main?.media) fd.append('main_media', String(f.main.media));
    if (f.id) await api.put(`/catalog/products/${f.id}`, fd); else await api.post('/catalog/products', fd);
    setF(null); reload();
  }, 'تم حفظ المنتج');
  const remove = (p) => {
    if (!window.confirm(`حذف المنتج "${p.name}" (${p.sku})؟\nإذا كان مرتبطاً بطلبات سابقة سيُخفى ويُؤرشف بدل الحذف النهائي.`)) return;
    run(async () => {
      const r = await api.del(`/catalog/products/${p.id}`);
      setF(null); reload();
      return r;
    }, 'تم حذف المنتج').catch(() => {});
  };
  if (!data) return <Loader />;
  return (
    <Page title="منتجات المتجر" actions={<Btn onClick={() => setF({ karats: [21], colors: ['yellow'], sizes: [], availability: 'made_to_order', active: true, labor_method: 'per_gram' })}>منتج جديد</Btn>}>
      <div className="card"><Table rows={data} onRow={(p) => setF({ ...p, karats: p.karats, colors: p.colors, sizes: p.sizes, files: null })} columns={[
        ['', (p) => (p.media[0] ? <img src={fileUrl(p.media[0].path, 400)} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} /> : null)],
        ['رقم المنتج', 'sku'], ['الاسم', (p) => <b>{p.name}</b>], ['النوع', 'product_type'], ['العيارات', (p) => p.karats.join('، ')], ['الألوان', (p) => p.colors.map((c) => COLORS[c]).join('، ')],
        ['الوزن', (p) => fmtW(p.final_weight || p.approx_weight)], ['الأجرة', (p) => (p.labor_method ? `${fmtMoney(p.labor_rate)} ${METHODS[p.labor_method]}` : 'حسب القواعد')], ['المخزون', 'stock_qty'],
        ['التوفر', (p) => AV[p.availability]],
        ['', (p) => <span className="d-inline-flex gap-2 align-items-center" onClick={(e) => e.stopPropagation()}>
          <label className="form-check form-switch m-0 d-inline-flex align-items-center gap-2 text-nowrap small" title={p.active ? 'ظاهر في المتجر — اضغط للإخفاء' : 'مخفي — اضغط للإظهار'}>
            <input className="form-check-input m-0" type="checkbox" role="switch" checked={!!p.active} disabled={busy}
              onChange={(e) => run(async () => { await api.post(`/catalog/products/${p.id}/visibility`, { active: e.target.checked }); reload(); }, e.target.checked ? 'ظهر المنتج في المتجر' : 'أُخفي المنتج من المتجر')} />
            <span className={p.active ? 'text-success' : 'text-body-secondary'}>{p.active ? 'ظاهر في المتجر' : 'مخفي'}</span>
          </label>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(p)} title="حذف المنتج">حذف</button>
        </span>],
      ]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'تعديل منتج' : 'منتج جديد'} wide>
        {f && <>
          <div className="grid g3">
            <Field label="نوع القطعة *"><Select value={f.product_type || ''} onChange={(e) => setF({ ...f, product_type: e.target.value })} placeholder="اختر نوع القطعة"
              options={[...(types || []).map((t) => [t.name, `${t.name} (${t.prefix})`]), ...(f.product_type && !(types || []).some((t) => t.name === f.product_type) ? [[f.product_type, f.product_type]] : [])]} /></Field>
            {f.id
              ? <Field label="رقم المنتج *"><Input value={f.sku || ''} onChange={(e) => setF({ ...f, sku: e.target.value })} dir="ltr" /></Field>
              : <Field label="رقم المنتج" hint="يُولَّد تلقائياً عند الحفظ حسب نوع القطعة"><Input value={nextSku || ''} readOnly dir="ltr" placeholder="اختر نوع القطعة أولاً" className="form-control bg-body-tertiary" /></Field>}
            <Field label="اسم المنتج *"><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="الوزن التقريبي (جم)"><Input dir="ltr" value={f.approx_weight || ''} onChange={(e) => setF({ ...f, approx_weight: e.target.value })} /></Field>
            <Field label="الوزن النهائي (جم)"><Input dir="ltr" value={f.final_weight || ''} onChange={(e) => setF({ ...f, final_weight: e.target.value })} /></Field>
            <Field label="المقاسات (مفصولة بفاصلة)"><Input value={(f.sizes || []).join(',')} onChange={(e) => setF({ ...f, sizes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
            <Field label="طريقة الأجرة"><Select value={f.labor_method || ''} onChange={(e) => setF({ ...f, labor_method: e.target.value })} placeholder="حسب قواعد الأجور" options={Object.entries(METHODS).filter(([k]) => k !== 'manual')} /></Field>
            <Field label="أجرة التصنيع (ر.س)"><Input dir="ltr" value={f.labor_rate || ''} onChange={(e) => setF({ ...f, labor_rate: e.target.value })} /></Field>
            <Field label="التوفر"><Select value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} options={Object.entries(AV)} /></Field>
            <Field label="مسار الإنتاج"><Select value={f.route_id || ''} onChange={(e) => setF({ ...f, route_id: e.target.value })} placeholder="تلقائي" options={(lookups?.routes || []).map((r) => [r.id, r.name])} /></Field>
          </div>
          <StonesSection f={f} setF={setF} />
          <Field label="العيارات"><div className="chips">{[18, 21, 24].map((k) => <button type="button" key={k} className={`chip ${(f.karats || []).includes(k) ? 'on' : ''}`} onClick={() => toggle('karats', k)}>{k}</button>)}</div></Field>
          <Field label="الألوان"><div className="chips">{Object.entries(COLORS).map(([k, v]) => <button type="button" key={k} className={`chip ${(f.colors || []).includes(k) ? 'on' : ''}`} onClick={() => toggle('colors', k)}>{v}</button>)}</div></Field>
          <Field label="الوصف"><Textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <FilePicker label="الصور والفيديو" accept="image/*,video/*" value={f.files || []} hint="أضف صورة بعد صورة — تُرفع كلها عند الحفظ. اضغط ★ لتحديد الصورة الرئيسية"
            onChange={(files) => setF({ ...f, files, main: f.main?.new != null && f.main.new >= files.length ? null : f.main })}
            main={f.main?.new ?? (!f.main && !f.media?.length && f.files?.length ? 0 : null)} onMain={(i) => setF({ ...f, main: { new: i } })} />
          {f.media?.length > 0 && <div className="files">{f.media.map((m, i) => {
            const isMain = f.main ? f.main.media === m.id : i === 0;
            return (
              <span key={m.id} className={`media-item ${isMain ? 'main' : ''}`}>
                {m.kind === 'video' ? <span className="doc">فيديو</span> : <img src={fileUrl(m.path, 400)} alt="" />}
                {isMain ? <span className="media-main-tag">★ الرئيسية</span> : <button type="button" className="link small" onClick={() => setF({ ...f, main: { media: m.id } })}>☆ تعيين رئيسية</button>}
                <button type="button" className="link small text-danger" onClick={() => setF({ ...f, remove_media: [...(f.remove_media || []), m.id], media: f.media.filter((x) => x.id !== m.id), main: f.main?.media === m.id ? null : f.main })}>حذف</button>
              </span>
            );
          })}</div>}
          <label className="check"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ظاهر في المتجر</label>
          <div className="hrow end gap">
            {f.id && <Btn kind="danger" loading={busy} onClick={() => remove(f)}>حذف المنتج</Btn>}
            <Btn loading={busy} disabled={!f.product_type || !f.name} onClick={save}>حفظ</Btn>
          </div>
        </>}
      </Modal>
    </Page>
  );
}

const STONE_FIELDS = [['pearl_weight', 'اللؤلؤ', 'وزن اللؤلؤ (جم)'], ['stone_weight', 'الحجر', 'وزن الحجر (قيراط)'], ['zircon_weight', 'الزركون', 'وزن الزركون (جم)']];

/** تفاصيل أحجار المنتج: الألماس يُختار من مخزون الألماس ويُحجز عند اعتماد الطلب، والباقي للعرض فقط */
function StonesSection({ f, setF }) {
  const { data: lots } = useFetch('/catalog/diamond-lots');
  const has = f.has_diamonds ?? (f.diamonds || []).length > 0;
  const list = f.diamonds || [];
  const setList = (l) => setF({ ...f, diamonds: l, has_diamonds: true });
  const upd = (i, k, v) => setList(list.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');
  const opts = (lots || []).map((l) => [l.id, `${l.shape_name} — ${l.size_label || ''}${l.color ? ` ${l.color}` : ''}${l.clarity ? ` ${l.clarity}` : ''} ${l.stock_carats != null ? ` (متوفر ${Number(l.stock_carats)} ct)` : l.available ? ' (متوفر)' : ' (غير متوفر حالياً)'}`]);
  const shown = (k) => f[`show_${k}`] ?? (f[k] != null && f[k] !== '');
  return (
    <div className="card mb-3">
      <div className="card-header bg-transparent py-2"><b>تفاصيل الأحجار</b> <span className="small text-body-secondary">(اختياري — لكل قطعة)</span></div>
      <div className="card-body d-grid gap-3">
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className={`chip ${has ? 'on' : ''}`} onClick={() => setF({ ...f, has_diamonds: !has, diamonds: !has && !list.length ? [{ lot_id: '', carats: '', count: '' }] : list })}>💎 الألماس المخبري</button>
          {STONE_FIELDS.map(([k, l]) => <button key={k} type="button" className={`chip ${shown(k) ? 'on' : ''}`} onClick={() => setF({ ...f, [`show_${k}`]: !shown(k), [k]: shown(k) ? null : f[k] })}>{l}</button>)}
        </div>
        {has && (
          <div className="d-grid gap-2">
            {list.map((d, i) => (
              <div key={i} className="grid g3 align-items-end">
                <Field label={`نوع الألماس المخبري ${list.length > 1 ? i + 1 : ''}`}><Select value={d.lot_id || ''} onChange={(e) => upd(i, 'lot_id', e.target.value)} placeholder={lots ? 'اختر من مخزون الألماس المخبري' : 'جارٍ التحميل…'} options={opts} /></Field>
                <Field label="الوزن (قيراط)"><Input dir="ltr" inputMode="decimal" value={d.carats ?? ''} onChange={(e) => upd(i, 'carats', num(e.target.value))} /></Field>
                <div className="d-flex gap-2 align-items-end">
                  <Field label="عدد الحبات" className="flex-grow-1"><Input dir="ltr" inputMode="numeric" value={d.count ?? ''} onChange={(e) => upd(i, 'count', e.target.value.replace(/\D/g, ''))} /></Field>
                  <Btn kind="ghost" size="sm" onClick={() => setList(list.filter((_, j) => j !== i))}>حذف</Btn>
                </div>
              </div>
            ))}
            <div><Btn kind="ghost" size="sm" onClick={() => setList([...list, { lot_id: '', carats: '', count: '' }])}>+ نوع ألماس مخبري آخر</Btn></div>
            <div className="small text-body-secondary">عند اعتماد أي طلب لهذا المنتج يُخصم الألماس المخبري من المخزون (الوزن × عدد القطع) ويُحجز للطلب، ويُعاد للمخزون إذا أُلغي الطلب.</div>
          </div>
        )}
        {STONE_FIELDS.some(([k]) => shown(k)) && (
          <div className="grid g3">
            {STONE_FIELDS.filter(([k]) => shown(k)).map(([k, , label]) => <Field key={k} label={label} hint="للعرض فقط"><Input dir="ltr" inputMode="decimal" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: num(e.target.value) })} /></Field>)}
          </div>
        )}
      </div>
    </div>
  );
}
