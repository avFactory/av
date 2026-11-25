// تحويل الطلب من عامل إلى عامل المرحلة التالية (تشبيك ← تركيب مثلاً):
// 1) العامل الأول (أو المشرف) يحدد العامل التالي ووزن القطع على الميزان → تحويل بانتظار القبول
// 2) العامل الثاني يزن ويؤكد الوزن ويقبل → استلام من الأول بهذا الوزن (الفرق عجز على الأول: طبيعي/غير طبيعي)،
//    نقل الطلب للمرحلة التالية، وتسليمه للثاني كعهدة مقبولة (قبوله توقيعه الإلكتروني).
import { bad, conflict, forbidden, notFound, int, str, weight as W } from './http.js';
import { audit } from './audit.js';
import { notifyPerm, notifyUsers } from './notify.js';
import { receive, issue, issueGeneral, getWorker, preview } from './custody.js';
import { advance, lockOrder, logStage } from './production.js';
import { groupInfo } from './orderGroups.js';
import { has } from './auth.js';
import { partialReturn } from './partialReturn.js';

const label = async (db, orderId) => (await db.query(`select coalesce(case when (select count(*) from orders x where x.cart_ref=o.cart_ref and x.status not in ('cancelled','rejected')) > 1 then o.cart_ref end, o.order_no) n from orders o where o.id=$1`, [orderId])).rows[0]?.n || 'عهدة عامة';

/** إنشاء تحويل: العامل صاحب العهدة أو المشرف */
export async function createTransfer(db, req, custodyId, body) {
  const c = (await db.query('select * from custodies where id=$1 for update', [int(custodyId)])).rows[0];
  if (!c) throw notFound('العهدة غير موجودة');
  const isOwner = c.worker_id === req.user.id;
  if (!isOwner && !(has(req, 'custody.issue') && has(req, 'custody.receive'))) throw forbidden();
  if (c.status !== 'open') throw conflict('العهدة ليست مفتوحة');
  if (c.finding_id) throw bad('عهدة الخامات لا تُحوّل — أرجعها للمشرف ثم تُصرف للعامل الآخر');
  // نفس المرحلة = إعادة إسناد لعامل آخر بدون نقل الطلب؛ العهدة العامة دائماً بنفس الحال
  // جزء من العهدة: ينتقل الجزء فقط ويبقى الباقي لدى المرسل (بلا عجز)، وللطلب يكون في نفس المرحلة
  const portion = body.portion === 'part' ? 'part' : 'full';
  const mode = !c.order_id || portion === 'part' ? 'same_stage' : body.mode === 'same_stage' ? 'same_stage' : 'next_stage';
  if (isOwner && !c.worker_ack_at) throw conflict('اقبل العهدة أولاً');
  if (c.worker_rejected_at && !c.worker_ack_at) throw conflict('العامل رفض استلام هذه العهدة — صحّح التسليم أو ألغِه أولاً');
  const toId = int(body.to_worker_id, 'العامل');
  if (toId === c.worker_id) throw bad('اختر عاملاً آخر');
  const to = await getWorker(db, toId);
  // المكينة لا تستلم بنفسها: التحويل إليها من المشرف فقط، ويُسجل عليها فوراً بالوزن الذي يزنه المشرف
  if (to.kind === 'machine' && isOwner) throw bad('التحويل للمكينة عن طريق المشرف — سلّم القطع للمشرف ليزنها ويحوّلها');
  const weight = W(body.weight, 'الوزن');
  const remaining = Number(c.weight_issued) - Number(c.weight_used);
  if (Number(weight) > remaining * 1.5 + 5) throw bad('الوزن غير منطقي مقارنة بالعهدة');
  if (portion === 'part' && Number(weight) >= remaining - 1e-9) throw bad(`جزء العهدة يجب أن يكون أقل مما لديك (${remaining.toFixed(3)} جم) — لتحويل الكل اختر «كل العهدة»`);
  // تحويل الكل بوزن أقل بكثير من العهدة: غالباً المقصود تحويل جزء — يُمنع حتى لا يُحسب الباقي عجزاً بالخطأ
  if (portion === 'full' && remaining - Number(weight) > Math.max(1, remaining * 0.1)) throw bad(`الوزن ${Number(weight).toFixed(3)} أقل بكثير من العهدة (${remaining.toFixed(3)} جم) — إذا تحوّل جزءاً فقط اختر «جزء من العهدة» فيبقى الباقي لديك بدون عجز`);
  const pend = (await db.query("select 1 from custody_transfers where custody_id=$1 and status='pending'", [c.id])).rowCount;
  if (pend) throw conflict('يوجد تحويل بانتظار القبول لهذه العهدة');
  const t = (await db.query(`insert into custody_transfers(custody_id, order_id, from_worker, to_worker, weight, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [c.id, c.order_id, c.worker_id, to.id, weight, str(body.note, 'ملاحظة'), req.user.id])).rows[0];
  await db.query('update custody_transfers set mode=$2, portion=$3 where id=$1', [t.id, mode, portion]); t.mode = mode; t.portion = portion;
  const no = await label(db, c.order_id);
  const from = (await db.query('select full_name from users where id=$1', [c.worker_id])).rows[0].full_name;
  await logStage(db, c.order_id, c.stage_id, 'note', req.user.id, `تحويل ${weight} جم من ${from} إلى ${to.full_name} - بانتظار قبوله`, false, c.worker_id);
  await notifyUsers(db, [to.id], { kind: 'custody', title: `تحويل إليك: ${no} — ${Number(weight)} جم`, body: `من ${from}: زِن القطع وأكّد الوزن ثم اقبل`, link: '/w' });
  await audit(db, req, 'custody.transfer_request', 'custody', c.id, { to: to.full_name, weight });
  if (to.kind === 'machine') return { ...t, auto: await acceptTransfer(db, req, t.id, { weight }, { auto: true }) };
  return t;
}

/** قبول العامل الثاني بعد التأكد من الوزن */
export async function acceptTransfer(db, req, transferId, body, opts = {}) {
  const t = (await db.query('select * from custody_transfers where id=$1 for update', [int(transferId)])).rows[0];
  if (!t || (t.to_worker !== req.user.id && !opts.auto)) throw notFound('التحويل غير موجود');
  const toName = (await db.query('select full_name from users where id=$1', [t.to_worker])).rows[0].full_name;
  if (t.status !== 'pending') throw conflict('التحويل لم يعد بانتظار القبول');
  const confirmed = W(body.weight, 'الوزن الذي استلمته');
  const c = (await db.query('select * from custodies where id=$1', [t.custody_id])).rows[0];
  if (c.status !== 'open') throw conflict('عهدة العامل الأول لم تعد مفتوحة - تواصل مع المشرف');
  const fromName = (await db.query('select full_name from users where id=$1', [t.from_worker])).rows[0].full_name;
  const no = await label(db, c.order_id);

  const same = t.mode === 'same_stage' || !c.order_id;
  // تحويل جزء: ينتقل الوزن المؤكد فقط من المرسل للمستلم، وتبقى عهدة المرسل مفتوحة بالباقي (بلا تسوية ولا عجز)
  if (t.portion === 'part') {
    const remaining = Number(c.weight_issued) - Number(c.weight_used);
    if (Number(confirmed) >= remaining - 1e-9) throw conflict(`الوزن المؤكد (${Number(confirmed)} جم) لا يقل عن كل ما لدى ${fromName} (${remaining.toFixed(3)} جم) — يجب تحويل كامل العهدة بدلاً من الجزء`);
    await partialReturn(db, req, c.id, { weight: confirmed, note: `تحويل جزء إلى ${toName} (التحويل #${t.id})` }, { forTransfer: true });
    let ncId;
    if (c.order_id) {
      const is2 = await issue(db, req, { worker_id: t.to_worker, note: `تحويل جزء من ${fromName}`, silent: true,
        items: [{ order_id: c.order_id, weight: confirmed, stones_weight: '0', from_vault: false, notes: `جزء محوّل من ${fromName}` }] });
      ncId = is2.custodies[0].id;
    } else {
      ncId = (await issueGeneral(db, req, { worker_id: t.to_worker, material_id: c.material_id, weight: confirmed, purpose: c.purpose || `محوّلة من ${fromName}`, loss_rate_percent: String(Number(c.loss_rate_snapshot)), silent: true })).custody_id;
    }
    await db.query('update custodies set worker_ack_at=now(), ack_ip=$2 where id=$1', [ncId, req.ip]);
    await db.query("insert into custody_work_log(custody_id, event, user_id, reason) values ($1,'ack',$2,'قبول جزء محوّل بعد التأكد من الوزن')", [ncId, req.user.id]);
    await db.query("update custody_transfers set status='accepted', confirmed_weight=$2, decided_at=now(), new_custody_id=$3 where id=$1", [t.id, confirmed, ncId]);
    const left = (remaining - Number(confirmed)).toFixed(3);
    await notifyUsers(db, [t.from_worker], { kind: 'custody', title: `قبل ${toName} الجزء المحوّل: ${no}`, body: `استلم ${Number(confirmed)} جم — يبقى لديك ${left} جم`, link: '/w' });
    await notifyPerm(db, 'custody.receive', { kind: 'custody', title: `تحويل جزء ${no}: ${fromName} ← ${toName}`, body: `${Number(confirmed)} جم · بقي لدى ${fromName} ${left} جم`, link: c.order_id ? `/orders/${c.order_id}` : `/sup/workers/${t.from_worker}` });
    await audit(db, req, 'custody.transfer_accept', 'custody', ncId, { transfer: t.id, portion: 'part', from: fromName, declared: t.weight, confirmed, left });
    return { ok: true, custody_id: ncId, portion: 'part', left };
  }
  // الوزن أكبر مما سُلّم للأول: الزيادة ذهب أضافه من عهدته العامة (أو عهد الخامات) فتُخصم منها تلقائياً
  const pv = await preview(db, c.id, confirmed, '0');
  const additions = [];
  let gain = Number(pv.gain_weight);
  if (gain > 0 && !c.order_id) throw conflict(`الوزن أكبر من العهدة العامة لدى ${fromName} — تواصل مع المشرف`);
  if (gain > 0) {
    const srcs = (await db.query(`select id, (weight_issued - weight_used)::numeric(16,4) as avail from custodies
      where worker_id=$1 and status='open' and worker_rejected_at is null and material_id=$2 and id<>$3 and (kind='general' or finding_id is not null) and weight_issued > weight_used
      order by (finding_id is null) desc, issued_at`, [t.from_worker, c.material_id, c.id])).rows;
    for (const s of srcs) {
      if (gain <= 0) break;
      const take = Math.min(gain, Number(s.avail));
      additions.push({ source_custody_id: s.id, weight: take.toFixed(4) });
      gain = +(gain - take).toFixed(4);
    }
    if (gain > 0) throw conflict(`الوزن (${Number(confirmed)} جم) أكبر مما سُلّم لـ${fromName} بـ ${Number(pv.gain_weight)} جم، ولا تكفي عهدته العامة لتغطية الزيادة (ينقص ${gain} جم) - تواصل مع المشرف`);
  }
  // 1) استلام من العامل الأول بالوزن المؤكد (العجز عليه حسب نسبته)
  const rc = await receive(db, req, {
    worker_id: t.from_worker, note: `تحويل إلى ${toName}`,
    items: [{ custody_id: c.id, returned_weight: confirmed, scrap_weight: '0', advance: false, additions, notes: `تحويل مباشر إلى ${toName} (التحويل #${t.id})${additions.length ? ' + إضافة من العهدة العامة' : ''}` }],
  });
  const settlement = rc.results?.[0]?.settlement;
  if (settlement?.status === 'pending_review') throw conflict('الوزن أكبر من المسلَّم للعامل الأول - يجب مراجعة المشرف (لم يتم التحويل)');

  let next, is;
  if (!c.order_id) {
    // عهدة عامة: تُسجل للعامل الثاني بنفس الغرض ونسبة العجز
    const g = await issueGeneral(db, req, { worker_id: t.to_worker, material_id: c.material_id, weight: confirmed, purpose: c.purpose || `محوّلة من ${fromName}`, loss_rate_percent: String(Number(c.loss_rate_snapshot)), silent: true });
    is = { custodies: [{ id: g.custody_id }] };
    next = { name: 'عهدة عامة' };
  } else {
    const o = await lockOrder(db, c.order_id);
    if (!same) {
      // 2) نقل الطلب (وبقية بنوده في نفس المرحلة) للمرحلة التالية
      const stageBefore = o.current_stage_id;
      await advance(db, o, req.user.id);
      const g = await groupInfo(db, o.id);
      if (g?.isGroup && g.lead === o.id) {
        for (const sid of g.ids.filter((x) => x !== o.id)) {
          const so = await lockOrder(db, sid);
          if (so.status === 'in_production' && so.current_stage_id === stageBefore) await advance(db, so, req.user.id).catch((e) => { if (e.status !== 409) throw e; });
        }
      }
    }
    next = (await db.query('select s.id, s.name, s.handles_gold from orders o join stages s on s.id=o.current_stage_id where o.id=$1', [o.id])).rows[0];
    if (!next?.handles_gold) throw conflict(`المرحلة التالية "${next?.name || ''}" لا تتضمن تسليم ذهب - سلّم الطلب للمشرف`);
    // 3) تسليم للعامل الثاني بنفس الوزن (نفس المرحلة أو التالية)، وقبوله الآن توقيعه الإلكتروني
    is = await issue(db, req, {
      worker_id: t.to_worker, note: `تحويل من ${fromName}`, silent: true,
      items: [{ order_id: o.id, weight: confirmed, from_vault: false, notes: `محوّل من ${fromName}${same ? ' (نفس المرحلة)' : ''}` }],
    });
  }
  const nc = is.custodies[0];
  await db.query('update custodies set worker_ack_at=now(), ack_ip=$2 where id=$1', [nc.id, req.ip]);
  await db.query("insert into custody_work_log(custody_id, event, user_id, reason) values ($1,'ack',$2,'قبول التحويل بعد التأكد من الوزن')", [nc.id, req.user.id]);
  await db.query("update custody_transfers set status='accepted', confirmed_weight=$2, decided_at=now(), new_custody_id=$3, settlement_id=$4 where id=$1", [t.id, confirmed, nc.id, settlement?.id || null]);
  const loss = settlement ? Number(settlement.actual_loss) : 0;
  await notifyUsers(db, [t.from_worker], { kind: 'custody', title: `قبل ${toName} التحويل: ${no}`, body: `استلم ${Number(confirmed)} جم${loss > 0 ? ` — عجز ${loss} جم على حسابك` : ''}`, link: '/w' });
  await notifyPerm(db, 'custody.receive', { kind: 'custody', title: `تحويل ${no}: ${fromName} ← ${toName}`, body: `${Number(confirmed)} جم${loss > 0 ? ` · عجز ${loss} جم` : ''} · ${next.name}`, link: c.order_id ? `/orders/${c.order_id}` : `/sup/workers/${t.to_worker}` });
  await audit(db, req, 'custody.transfer_accept', 'custody', nc.id, { transfer: t.id, from: fromName, declared: t.weight, confirmed, loss });
  return { ok: true, custody_id: nc.id, settlement, stage: next.name };
}

export async function rejectTransfer(db, req, transferId, body) {
  const t = (await db.query('select * from custody_transfers where id=$1 for update', [int(transferId)])).rows[0];
  if (!t || t.to_worker !== req.user.id) throw notFound('التحويل غير موجود');
  if (t.status !== 'pending') throw conflict('التحويل لم يعد بانتظار القبول');
  const reason = str(body.reason, 'سبب الرفض', { required: true });
  await db.query("update custody_transfers set status='rejected', reject_reason=$2, decided_at=now() where id=$1", [t.id, reason]);
  const no = await label(db, t.order_id);
  await notifyUsers(db, [t.from_worker], { kind: 'reject', title: `رفض ${req.user.full_name} التحويل: ${no}`, body: reason, link: '/w' });
  await notifyPerm(db, 'custody.issue', { kind: 'reject', title: `رُفض تحويل ${no}`, body: `${req.user.full_name}: ${reason}`, link: `/orders/${t.order_id}` });
  await audit(db, req, 'custody.transfer_reject', 'custody', t.custody_id, { transfer: t.id, reason });
  return { ok: true };
}

export async function cancelTransfer(db, req, transferId) {
  const t = (await db.query('select * from custody_transfers where id=$1 for update', [int(transferId)])).rows[0];
  if (!t) throw notFound('التحويل غير موجود');
  if (t.from_worker !== req.user.id && !has(req, 'custody.issue')) throw forbidden();
  if (t.status !== 'pending') throw conflict('التحويل لم يعد بانتظار القبول');
  await db.query("update custody_transfers set status='cancelled', decided_at=now() where id=$1", [t.id]);
  await audit(db, req, 'custody.transfer_cancel', 'custody', t.custody_id, { transfer: t.id });
  return { ok: true };
}

export const transferCols = `t.id, t.custody_id, t.order_id, t.weight::text, t.status, t.note, t.mode, t.portion, t.created_at, fw.full_name as from_name, tw.full_name as to_name, tw.employee_no as to_no`;
