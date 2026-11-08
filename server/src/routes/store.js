// المتجر الإلكتروني بالجملة - لأصحاب محلات الذهب المعتمدين فقط
// لا تظهر للعميل أي معلومات داخلية: العهد، نسب العجز، أسماء العمال، حركات الذهب.
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm, loginThrottle } from '../lib/auth.js';
import { HttpError, bad, conflict, forbidden, notFound, int, str, oneOf, weight as W } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyPerm } from '../lib/notify.js';
import { upload, registerFiles } from '../lib/uploads.js';
import { resolveLabor, resolveLaborMany, laborAmount } from '../lib/labor.js';
import * as prod from '../lib/production.js';
import * as ledger from '../lib/ledger.js';
import { materialFor, orderColor } from './orders.js';
import { parseDiamonds, optW, releaseDiamonds } from '../lib/stoneReserve.js';
import { invoiceDetail, withInvoiceExtras } from './finance.js';
import { newGroupNo, nextItemNo } from '../lib/orderGroups.js';
import { bullionVals } from './catalog.js';
import { applyDueDate, leadDays, orderCategory } from '../lib/leadTime.js';
import { visibleTo } from '../lib/audience.js';
import { listBranches, createBranch, updateBranch, assertMainAccount } from '../lib/branches.js';

const r = Router();
r.use(requirePerm('store.access'));

r.get('/account', async (req, res) => {
  const c = await one('select c.*, t.name as tier_name, t.color as tier_color from customers c left join customer_tiers t on t.id=c.tier_id where c.id=$1', [req.user.customer_id]);
  const bal = await one(`select
      coalesce((select sum(case when invoice_type='invoice' then total else -total end) from invoices where customer_id=$1 and status='issued'),0)::text as invoiced,
      coalesce((select sum(case when kind='refund' then -amount else amount end) from payments where customer_id=$1),0)::text as paid`, [req.user.customer_id]);
  const docs = await many('select id, path, original_name, mime, doc_type, created_at from customer_documents where customer_id=$1 order by id', [req.user.customer_id]);
  const branch = req.user.branch_id ? await one('select id, name, city, address, phone from customer_branches where id=$1', [req.user.branch_id]) : null;
  res.json({ customer: c, balance: (Number(bal.invoiced) - Number(bal.paid)).toFixed(2), ...bal, docs, branch, is_main: !req.user.branch_id });
});

/** رفع بيانات ومستندات المنشأة (سجل تجاري، شهادة ضريبية...) */
r.post('/account/documents', upload.array('files', 5), async (req, res) => {
  assertMainAccount(req);
  res.json(await tx(async (db) => {
    const files = await registerFiles(db, req.files, req.user.id);
    if (!files.length) throw bad('اختر الملفات');
    for (const f of files) await db.query('insert into customer_documents(customer_id, path, original_name, mime) values ($1,$2,$3,$4)', [req.user.customer_id, f.path, f.original_name, f.mime]);
    await audit(db, req, 'customer.documents', 'customer', req.user.customer_id, { count: files.length });
    return { ok: true };
  }));
});

r.put('/account', async (req, res) => {
  assertMainAccount(req);
  const b = req.body;
  const c = await one('select * from customers where id=$1', [req.user.customer_id]);
  await pool.query('update customers set owner_name=$2, phone=$3, email=$4, city=$5, address=$6, vat_number=$7, cr_number=$8 where id=$1',
    [c.id, str(b.owner_name ?? c.owner_name, 'المالك'), str(b.phone ?? c.phone, 'الجوال'), str(b.email ?? c.email, 'البريد'), str(b.city ?? c.city, 'المدينة'),
     str(b.address ?? c.address, 'العنوان'), c.status === 'approved' ? c.vat_number : str(b.vat_number ?? c.vat_number, 'الرقم الضريبي'), c.status === 'approved' ? c.cr_number : str(b.cr_number ?? c.cr_number, 'السجل')]);
  await audit(pool, req, 'customer.self_update', 'customer', c.id, { before: c, after: b });
  res.json({ ok: true });
});

/** فروع المحل: يديرها الحساب الرئيسي فقط */
r.get('/branches', async (req, res) => {
  assertMainAccount(req);
  res.json(await listBranches(pool, req.user.customer_id));
});
r.post('/branches', async (req, res) => {
  assertMainAccount(req);
  res.json(await tx((db) => createBranch(db, req, req.user.customer_id, req.body)));
});
r.put('/branches/:id', async (req, res) => {
  assertMainAccount(req);
  res.json(await tx((db) => updateBranch(db, req, req.user.customer_id, req.params.id, req.body)));
});

// ما بعد هذا يتطلب حساباً معتمداً
r.use((req, _res, next) => {
  if (req.user.customer_status !== 'approved') throw new HttpError(403, 'حسابكم بانتظار موافقة إدارة المصنع');
  next();
});

r.get('/products', async (req, res) => {
  const f = req.query;
  // صفحات: 48 منتجاً في كل مرة (التمرير يجلب المزيد)، وصورة الغلاف فقط في القائمة
  const limit = Math.min(Math.max(int(f.limit ?? 48, 'limit', { min: 1 }), 1), 200);
  const offset = Math.max(int(f.offset ?? 0, 'offset', { min: 0 }), 0);
  const params = [f.type || null, f.karat ? int(f.karat) : null, String(f.q ?? '').trim() ? `%${String(f.q).trim().replace(/[%_\\]/g, (c) => '\\' + c)}%` : null, ['gold', 'diamond', 'pearl', 'stone', 'bullion'].includes(f.cat) ? f.cat : null, req.user.customer_id ?? null];
  const where = `p.active and p.availability <> 'unavailable' and ${visibleTo(5)}
      and ($1::text is null or p.product_type=$1) and ($2::int is null or $2 = any(p.karats)) and ($3::text is null or p.name ilike $3 or p.sku ilike $3 or p.product_type ilike $3)
      and ($4::text is null or ($4='diamond' and jsonb_array_length(p.diamonds) > 0) or ($4='pearl' and coalesce(p.pearl_weight,0) > 0)
        or ($4='stone' and coalesce(p.stone_weight,0) > 0) or ($4='bullion' and p.bullion_type is not null)
        or ($4='gold' and jsonb_array_length(p.diamonds) = 0 and coalesce(p.pearl_weight,0) = 0 and coalesce(p.stone_weight,0) = 0 and p.bullion_type is null))`;
  const rows = await many(`select p.id, p.sku, p.name, p.product_type, p.karats, p.colors, p.approx_weight::text, p.final_weight::text, p.sizes,
      p.stock_qty, p.availability, p.labor_method, p.labor_rate,
      coalesce((select json_build_array(json_build_object('path', m.path, 'kind', m.kind)) from product_media m where m.product_id=p.id order by m.sort, m.id limit 1), '[]') as media,
      jsonb_array_length(p.diamonds) > 0 as has_diamond, coalesce(p.pearl_weight, 0) > 0 as has_pearl, coalesce(p.stone_weight, 0) > 0 as has_stone,
  (jsonb_array_length(p.diamonds) = 0 and coalesce(p.pearl_weight, 0) = 0 and coalesce(p.stone_weight, 0) = 0 and p.bullion_type is null) as is_gold, p.bullion_type is not null as has_bullion, p.bullion_type, p.bullion_weight::text
    from products p where ${where}
    order by p.id desc limit ${limit + 1} offset ${offset}`, params);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const labor = await resolveLaborMany(pool, req.user.customer_id, rows);
  for (const p of rows) {
    const l = labor.get(p.id);
    p.labor = l ? { method: l.method, rate: l.rate, estimate: laborAmount(l.method, l.rate, p.final_weight || p.approx_weight, 1) } : null;
    delete p.labor_method; delete p.labor_rate;
  }
  const total = offset === 0 ? (await one(`select count(*)::int n from products p where ${where}`, params)).n : undefined;
  const types = offset === 0 ? (await many(`select distinct p.product_type from products p where p.active and ${visibleTo(1)} order by 1`, [req.user.customer_id ?? null])).map((t) => t.product_type) : undefined;
  res.json({ products: rows, types, total, has_more: hasMore, offset });
});

r.get('/products/:id', async (req, res) => {
  const p = await one(`select p.id, p.sku, p.name, p.product_type, p.description, p.karats, p.colors, p.approx_weight::text, p.final_weight::text, p.sizes, p.stock_qty, p.availability,
      coalesce((select json_agg(json_build_object('path', m.path, 'kind', m.kind) order by m.sort, m.id) from product_media m where m.product_id=p.id), '[]') as media,
      p.pearl_weight::text, p.stone_weight::text, p.zircon_weight::text, p.bullion_type, p.bullion_weight::text,
      coalesce((select json_agg(json_build_object('shape', s.name, 'size', l.size_label, 'color', l.color, 'clarity', l.clarity, 'carats', (d->>'carats')::numeric, 'count', (d->>'count')::int))
        from jsonb_array_elements(p.diamonds) d join stone_lots l on l.id=(d->>'lot_id')::int left join stone_shapes s on s.id=l.shape_id), '[]') as diamond_details
    from products p where p.id=$1 and p.active and ${visibleTo(2)}`, [int(req.params.id), req.user.customer_id ?? null]);
  if (!p) throw notFound('المنتج غير متوفر');
  const l = await resolveLabor(pool, { customer_id: req.user.customer_id, product_id: p.id, product_type: p.product_type });
  p.labor = l ? { method: l.method, rate: l.rate, estimate: laborAmount(l.method, l.rate, p.final_weight || p.approx_weight, 1) } : null;
  // مدة التنفيذ المتوقعة لهذا العميل (لا تُعرض للمتوفر في المخزون)
  const inStock = p.availability === 'available' && Number(p.stock_qty) > 0;
  p.lead_days = inStock ? null : await leadDays(pool, { category: p.diamond_details?.length ? 'diamond' : orderCategory(p), customerId: req.user.customer_id });
  res.json(p);
});

/** مدة تنفيذ التصميم الخاص المتوقعة لهذا العميل (لصفحة "اطلب تصميمك") */
r.get('/lead-times', async (req, res) => {
  const gold = await leadDays(pool, { category: 'gold', customerId: req.user.customer_id });
  const diamond = await leadDays(pool, { category: 'diamond', customerId: req.user.customer_id });
  res.json({ gold, diamond, custom_gold: gold, custom_diamond: diamond, catalog_gold: gold, catalog_diamond: diamond });
});

/** إرسال سلة المنتجات الجاهزة: كل بند يصبح طلباً مستقلاً برقم وQR خاص (مرتبطة برقم السلة) */
r.post('/orders', async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('السلة فارغة');
  res.json(await tx(async (db) => {
    // طلب واحد برقم واحد، وكل صنف بند فيه (ORD-…-1، -2 …) يُصنَّع ويُتتبع مستقلاً
    const cartRef = await newGroupNo(db);
    const created = [];
    for (const [idx, it] of items.entries()) {
      const p = (await db.query(`select * from products p where p.id=$1 and p.active and ${visibleTo(2)} for update`, [int(it.product_id), req.user.customer_id ?? null])).rows[0];
      if (!p || p.availability === 'unavailable') throw bad('منتج غير متوفر');
      const karat = int(it.karat, 'العيار');
      if (!p.karats.includes(karat)) throw bad(`العيار ${karat} غير متاح للمنتج ${p.name}`);
      const color = it.color || p.colors[0];
      if (!p.colors.includes(color)) throw bad(`اللون غير متاح للمنتج ${p.name}`);
      if (p.sizes.length && it.size && !p.sizes.includes(String(it.size))) throw bad('المقاس غير متاح');
      const qty = int(it.quantity ?? 1, 'الكمية', { min: 1 });
      const labor = await resolveLabor(db, { customer_id: req.user.customer_id, product_id: p.id, product_type: p.product_type });
      const w = p.final_weight || p.approx_weight;
      const o = (await db.query(`insert into orders(order_no, customer_id, source, cart_ref, product_id, product_type, title, material_id, approx_weight, size, quantity, notes,
          status, labor_method, labor_rate, labor_estimate, created_by, route_id, branch_id, color, diamonds, pearl_weight, stone_weight, zircon_weight, bullion_type, bullion_weight)
        values ($22,$1,'store_catalog',$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_review',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$23,$24) returning *`,
        [req.user.customer_id, cartRef, p.id, p.product_type, p.name, await materialFor(db, karat), w ? (await db.query('select ($1::numeric * $2)::text v', [w, qty])).rows[0].v : null,
         str(it.size, 'المقاس'), qty, str(it.notes, 'ملاحظات'), labor?.method || null, labor?.rate || null,
         labor ? laborAmount(labor.method, labor.rate, w, 1) * (labor.method === 'fixed' ? 1 : qty) : null, req.user.id, p.route_id, req.user.branch_id || null, orderColor(color), JSON.stringify(p.diamonds || []), p.pearl_weight, p.stone_weight, p.zircon_weight, `${cartRef}-${idx + 1}`, p.bullion_type, p.bullion_weight])).rows[0];
      await prod.logStage(db, o.id, null, 'created', req.user.id, `طلب من المتجر (${cartRef})`, true);
      // المتوفر في المخزون لا يحتاج مدة تنفيذ
      if (!(p.availability === 'available' && Number(p.stock_qty) >= qty)) await applyDueDate(db, o.id);
      created.push(o);
    }
    await notifyPerm(db, 'orders.manage', { kind: 'order', title: `طلب جديد من ${req.user.shop_name}${req.user.branch_name ? ' - ' + req.user.branch_name : ''}`, body: `${created.length} صنف - ${cartRef}`, link: `/orders?q=${encodeURIComponent(cartRef)}` });
    await audit(db, req, 'store.order', 'cart', cartRef, { orders: created.map((o) => o.order_no) });
    return { cart_ref: cartRef, orders: created.map((o) => ({ id: o.id, order_no: o.order_no })) };
  }));
});

/** أنواع الألماس للاختيار في "اطلب تصميمك" (بدون كميات المخزون) */
r.get('/diamond-types', async (_req, res) => {
  res.json(await many(`select l.id, s.name as shape, s.icon, s.sort_order, l.size_label, l.color, l.clarity, (b.stock_carats > 0) as available
    from stone_lots l join stone_shapes s on s.id=l.shape_id join stone_lot_balances b on b.lot_id=l.id
    where l.active order by s.sort_order, s.name, (l.size_unit='mm') desc, l.size_value nulls last, l.size_label`));
});

/** اطلب تصميمك: تصنيع حسب الطلب مع رفع الصور والرسومات وملفات 3D */
r.post('/custom', upload.array('files', 20), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    // من السلة: يُربط برقم السلة نفسه مع بقية المنتجات (إن وُجد ويخص هذا العميل)، وإلا رقم سلة جديد
    let cartRef = null;
    if (b.from_cart) {
      const ref = str(b.cart_ref, 'رقم السلة', { max: 40 });
      cartRef = ref && (await db.query('select 1 from orders where cart_ref=$1 and customer_id=$2 limit 1', [ref, req.user.customer_id])).rows[0] ? ref
        : await newGroupNo(db);
    }
    const orderNo = cartRef ? await nextItemNo(db, cartRef) : null;
    const karat = oneOf(int(b.karat, 'العيار'), [18, 21, 24], 'العيار');
    const o = (await db.query(`insert into orders(order_no, customer_id, source, cart_ref, product_type, title, material_id, approx_weight, size, quantity, due_date, notes, status, design_approval_required, created_by, branch_id, color, diamonds, pearl_weight, stone_weight, zircon_weight, bullion_type, bullion_weight)
      values (coalesce($18, next_doc_no('ORD')),$1,'store_custom',$17,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review',true,$10,$11,$12,$13,$14,$15,$16,$19,$20) returning *`,
      [req.user.customer_id, str(b.product_type, 'نوع القطعة', { required: true }), str(b.title, 'اسم التصميم') || `تصميم خاص - ${b.product_type}`,
       await materialFor(db, karat), b.approx_weight ? W(b.approx_weight, 'الوزن التقريبي') : null, str(b.size, 'المقاس'),
       int(b.quantity ?? 1, 'الكمية', { min: 1 }), b.due_date || null, str(b.notes, 'الملاحظات', { max: 5000 }), req.user.id, req.user.branch_id || null, orderColor(b.color) || 'yellow',
       JSON.stringify(parseDiamonds(b.diamonds)), optW(b.pearl_weight, 'وزن اللؤلؤ'), optW(b.stone_weight, 'وزن الحجر'), optW(b.zircon_weight, 'وزن الزركون'), cartRef, orderNo, ...bullionVals(b)])).rows[0];
    const files = await registerFiles(db, req.files, req.user.id);
    let kinds = [];
    try { kinds = JSON.parse(b.file_kinds || '[]'); } catch { kinds = []; }
    for (const [i, f] of files.entries()) {
      const kind = /\.(stl|obj|3dm|step|stp|glb|gltf)$/i.test(f.path) ? 'model3d' : (kinds[i] === 'sketch' || (!kinds.length && b.file_kind === 'sketch') ? 'sketch' : 'reference');
      await db.query('insert into order_files(order_id, kind, path, original_name, mime, uploaded_by, customer_visible) values ($1,$2,$3,$4,$5,$6,true)', [o.id, kind, f.path, f.original_name, f.mime, req.user.id]);
    }
    await prod.logStage(db, o.id, null, 'created', req.user.id, 'طلب تصميم خاص', true);
    await applyDueDate(db, o.id);
    await notifyPerm(db, 'orders.quote', { kind: 'order', title: `طلب تصميم خاص من ${req.user.shop_name}`, body: o.order_no, link: `/orders/${o.id}` });
    await audit(db, req, 'store.custom', 'order', o.id, { files: files.length });
    return { id: o.id, order_no: o.order_no, cart_ref: cartRef };
  }));
});

async function myOrder(db, req, id, lock = false) {
  const o = (await db.query(`select * from orders where id=$1 ${lock ? 'for update' : ''}`, [int(id)])).rows[0];
  if (!o || o.customer_id !== req.user.customer_id) throw notFound('الطلب غير موجود');
  // حساب الفرع يرى طلبات فرعه فقط، والحساب الرئيسي يرى كل الفروع
  if (req.user.branch_id && o.branch_id !== req.user.branch_id) throw notFound('الطلب غير موجود');
  return o;
}

r.get('/orders', async (req, res) => {
  res.json(await many(`select o.id, o.order_no, o.title, o.status, o.quantity, o.due_date, o.created_at, o.design_status, o.labor_estimate::text, o.cart_ref,
      s.name as stage_name, m.name || coalesce(' ' || case o.color when 'yellow' then 'أصفر' when 'white' then 'أبيض' when 'rose' then 'روز' end, '') as material_name, o.stage_seq, br.name as branch_name,
      (select count(*) from route_stages rs where rs.route_id=o.route_id)::int as total_stages,
      (select f.path from order_files f where f.order_id=o.id and f.customer_visible and f.mime like 'image/%' order by f.id desc limit 1) as image,
      (select pm.path from product_media pm where pm.product_id=o.product_id order by pm.sort, pm.id limit 1) as product_image
    from orders o left join stages s on s.id=o.current_stage_id join materials m on m.id=o.material_id left join customer_branches br on br.id=o.branch_id
    where o.customer_id=$1 and ($2::int is null or o.branch_id=$2)
      and not (o.status='cancelled' and o.production_started_at is null) -- المحذوفة قبل القبول لا تظهر
    order by o.id desc`, [req.user.customer_id, req.user.branch_id || null]));
});

/** متابعة الطلب: بيانات العميل فقط (بدون عمال أو عهد أو نسب عجز) */
r.get('/orders/:id', async (req, res) => {
  const o = await myOrder(pool, req, req.params.id);
  const m = await one('select name, karat, color from materials where id=$1', [o.material_id]);
  const diamond = await prod.hasDiamonds(pool, o.id);
  const stages = o.route_id ? (await prod.routeStages(pool, o.route_id)).filter((s) => s.customer_visible && (diamond || s.code !== 'lab')).map((s) => ({ seq: s.seq, name: s.name })) : [];
  const total = o.route_id ? (await one('select count(*)::int n from route_stages where route_id=$1', [o.route_id])).n : 0;
  // منتجات الطلب (كل بنود نفس الطلب) بصورة مصغّرة وتفاصيل مختصرة
  const items = await many(`select o.id, o.order_no, o.title, o.product_type, o.quantity, o.size, o.status, o.approx_weight::text, o.final_weight::text,
      m.karat, coalesce(o.color, m.color) as color, s.name as stage_name,
      coalesce((select pm.path from product_media pm where pm.product_id=o.product_id and pm.kind='image' order by pm.sort, pm.id limit 1),
               (select f.path from order_files f where f.order_id=o.id and f.customer_visible and f.mime like 'image/%' order by f.id limit 1)) as image
    from orders o join materials m on m.id=o.material_id left join stages s on s.id=o.current_stage_id
    where o.customer_id=$1 and ($2::int is null or o.branch_id=$2) and (o.id=$3 or ($4::text is not null and o.cart_ref=$4))
      and (o.id=$3 or not (o.status='cancelled' and o.production_started_at is null))
    order by o.id`, [req.user.customer_id, req.user.branch_id || null, o.id, o.cart_ref || null]);
  const files = await many("select id, kind, path, original_name, mime from order_files where order_id=$1 and customer_visible order by id", [o.id]);
  const notes = await many("select note, created_at from order_stage_log where order_id=$1 and event='customer_note' order by id desc", [o.id]);
  const designs = await many('select id, file_ids, message, sent_at, status, customer_note, decided_at from design_reviews where order_id=$1 order by id desc', [o.id]);
  const invoices = await many(`select distinct i.id, i.invoice_no, i.total::text, i.invoice_type from invoice_lines l join invoices i on i.id=l.invoice_id where l.order_id=$1`, [o.id]);
  const stones = await one(`select o.pearl_weight::text, o.stone_weight::text, o.zircon_weight::text, o.bullion_type, o.bullion_weight::text,
      coalesce((select json_agg(json_build_object('shape', s2.name, 'size', l2.size_label, 'color', l2.color, 'clarity', l2.clarity, 'carats', (d->>'carats')::numeric, 'count', (d->>'count')::int))
        from jsonb_array_elements(o.diamonds) d join stone_lots l2 on l2.id=(d->>'lot_id')::int left join stone_shapes s2 on s2.id=l2.shape_id), '[]') as diamond_details
    from orders o where o.id=$1`, [o.id]);
  const productImage = o.product_id ? (await one('select path from product_media where product_id=$1 order by sort, id limit 1', [o.product_id]))?.path : null;
  const stageName = o.current_stage_id ? (await one('select name from stages where id=$1', [o.current_stage_id])).name : null;
  res.json({
    order: {
      id: o.id, order_no: o.order_no, title: o.title, status: o.status, branch_name: o.branch_id ? (await one('select name from customer_branches where id=$1', [o.branch_id]))?.name : null, karat: m.karat, color: o.color || m.color, material: m.name, size: o.size, quantity: o.quantity,
      approx_weight: o.approx_weight, final_weight: o.final_weight, labor_method: o.labor_method, labor_rate: o.labor_rate, labor_estimate: o.labor_estimate,
      quote_note: o.quote_note, quote_sent_at: o.quote_sent_at, customer_accepted_at: o.customer_accepted_at, due_date: o.due_date, notes: o.notes,
      design_status: o.design_status, design_approval_required: o.design_approval_required, stage_name: stageName, created_at: o.created_at,
      progress: total && o.stage_seq ? Math.round((100 * (o.status === 'delivered' ? total : o.stage_seq - 1)) / total) : 0, delivered_at: o.delivered_at,
      product_image: productImage, cart_ref: o.cart_ref,
      ...stones,
    },
    stages, current_seq: o.stage_seq, items, files, designs, invoices, notes,
  });
});

/** موافقة العميل على عرض الأجور => تحويل الطلب إلى أمر إنتاج */
r.post('/orders/:id/quote', async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await myOrder(db, req, req.params.id, true);
    if (o.status !== 'quoted') throw conflict('لا يوجد عرض بانتظار موافقتكم');
    const decision = oneOf(req.body.decision, ['accept', 'reject'], 'القرار');
    if (decision === 'reject') {
      await db.query("update orders set status='rejected', updated_at=now() where id=$1", [o.id]);
      await prod.logStage(db, o.id, null, 'quote', req.user.id, `رفض العميل العرض: ${req.body.note || ''}`, true);
      await notifyPerm(db, 'orders.quote', { kind: 'quote', title: `رفض العميل عرض ${o.order_no}`, body: req.body.note, link: `/orders/${o.id}` });
    } else {
      await db.query("update orders set customer_accepted_at=now(), status='approved' where id=$1", [o.id]);
      await prod.logStage(db, o.id, null, 'quote', req.user.id, 'وافق العميل على عرض الأجور', true);
      // إن لم يكفِ مخزون الألماس: تبقى موافقة العميل مسجلة، ويُنبَّه المصنع لاعتماد الطلب بعد توفير الألماس
      await db.query('savepoint start_prod');
      try {
        await prod.startProduction(db, { ...o, status: 'approved' }, req.user.id);
        await db.query('release savepoint start_prod');
        await notifyPerm(db, 'orders.manage', { kind: 'quote', title: `وافق العميل على عرض ${o.order_no} - تحول لأمر إنتاج`, link: `/orders/${o.id}` });
      } catch (e) {
        if (e.status !== 409) throw e;
        await db.query('rollback to savepoint start_prod');
        await notifyPerm(db, 'orders.manage', { kind: 'quote', title: `وافق العميل على عرض ${o.order_no} — لم يبدأ الإنتاج`, body: e.message, link: `/orders/${o.id}` });
      }
    }
    await audit(db, req, `store.quote.${decision}`, 'order', o.id, { note: req.body.note });
    return { ok: true };
  }));
});

/** اعتماد التصميم إلكترونياً / طلب تعديل / رفض */
r.post('/orders/:id/design', async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await myOrder(db, req, req.params.id, true);
    const decision = oneOf(req.body.decision, ['approved', 'changes_requested', 'rejected'], 'القرار');
    const note = str(req.body.note, 'الملاحظات', { max: 3000 });
    if (decision !== 'approved' && !note) throw bad('اكتب التعديلات المطلوبة أو سبب الرفض');
    const d = (await db.query("select * from design_reviews where order_id=$1 and status='pending' order by id desc limit 1 for update", [o.id])).rows[0];
    if (!d) throw conflict('لا يوجد تصميم بانتظار اعتمادكم');
    await db.query('update design_reviews set status=$2, customer_note=$3, decided_by=$4, decided_at=now() where id=$1', [d.id, decision, note, req.user.id]);
    await db.query(`update orders set design_status=$2, design_approved_at=case when $2='approved' then now() else design_approved_at end, updated_at=now() where id=$1`, [o.id, decision]);
    const label = { approved: 'اعتمد العميل التصميم', changes_requested: 'طلب العميل تعديل التصميم', rejected: 'رفض العميل التصميم' }[decision];
    await prod.logStage(db, o.id, o.current_stage_id, 'design', req.user.id, `${label}${note ? ': ' + note : ''}`, true);
    await notifyPerm(db, 'design.manage', { kind: 'design', title: `${label} - ${o.order_no}`, body: note, link: `/orders/${o.id}` });
    await audit(db, req, `design.${decision}`, 'order', o.id, { review: d.id, note, at: new Date().toISOString() });
    return { ok: true };
  }));
});

/**
 * حذف طلب لم يُقبل بعد (بانتظار المراجعة أو عرض الأجور): يُلغى ويختفي من طلباتي.
 * all: true يحذف كل بنود الطلب التي لم تُقبل بعد.
 */
r.post('/orders/:id/cancel', async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await myOrder(db, req, req.params.id, true);
    const ids = req.body.all && o.cart_ref
      ? (await db.query(`select id from orders where cart_ref=$1 and customer_id=$2 and ($3::int is null or branch_id=$3) and status in ('pending_review','quoted') order by id for update`,
          [o.cart_ref, req.user.customer_id, req.user.branch_id || null])).rows.map((x) => x.id)
      : [o.id];
    const done = [];
    for (const id of ids) {
      const x = (await db.query('select * from orders where id=$1 for update', [id])).rows[0];
      if (!['pending_review', 'quoted'].includes(x.status)) throw conflict(`الطلب ${x.order_no} قُبل وبدأ تجهيزه - لا يمكن حذفه، تواصل مع المصنع`);
      await db.query("update orders set status='cancelled', updated_at=now() where id=$1", [id]);
      await releaseDiamonds(db, id, req.user.id, `حذف العميل للطلب ${x.order_no}`);
      await prod.logStage(db, id, null, 'status', req.user.id, 'حذف العميل الطلب قبل قبوله', false);
      done.push(x.order_no);
    }
    await notifyPerm(db, 'orders.manage', { kind: 'order', title: `حذف ${req.user.shop_name} طلباً قبل قبوله`, body: done.join('، '), link: `/orders?q=${encodeURIComponent(o.cart_ref || o.order_no)}` });
    await audit(db, req, 'store.order_cancel', 'order', o.id, { orders: done });
    return { ok: true, cancelled: done };
  }));
});

/** ملاحظة من العميل على طلب قيد التصنيع (تصل للمصنع فوراً) */
r.post('/orders/:id/note', async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await myOrder(db, req, req.params.id);
    if (!['approved', 'in_production'].includes(o.status)) throw conflict('الملاحظات متاحة للطلبات قيد التصنيع');
    const note = str(req.body.note, 'الملاحظة', { required: true, max: 1000 });
    loginThrottle(`cnote:${req.user.id}`, 30);
    await prod.logStage(db, o.id, o.current_stage_id, 'customer_note', req.user.id, note, true);
    await notifyPerm(db, 'orders.manage', { kind: 'order', title: `ملاحظة من ${req.user.shop_name} على ${o.order_no}`, body: note, link: `/orders/${o.id}` });
    await notifyPerm(db, 'orders.advance', { kind: 'order', title: `ملاحظة من العميل على ${o.order_no}`, body: note, link: `/orders/${o.id}` });
    await audit(db, req, 'store.order_note', 'order', o.id, { note });
    return { ok: true };
  }));
});

r.get('/invoices', async (req, res) => {
  res.json(await many(`select id, invoice_no, invoice_type, issue_date, subtotal::text, vat_amount::text, total::text, status,
      coalesce((select sum(case when kind='refund' then -amount else amount end) from payments p where p.invoice_id=i.id),0)::text as paid
    from invoices i where customer_id=$1
      and ($2::int is null or exists (select 1 from invoice_lines l join orders o on o.id=l.order_id where l.invoice_id=i.id and o.branch_id=$2))
    order by id desc`, [req.user.customer_id, req.user.branch_id || null]));
});

r.get('/invoices/:id', async (req, res) => {
  const d = await invoiceDetail(pool, int(req.params.id));
  if (!d || d.invoice.customer_id !== req.user.customer_id) throw notFound();
  if (req.user.branch_id) {
    const own = await one('select 1 from invoice_lines l join orders o on o.id=l.order_id where l.invoice_id=$1 and o.branch_id=$2 limit 1', [d.invoice.id, req.user.branch_id]);
    if (!own) throw notFound();
  }
  res.json(await withInvoiceExtras(d, req));
});

export default r;
