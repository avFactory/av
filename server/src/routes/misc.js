// عام: البيانات المرجعية، الإشعارات، الملفات المحمية، رموز QR، التحديثات الفورية
import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import QRCode from 'qrcode';
import { pool, many, one } from '../db.js';
import { requireAuth, has } from '../lib/auth.js';
import { HttpError, forbidden, notFound, int } from '../lib/http.js';
import { UPLOAD_DIR } from '../lib/uploads.js';
import { sseHandler } from '../lib/events.js';
import { thumbnail } from '../lib/thumbs.js';
import { is3D } from '../lib/internalImages.js';
import { getMinOrder } from '../lib/minOrder.js';

const r = Router();

/** أخطاء الواجهة (للتشخيص): تُسجَّل في سجل الخادم فقط */
r.post('/client-error', async (req, res) => {
  const b = req.body || {};
  const t = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
  console.error('[client-error]', JSON.stringify({ user: req.user?.username || null, path: t(b.path, 300), message: t(b.message, 500), stack: t(b.stack, 1500), component: t(b.component, 600), ua: t(req.headers['user-agent'], 200) }));
  res.json({ ok: true });
});

r.get('/lookups', requireAuth, async (req, res) => {
  const staff = req.user.role_code !== 'customer';
  const materials = await many('select id, name, karat, color from materials where active order by id');
  const settings = Object.fromEntries((await many("select key, value from settings where key in ('company','weight_decimals','currency','vat_rate','diamond_worker_nos')")).map((x) => [x.key, x.value]));
  settings.min_order = await getMinOrder(pool);
  if (!staff) return res.json({ materials, settings: { weight_decimals: settings.weight_decimals, currency: settings.currency, company: { name: settings.company?.name }, min_order: settings.min_order } });
  res.json({
    materials, settings,
    stages: await many('select s.id, s.name, s.kind, s.handles_gold, s.sort_order, s.active, r.rate_percent::text as loss_rate from stages s join stage_current_rates r on r.stage_id=s.id order by s.sort_order'),
    routes: await many('select id, name, product_type, is_default from routes where active order by id'),
    departments: await many('select id, name from departments where active order by name'),
    workers: has(req, 'worker.self') ? [] : await many("select id, full_name, employee_no, kind from users where role_code='worker' and active order by kind, full_name"),
    customers: has(req, 'customers.view') || has(req, 'orders.manage') ? await many("select id, shop_name from customers where status='approved' order by shop_name") : [],
    tiers: await many('select id, name, color, is_default from customer_tiers order by sort_order, name'),
  });
});

r.get('/notifications', requireAuth, async (req, res) => {
  res.json(await many('select * from notifications where user_id=$1 order by id desc limit 100', [req.user.id]));
});
r.post('/notifications/read', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => int(x)) : null;
  await pool.query(`update notifications set read_at=now() where user_id=$1 and read_at is null ${ids ? 'and id = any($2::int[])' : ''}`, ids ? [req.user.id, ids] : [req.user.id]);
  res.json({ ok: true });
});

r.get('/events', requireAuth, sseHandler);

/** رمز QR بصيغة SVG */
r.get('/qr', requireAuth, async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  const svg = await QRCode.toString(text || ' ', { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(svg);
});

/** الملفات: لا تقدم إلا لمن يملك صلاحية على الكيان المرتبط */
r.get('/files/*filepath', async (req, res) => {
  const rel = [].concat(req.params.filepath).join('/');
  const abs = path.resolve(UPLOAD_DIR, rel);
  if (!abs.startsWith(UPLOAD_DIR + path.sep)) throw forbidden();
  if (!req.user) throw new HttpError(401, 'يجب تسجيل الدخول');
  const u = req.user;
  let allowed = false;
  const of = await one('select o.customer_id, o.assigned_worker_id, f.customer_visible, f.order_id from order_files f join orders o on o.id=f.order_id where f.path=$1 limit 1', [rel]);
  const pm = await one('select 1 from product_media where path=$1 limit 1', [rel]);
  if (pm) allowed = true; // صور المنتجات لأي مستخدم مسجل (موظف أو محل)
  else if (of) {
    if (u.role_code === 'customer') {
      allowed = of.customer_id === u.customer_id && of.customer_visible;
      // حساب الفرع يرى ملفات طلبات فرعه فقط
      if (allowed && u.branch_id) allowed = !!(await one('select 1 from orders where id=$1 and branch_id=$2', [of.order_id, u.branch_id]));
    }
    else if (u.role_code === 'worker') allowed = of.assigned_worker_id === u.id || is3D(u) || !!(await one(`select 1 from orders x where (x.id=$1 or (x.cart_ref is not null and x.cart_ref = (select cart_ref from orders where id=$1)))
      and (x.assigned_worker_id=$2 or exists (select 1 from custodies k where k.order_id=x.id and k.worker_id=$2)) limit 1`, [of.order_id, u.id]));
    else allowed = has(req, 'orders.view');
  } else if (rel.startsWith('signatures/')) {
    allowed = has(req, 'custody.view_all') || !!(await one('select 1 from custody_batches where signature_path=$1 and worker_id=$2', [rel, u.id]));
  } else {
    const f = await one('select uploaded_by from files where path=$1', [rel]);
    const cd = await one('select customer_id from customer_documents where path=$1', [rel]);
    if (cd) allowed = has(req, 'customers.view') || cd.customer_id === u.customer_id;
    // ملفات أخرى (مستندات الموظفين، إيصالات، صور المخزون…): للموظفين عدا العمال، والعامل/العميل يرى ما رفعه فقط
    else allowed = u.role_code !== 'customer' && u.role_code !== 'worker' ? true : f?.uploaded_by === u.id;
  }
  if (!allowed) throw forbidden();
  if (!fs.existsSync(abs)) throw notFound('الملف غير موجود');
  // الملفات تُعرض في بيئة معزولة، وغير الصور/الفيديو/PDF تُنزَّل ولا تُفتح في المتصفح
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  // أسماء الملفات عشوائية ولا تتغير، فيُحفظ الملف في المتصفح 30 يوماً
  res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
  // صورة مصغّرة خفيفة (WebP) للقوائم والمتجر: ?w=200|400|800
  const w = Number(req.query.w);
  if (w) {
    const t = await thumbnail(abs, rel, w);
    if (t) { res.type('image/webp'); return res.sendFile(t, { dotfiles: 'allow' }); }
  }
  if (!/\.(jpe?g|png|webp|gif|heic|mp4|mov|webm|pdf)$/i.test(abs)) res.attachment(path.basename(abs));
  res.sendFile(abs);
});

export default r;
