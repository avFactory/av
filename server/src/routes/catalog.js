// المنتجات وقواعد أجور التصنيع
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, notFound, int, str, oneOf, weight as W, money } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { upload, registerFiles } from '../lib/uploads.js';

const r = Router();
const arr = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

r.get('/products', requirePerm('products.manage', 'orders.view'), async (_req, res) => {
  res.json(await many(`select p.*, p.approx_weight::text, p.final_weight::text, p.labor_rate::text,
      coalesce((select json_agg(json_build_object('id', m.id, 'path', m.path, 'kind', m.kind) order by m.sort, m.id) from product_media m where m.product_id=p.id), '[]') as media
    from products p order by p.active desc, p.id desc`));
});

function productVals(b) {
  const karats = arr(b.karats).map((k) => int(k, 'العيار'));
  for (const k of karats) if (![18, 21, 22, 24].includes(k)) throw bad('العيار يجب أن يكون 18 أو 21 أو 22 أو 24');
  const colors = arr(b.colors);
  for (const c of colors) oneOf(c, ['yellow', 'white', 'rose'], 'اللون');
  return [
    str(b.sku, 'رقم المنتج', { required: true }), str(b.name, 'اسم المنتج', { required: true }), str(b.product_type, 'نوع القطعة', { required: true }),
    str(b.description, 'الوصف'), karats.length ? karats : [21], colors.length ? colors : ['yellow'],
    b.approx_weight ? W(b.approx_weight, 'الوزن التقريبي') : null, b.final_weight ? W(b.final_weight, 'الوزن النهائي') : null, arr(b.sizes),
    b.labor_method ? oneOf(b.labor_method, ['per_gram', 'per_piece', 'fixed'], 'طريقة الأجرة') : null,
    b.labor_rate !== undefined && b.labor_rate !== '' && b.labor_rate !== null ? money(b.labor_rate, 'الأجرة', { allowZero: true }) : null,
    oneOf(b.availability || 'made_to_order', ['available', 'made_to_order', 'unavailable'], 'التوفر'),
    b.route_id ? int(b.route_id) : null, b.active === undefined ? true : b.active === true || b.active === 'true',
  ];
}

r.post('/products', requirePerm('products.manage'), upload.array('files', 10), async (req, res) => {
  res.json(await tx(async (db) => {
    const p = (await db.query(`insert into products(sku, name, product_type, description, karats, colors, approx_weight, final_weight, sizes, labor_method, labor_rate, availability, route_id, active)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`, productVals(req.body)).catch((e) => { if (e.code === '23505') throw bad('رقم المنتج مستخدم'); throw e; })).rows[0];
    const files = await registerFiles(db, req.files, req.user.id);
    for (const [i, f] of files.entries()) await db.query('insert into product_media(product_id, path, kind, sort) values ($1,$2,$3,$4)', [p.id, f.path, f.mime?.startsWith('video') ? 'video' : 'image', i]);
    await audit(db, req, 'product.create', 'product', p.id, { sku: p.sku });
    return p;
  }));
});

r.put('/products/:id', requirePerm('products.manage'), upload.array('files', 10), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const before = (await db.query('select * from products where id=$1', [id])).rows[0];
    if (!before) throw notFound();
    await db.query(`update products set sku=$2, name=$3, product_type=$4, description=$5, karats=$6, colors=$7, approx_weight=$8, final_weight=$9, sizes=$10,
      labor_method=$11, labor_rate=$12, availability=$13, route_id=$14, active=$15 where id=$1`, [id, ...productVals(req.body)]);
    const files = await registerFiles(db, req.files, req.user.id);
    for (const f of files) await db.query('insert into product_media(product_id, path, kind, sort) values ($1,$2,$3,99)', [id, f.path, f.mime?.startsWith('video') ? 'video' : 'image']);
    for (const mid of arr(req.body.remove_media)) await db.query('delete from product_media where id=$1 and product_id=$2', [int(mid), id]);
    await audit(db, req, 'product.update', 'product', id, { before, after: req.body });
    return { ok: true };
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
