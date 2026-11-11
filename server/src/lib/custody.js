// محرك العهدة: تسليم واستلام الذهب، حساب العجز، المراجعة والتحقيق والتصحيح
import { bad, conflict, forbidden, notFound, weight as W, int, str } from './http.js';
import { specialtyRate } from './workerLoss.js';
import * as ledger from './ledger.js';
import { audit } from './audit.js';
import { notifyPerm, notifyUsers } from './notify.js';
import { saveSignature } from './uploads.js';
import { lockOrder, advance, goldStonesGrams, logStage } from './production.js';
import { groupInfo } from './orderGroups.js';
import { has } from './auth.js';

async function sub(db, a, b) {
  return (await db.query('select round($1::numeric - $2::numeric, 4)::text v', [a, b])).rows[0].v;
}

export async function getWorker(db, id) {
  const r = await db.query("select id, full_name, employee_no, role_code, active from users where id=$1", [id]);
  const w = r.rows[0];
  if (!w || w.role_code !== 'worker') throw bad('العامل غير موجود');
  if (!w.active) throw bad('حساب العامل غير نشط');
  return w;
}

async function currentRate(db, stageId) {
  return (await db.query('select rate_percent::text r from stage_current_rates where stage_id=$1', [stageId])).rows[0]?.r ?? '0';
}

/**
 * تسليم ذهب لعامل (طلب واحد أو عدة طلبات في جلسة واحدة).
 * كل طلب = عهدة مستقلة + حركات مستقلة (لا دمج للأوزان).
 */
export async function issue(db, req, body) {
  const workerId = int(body.worker_id, 'العامل');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad('اختر طلباً واحداً على الأقل');
  if (items.length > 100) throw bad('عدد الطلبات كبير جداً في جلسة واحدة');
  const key = str(body.idempotency_key, 'idempotency', { max: 100 });

  if (key) {
    const dup = await db.query('select issue_batch_id from custodies where idempotency_key=$1', [`${key}:0`]);
    if (dup.rows[0]) return { batch_id: dup.rows[0].issue_batch_id, duplicate: true };
  }
  const worker = await getWorker(db, workerId);
  // الطلب متعدد المنتجات يُسلَّم كقطعة واحدة: كل بنوده تتحول للبند القائد
  const groups = new Map();
  for (const it of items) {
    const g = await groupInfo(db, int(it.order_id, 'الطلب'));
    if (!g) throw notFound('الطلب غير موجود');
    if (g.isGroup) { it.order_id = g.lead; groups.set(g.lead, g); }
  }
  const orderIds = items.map((i) => int(i.order_id, 'الطلب'));
  if (new Set(orderIds).size !== orderIds.length) throw bad('لا يمكن تكرار الطلب نفسه في الجلسة (الطلب متعدد المنتجات يُسلَّم بسطر واحد)');

  const sig = await saveSignature(db, body.signature, req.user.id);
  const batch = (await db.query(
    `insert into custody_batches(batch_no, kind, worker_id, supervisor_id, signature_path, signed_at, note)
     values (next_doc_no('ISS'),'issue',$1,$2,$3,$4,$5) returning *`,
    [workerId, req.user.id, sig, sig ? new Date() : null, str(body.note, 'ملاحظات')]
  )).rows[0];

  const created = [];
  // ترتيب ثابت للأقفال لتجنب الجمود عند التزامن
  const ordered = items.map((it, idx) => ({ it, idx })).sort((a, b) => Number(a.it.order_id) - Number(b.it.order_id));
  for (const { it, idx } of ordered) {
    const order = await lockOrder(db, int(it.order_id));
    if (order.status !== 'in_production') throw conflict(`الطلب ${order.order_no} ليس قيد التصنيع`);
    if (order.stage_state === 'shortage') throw conflict(`الطلب ${order.order_no} في النواقص`);
    const stageId = it.stage_id ? int(it.stage_id) : order.current_stage_id;
    const stage = (await db.query('select * from stages where id=$1', [stageId])).rows[0];
    if (!stage) throw bad('المرحلة غير موجودة');
    if (!stage.handles_gold) throw conflict(`المرحلة "${stage.name}" لا تتضمن تسليم ذهب - الطلب ${order.order_no}`);
    if (order.design_approval_required && order.design_status !== 'approved')
      throw conflict(`الطلب ${order.order_no}: لا يمكن بدء التصنيع قبل اعتماد العميل للتصميم`);

    const grp = groups.get(order.id);
    if (grp) {
      // ذهب بقية بنود الطلب (إن وُجد) يُجمع على البند القائد قبل التسليم
      for (const sid of grp.ids.filter((x) => x !== order.id)) {
        const sib = (await db.query('select id, order_no, material_id from orders where id=$1', [sid])).rows[0];
        const busy = (await db.query("select 1 from custodies where order_id=$1 and status in ('open','under_review') limit 1", [sid])).rowCount;
        if (busy) throw conflict(`البند ${sib.order_no} عليه عهدة مفتوحة - استلمها أولاً`);
        const bal = await ledger.balance(db, 'order', sid, sib.material_id);
        if (Number(bal) > 0 && sib.material_id === order.material_id) {
          await ledger.post(db, { kind: 'group_merge', material_id: order.material_id, weight: bal, from: ['order', sid], to: ['order', order.id], order_id: order.id, reason: `دمج ذهب البند ${sib.order_no} في الطلب`, user_id: req.user.id });
        }
      }
    }
    // الوزن: إما صافي ذهب مباشرة أو وزن الميزان ناقص الأحجار المركبة
    const stones = it.stones_weight != null && it.stones_weight !== '' ? W(it.stones_weight, 'وزن الأحجار', { allowZero: true }) : (await goldStonesGrams(db, order.id)).used;
    const gross = W(it.weight, `وزن الطلب ${order.order_no}`);
    const net = await sub(db, gross, stones);
    if (Number(net) <= 0) throw bad(`صافي الذهب للطلب ${order.order_no} غير صالح`);
    const allQty = grp ? Number((await db.query('select coalesce(sum(quantity),0) n from orders where id = any($1::int[])', [grp.ids])).rows[0].n) : order.quantity;
    const pieces = it.pieces != null && it.pieces !== '' ? int(it.pieces, 'عدد القطع', { min: 0 }) : allQty;
    // نسبة العجز: حسب مهنة العامل إن حُددت (تشبيك/تفنيش/أسماء/تركيب…)، وإلا نسبة المرحلة
    const rate = (await specialtyRate(db, workerId)) ?? (await currentRate(db, stage.id));

    // سحب الذهب: من رصيد الطلب، وإن لم يكفِ يُستكمل من الخزنة (عند السماح)
    await ledger.lockLocation(db, 'order', order.id, order.material_id);
    const orderBal = await ledger.balance(db, 'order', order.id, order.material_id);
    const shortfall = await sub(db, net, orderBal);
    if (Number(shortfall) > 0) {
      if (it.from_vault === false) throw bad(`رصيد الذهب المخصص للطلب ${order.order_no} غير كافٍ (المتاح ${Number(orderBal).toFixed(3)})`);
      await ledger.requireBalance(db, 'vault', null, order.material_id, shortfall, `رصيد الخزنة من مادة الطلب ${order.order_no} غير كافٍ`);
      await ledger.post(db, { kind: 'allocate', material_id: order.material_id, weight: shortfall, from: ['vault', null], to: ['order', order.id], order_id: order.id, stage_id: stage.id, batch_id: batch.id, reason: 'صرف تلقائي من الخزنة عند التسليم', user_id: req.user.id });
    }

    const c = (await db.query(
      `insert into custodies(custody_no, order_id, worker_id, supervisor_id, stage_id, material_id, weight_issued, gross_weight, stones_weight,
         pieces, loss_rate_snapshot, issue_batch_id, notes, idempotency_key, worker_ack_at)
       values (next_doc_no('CUS'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [order.id, workerId, req.user.id, stage.id, order.material_id, net, gross, stones, pieces, rate, batch.id,
       str(it.notes, 'ملاحظات'), key ? `${key}:${idx}` : null, sig ? new Date() : null]
    )).rows[0];
    await ledger.post(db, { kind: 'issue', material_id: order.material_id, weight: net, from: ['order', order.id], to: ['worker', workerId], order_id: order.id, custody_id: c.id, worker_id: workerId, stage_id: stage.id, batch_id: batch.id, user_id: req.user.id });
    await db.query("update orders set assigned_worker_id=$2, stage_state='waiting', updated_at=now() where id=$1", [order.id, workerId]);
    // تسليم جديد في مرحلة الجودة والوزن النهائي يُلغي أي وزن نهائي سابق (سيتغير الوزن) - يُسجَّل من جديد بعد الاستلام
    if (stage.kind === 'final_weight') await db.query('update orders set final_weight=null, final_gold_weight=null where id = any($1::int[]) and final_weight is not null', [grp ? grp.ids : [order.id]]);
    await logStage(db, order.id, stage.id, 'assigned', req.user.id, `تسليم ${net} جم - ${c.custody_no}`, false, workerId);
    if (sig) await db.query("insert into custody_work_log(custody_id, event, user_id, reason) values ($1,'ack',$2,'توقيع العامل عند التسليم')", [c.id, req.user.id]);
    created.push({ ...c, order_no: order.order_no });
  }

  await notifyUsers(db, [workerId], { kind: 'custody', title: `بانتظار قبولك: ${created.length} طلب`, body: created.map((c) => `${c.order_no}: ${c.weight_issued} جم`).join('، ') + ' — افتح مهامك واضغط قبول الاستلام', link: '/w' });
  await audit(db, req, 'custody.issue', 'custody_batch', batch.id, { worker: worker.full_name, items: created.map((c) => ({ custody: c.custody_no, order: c.order_no, weight: c.weight_issued })) });
  return { batch_id: batch.id, batch_no: batch.batch_no, custodies: created };
}

/** قطع عهدة الخامات المتبقية (المصروفة − المضافة على طلبات) */
async function piecesLeft(db, c) {
  if (!c.finding_id) return c.pieces;
  const used = Number((await db.query('select coalesce(sum(pieces),0) n from custody_additions where source_custody_id=$1 and not reversed', [c.id])).rows[0].n);
  return Math.max(0, Number(c.pieces || 0) - used);
}

/** معاينة حساب العجز قبل التأكيد (نفس دالة قاعدة البيانات) */
export async function preview(db, custodyId, returnedGross, scrap, stonesW, added = '0') {
  const c = (await db.query('select * from custodies where id=$1', [custodyId])).rows[0];
  if (!c) throw notFound('العهدة غير موجودة');
  const stones = stonesW != null && stonesW !== '' ? W(stonesW, 'وزن الأحجار', { allowZero: true }) : c.order_id ? (await goldStonesGrams(db, c.order_id, c.worker_id)).total : '0';
  const gross = W(returnedGross, 'الوزن المرتجع', { allowZero: true });
  const returned = await sub(db, gross, stones);
  if (Number(returned) < 0) throw bad('الوزن المرتجع أقل من وزن الأحجار');
  const s = scrap == null || scrap === '' ? '0' : W(scrap, 'البقايا', { allowZero: true });
  // المسلَّم الفعلي = المسلَّم − ما استُهلك منه في طلبات (عهدة الخامات) + خامات أضافها العامل على هذا الطلب
  const issued = (await db.query('select ($1::numeric - $2::numeric + $3::numeric)::numeric(16,4)::text v', [c.weight_issued, c.weight_used || 0, added || 0])).rows[0].v;
  const r = (await db.query('select * from calc_loss($1,$2,$3,$4)', [issued, returned, s, c.loss_rate_snapshot])).rows[0];
  return { custody: c, issued, added: added || '0', returned, scrap: s, stones, gross, ...r };
}

/**
 * استلام ذهب من عامل (طلب أو عدة طلبات). لكل طلب تسوية مستقلة.
 * المعادلة: المستلم = المرتجع + البقايا + الفقد المسجل
 */
export async function receive(db, req, body) {
  const workerId = int(body.worker_id, 'العامل');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad('اختر عهدة واحدة على الأقل');
  const key = str(body.idempotency_key, 'idempotency', { max: 100 });
  if (key) {
    const dup = await db.query('select receive_batch_id from settlements where idempotency_key=$1', [`${key}:0`]);
    if (dup.rows[0]) return { batch_id: dup.rows[0].receive_batch_id, duplicate: true };
  }
  await getWorker(db, workerId);

  const sig = await saveSignature(db, body.signature, req.user.id);
  const batch = (await db.query(
    `insert into custody_batches(batch_no, kind, worker_id, supervisor_id, signature_path, signed_at, note)
     values (next_doc_no('RCV'),'receive',$1,$2,$3,$4,$5) returning *`,
    [workerId, req.user.id, sig, sig ? new Date() : null, str(body.note, 'ملاحظات')]
  )).rows[0];

  const results = [];
  const ordered = items.map((it, idx) => ({ it, idx })).sort((a, b) => Number(a.it.custody_id) - Number(b.it.custody_id));
  for (const { it, idx } of ordered) {
    const cid = int(it.custody_id, 'العهدة');
    const c = (await db.query('select * from custodies where id=$1 for update', [cid])).rows[0];
    if (!c) throw notFound('العهدة غير موجودة');
    if (c.worker_id !== workerId) throw bad(`العهدة ${c.custody_no} ليست لدى هذا العامل`);
    if (c.status !== 'open') throw conflict(`العهدة ${c.custody_no} تم استلامها مسبقاً - لا يمكن تكرار تسجيل الوزن`);
    const order = c.order_id ? await lockOrder(db, c.order_id) : null;
    const label = order ? order.order_no : `عهدة عامة${c.purpose ? ' - ' + c.purpose : ''}`;

    // خامات أضافها العامل على الطلب (سلسلة، قفل...) من عهدة الخامات لديه: يُخصم وزنها منها ويدخل في وزن الطلب
    const additions = [];
    const usedNow = new Map();
    for (const a of Array.isArray(it.additions) ? it.additions : []) {
      if (!c.order_id) throw bad('الخامات تُضاف على عهدة طلب تصنيع');
      const sid = int(a.source_custody_id, 'عهدة الخامات');
      const src = (await db.query('select c.*, f.name as finding_name from custodies c left join findings f on f.id=c.finding_id where c.id=$1 for update of c', [sid])).rows[0];
      if (!src || src.worker_id !== workerId || src.status !== 'open' || (!src.finding_id && src.kind !== 'general')) throw bad('عهدة الإضافة غير صالحة لهذا العامل');
      if (!src.finding_id) src.finding_name = `العهدة العامة${src.purpose ? ` (${src.purpose})` : ''}`;
      if (src.material_id !== c.material_id) throw bad(`عيار "${src.finding_name}" يختلف عن عيار الطلب ${label}`);
      const w = Number(W(a.weight, `وزن ${src.finding_name}`));
      const avail = Number(src.weight_issued) - Number(src.weight_used) - (usedNow.get(sid) || 0);
      if (w > avail + 1e-9) throw bad(`وزن "${src.finding_name}" أكبر من المتبقي لدى العامل (${avail.toFixed(3)} جم)`);
      usedNow.set(sid, (usedNow.get(sid) || 0) + w);
      additions.push({ src, w, pieces: a.pieces != null && a.pieces !== '' ? int(a.pieces, 'عدد القطع', { min: 0 }) : 0 });
    }
    const added = (Math.round(additions.reduce((t, a) => t + a.w, 0) * 10000) / 10000).toFixed(4);
    const p = await preview(db, c.id, it.returned_weight, it.scrap_weight, it.stones_weight, added);
    // العجز يُسجَّل تلقائياً ويبقى الزائد على حساب العامل (يُحسب على إجمالي شغل الشهر).
    // المراجعة فقط عند زيادة الوزن عن المسلَّم (حالة غير طبيعية تحتاج ملاحظة).
    // أو إذا طلب المشرف صراحةً إحالة الحالة للمراجعة (review: true)
    const needsReview = Number(p.gain_weight) > 0 || it.review === true;
    const reason = str(it.reason, 'سبب العجز');
    if (needsReview && !reason) throw bad(`العهدة ${c.custody_no}: ${Number(p.gain_weight) > 0 ? 'الوزن المستلم أكبر من المسلَّم' : 'الإحالة للمراجعة'} - سجّل ملاحظة`, { custody_id: c.id, calc: p });

    const st = (await db.query(
      `insert into settlements(settlement_no, custody_id, receive_batch_id, weight_issued, returned_weight, gross_returned, stones_weight, scrap_weight,
         actual_loss, allowed_loss, normal_loss, abnormal_loss, gain_weight, rate_snapshot, pieces_returned, status, reason, notes, received_by, idempotency_key)
       values (next_doc_no('STL'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
      [c.id, batch.id, p.issued, p.returned, p.gross, p.stones, p.scrap, p.actual_loss, p.allowed_loss, p.normal_loss, p.abnormal_loss,
       p.gain_weight, c.loss_rate_snapshot, it.pieces_returned != null && it.pieces_returned !== '' ? int(it.pieces_returned, 'عدد القطع', { min: 0 }) : await piecesLeft(db, c),
       needsReview ? 'pending_review' : 'approved', reason, str(it.notes, 'ملاحظات'), req.user.id, key ? `${key}:${idx}` : null]
    )).rows[0];

    const base = { material_id: c.material_id, order_id: c.order_id, custody_id: c.id, settlement_id: st.id, worker_id: workerId, stage_id: c.stage_id, batch_id: batch.id, user_id: req.user.id };
    for (const a of additions) {
      await db.query(`insert into custody_additions(custody_id, source_custody_id, finding_id, order_id, weight, pieces, settlement_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c.id, a.src.id, a.src.finding_id, c.order_id, a.w, a.pieces, st.id, req.user.id]);
      const u = (await db.query('update custodies set weight_used = weight_used + $2 where id=$1 returning weight_issued, weight_used', [a.src.id, a.w])).rows[0];
      if (a.src.finding_id) await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, order_id, note, created_by) values ($1,'used',0,$2,$3,$4,$5,$6)`,
        [a.src.finding_id, a.w, a.src.id, c.order_id, `أُضيفت على ${label}${a.pieces ? ` (${a.pieces} قطعة)` : ''}`, req.user.id]);
      // استُهلكت عهدة الخامات بالكامل: تُغلق تلقائياً
      if (Number(u.weight_used) >= Number(u.weight_issued)) await db.query("update custodies set status='closed', closed_at=now(), work_state='finished', finished_at=coalesce(finished_at, now()) where id=$1", [a.src.id]);
    }
    await ledger.postIf(db, { ...base, kind: 'gain_pending', weight: p.gain_weight, from: ['variance', null], to: ['worker', workerId], reason });
    // عهدة الطلب يعود ذهبها لرصيد الطلب، وعهدة الخامات لمخزون الخامات، والعهدة العامة للخزنة
    await ledger.postIf(db, { ...base, kind: c.order_id ? 'return' : c.finding_id ? 'findings_return' : 'general_return', weight: p.returned, from: ['worker', workerId],
      to: c.order_id ? ['order', c.order_id] : c.finding_id ? ['findings', c.finding_id] : ['vault', null] });
    if (c.finding_id) await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, note, created_by) values ($1,'return',$2,$3,$4,$5,$6)`,
      [c.finding_id, st.pieces_returned || 0, p.returned, c.id, `إرجاع من العامل (${st.settlement_no})`, req.user.id]);
    await ledger.postIf(db, { ...base, kind: 'scrap_return', weight: p.scrap, from: ['worker', workerId], to: ['scrap', null] });
    await ledger.postIf(db, { ...base, kind: 'normal_loss', weight: p.normal_loss, from: ['worker', workerId], to: ['loss_normal', null] });
    if (Number(p.abnormal_loss) > 0) {
      // عجز غير طبيعي: إن تجاوز حد المراجعة يبقى معلقاً، وإلا يعتمد مباشرة
      await ledger.post(db, { ...base, kind: needsReview ? 'abnormal_pending' : 'abnormal_loss', weight: p.abnormal_loss, from: ['worker', workerId], to: [needsReview ? 'loss_suspense' : 'loss_abnormal', null], reason });
    }

    await db.query(
      `update custodies set status=$2, closed_at=case when $2='closed' then now() else null end, work_state='finished',
         finished_at=coalesce(finished_at, now()) where id=$1`,
      [c.id, needsReview ? 'under_review' : 'closed']
    );
    await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `استلام ${p.returned} جم${Number(added) ? ` (منها خامات مضافة ${added} جم: ${additions.map((a) => a.src.finding_name).join('، ')})` : ''} + بقايا ${p.scrap} - عجز ${p.actual_loss} (${st.settlement_no})`, false, workerId);

    let advanced = null;
    if (needsReview) {
      await notifyPerm(db, 'loss.review', { kind: 'loss', title: `${Number(p.gain_weight) > 0 ? `زيادة وزن ${p.gain_weight}` : `عجز ${p.actual_loss}`} جم - ${label}`, body: reason, link: '/sup/review' });
    } else if (it.advance !== false && c.order_id) {
      advanced = await tryAdvance(db, req, c.order_id);
    }
    results.push({ settlement: st, order_no: label, advanced });
  }
  await audit(db, req, 'custody.receive', 'custody_batch', batch.id, { worker_id: workerId, settlements: results.map((r) => r.settlement.settlement_no) });
  return { batch_id: batch.id, batch_no: batch.batch_no, results };
}

async function tryAdvance(db, req, orderId) {
  const o = await lockOrder(db, orderId);
  if (o.status !== 'in_production') return null;
  const stage = (await db.query('select * from stages where id=$1', [o.current_stage_id])).rows[0];
  const open = await db.query("select count(*)::int n from custodies where order_id=$1 and status in ('open','under_review')", [orderId]);
  if (open.rows[0].n || !stage?.handles_gold) return null;
  if (stage.requires_approval && !has(req, 'orders.advance')) return null;
  try {
    const r = await advance(db, o, req.user.id);
    // الطلب متعدد المنتجات: بقية البنود في نفس المرحلة تنتقل معه
    const g = await groupInfo(db, o.id);
    if (g?.isGroup && g.lead === o.id) {
      for (const sid of g.ids.filter((x) => x !== o.id)) {
        const so = await lockOrder(db, sid);
        if (so.status !== 'in_production' || so.current_stage_id !== stage.id) continue;
        try { await advance(db, so, req.user.id); } catch (e) { if (e.status !== 409) throw e; }
      }
    }
    return r;
  } catch (e) {
    if (e.status === 409) return { blocked: e.message };
    throw e;
  }
}

async function closeAfterReview(db, req, st) {
  await db.query("update custodies set status='closed', closed_at=now() where id=$1", [st.custody_id]);
  const c = (await db.query('select order_id from custodies where id=$1', [st.custody_id])).rows[0];
  return c.order_id ? tryAdvance(db, req, c.order_id) : null;
}

/** مراجعة المشرف: اعتماد التسوية أو إحالتها للتحقيق */
export async function review(db, req, id, body) {
  const st = (await db.query('select * from settlements where id=$1 for update', [id])).rows[0];
  if (!st) throw notFound('التسوية غير موجودة');
  if (st.status !== 'pending_review') throw conflict('التسوية ليست بانتظار المراجعة');
  const notes = str(body.notes, 'ملاحظات المراجعة');
  if (body.decision === 'approve') {
    if (!has(req, 'loss.approve')) throw forbidden('اعتماد العجز غير الطبيعي يتطلب صلاحية الاعتماد - أحِل الحالة للتحقيق');
    const c = (await db.query('select * from custodies where id=$1', [st.custody_id])).rows[0];
    if (Number(st.abnormal_loss) > 0)
      await ledger.post(db, { kind: 'abnormal_loss_approved', material_id: c.material_id, weight: st.abnormal_loss, from: ['loss_suspense', null], to: ['loss_abnormal', null], order_id: c.order_id, custody_id: c.id, settlement_id: st.id, worker_id: c.worker_id, stage_id: c.stage_id, reason: notes, user_id: req.user.id });
    await db.query("update settlements set status='resolved', review_decision='accept_loss', reviewed_by=$2, reviewed_at=now(), review_notes=$3, resolved_by=$2, resolved_at=now() where id=$1", [id, req.user.id, notes]);
    const adv = await closeAfterReview(db, req, st);
    await audit(db, req, 'loss.approve', 'settlement', id, { notes, abnormal: st.abnormal_loss, gain: st.gain_weight });
    return { status: 'resolved', advanced: adv };
  }
  if (body.decision === 'investigate') {
    if (!notes) throw bad('اكتب سبب الإحالة للتحقيق');
    await db.query("update settlements set status='investigating', reviewed_by=$2, reviewed_at=now(), review_notes=$3 where id=$1", [id, req.user.id, notes]);
    await notifyPerm(db, 'loss.investigate', { kind: 'loss', title: `إحالة عجز للتحقيق - ${st.settlement_no}`, body: notes, link: '/sup/review' });
    await audit(db, req, 'loss.refer', 'settlement', id, { notes });
    return { status: 'investigating' };
  }
  throw bad('قرار غير صالح');
}

/** نتيجة التحقيق: استرداد جزء/كل العجز أو اعتماده، مع تحديد المسؤولية (ليست تلقائية على العامل) */
export async function investigate(db, req, id, body) {
  const st = (await db.query('select * from settlements where id=$1 for update', [id])).rows[0];
  if (!st) throw notFound('التسوية غير موجودة');
  if (!['investigating', 'pending_review'].includes(st.status)) throw conflict('التسوية ليست قيد التحقيق');
  const result = str(body.result, 'نتيجة التحقيق', { required: true });
  const decision = ['accept_loss', 'recovered', 'worker_responsible', 'no_fault'].includes(body.decision) ? body.decision : null;
  if (!decision) throw bad('حدد قرار التحقيق');
  const recovered = W(body.recovered_weight, 'الوزن المسترد', { allowZero: true });
  if (Number(recovered) > Number(st.abnormal_loss)) throw bad('الوزن المسترد أكبر من العجز غير الطبيعي');
  const c = (await db.query('select * from custodies where id=$1', [st.custody_id])).rows[0];
  const base = { material_id: c.material_id, order_id: c.order_id, custody_id: c.id, settlement_id: st.id, worker_id: c.worker_id, stage_id: c.stage_id, reason: result, user_id: req.user.id };
  await ledger.postIf(db, { ...base, kind: 'loss_recovered', weight: recovered, from: ['loss_suspense', null], to: ['scrap', null] });
  const remaining = await sub(db, st.abnormal_loss, recovered);
  await ledger.postIf(db, { ...base, kind: 'abnormal_loss_approved', weight: remaining, from: ['loss_suspense', null], to: ['loss_abnormal', null] });
  await db.query(
    `update settlements set status='resolved', review_decision=$2, investigation_result=$3, recovered_weight=$4, resolved_by=$5, resolved_at=now(),
       reviewed_by=coalesce(reviewed_by,$5), reviewed_at=coalesce(reviewed_at, now()) where id=$1`,
    [id, decision, result, recovered, req.user.id]
  );
  const adv = await closeAfterReview(db, req, st);
  await notifyUsers(db, [st.received_by], { kind: 'loss', title: `تم إغلاق التحقيق ${st.settlement_no}`, body: result, link: '/sup/review' });
  await audit(db, req, 'loss.investigate', 'settlement', id, { decision, result, recovered });
  return { status: 'resolved', advanced: adv };
}

/** تصحيح تسوية: حركات عكسية لكل حركاتها وإعادة فتح العهدة - مع السبب والمستخدم والتاريخ */
export async function reverseSettlement(db, req, id, reasonIn) {
  const reason = str(reasonIn, 'سبب التصحيح', { required: true });
  const st = (await db.query('select * from settlements where id=$1 for update', [id])).rows[0];
  if (!st) throw notFound('التسوية غير موجودة');
  if (st.status === 'reversed') throw conflict('التسوية مصححة مسبقاً');
  const c = (await db.query('select * from custodies where id=$1 for update', [st.custody_id])).rows[0];
  const order = c.order_id ? await lockOrder(db, c.order_id) : null;
  const later = !order ? { rowCount: 0 } : await db.query("select 1 from custodies where order_id=$1 and issued_at > $2 and status <> 'reversed' limit 1", [c.order_id, st.received_at]);
  if (later.rowCount) throw conflict('تم تسليم الطلب لمرحلة لاحقة بعد هذه التسوية - صحّح العهدة اللاحقة أولاً أو سجّل تسوية مستقلة');
  const mvs = (await db.query(
    'select * from gold_ledger g where settlement_id=$1 and reverses_id is null and not exists (select 1 from gold_ledger r where r.reverses_id=g.id) order by id desc', [id]
  )).rows;
  for (const mv of mvs) {
    if (mv.to_type !== 'worker') await ledger.requireBalance(db, mv.to_type, mv.to_ref, mv.material_id, mv.weight, 'لا يمكن عكس الحركة لعدم كفاية الرصيد');
    await ledger.reverse(db, mv, `تصحيح ${st.settlement_no}: ${reason}`, req.user.id);
  }
  // إرجاع الخامات المضافة لعهدة الخامات لدى العامل
  for (const a of (await db.query('select * from custody_additions where settlement_id=$1 and not reversed', [id])).rows) {
    const src = (await db.query('select * from custodies where id=$1 for update', [a.source_custody_id])).rows[0];
    if (src.status !== 'open' && (await db.query("select 1 from settlements where custody_id=$1 and status <> 'reversed'", [src.id])).rowCount)
      throw conflict(`عهدة الخامات ${src.custody_no} تم استلامها - صحّح تسويتها أولاً`);
    await db.query("update custodies set weight_used = weight_used - $2, status='open', closed_at=null where id=$1", [src.id, a.weight]);
    await db.query('update custody_additions set reversed=true where id=$1', [a.id]);
    await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, order_id, note, created_by) values ($1,'reversal',0,$2,$3,$4,$5,$6)`,
      [a.finding_id, a.weight, src.id, a.order_id, `تصحيح ${st.settlement_no}: إلغاء إضافة الخامة`, req.user.id]);
  }
  if (c.finding_id) await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, note, created_by) values ($1,'reversal',$2,$3,$4,$5,$6)`,
    [c.finding_id, -(st.pieces_returned || 0), st.returned_weight, c.id, `تصحيح ${st.settlement_no}`, req.user.id]);
  await db.query("update settlements set status='reversed', reversed_by=$2, reversed_at=now(), reversal_reason=$3 where id=$1", [id, req.user.id, reason]);
  await db.query("update custodies set status='open', closed_at=null where id=$1", [c.id]);
  if (order && order.current_stage_id !== c.stage_id && order.status === 'in_production') {
    const seq = (await db.query('select seq from route_stages where route_id=$1 and stage_id=$2 order by seq limit 1', [order.route_id, c.stage_id])).rows[0];
    if (seq) await db.query("update orders set current_stage_id=$2, stage_seq=$3, stage_state='in_progress' where id=$1", [order.id, c.stage_id, seq.seq]);
  }
  await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `تصحيح التسوية ${st.settlement_no}: ${reason}`);
  await audit(db, req, 'settlement.reverse', 'settlement', id, { reason, movements: mvs.map((m) => m.movement_no) });
  return { reversed: mvs.length };
}

/** إلغاء تسليم خاطئ (قبل الاستلام) بحركة عكسية */
export async function reverseIssue(db, req, id, reasonIn) {
  const reason = str(reasonIn, 'سبب التصحيح', { required: true });
  const c = (await db.query('select * from custodies where id=$1 for update', [id])).rows[0];
  if (!c) throw notFound('العهدة غير موجودة');
  if (c.status !== 'open') throw conflict('لا يمكن إلغاء عهدة تم استلامها - صحّح التسوية أولاً');
  if (c.order_id) await lockOrder(db, c.order_id);
  if (Number(c.weight_used) > 0) throw conflict('أُضيف جزء من هذه الخامات على طلبات - صحّح تلك التسويات أولاً');
  const mvs = (await db.query("select * from gold_ledger g where custody_id=$1 and settlement_id is null and kind in ('issue','general_issue','findings_issue') and not exists (select 1 from gold_ledger r where r.reverses_id=g.id)", [id])).rows;
  if (c.finding_id) await db.query(`insert into finding_moves(finding_id, kind, pieces, weight, custody_id, note, created_by) values ($1,'reversal',$2,$3,$4,$5,$6)`,
    [c.finding_id, c.pieces || 0, c.weight_issued, c.id, `إلغاء صرف ${c.custody_no}`, req.user.id]);
  for (const mv of mvs) await ledger.reverse(db, mv, `إلغاء تسليم ${c.custody_no}: ${reason}`, req.user.id);
  await db.query("update custodies set status='reversed', reversed_by=$2, reversed_at=now(), reversal_reason=$3 where id=$1", [id, req.user.id, reason]);
  await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `إلغاء التسليم ${c.custody_no}: ${reason}`);
  await audit(db, req, 'custody.reverse', 'custody', id, { reason });
  return { reversed: mvs.length };
}

/**
 * عهدة عامة: تحويل ذهب من الخزنة إلى عامل كرصيد في عهدته بدون طلب تصنيع.
 * تُستلم لاحقاً من شاشة الاستلام المعتادة ويعود الذهب للخزنة مع حساب العجز.
 */
export async function issueGeneral(db, req, body) {
  const workerId = int(body.worker_id, 'العامل');
  const worker = await getWorker(db, workerId);
  const materialId = int(body.material_id, 'المادة');
  const weight = W(body.weight, 'الوزن');
  const purpose = str(body.purpose, 'الغرض / البيان', { required: true, max: 300 });
  const rate = body.loss_rate_percent != null && body.loss_rate_percent !== '' ? String(body.loss_rate_percent).trim() : '0';
  if (!/^\d{1,2}(\.\d{1,5})?$/.test(rate)) throw bad('نسبة العجز المسموح غير صالحة');
  const key = str(body.idempotency_key, 'idempotency', { max: 100 });
  if (key) {
    const dup = (await db.query('select id, issue_batch_id from custodies where idempotency_key=$1', [`${key}:g`])).rows[0];
    if (dup) return { custody_id: dup.id, batch_id: dup.issue_batch_id, duplicate: true };
  }
  await ledger.requireBalance(db, 'vault', null, materialId, weight, 'رصيد الخزنة من هذه المادة غير كافٍ');
  const batch = (await db.query(`insert into custody_batches(batch_no, kind, worker_id, supervisor_id, note) values (next_doc_no('ISS'),'issue',$1,$2,$3) returning *`,
    [workerId, req.user.id, purpose])).rows[0];
  const c = (await db.query(`insert into custodies(custody_no, kind, purpose, order_id, worker_id, supervisor_id, stage_id, material_id, weight_issued, gross_weight, pieces,
      loss_rate_snapshot, issue_batch_id, notes, idempotency_key) values (next_doc_no('CUS'),'general',$1,null,$2,$3,null,$4,$5,$5,0,$6,$7,$8,$9) returning *`,
    [purpose, workerId, req.user.id, materialId, weight, rate, batch.id, str(body.notes, 'ملاحظات'), key ? `${key}:g` : null])).rows[0];
  await ledger.post(db, { kind: 'general_issue', material_id: materialId, weight, from: ['vault', null], to: ['worker', workerId], custody_id: c.id, worker_id: workerId, batch_id: batch.id, reason: purpose, user_id: req.user.id });
  await notifyUsers(db, [workerId], { kind: 'custody', title: `بانتظار قبولك: عهدة عامة ${weight} جم`, body: `${purpose} — افتح مهامك واضغط قبول الاستلام`, link: '/w' });
  await audit(db, req, 'custody.general_issue', 'custody', c.id, { worker: worker.full_name, material_id: materialId, weight, purpose, rate });
  return { custody_id: c.id, custody_no: c.custody_no, batch_id: batch.id, batch_no: batch.batch_no };
}
