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
