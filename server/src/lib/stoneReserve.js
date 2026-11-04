// حجز ألماس المنتج للطلب عند اعتماده (بدء الإنتاج):
// - allocate: يخصم من مخزن الألماس لصالح الطلب (كمية المنتج × عدد القطع)
// - عند صرف الألماس للعامل على نفس الطلب: يُفك الحجز أولاً ثم يُصرف (فلا يُخصم مرتين)
// - عند إلغاء الطلب: يُعاد المحجوز للمخزن (deallocate)
import { bad, conflict, int, weight as W } from './http.js';

const rnd = (x) => Math.round(Number(x) * 10000) / 10000;

export async function reservedFor(db, lotId, orderId) {
  const r = (await db.query(`select coalesce(sum(case kind when 'allocate' then carats when 'deallocate' then -carats end),0)::numeric as c,
      coalesce(sum(case kind when 'allocate' then count when 'deallocate' then -count end),0)::int as n
    from stone_movements m where lot_id=$1 and order_id=$2 and kind in ('allocate','deallocate')
      and not exists (select 1 from stone_movements x where x.reverses_id=m.id)`, [lotId, orderId])).rows[0];
  return { carats: Number(r.c), count: Number(r.n) };
}

export async function reserveDiamonds(db, order, userId) {
  // ألماس الطلب نفسه (من "اطلب تصميمك" أو المنسوخ من المنتج)، وإلا ألماس المنتج
  const own = (await db.query('select diamonds from orders where id=$1', [order.id])).rows[0]?.diamonds;
  const p = order.product_id ? (await db.query('select name, diamonds from products where id=$1', [order.product_id])).rows[0] : { name: order.title };
  const src = Array.isArray(own) && own.length ? own : p?.diamonds;
  const list = Array.isArray(src) ? src.filter((d) => d && d.lot_id && Number(d.carats) > 0) : [];
  if (!list.length) return [];
  // لا يُحجز مرتين لنفس الطلب
  if ((await db.query("select 1 from stone_movements where order_id=$1 and kind='allocate' limit 1", [order.id])).rowCount) return [];
  const qty = Number(order.quantity) || 1;
  const done = [];
  for (const d of list) {
    const lotId = Number(d.lot_id);
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`stone:${lotId}`]);
    const lot = (await db.query(`select l.lot_no, l.size_label, s.name as shape, b.stock_carats, b.stock_count
      from stone_lots l join stone_lot_balances b on b.lot_id=l.id left join stone_shapes s on s.id=l.shape_id where l.id=$1`, [lotId])).rows[0];
    if (!lot) throw conflict(`صنف الألماس المحدد في المنتج ${p.name} غير موجود`);
    const carats = rnd(Number(d.carats) * qty);
    const count = (Number(d.count) || 0) * qty;
    if (Number(lot.stock_carats) < carats || (count && Number(lot.stock_count) < count)) {
      throw conflict(`مخزون الألماس غير كافٍ لاعتماد الطلب ${order.order_no}: ${lot.shape || ''} ${lot.size_label || ''} — المطلوب ${carats} قيراط${count ? ` / ${count} حبة` : ''}، المتوفر ${Number(lot.stock_carats)} قيراط${count ? ` / ${lot.stock_count} حبة` : ''}`);
    }
    await db.query(`insert into stone_movements(lot_id, kind, carats, count, order_id, note, created_by) values ($1,'allocate',$2,$3,$4,$5,$6)`,
      [lotId, carats, count, order.id, `حجز لطلب ${order.order_no} عند الاعتماد`, userId]);
    done.push({ lot_id: lotId, carats, count });
  }
  return done;
}

export async function releaseDiamonds(db, orderId, userId, note) {
  const lots = (await db.query("select distinct lot_id from stone_movements where order_id=$1 and kind in ('allocate','deallocate')", [orderId])).rows;
  for (const { lot_id: lotId } of lots) {
    const r = await reservedFor(db, lotId, orderId);
    if (r.carats > 0 || r.count > 0) {
      await db.query(`insert into stone_movements(lot_id, kind, carats, count, order_id, note, created_by) values ($1,'deallocate',$2,$3,$4,$5,$6)`,
        [lotId, Math.max(0, r.carats), Math.max(0, r.count), orderId, note, userId]);
    }
  }
}

// ------------------------------------------------------------- إدخال تفاصيل الأحجار
export const optW = (v, name) => (v === undefined || v === null || v === '' ? null : W(v, name));
/** ألماس المنتج: [{lot_id, carats, count}] لكل قطعة — يُحجز من المخزون عند اعتماد الطلب */
export function parseDiamonds(v) {
  let list = v;
  if (typeof v === 'string') { try { list = v ? JSON.parse(v) : []; } catch { throw bad('بيانات الألماس غير صالحة'); } }
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d && d.lot_id).slice(0, 20).map((d) => {
    const carats = Number(d.carats);
    if (!(carats > 0) || carats > 10000) throw bad('وزن الألماس (قيراط) مطلوب لكل نوع');
    const count = d.count === '' || d.count == null ? 0 : int(d.count, 'عدد الحبات', { min: 0 });
    return { lot_id: int(d.lot_id, 'نوع الألماس'), carats: Math.round(carats * 10000) / 10000, count };
  });
}
