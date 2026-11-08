// المتجر العام: تصفح المنتجات بدون تسجيل دخول. لا أسعار مصنعية ولا إرسال طلبات للزوار.
import { Router } from 'express';
import { many, one, pool } from '../db.js';
import { routeStages, hasDiamonds } from '../lib/production.js';
import { getPricing, checkToken, shortView } from '../lib/pricingSheet.js';
import { checkShareToken } from '../lib/shareLinks.js';
import { invoiceDetail, withInvoiceExtras } from './finance.js';
import { notFound, int } from '../lib/http.js';
import { visibleTo } from '../lib/audience.js';

const r = Router();
// تصفح المنتجات يتطلب تسجيل الدخول (حساب محل أو موظف) — روابط التتبع والتسعيرة والمخزون تبقى بالرمز السري
const needLogin = (req, _res, next) => (req.user ? next() : next(Object.assign(new Error('يجب تسجيل الدخول لتصفح المتجر'), { status: 401 })));
const COLS = `p.id, p.sku, p.name, p.product_type, p.description, p.karats, p.colors, p.approx_weight::text, p.final_weight::text, p.sizes, p.availability,
  case when p.availability = 'available' and p.stock_qty > 0 then true else false end as in_stock,
  coalesce((select json_agg(json_build_object('path', m.path, 'kind', m.kind) order by m.sort, m.id) from product_media m where m.product_id=p.id), '[]') as media,
  p.pearl_weight::text, p.stone_weight::text, p.zircon_weight::text,
  coalesce((select json_agg(json_build_object('shape', s.name, 'size', l.size_label, 'color', l.color, 'clarity', l.clarity, 'carats', (d->>'carats')::numeric, 'count', (d->>'count')::int))
    from jsonb_array_elements(p.diamonds) d join stone_lots l on l.id=(d->>'lot_id')::int left join stone_shapes s on s.id=l.shape_id), '[]') as diamond_details,
  jsonb_array_length(p.diamonds) > 0 as has_diamond, coalesce(p.pearl_weight, 0) > 0 as has_pearl, coalesce(p.stone_weight, 0) > 0 as has_stone,
  (jsonb_array_length(p.diamonds) = 0 and coalesce(p.pearl_weight, 0) = 0 and coalesce(p.stone_weight, 0) = 0 and p.bullion_type is null) as is_gold, p.bullion_type is not null as has_bullion, p.bullion_type, p.bullion_weight::text`;

r.get('/products', needLogin, async (req, res) => {
  const f = req.query;
  const limit = Math.min(Math.max(int(f.limit ?? 48, 'limit'), 1), 200);
  const offset = Math.max(int(f.offset ?? 0, 'offset'), 0);
  const params = [f.type || null, f.karat ? int(f.karat) : null, String(f.q ?? '').trim() ? `%${String(f.q).trim().replace(/[%_\\]/g, (c) => '\\' + c)}%` : null, ['gold', 'diamond', 'pearl', 'stone', 'bullion'].includes(f.cat) ? f.cat : null, req.user.customer_id ?? null];
  const where = `p.active and p.availability <> 'unavailable' and ${visibleTo(5)}
      and ($1::text is null or p.product_type=$1) and ($2::int is null or $2 = any(p.karats)) and ($3::text is null or p.name ilike $3 or p.sku ilike $3 or p.product_type ilike $3)
      and ($4::text is null or ($4='diamond' and jsonb_array_length(p.diamonds) > 0) or ($4='pearl' and coalesce(p.pearl_weight,0) > 0)
        or ($4='stone' and coalesce(p.stone_weight,0) > 0) or ($4='bullion' and p.bullion_type is not null)
        or ($4='gold' and jsonb_array_length(p.diamonds) = 0 and coalesce(p.pearl_weight,0) = 0 and coalesce(p.stone_weight,0) = 0 and p.bullion_type is null))`;
  const rows = await many(`select ${LIST_COLS} from products p where ${where} order by p.id desc limit ${limit + 1} offset ${offset}`, params);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const total = offset === 0 ? (await one(`select count(*)::int n from products p where ${where}`, params)).n : undefined;
  const types = offset === 0 ? (await many(`select distinct p.product_type from products p where p.active and p.availability <> 'unavailable' and ${visibleTo(1)} order by 1`, [req.user.customer_id ?? null])).map((t) => t.product_type) : undefined;
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.json({ products: rows, types, total, has_more: hasMore, offset });
});

r.get('/products/:id', needLogin, async (req, res) => {
  const p = await one(`select ${COLS} from products p where p.id=$1 and p.active and p.availability <> 'unavailable' and ${visibleTo(2)}`, [int(req.params.id), req.user.customer_id ?? null]);
  if (!p) throw notFound('المنتج غير متوفر');
  res.json(p);
});

// أعمدة القائمة: صورة الغلاف فقط وبدون تفاصيل الألماس (تُجلب في صفحة المنتج)
const LIST_COLS = `p.id, p.sku, p.name, p.product_type, p.karats, p.colors, p.approx_weight::text, p.final_weight::text, p.sizes, p.availability,
  case when p.availability = 'available' and p.stock_qty > 0 then true else false end as in_stock,
  coalesce((select json_build_array(json_build_object('path', m.path, 'kind', m.kind)) from product_media m where m.product_id=p.id order by m.sort, m.id limit 1), '[]') as media,
  jsonb_array_length(p.diamonds) > 0 as has_diamond, coalesce(p.pearl_weight, 0) > 0 as has_pearl, coalesce(p.stone_weight, 0) > 0 as has_stone,
  (jsonb_array_length(p.diamonds) = 0 and coalesce(p.pearl_weight, 0) = 0 and coalesce(p.stone_weight, 0) = 0 and p.bullion_type is null) as is_gold, p.bullion_type is not null as has_bullion, p.bullion_type, p.bullion_weight::text`;

/**
 * تتبع الطلب برابط خاص (بدون تسجيل دخول): عرض فقط للمرحلة التي وصل لها الطلب.
 * الرابط يحمل رمزاً عشوائياً سرياً لكل طلب، ولا يعرض أوزاناً أو أسعاراً أو بيانات عملاء أو عمال.
 */
const TRACK_STATUS = { draft: 'مسودة', pending_review: 'قيد المراجعة', quoted: 'بانتظار الموافقة على العرض', approved: 'معتمد', in_production: 'قيد التصنيع', ready: 'جاهز للتسليم', delivered: 'تم التسليم', cancelled: 'ملغي', rejected: 'مرفوض', on_hold: 'متوقف مؤقتاً' };
r.get('/track/:token', async (req, res) => {
  const token = String(req.params.token || '').toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(token)) throw notFound('رابط التتبع غير صحيح');
  const o = await one(`select o.id, o.order_no, o.title, o.product_type, o.quantity, o.size, o.status, o.route_id, o.stage_seq, o.due_date, o.created_at, o.ready_at, o.delivered_at,
      m.karat, coalesce(o.color, m.color) as color, s.name as stage_name
    from orders o join materials m on m.id=o.material_id left join stages s on s.id=o.current_stage_id where o.qr_token=$1`, [token]);
  if (!o) throw notFound('رابط التتبع غير صحيح أو الطلب غير موجود');
  const diamond = await hasDiamonds(pool, o.id);
  const all = (o.route_id ? await routeStages(pool, o.route_id) : []).filter((s) => diamond || s.code !== 'lab');
  const delivered = o.status === 'delivered';
  const stages = all.filter((s) => s.customer_visible).map((s) => ({ name: s.name, state: delivered || s.seq < o.stage_seq ? 'done' : s.seq === o.stage_seq ? 'current' : 'next' }));
  const entered = await many(`select s.name as stage_name, min(l.created_at) as at from order_stage_log l join stages s on s.id=l.stage_id
    where l.order_id=$1 and l.event='entered' and s.customer_visible group by s.name`, [o.id]);
  const at = Object.fromEntries(entered.map((e) => [e.stage_name, e.at]));
  for (const s of stages) if (s.state !== 'next') s.at = at[s.name] || null;
  const total = all.length;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.json({
    order_no: o.order_no, title: o.title, product_type: o.product_type, quantity: o.quantity, size: o.size, karat: o.karat, color: o.color,
    status: o.status, status_label: TRACK_STATUS[o.status] || o.status, stage_name: delivered ? 'تم التسليم' : o.stage_name,
    progress: delivered ? 100 : total && o.stage_seq ? Math.round((100 * (o.stage_seq - 1)) / total) : 0,
    due_date: o.due_date, created_at: o.created_at, ready_at: o.ready_at, delivered_at: o.delivered_at, stages,
  });
});

/** الفاتورة برابط عام (عرض فقط): رمز سري لكل فاتورة يُطبع كـ QR عليها */
r.get('/invoice/:token', async (req, res) => {
  const token = String(req.params.token || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(token)) throw notFound('رابط الفاتورة غير صحيح');
  const row = await one('select id from invoices where public_token=$1', [token]);
  if (!row) throw notFound('رابط الفاتورة غير صحيح');
  const d = await withInvoiceExtras(await invoiceDetail(pool, row.id), req);
  delete d.invoice.notes_internal;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.json(d);
});

/** التسعيرة برابط خارجي: قراءة فقط (سعر الذهب والثوابت)، والأوزان تُدخل وتُحسب على جهاز الزائر ولا تُحفظ */
r.get('/pricing/:token', async (req, res) => {
  const view = await checkToken(pool, String(req.params.token || ''));
  if (!view) throw notFound('الرابط غير صحيح أو تم إيقافه');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const p = await getPricing(pool);
  if (view === 'full') return res.json({ ...p, view });
  // المختصرة: لا تُرسل الثوابت (المصنعية/الفائدة/التكاليف) — فقط النتائج المسموح بعرضها
  res.json({ view, gold24: p.gold24, updated_at: p.updated_at, sections: shortView(p) });
});

/** حساب التسعيرة المختصرة للأوزان التي يكتبها الزائر (لا يُحفظ شيء) */
r.post('/pricing/:token/calc', async (req, res) => {
  const view = await checkToken(pool, String(req.params.token || ''));
  if (view !== 'short') throw notFound('الرابط غير صحيح أو تم إيقافه');
  res.setHeader('Cache-Control', 'no-store');
  const p = await getPricing(pool);
  res.json({ sections: shortView(p, req.body?.weights || {}) });
});

/**
 * مخزون الألماس برابط خارجي (عرض فقط): المتوفر في المخزن لكل قصّة ومقاس.
 * لا يكشف الأسعار ولا العمال ولا الطلبات ولا أرقام الدفعات.
 */
r.get('/stones/:token', async (req, res) => {
  if (!(await checkShareToken(pool, 'stones_share', req.params.token))) throw notFound('الرابط غير صحيح أو تم إيقافه');
  const rows = await many(`select s.id as shape_id, s.name as shape, s.icon, s.sort_order, l.size_label, l.size_value, l.size_unit, l.stone_type, l.color, l.clarity,
      greatest(b.stock_carats, 0)::numeric(14,3)::text as carats, greatest(b.stock_count, 0) as count, l.min_carats::text as min_carats
    from stone_lots l join stone_lot_balances b on b.lot_id=l.id join stone_shapes s on s.id=l.shape_id
    where l.active order by s.sort_order, s.name, (l.size_unit='mm') desc, l.size_value nulls last, l.size_label`);
  const last = (await one('select max(created_at) as t from stone_movements')).t;
  const shapes = [];
  for (const x of rows) {
    let g = shapes.find((s) => s.id === x.shape_id);
    if (!g) { g = { id: x.shape_id, name: x.shape, icon: x.icon, carats: 0, count: 0, items: [] }; shapes.push(g); }
    const c = Number(x.carats);
    const status = c <= 0 ? 'out' : x.min_carats != null && c <= Number(x.min_carats) ? 'low' : 'ok';
    g.items.push({ size: x.size_label, type: x.stone_type, color: x.color, clarity: x.clarity, carats: c, count: Number(x.count), status });
    g.carats += c; g.count += Number(x.count);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.json({
    generated_at: new Date().toISOString(), last_movement_at: last,
    totals: { carats: shapes.reduce((a, s) => a + s.carats, 0), count: shapes.reduce((a, s) => a + s.count, 0), types: rows.length, available: rows.filter((x) => Number(x.carats) > 0).length },
    shapes,
  });
});

export default r;
