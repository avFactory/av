// تقارير المتجر: المبيعات، المنتجات الأكثر طلباً، العملاء، الأصناف، العيارات، الفئات، المدن، التسليم والالتزام بالموعد
import { Router } from 'express';
import { pool } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad } from '../lib/http.js';

const r = Router();
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const n = (x) => Number(x) || 0;
const q = async (sql, p) => (await pool.query(sql, p)).rows;

r.get('/', requirePerm('reports.view', 'products.manage'), async (req, res) => {
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const to = isoDay(req.query.to) || today;
  const from = isoDay(req.query.from) || `${to.slice(0, 7)}-01`;
  if (from > to) throw bad('تاريخ البداية بعد النهاية');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const grain = days > 62 ? 'month' : 'day';
  // نطاق الفترة بتوقيت الرياض
  const P = [from, to];
  const inP = (col) => `(${col} at time zone 'Asia/Riyadh')::date between $1::date and $2::date`;
  // طلبات العملاء (غير الداخلية) — البنود الملغاة والمرفوضة تُستبعد من المبيعات
  const O = `orders o join materials m on m.id=o.material_id left join customers c on c.id=o.customer_id`;
  const sold = `o.customer_id is not null and o.status not in ('cancelled','rejected') and ${inP('o.created_at')}`;
  const pureW = `coalesce(o.final_weight, 0) * m.karat / 24.0`;
  const deliv = `o.customer_id is not null and o.status='delivered' and ${inP('o.delivered_at')}`;

  const [k] = await q(`select
      count(distinct coalesce(o.cart_ref, o.order_no)) filter (where ${sold})::int as orders,
      count(*) filter (where ${sold})::int as items,
      coalesce(sum(o.quantity) filter (where ${sold}),0)::int as pieces,
      count(distinct o.customer_id) filter (where ${sold})::int as customers,
      coalesce(sum(o.labor_estimate) filter (where ${sold}),0)::numeric(14,2)::text as labor_estimate,
      coalesce(sum(o.quantity) filter (where ${deliv}),0)::int as delivered_pieces,
      count(distinct coalesce(o.cart_ref, o.order_no)) filter (where ${deliv})::int as delivered_orders,
      coalesce(sum(${pureW}) filter (where ${deliv}),0)::numeric(16,4)::text as delivered_pure,
      coalesce(sum(o.final_weight) filter (where ${deliv}),0)::numeric(16,4)::text as delivered_weight,
      count(*) filter (where o.customer_id is not null and o.status in ('cancelled','rejected') and ${inP('o.created_at')})::int as cancelled_items,
      coalesce(avg(extract(epoch from (o.delivered_at - o.created_at))/86400) filter (where ${deliv}),0)::numeric(8,1)::text as avg_days,
      count(*) filter (where ${deliv} and o.due_date is not null and (o.delivered_at at time zone 'Asia/Riyadh')::date <= o.due_date)::int as on_time,
      count(*) filter (where ${deliv} and o.due_date is not null)::int as with_due
    from ${O}`, P);
  const [inv] = await q(`select coalesce(sum(case when invoice_type='invoice' then subtotal else -subtotal end),0)::numeric(14,2)::text as subtotal,
      coalesce(sum(case when invoice_type='invoice' then total else -total end),0)::numeric(14,2)::text as total,
      count(*) filter (where invoice_type='invoice')::int as count
    from invoices where status='issued' and ${inP('issue_date')}`, P);
  const [pay] = await q(`select coalesce(sum(case when kind='refund' then -amount else amount end),0)::numeric(14,2)::text as collected from payments where ${inP('received_at')}`, P);
  const [nc] = await q(`select count(*)::int as new_customers from customers where ${inP('created_at')}`, P);
  const [pending] = await q("select count(*)::int as n from customers where status='pending'");

  const trend = await q(`with d as (select generate_series(date_trunc('${grain}', $1::date), $2::date, interval '1 ${grain}')::date as d)
    select to_char(d.d, '${grain === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}') as period,
      coalesce((select sum(o.quantity) from ${O} where ${sold.replace(inP('o.created_at'), `date_trunc('${grain}', o.created_at at time zone 'Asia/Riyadh')::date = d.d and ${inP('o.created_at')}`)}),0)::int as pieces,
      coalesce((select count(distinct coalesce(o.cart_ref, o.order_no)) from ${O} where ${sold.replace(inP('o.created_at'), `date_trunc('${grain}', o.created_at at time zone 'Asia/Riyadh')::date = d.d and ${inP('o.created_at')}`)}),0)::int as orders,
      coalesce((select sum(${pureW}) from ${O} where ${deliv.replace(inP('o.delivered_at'), `date_trunc('${grain}', o.delivered_at at time zone 'Asia/Riyadh')::date = d.d and ${inP('o.delivered_at')}`)}),0)::numeric(16,3)::text as delivered_pure,
      coalesce((select sum(case when i.invoice_type='invoice' then i.subtotal else -i.subtotal end) from invoices i where i.status='issued' and date_trunc('${grain}', i.issue_date at time zone 'Asia/Riyadh')::date = d.d and ${inP('i.issue_date')}),0)::numeric(14,2)::text as invoiced
    from d order by d.d`, P);

  // حذف الفترات الفارغة في بداية المدة (مثلاً «منذ البداية»)
  const first = trend.findIndex((x) => x.pieces || x.orders || n(x.delivered_pure) || n(x.invoiced));
  trend.splice(0, first < 0 ? Math.max(0, trend.length - 1) : first);

  const products = await q(`select p.id, p.sku, p.name, p.product_type,
      (select pm.path from product_media pm where pm.product_id=p.id and pm.kind='image' order by pm.sort, pm.id limit 1) as image,
      count(*)::int as items, count(distinct coalesce(o.cart_ref, o.order_no))::int as orders, sum(o.quantity)::int as pieces, count(distinct o.customer_id)::int as customers,
      coalesce(sum(o.labor_estimate),0)::numeric(14,2)::text as labor_estimate,
      coalesce(sum(${pureW}) filter (where o.status='delivered'),0)::numeric(16,3)::text as delivered_pure,
      max(o.created_at) as last_at
    from ${O} join products p on p.id=o.product_id where ${sold} group by p.id order by pieces desc, orders desc limit 100`, P);

  const customers = await q(`with s as (select o.customer_id, count(distinct coalesce(o.cart_ref, o.order_no))::int as orders, sum(o.quantity)::int as pieces,
        coalesce(sum(o.labor_estimate),0) as labor_estimate, max(o.created_at) as last_at, mode() within group (order by o.product_type) as top_type
      from ${O} where ${sold} group by o.customer_id),
    dv as (select o.customer_id, sum(${pureW}) as pure, sum(o.quantity)::int as pieces from ${O} where ${deliv} group by o.customer_id),
    iv as (select customer_id, sum(case when invoice_type='invoice' then total else -total end) as total from invoices where status='issued' and ${inP('issue_date')} group by customer_id),
    py as (select customer_id, sum(case when kind='refund' then -amount else amount end) as paid from payments where ${inP('received_at')} group by customer_id)
    select c.id, c.shop_name, c.city, t.name as tier_name, coalesce(s.orders,0) as orders, coalesce(s.pieces,0) as pieces, coalesce(s.labor_estimate,0)::numeric(14,2)::text as labor_estimate,
      coalesce(dv.pieces,0) as delivered_pieces, coalesce(dv.pure,0)::numeric(16,3)::text as delivered_pure,
      coalesce(iv.total,0)::numeric(14,2)::text as invoiced, coalesce(py.paid,0)::numeric(14,2)::text as paid, s.last_at, s.top_type
    from customers c left join customer_tiers t on t.id=c.tier_id left join s on s.customer_id=c.id left join dv on dv.customer_id=c.id
      left join iv on iv.customer_id=c.id left join py on py.customer_id=c.id
    where s.customer_id is not null or dv.customer_id is not null or iv.customer_id is not null or py.customer_id is not null
    order by coalesce(s.pieces,0) desc, coalesce(iv.total,0) desc`, P);

  const group = (expr, label) => q(`select ${expr} as key, count(distinct coalesce(o.cart_ref, o.order_no))::int as orders, sum(o.quantity)::int as pieces,
      count(distinct o.customer_id)::int as customers, coalesce(sum(o.labor_estimate),0)::numeric(14,2)::text as labor_estimate,
      coalesce(sum(${pureW}) filter (where o.status='delivered'),0)::numeric(16,3)::text as delivered_pure
    from ${O} left join customer_tiers t on t.id=c.tier_id where ${sold} group by 1 order by pieces desc`, P).then((rows) => rows.map((x) => ({ ...x, key: x.key ?? label })));
  const [byType, byKarat, byColor, byTier, byCity, bySource] = await Promise.all([
    group("coalesce(nullif(o.product_type,''), 'غير محدد')", 'غير محدد'), group("'عيار ' || m.karat", ''),
    group("coalesce(o.color, 'غير محدد')", 'غير محدد'), group("coalesce(t.name, 'بدون فئة')", 'بدون فئة'),
    group("coalesce(nullif(c.city,''), 'غير محدد')", 'غير محدد'), group('o.source', '')]);

  const statuses = await q(`select o.status, count(*)::int as items, sum(o.quantity)::int as pieces from ${O}
    where o.customer_id is not null and ${inP('o.created_at')} group by o.status`, P);

  const unsold = await q(`select p.id, p.sku, p.name, p.product_type, p.created_at,
      (select max(o.created_at) from orders o where o.product_id=p.id and o.status not in ('cancelled','rejected')) as last_at
    from products p where p.active and p.deleted_at is null and not exists (
      select 1 from orders o where o.product_id=p.id and o.status not in ('cancelled','rejected') and ${inP('o.created_at')})
    order by last_at nulls first, p.created_at limit 200`, P);

  const dormant = await q(`select c.id, c.shop_name, c.city, c.phone, max(o.created_at) as last_at, count(distinct coalesce(o.cart_ref, o.order_no))::int as orders_before
    from customers c join orders o on o.customer_id=c.id and o.status not in ('cancelled','rejected')
    where c.status='approved' and not exists (select 1 from orders x where x.customer_id=c.id and ${inP('x.created_at')})
    group by c.id order by last_at desc limit 200`, P);

  res.json({
    from, to, days, grain,
    kpi: { ...k, ...nc, pending_customers: pending.n, invoiced_subtotal: inv.subtotal, invoiced_total: inv.total, invoices: inv.count, collected: pay.collected,
      avg_pieces: k.orders ? Math.round((k.pieces / k.orders) * 10) / 10 : 0, on_time_rate: k.with_due ? Math.round((100 * k.on_time) / k.with_due) : null,
      cancel_rate: k.items + k.cancelled_items ? Math.round((100 * k.cancelled_items) / (k.items + k.cancelled_items)) : 0 },
    trend, products, customers, byType, byKarat, byColor, byTier, byCity, bySource, statuses, unsold, dormant,
  });
});

export default r;
