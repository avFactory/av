// تعديل عهدة مفتوحة (للمدير فقط): وزن التسليم/الأحجار/القطع. الفرق ينتقل بين العامل ومصدر العهدة بحركة موثقة.
import { bad, conflict, forbidden, notFound, int, str, weight as W } from './http.js';
import * as ledger from './ledger.js';
import { audit } from './audit.js';
import { notifyUsers, resolveNotifs } from './notify.js';
import { lockOrder, logStage } from './production.js';

export async function editCustody(db, req, id, body) {
  if (req.user.role_code !== 'admin') throw forbidden('تعديل العهدة للمدير فقط');
  const c = (await db.query('select * from custodies where id=$1 for update', [int(id)])).rows[0];
  if (!c) throw notFound('العهدة غير موجودة');
  if (c.status !== 'open') throw conflict('العهدة ليست مفتوحة — بعد الاستلام تُصحح التسوية نفسها');
  if ((await db.query("select 1 from custody_transfers where custody_id=$1 and status='pending'", [c.id])).rowCount) throw conflict('على العهدة تحويل معلق لعامل آخر — ألغه أولاً');
  if ((await db.query("select 1 from custody_return_requests where custody_id=$1 and status='pending'", [c.id])).rowCount) throw conflict('على العهدة طلب تسليم جزء للمشرف — أكّده أو ارفضه أولاً');
  const reason = str(body.reason, 'سبب التعديل', { required: true, max: 300 });
  if (c.order_id) await lockOrder(db, c.order_id);

  // الوزن الجديد: وزن الميزان − الأحجار (لعهدة الطلب)، أو الوزن مباشرة (عامة/خامات)
  const stones = c.order_id ? W(body.stones_weight ?? c.stones_weight ?? 0, 'وزن الأحجار', { allowZero: true }) : '0';
  const gross = W(body.gross_weight, 'الوزن');
  const net = (Number(gross) - Number(stones));
  if (!(net > 0)) throw bad('صافي الذهب يجب أن يكون أكبر من صفر');
  const used = Number(c.weight_used || 0);
  if (net < used - 1e-9) throw bad(`لا يمكن أن يقل الوزن عن المستخدم/المستلم منها جزئياً (${used.toFixed(3)} جم)`);
  const pieces = body.pieces != null && body.pieces !== '' ? int(body.pieces, 'عدد القطع', { min: 0 }) : c.pieces;
  const diff = Math.round((net - Number(c.weight_issued)) * 10000) / 10000;

  // مصدر العهدة: رصيد الطلب (والخزنة عند النقص)، أو مخزون الخامات، أو الخزنة
  const src = c.order_id ? ['order', c.order_id] : c.finding_id ? ['findings', c.finding_id] : ['vault', null];
  // قبل قبول العامل: الذهب ما زال بانتظار قبوله (لا يمس حسابه)
  const holder = [c.worker_ack_at ? 'worker' : 'transit', c.worker_id];
  const base = { material_id: c.material_id, order_id: c.order_id, custody_id: c.id, worker_id: c.worker_id, stage_id: c.stage_id, user_id: req.user.id };
  if (diff > 0) {
    const w = diff.toFixed(4);
    if (c.order_id) {
      await ledger.lockLocation(db, 'order', c.order_id, c.material_id);
      const bal = Number(await ledger.balance(db, 'order', c.order_id, c.material_id));
      if (bal < diff) {
        const short = (diff - bal).toFixed(4);
        await ledger.requireBalance(db, 'vault', null, c.material_id, short, 'رصيد الخزنة من هذه المادة غير كافٍ لزيادة العهدة');
        await ledger.post(db, { ...base, kind: 'allocate', weight: short, from: ['vault', null], to: ['order', c.order_id], reason: `زيادة العهدة ${c.custody_no}` });
      }
    } else {
      await ledger.requireBalance(db, src[0], src[1], c.material_id, w, c.finding_id ? 'مخزون الخامات غير كافٍ' : 'رصيد الخزنة غير كافٍ');
    }
    await ledger.post(db, { ...base, kind: 'custody_adjust', weight: w, from: src, to: holder, reason: `تعديل العهدة ${c.custody_no} (+${w}): ${reason}` });
  } else if (diff < 0) {
    const w = (-diff).toFixed(4);
    await ledger.post(db, { ...base, kind: 'custody_adjust', weight: w, from: holder, to: src, reason: `تعديل العهدة ${c.custody_no} (−${w}): ${reason}` });
  }
  if (c.finding_id && (diff !== 0 || pieces !== c.pieces)) {
    await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)`,
      [c.finding_id, diff >= 0 ? 'issue' : 'return', Math.abs(Number(pieces || 0) - Number(c.pieces || 0)), Math.abs(diff), c.id, `تعديل العهدة ${c.custody_no}: ${reason}`, req.user.id]);
  }
  await db.query("select set_config('av.allow_custody_edit', 'on', true)");
  await db.query('update custodies set weight_issued=$2, gross_weight=$3, stones_weight=$4, pieces=$5 where id=$1', [c.id, net.toFixed(4), c.order_id ? gross : net.toFixed(4), stones, pieces]);
  await db.query("select set_config('av.allow_custody_edit', 'off', true)");
  const was = `${Number(c.weight_issued).toFixed(3)} جم`, now = `${net.toFixed(3)} جم`;
  await db.query("insert into custody_work_log(custody_id, event, reason, user_id) values ($1,'note',$2,$3)", [c.id, `عدّل المدير العهدة من ${was} إلى ${now}: ${reason}`, req.user.id]);
  if (c.order_id) await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `تعديل العهدة ${c.custody_no} من ${was} إلى ${now}: ${reason}`, false, c.worker_id);
  await resolveNotifs(db, `custody_reject:${c.id}`, `✓ صحّحه ${req.user.full_name} إلى ${now}`);
  await notifyUsers(db, [c.worker_id], { kind: 'custody', title: `عُدّلت عهدتك ${c.custody_no}`, body: `من ${was} إلى ${now} — ${reason}`, link: '/w' });
  await audit(db, req, 'custody.edit', 'custody', c.id, { before: { weight: c.weight_issued, gross: c.gross_weight, stones: c.stones_weight, pieces: c.pieces }, after: { weight: net.toFixed(4), gross, stones, pieces }, accepted: !!c.worker_ack_at, reason });
  return { ok: true, weight: net.toFixed(4), diff };
}
