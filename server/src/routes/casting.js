// صفحة الصب: أشجار الشمع (رقم الشجرة، اللون، الزركون، الشمع، العيار، الذهب قبل/بعد) وربطها بالطلبات
import { Router } from 'express';
import { tx, many } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, notFound, int, str } from '../lib/http.js';
import { audit } from '../lib/audit.js';

const r = Router();
// الصب للمشرفين ومن يدير المراحل فقط (ليس للعمال: صلاحية المسح وحدها لا تكفي)
const PERMS = ['custody.issue', 'custody.receive', 'orders.advance'];

const num = (v, name) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const x = Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, ''));
  if (!Number.isFinite(x) || x < 0 || x > 1_000_000) throw bad(`قيمة غير صالحة: ${name}`);
  return x;
};
const COLS = `t.id, t.tree_no, t.color, t.karat, t.zircon::text, t.wax::text, t.gold_before::text, t.gold_after::text, t.issued_at, t.received_at, t.notes, t.created_at,
  coalesce((select json_agg(json_build_object('id', o.id, 'order_no', o.order_no, 'title', o.title) order by o.id)
    from casting_tree_orders x join orders o on o.id=x.order_id where x.tree_id=t.id), '[]') as orders`;

// ------------------------------------------------------------------ المطابقة اليومية
const DCOLS = `d.id, to_char(d.check_date, 'YYYY-MM-DD') as check_date, d.gross::text, d.bags, d.bag_weight::text, d.spoons, d.spoon_weight::text,
  d.boxes_weight::text, d.other_weight::text, d.other_note, d.net::text, d.note, d.created_at, u.full_name as created_by_name`;
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

r.get('/daily', requirePerm(...PERMS), async (req, res) => {
  const date = isoDate(req.query.date);
  const rows = await many(`select ${DCOLS} from casting_daily_checks d left join users u on u.id=d.created_by
    where d.check_date = coalesce($1::date, current_date) order by d.id`, [date]);
  // أوزان الكيس والمعلق الافتراضية = آخر ما استُخدم (أو 0.383 و 0.75)
  const last = (await many('select bag_weight::text, spoon_weight::text from casting_daily_checks order by id desc limit 1'))[0];
  const days = await many(`select to_char(check_date, 'YYYY-MM-DD') as date, count(*)::int n, sum(gross)::text gross, sum(net)::text net
    from casting_daily_checks where check_date > current_date - 30 group by check_date order by check_date desc`);
  res.json({ rows, defaults: { bag_weight: last?.bag_weight || '0.383', spoon_weight: last?.spoon_weight || '0.750' }, days });
});

const dailyVals = (b) => {
  const gross = num(b.gross, 'الوزن القائم');
  if (gross == null || gross <= 0) throw bad('أدخل الوزن القائم');
  const cnt = (v, n) => { const x = num(v ?? 0, n) ?? 0; if (!Number.isInteger(x)) throw bad(`${n} يجب أن يكون عدداً صحيحاً`); return x; };
  const v = {
    gross, bags: cnt(b.bags, 'عدد الأكياس'), bag_weight: num(b.bag_weight ?? 0.383, 'وزن الكيس') ?? 0.383,
    spoons: cnt(b.spoons, 'عدد المعالق'), spoon_weight: num(b.spoon_weight ?? 0.75, 'وزن المعلق') ?? 0.75,
    boxes_weight: num(b.boxes_weight ?? 0, 'وزن العلب') ?? 0, other_weight: num(b.other_weight ?? 0, 'الوزن الآخر') ?? 0,
  };
  v.net = +(v.gross - v.bags * v.bag_weight - v.spoons * v.spoon_weight - v.boxes_weight - v.other_weight).toFixed(3);
  if (v.net < 0) throw bad(`الخصومات أكبر من الوزن القائم (الباقي ${v.net} جم) — راجع الأرقام`);
  return v;
};

r.post('/daily', requirePerm(...PERMS), async (req, res) => {
  const v = dailyVals(req.body);
  res.json(await tx(async (db) => {
    const row = (await db.query(`insert into casting_daily_checks(check_date, gross, bags, bag_weight, spoons, spoon_weight, boxes_weight, other_weight, other_note, net, note, created_by)
      values (coalesce($1::date, current_date),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, net::text`,
      [isoDate(req.body.check_date), v.gross, v.bags, v.bag_weight, v.spoons, v.spoon_weight, v.boxes_weight, v.other_weight, str(req.body.other_note, 'بيان الوزن الآخر', { max: 200 }), v.net, str(req.body.note, 'ملاحظة', { max: 300 }), req.user.id])).rows[0];
    await audit(db, req, 'casting.daily_check', 'casting_daily_check', row.id, v);
    return row;
  }));
});

r.delete('/daily/:id', requirePerm(...PERMS), async (req, res) => {
  res.json(await tx(async (db) => {
    const d = (await db.query('delete from casting_daily_checks where id=$1 returning *', [int(req.params.id)])).rows[0];
    if (!d) throw notFound('السطر غير موجود');
    await audit(db, req, 'casting.daily_check_delete', 'casting_daily_check', d.id, { gross: d.gross, net: d.net, date: d.check_date });
    return { ok: true };
  }));
});

r.get('/', requirePerm(...PERMS), async (req, res) => {
  const orderId = req.query.order ? int(req.query.order) : null;
  const days = Math.min(int(req.query.days || 60, 'المدة', { min: 1 }), 3650);
  res.json(await many(`select ${COLS} from casting_trees t
    where ($1::int is null or exists (select 1 from casting_tree_orders x where x.tree_id=t.id and x.order_id=$1))
      and ($1::int is not null or t.created_at > now() - ($2 || ' days')::interval)
    order by t.id`, [orderId, String(days)]));
});

async function linkOrders(db, treeId, ids) {
  for (const oid of ids || []) {
    const o = (await db.query('select id from orders where id=$1', [int(oid)])).rows[0];
    if (!o) throw notFound('الطلب غير موجود');
    await db.query('insert into casting_tree_orders(tree_id, order_id) values ($1,$2) on conflict do nothing', [treeId, o.id]);
  }
}

r.post('/', requirePerm(...PERMS), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const karat = b.karat ? int(b.karat, 'العيار') : 18;
    if (![18, 21].includes(karat)) throw bad('العيار 18 أو 21');
    const before = num(b.gold_before, 'الذهب قبل') ?? null;
    const after = num(b.gold_after, 'الذهب بعد') ?? null;
    const t = (await db.query(`insert into casting_trees(tree_no, color, karat, zircon, wax, gold_before, gold_after, issued_at, received_at, notes, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [str(b.tree_no, 'رقم الشجرة', { max: 40 }) || '—', str(b.color, 'اللون', { max: 30 }), karat, num(b.zircon, 'الزركون') ?? null, num(b.wax, 'الشمع') ?? null,
      before, after, before != null ? new Date() : null, after != null ? new Date() : null, str(b.notes, 'ملاحظات'), req.user.id])).rows[0];
    await linkOrders(db, t.id, b.order_ids);
    await audit(db, req, 'casting.create', 'casting_tree', t.id, b);
    return (await db.query(`select ${COLS} from casting_trees t where t.id=$1`, [t.id])).rows[0];
  }));
});

r.put('/:id', requirePerm(...PERMS), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const cur = (await db.query('select * from casting_trees where id=$1 for update', [id])).rows[0];
    if (!cur) throw notFound('الشجرة غير موجودة');
    const next = { ...cur };
    if (b.tree_no !== undefined) next.tree_no = str(b.tree_no, 'رقم الشجرة', { max: 40 }) || '—';
    if (b.color !== undefined) next.color = str(b.color, 'اللون', { max: 30 });
    if (b.karat !== undefined) { next.karat = int(b.karat, 'العيار'); if (![18, 21].includes(next.karat)) throw bad('العيار 18 أو 21'); }
    for (const [k, l] of [['zircon', 'الزركون'], ['wax', 'الشمع'], ['gold_before', 'الذهب قبل'], ['gold_after', 'الذهب بعد']]) {
      const v = num(b[k], l);
      if (v !== undefined) next[k] = v;
    }
    if (b.notes !== undefined) next.notes = str(b.notes, 'ملاحظات');
    // تاريخ التسليم/الاستلام يُسجَّل تلقائياً أول مرة يُدخل فيها الوزن (مثل NOW في Excel)
    const issued = cur.issued_at || (next.gold_before != null ? new Date() : null);
    const received = cur.received_at || (next.gold_after != null ? new Date() : null);
    await db.query(`update casting_trees set tree_no=$2, color=$3, karat=$4, zircon=$5, wax=$6, gold_before=$7, gold_after=$8, issued_at=$9, received_at=$10, notes=$11, updated_at=now() where id=$1`,
      [id, next.tree_no, next.color, next.karat, next.zircon, next.wax, next.gold_before, next.gold_after, issued, received, next.notes]);
    if (Array.isArray(b.add_orders)) await linkOrders(db, id, b.add_orders);
    if (Array.isArray(b.remove_orders)) for (const oid of b.remove_orders) await db.query('delete from casting_tree_orders where tree_id=$1 and order_id=$2', [id, int(oid)]);
    await audit(db, req, 'casting.update', 'casting_tree', id, { before: cur, change: b });
    return (await db.query(`select ${COLS} from casting_trees t where t.id=$1`, [id])).rows[0];
  }));
});

r.delete('/:id', requirePerm(...PERMS), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const cur = (await db.query('select * from casting_trees where id=$1', [id])).rows[0];
    if (!cur) throw notFound('الشجرة غير موجودة');
    await db.query('delete from casting_trees where id=$1', [id]);
    await audit(db, req, 'casting.delete', 'casting_tree', id, cur);
    return { ok: true };
  }));
});

export default r;
