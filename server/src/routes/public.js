// المتجر العام: تصفح المنتجات بدون تسجيل دخول. لا أسعار مصنعية ولا إرسال طلبات للزوار.
import { Router } from 'express';
import { many, one, pool } from '../db.js';
import { routeStages } from '../lib/production.js';
import { getPricing, checkToken } from '../lib/pricingSheet.js';
import { notFound, int } from '../lib/http.js';

const r = Router();
const COLS = `p.id, p.sku, p.name, p.product_type, p.description, p.karats, p.colors, p.approx_weight::text, p.final_weight::text, p.sizes, p.availability,
  case when p.availability = 'available' and p.stock_qty > 0 then true else false end as in_stock,
  coalesce((select json_agg(json_build_object('path', m.path, 'kind', m.kind) order by m.sort, m.id) from product_media m where m.product_id=p.id), '[]') as media`;

r.get('/products', async (req, res) => {
  const f = req.query;
  const rows = await many(`select ${COLS} from products p where p.active and p.availability <> 'unavailable'
      and ($1::text is null or p.product_type=$1) and ($2::int is null or $2 = any(p.karats)) and ($3::text is null or p.name ilike $3 or p.sku ilike $3)
    order by p.id desc limit 500`, [f.type || null, f.karat ? int(f.karat) : null, f.q ? `%${f.q}%` : null]);
  const types = await many("select distinct product_type from products where active and availability <> 'unavailable' order by 1");
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ products: rows, types: types.map((t) => t.product_type) });
});

r.get('/products/:id', async (req, res) => {
  const p = await one(`select ${COLS} from products p where p.id=$1 and p.active and p.availability <> 'unavailable'`, [int(req.params.id)]);
  if (!p) throw notFound('المنتج غير متوفر');
  res.json(p);
});

/**
 * تتبع الطلب برابط خاص (بدون تسجيل دخول): عرض فقط للمرحلة التي وصل لها الطلب.
 * الرابط يحمل رمزاً عشوائياً سرياً لكل طلب، ولا يعرض أوزاناً أو أسعاراً أو بيانات عملاء أو عمال.
 */
const TRACK_STATUS = { draft: 'مسودة', pending_review: 'قيد المراجعة', quoted: 'بانتظار الموافقة على العرض', approved: 'معتمد', in_production: 'قيد التصنيع', ready: 'جاهز للتسليم', delivered: 'تم التسليم', cancelled: 'ملغي', rejected: 'مرفوض', on_hold: 'متوقف مؤقتاً' };
r.get('/track/:token', async (req, res) => {
  const token = String(req.params.token || '').toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(token)) throw notFound('رابط التتبع غير صحيح');
  const o = await one(`select o.id, o.order_no, o.title, o.product_type, o.quantity, o.size, o.status, o.route_id, o.stage_seq, o.due_date, o.created_at, o.ready_at, o.delivered_at,
      m.karat, m.color, s.name as stage_name
    from orders o join materials m on m.id=o.material_id left join stages s on s.id=o.current_stage_id where o.qr_token=$1`, [token]);
  if (!o) throw notFound('رابط التتبع غير صحيح أو الطلب غير موجود');
  const all = o.route_id ? await routeStages(pool, o.route_id) : [];
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

/** التسعيرة برابط خارجي: قراءة فقط (سعر الذهب والثوابت)، والأوزان تُدخل وتُحسب على جهاز الزائر ولا تُحفظ */
r.get('/pricing/:token', async (req, res) => {
  if (!(await checkToken(pool, String(req.params.token || '')))) throw notFound('الرابط غير صحيح أو تم إيقافه');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.json(await getPricing(pool));
});

export default r;
