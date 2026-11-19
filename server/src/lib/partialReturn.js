// استلام جزء من عهدة العامل للمشرف: يُوزن الجزء المرتجع ويعود لمكانه (الطلب / الخزنة / مخزون الخامات)،
// وتبقى العهدة مفتوحة بالباقي. العجز يُحسب لاحقاً عند الاستلام الكامل على المتبقي فقط.
import { bad, conflict, notFound, int, str, weight as W } from './http.js';
import * as ledger from './ledger.js';
import { audit } from './audit.js';
import { notifyUsers } from './notify.js';
import { logStage } from './production.js';

export async function partialReturn(db, req, custodyId, body) {
  const c = (await db.query('select c.*, f.name as finding_name from custodies c left join findings f on f.id=c.finding_id where c.id=$1 for update of c', [int(custodyId)])).rows[0];
  if (!c) throw notFound('العهدة غير موجودة');
  if (c.status !== 'open') throw conflict('العهدة ليست مفتوحة');
  if ((await db.query("select 1 from custody_transfers where custody_id=$1 and status='pending'", [c.id])).rowCount) throw conflict('على العهدة تحويل معلق لعامل آخر — ألغه أولاً');
  const w = W(body.weight, 'الوزن المستلم');
  const avail = Number(c.weight_issued) - Number(c.weight_used);
  if (Number(w) >= avail - 1e-9) throw bad(`الوزن يجب أن يكون أقل من المتبقي في العهدة (${avail.toFixed(3)} جم) — للاستلام الكامل استخدم «استلام ذهب»`);
  const pieces = body.pieces != null && body.pieces !== '' ? int(body.pieces, 'عدد القطع', { min: 0 }) : 0;
  if (pieces > Number(c.pieces || 0)) throw bad(`عدد القطع أكبر من الموجود في العهدة (${c.pieces})`);
  const note = str(body.note, 'البيان', { max: 300 });
  const label = c.order_id ? (await db.query('select order_no from orders where id=$1', [c.order_id])).rows[0].order_no : c.finding_name || `عهدة عامة${c.purpose ? ` (${c.purpose})` : ''}`;
  const to = c.order_id ? ['order', c.order_id] : c.finding_id ? ['findings', c.finding_id] : ['vault', null];
  const mv = await ledger.post(db, {
    kind: 'partial_return', material_id: c.material_id, weight: w, from: ['worker', c.worker_id], to,
    order_id: c.order_id, custody_id: c.id, worker_id: c.worker_id, stage_id: c.stage_id,
    reason: `استلام جزئي من العهدة ${c.custody_no}${note ? `: ${note}` : ''}`, user_id: req.user.id,
  });
  await db.query('update custodies set weight_used = weight_used + $2, pieces = greatest(0, coalesce(pieces,0) - $3) where id=$1', [c.id, w, pieces]);
  if (c.finding_id) await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, note, created_by) values ($1,'return',$2,$3,$4,$5,$6)`,
    [c.finding_id, pieces, w, c.id, `استلام جزئي من العامل (${c.custody_no})`, req.user.id]);
  await db.query("insert into custody_work_log(custody_id, event, reason, user_id) values ($1,'note',$2,$3)", [c.id, `استلم المشرف ${w} جم${pieces ? ` (${pieces} قطعة)` : ''}${note ? ` — ${note}` : ''}`, req.user.id]);
  if (c.order_id) await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `استلام جزئي ${w} جم من العامل (${c.custody_no})${note ? ` — ${note}` : ''}`, false, c.worker_id);
  const left = (avail - Number(w)).toFixed(4);
  await notifyUsers(db, [c.worker_id], { kind: 'custody', title: `استلم المشرف ${Number(w).toFixed(3)} جم من عهدتك`, body: `${label} — المتبقي لديك ${Number(left).toFixed(3)} جم`, link: '/w' });
  await audit(db, req, 'custody.partial_return', 'custody', c.id, { weight: w, pieces, left, note, movement: mv.movement_no });
  return { ok: true, weight: w, left, movement_no: mv.movement_no };
}
