// المنتجات وقواعد أجور التصنيع
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, notFound, int, str, oneOf, weight as W, money } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { upload, registerFiles } from '../lib/uploads.js';
import { nextSku, PRODUCT_TYPES } from '../lib/sku.js';
import { parseDiamonds, optW } from '../lib/stoneReserve.js';

const r = Router();
const arr = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

r.get('/products', requirePerm('products.manage', 'orders.view'), async (_req, res) => {
  res.json(await many(`select p.*, p.approx_weight::text, p.final_weight::text, p.labor_rate::text,
      coalesce((select json_agg(json_build_object('id', m.id, 'path', m.path, 'kind', m.kind) order by m.sort, m.id) from product_media m where m.product_id=p.id), '[]') as media
    from products p where p.deleted_at is null order by p.active desc, p.id desc`));
});

/** السبائك: النوع (سبيكة/جنيه) ووزن القطعة — فارغ = لا يوجد */
export function bullionVals(b) {
  const t = b.bullion_type ? oneOf(b.bullion_type, ['bar', 'coin'], 'نوع السبائك') : null;
  return [t, t ? optW(b.bullion_weight, t === 'coin' ? 'وزن الجنيه' : 'وزن السبيكة') : null];
}

function productVals(b) {
  const karats = arr(b.karats).map((k) => int(k, 'العيار'));
  for (const k of karats) if (![18, 21, 24].includes(k)) throw bad('العيار يجب أن يكون 18 أو 21 أو 24');
  const colors = arr(b.colors);
  for (const c of colors) oneOf(c, ['yellow', 'white', 'rose'], 'اللون');
  return [
    str(b.sku, 'رقم المنتج'), str(b.name, 'اسم المنتج', { required: true }), str(b.product_type, 'نوع القطعة', { required: true }),
    str(b.description, 'الوصف'), karats.length ? karats : [21], colors.length ? colors : ['yellow'],
    b.approx_weight ? W(b.approx_weight, 'الوزن التقريبي') : null, b.final_weight ? W(b.final_weight, 'الوزن النهائي') : null, arr(b.sizes),
    b.labor_method ? oneOf(b.labor_method, ['per_gram', 'per_piece', 'fixed'], 'طريقة الأجرة') : null,
    b.labor_rate !== undefined && b.labor_rate !== '' && b.labor_rate !== null ? money(b.labor_rate, 'الأجرة', { allowZero: true }) : null,
    oneOf(b.availability || 'made_to_order', ['available', 'made_to_order', 'unavailable'], 'التوفر'),
    b.route_id ? int(b.route_id) : null, b.active === undefined ? true : b.active === true || b.active === 'true',
    JSON.stringify(parseDiamonds(b.diamonds)), optW(b.pearl_weight, 'وزن اللؤلؤ'), optW(b.stone_weight, 'وزن الحجر'), optW(b.zircon_weight, 'وزن الزركون'),
    ...bullionVals(b),
  ];
}


/** أنواع القطع وبادئاتها، ومعاينة رقم المنتج التالي لنوع معيّن */
/** أنواع الألماس المخبري لنموذج المنتج: متاحة لمدير المتجر بدون صلاحية المخزون (الكميات فقط لمن لديه صلاحية المخزون) */
r.get('/diamond-lots', requirePerm('products.manage', 'stones.view'), async (req, res) => {
  const full = req.user.perms.has('stones.view');
  const rows = await many(`select l.id, l.size_label, l.color, l.clarity, s.name as shape_name, b.stock_carats::text, (b.stock_carats > 0) as available
    from stone_lots l join stone_lot_balances b on b.lot_id=l.id join stone_shapes s on s.id=l.shape_id
    where l.active order by s.sort_order, s.name, (l.size_unit='mm') desc, l.size_value nulls last, l.size_label, l.id`);
  res.json(full ? rows : rows.map(({ stock_carats, ...x }) => x)); // eslint-disable-line no-unused-vars
});

r.get('/product-types', requirePerm('products.manage', 'orders.view'), async (_req, res) => {
  res.json(PRODUCT_TYPES.map(([name, prefix]) => ({ name, prefix })));
});
r.get('/next-sku', requirePerm('products.manage'), async (req, res) => {
  res.json({ sku: await nextSku(pool, req.query.type) });
});

/** الصورة الرئيسية: main_media (صورة محفوظة) أو main_new (ترتيب صورة مرفوعة الآن) تصبح الأولى */
async function setMainMedia(db, productId, body, newIds) {
  let main = null;
  if (body.main_new !== undefined && body.main_new !== '' && newIds[Number(body.main_new)]) main = newIds[Number(body.main_new)];
  else if (body.main_media) main = int(body.main_media, 'الصورة الرئيسية');
  if (!main) return;
  await db.query(`update product_media m set sort = x.rn from (
      select id, row_number() over (order by (id = $2) desc, sort, id) as rn from product_media where product_id = $1) x
    where m.id = x.id`, [productId, main]);
}

r.post('/products', requirePerm('products.manage'), upload.array('files', 20), async (req, res) => {
  res.json(await tx(async (db) => {
    const vals = productVals(req.body);
    // رقم المنتج يُولَّد تلقائياً من نوع القطعة (RIN، SW، NK...) إذا لم يُدخل يدوياً
    if (!vals[0]) vals[0] = await nextSku(db, vals[2], { lock: true });
    const p = (await db.query(`insert into products(sku, name, product_type, description, karats, colors, approx_weight, final_weight, sizes, labor_method, labor_rate, availability, route_id, active,
        diamonds, pearl_weight, stone_weight, zircon_weight, bullion_type, bullion_weight)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`, vals).catch((e) => { if (e.code === '23505') throw bad('رقم المنتج مستخدم'); throw e; })).rows[0];
    const files = await registerFiles(db, req.files, req.user.id);
    const ids = [];
    for (const [i, f] of files.entries()) ids.push((await db.query('insert into product_media(product_id, path, kind, sort) values ($1,$2,$3,$4) returning id', [p.id, f.path, f.mime?.startsWith('video') ? 'video' : 'image', i])).rows[0].id);
    await setMainMedia(db, p.id, req.body, ids);
    await audit(db, req, 'product.create', 'product', p.id, { sku: p.sku });
    return p;
  }));
});

r.put('/products/:id', requirePerm('products.manage'), upload.array('files', 20), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const before = (await db.query('select * from products where id=$1', [id])).rows[0];
    if (!before) throw notFound();
    const vals = productVals(req.body);
    if (!vals[0]) vals[0] = before.sku;
    await db.query(`update products set sku=$2, name=$3, product_type=$4, description=$5, karats=$6, colors=$7, approx_weight=$8, final_weight=$9, sizes=$10,
      labor_method=$11, labor_rate=$12, availability=$13, route_id=$14, active=$15,
      diamonds=$16, pearl_weight=$17, stone_weight=$18, zircon_weight=$19, bullion_type=$20, bullion_weight=$21 where id=$1`, [id, ...vals]).catch((e) => { if (e.code === '23505') throw bad('رقم المنتج مستخدم'); throw e; });
    const files = await registerFiles(db, req.files, req.user.id);
    const ids = [];
    for (const f of files) ids.push((await db.query('insert into product_media(product_id, path, kind, sort) values ($1,$2,$3,99) returning id', [id, f.path, f.mime?.startsWith('video') ? 'video' : 'image'])).rows[0].id);
    for (const mid of arr(req.body.remove_media)) await db.query('delete from product_media where id=$1 and product_id=$2', [int(mid), id]);
    await setMainMedia(db, id, req.body, ids);
    await audit(db, req, 'product.update', 'product', id, { before, after: req.body });
    return { ok: true };
  }));
});

/** إظهار/إخفاء المنتج في المتجر بضغطة واحدة */
r.post('/products/:id/visibility', requirePerm('products.manage'), async (req, res) => {
  const id = int(req.params.id);
  const active = !!req.body.active;
  const p = await one('update products set active=$2 where id=$1 and deleted_at is null returning id, active', [id, active]);
  if (!p) throw notFound();
  await audit(pool, req, 'product.visibility', 'product', id, { active });
  res.json(p);
});

/**
 * حذف منتج: يُمنع إن كان له مخزون جاهز (قطع أو ذهب)،
 * ويُحذف نهائياً إن لم يُستخدم، وإلا يُؤرشف (يختفي من القوائم والمتجر وتبقى الطلبات والسجلات سليمة).
 */
r.delete('/products/:id', requirePerm('products.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const p = (await db.query('select * from products where id=$1 and deleted_at is null for update', [id])).rows[0];
    if (!p) throw notFound('المنتج غير موجود');
    const gold = (await db.query("select coalesce(sum(balance),0)::numeric as g from gold_balances where loc_type='finished' and loc_ref=$1", [id])).rows[0].g;
    if (Number(p.stock_qty) > 0 || Number(gold) !== 0) throw bad(`لا يمكن حذف المنتج: يوجد له مخزون جاهز (${p.stock_qty} قطعة${Number(gold) ? ` / ${Number(gold).toFixed(3)} جم ذهب` : ''}) - اصرفه أو حوّله أولاً`);
    const used = (await db.query(`select exists (select 1 from orders where product_id=$1)
        or exists (select 1 from labor_rates where product_id=$1)
        or exists (select 1 from inventory_items where product_id=$1)
        or exists (select 1 from gold_ledger where (from_type='finished' and from_ref=$1) or (to_type='finished' and to_ref=$1)) as used`, [id])).rows[0].used;
    if (used) {
      await db.query('update products set deleted_at=now(), active=false where id=$1', [id]);
      await audit(db, req, 'product.archive', 'product', id, { sku: p.sku, name: p.name });
      return { ok: true, archived: true };
    }
    await db.query('delete from product_media where product_id=$1', [id]);
    await db.query('delete from products where id=$1', [id]);
    await audit(db, req, 'product.delete', 'product', id, { sku: p.sku, name: p.name });
    return { ok: true, deleted: true };
  }));
});

r.get('/labor-rates', requirePerm('labor.manage', 'orders.quote'), async (_req, res) => {
  res.json(await many(`select l.*, l.rate::text, p.name as product_name, c.shop_name, t.name as tier_name, s.name as stage_name, u.full_name as created_by_name
    from labor_rates l left join products p on p.id=l.product_id left join customers c on c.id=l.customer_id left join customer_tiers t on t.id=l.tier_id
    left join stages s on s.id=l.stage_id left join users u on u.id=l.created_by order by l.active desc, l.scope, l.id desc`));
});

function laborVals(b) {
  const scope = oneOf(b.scope, ['default', 'product_type', 'product', 'tier', 'customer', 'stage'], 'نطاق الأجرة');
  const v = {
    product_type: str(b.product_type, 'نوع المنتج'), product_id: b.product_id ? int(b.product_id) : null, tier_id: b.tier_id ? int(b.tier_id) : null,
    customer_id: b.customer_id ? int(b.customer_id) : null, stage_id: b.stage_id ? int(b.stage_id) : null,
  };
  if (scope === 'product_type' && !v.product_type) throw bad('حدد نوع المنتج');
  if (scope === 'product' && !v.product_id) throw bad('حدد المنتج');
  if (scope === 'tier' && !v.tier_id) throw bad('حدد فئة العملاء');
  if (scope === 'customer' && !v.customer_id) throw bad('حدد العميل');
  if (scope === 'stage' && !v.stage_id) throw bad('حدد المرحلة');
  return [str(b.name, 'اسم القاعدة', { required: true }), scope, v.product_type, v.product_id, v.tier_id, v.customer_id, v.stage_id,
    oneOf(b.method, ['per_gram', 'per_piece', 'fixed'], 'طريقة الاحتساب'), money(b.rate, 'الأجرة', { allowZero: true }), b.active !== false];
}

r.post('/labor-rates', requirePerm('labor.manage'), async (req, res) => {
  const l = await one(`insert into labor_rates(name, scope, product_type, product_id, tier_id, customer_id, stage_id, method, rate, active, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [...laborVals(req.body), req.user.id]);
  await audit(pool, req, 'labor.create', 'labor_rate', l.id, l);
  res.json(l);
});

/** تعديل الأجرة: يعطل القاعدة القديمة وينشئ جديدة للحفاظ على التاريخ */
r.put('/labor-rates/:id', requirePerm('labor.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const before = (await db.query('select * from labor_rates where id=$1', [id])).rows[0];
    if (!before) throw notFound();
    await db.query('update labor_rates set active=false where id=$1', [id]);
    let l = null;
    if (req.body.active !== false) l = (await db.query(`insert into labor_rates(name, scope, product_type, product_id, tier_id, customer_id, stage_id, method, rate, active, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [...laborVals({ ...before, ...req.body }), req.user.id])).rows[0];
    await audit(db, req, 'labor.update', 'labor_rate', id, { before, after: req.body, new_id: l?.id });
    return l || { ok: true };
  }));
});

export default r;
