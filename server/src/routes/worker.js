// واجهة العامل: لا يرى إلا عهده وطلباته
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, forbidden, notFound, int, str, weight as W } from '../lib/http.js';
import { notifyPerm } from '../lib/notify.js';
import { saveSignature, upload, registerFiles } from '../lib/uploads.js';
import { advance, lockOrder, logStage } from '../lib/production.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requirePerm('worker.self'));

async function myCustody(db, req, id, lock = false) {
  const c = (await db.query(`select * from custodies where id=$1 ${lock ? 'for update' : ''}`, [int(id)])).rows[0];
  if (!c || c.worker_id !== req.user.id) throw notFound('العهدة غير موجودة');
  return c;
}

async function canSeeOrder(db, req, orderId) {
  const o = (await db.query('select * from orders where id=$1', [orderId])).rows[0];
  if (!o) throw notFound('الطلب غير موجود');
  if (o.assigned_worker_id === req.user.id) return o;
  const c = await db.query("select 1 from custodies where order_id=$1 and worker_id=$2 and status <> 'reversed' limit 1", [orderId, req.user.id]);
  if (!c.rowCount) throw forbidden('هذا الطلب غير مسند إليك');
  return o;
}

r.get('/tasks', async (req, res) => {
  const custodies = await many(`
    select c.id, c.custody_no, c.order_id, c.weight_issued::text, c.pieces, c.status, c.work_state, c.worker_ack_at, c.issued_at, c.started_at,
           c.worker_declared_returned::text, c.worker_declared_scrap::text, c.worker_declared_used::text, c.issue_batch_id,
           o.order_no, o.title, o.due_date, o.size, o.notes as order_notes, s.name as stage_name, s.required_fields, m.name as material_name,
           (select f.path from order_files f where f.order_id=o.id and f.kind in ('design','reference','sketch') and f.mime like 'image/%' order by f.id desc limit 1) as thumb
    from custodies c join orders o on o.id=c.order_id join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
    where c.worker_id=$1 and c.status in ('open','under_review') order by c.issued_at`, [req.user.id]);
  // مهام بدون ذهب (مثل التصميم) مسندة للعامل
  const tasks = await many(`
    select o.id as order_id, o.order_no, o.title, o.due_date, o.stage_state, s.name as stage_name, s.kind as stage_kind, s.requires_approval
    from orders o join stages s on s.id=o.current_stage_id
    where o.assigned_worker_id=$1 and o.status='in_production' and not s.handles_gold`, [req.user.id]);
  res.json({ custodies, tasks });
});

r.get('/orders/:id', async (req, res) => {
  const o = await canSeeOrder(pool, req, int(req.params.id));
  const files = await many("select id, kind, path, original_name, mime, created_at from order_files where order_id=$1 order by id", [o.id]);
  const material = await one('select name from materials where id=$1', [o.material_id]);
  const stage = await one('select name, kind, handles_gold, required_fields from stages where id=$1', [o.current_stage_id]);
  const myCustodies = await many(`select c.*, c.weight_issued::text, s.name as stage_name from custodies c join stages s on s.id=c.stage_id
                                  where c.order_id=$1 and c.worker_id=$2 order by c.id desc`, [o.id, req.user.id]);
  const log = await many(`select l.event, l.note, l.created_at, s.name as stage_name from order_stage_log l left join stages s on s.id=l.stage_id
                          where l.order_id=$1 and (l.worker_id=$2 or l.user_id=$2) order by l.id desc limit 50`, [o.id, req.user.id]);
  res.json({
    order: { id: o.id, order_no: o.order_no, title: o.title, size: o.size, quantity: o.quantity, due_date: o.due_date, notes: o.notes,
             product_type: o.product_type, approx_weight: o.approx_weight, material: material?.name, stage, stage_state: o.stage_state,
             assigned_to_me: o.assigned_worker_id === req.user.id },
    files, custodies: myCustodies, log,
  });
});

/** تأكيد استلام العهدة بالتوقيع */
r.post('/custody/:id/ack', async (req, res) => {
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.worker_ack_at) return { ok: true, already: true };
    const sig = await saveSignature(db, req.body.signature, req.user.id);
    if (!sig) throw bad('التوقيع مطلوب لتأكيد العهدة');
    await db.query('update custodies set worker_ack_at=now() where id=$1', [c.id]);
    await db.query('update custody_batches set signature_path=coalesce(signature_path,$2), signed_at=coalesce(signed_at, now()) where id=$1', [c.issue_batch_id, sig]);
    await db.query("insert into custody_work_log(custody_id, event, user_id) values ($1,'ack',$2)", [c.id, req.user.id]);
    await audit(db, req, 'custody.ack', 'custody', c.id);
    return { ok: true };
  }));
});

const transitions = {
  start: { from: ['not_started'], to: 'in_progress' },
  pause: { from: ['in_progress'], to: 'paused' },
  resume: { from: ['paused'], to: 'in_progress' },
};

r.post('/custody/:id/:action', async (req, res, next) => {
  if (!transitions[req.params.action]) return next();
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة مغلقة');
    if (!c.worker_ack_at) throw conflict('يجب تأكيد استلام العهدة أولاً');
    const t = transitions[req.params.action];
    if (!t.from.includes(c.work_state)) throw conflict('لا يمكن تنفيذ هذا الإجراء في الحالة الحالية');
    const reason = str(req.body.reason, 'السبب');
    if (req.params.action === 'pause' && !reason) throw bad('يجب تسجيل سبب الإيقاف');
    await db.query(`update custodies set work_state=$2, started_at=coalesce(started_at, case when $2='in_progress' then now() end) where id=$1`, [c.id, t.to]);
    await db.query("update orders set stage_state=$2 where id=$1 and assigned_worker_id=$3", [c.order_id, t.to === 'paused' ? 'paused' : 'in_progress', req.user.id]);
    await db.query('insert into custody_work_log(custody_id, event, reason, user_id) values ($1,$2,$3,$4)', [c.id, req.params.action, reason, req.user.id]);
    await logStage(db, c.order_id, c.stage_id, { start: 'started', pause: 'paused', resume: 'resumed' }[req.params.action], req.user.id, reason, false, req.user.id);
    return { ok: true };
  }));
});

/** تسجيل الوزن المستخدم والمرتجع والبقايا (تصريح العامل - يعتمده المشرف بالوزن الفعلي عند الاستلام) */
r.post('/custody/:id/declare', async (req, res) => {
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة مغلقة');
    const ret = W(req.body.returned, 'الوزن المرتجع', { allowZero: true });
    const scrap = W(req.body.scrap, 'البقايا', { allowZero: true });
    const used = req.body.used ? W(req.body.used, 'الوزن المستخدم', { allowZero: true }) : null;
    await db.query('update custodies set worker_declared_returned=$2, worker_declared_scrap=$3, worker_declared_used=$4, worker_declared_at=now() where id=$1', [c.id, ret, scrap, used]);
    await db.query("insert into custody_work_log(custody_id, event, reason, user_id) values ($1,'declare',$2,$3)", [c.id, `مرتجع ${ret} / بقايا ${scrap}${used ? ' / مستخدم ' + used : ''}`, req.user.id]);
    return { ok: true };
  }));
});

/** إنهاء المرحلة وتسليمها: تصبح "بانتظار الاستلام" لدى المشرف */
r.post('/custody/:id/finish', async (req, res) => {
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة مغلقة');
    if (!c.worker_ack_at) throw conflict('يجب تأكيد استلام العهدة أولاً');
    const stage = (await db.query('select * from stages where id=$1', [c.stage_id])).rows[0];
    if (stage.requires_weight && c.worker_declared_returned == null) throw bad('سجّل الوزن المرتجع والبقايا قبل إنهاء المرحلة');
    for (const f of stage.required_fields || []) {
      if (f === 'photo') {
        const p = await db.query("select 1 from order_files where order_id=$1 and kind='execution' and uploaded_by=$2 and created_at >= $3 limit 1", [c.order_id, req.user.id, c.issued_at]);
        if (!p.rowCount) throw bad('هذه المرحلة تتطلب رفع صورة التنفيذ');
      }
    }
    await db.query("update custodies set work_state='finished', finished_at=now() where id=$1", [c.id]);
    await db.query("insert into custody_work_log(custody_id, event, reason, user_id) values ($1,'finish',$2,$3)", [c.id, str(req.body.note, 'ملاحظة'), req.user.id]);
    const o = (await db.query('select order_no from orders where id=$1', [c.order_id])).rows[0];
    await logStage(db, c.order_id, c.stage_id, 'completed', req.user.id, 'أنهى العامل المرحلة - بانتظار الاستلام', false, req.user.id);
    await notifyPerm(db, 'custody.receive', { kind: 'receive', title: `${req.user.full_name} أنهى ${stage.name} - ${o.order_no}`, body: 'بانتظار الاستلام', link: `/sup/receive?worker=${req.user.id}` });
    return { ok: true };
  }));
});

/** إنهاء مهمة بدون ذهب (مثل التصميم) */
r.post('/orders/:id/finish', async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await lockOrder(db, int(req.params.id));
    if (o.assigned_worker_id !== req.user.id) throw forbidden('هذا الطلب غير مسند إليك');
    const stage = (await db.query('select * from stages where id=$1', [o.current_stage_id])).rows[0];
    if (stage.handles_gold) throw conflict('هذه المرحلة تتضمن عهدة ذهب - أنهِها من العهدة');
    return advance(db, o, req.user.id, { byWorker: true });
  }));
});

r.post('/orders/:id/files', upload.array('files', 10), async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await canSeeOrder(db, req, int(req.params.id));
    const files = await registerFiles(db, req.files, req.user.id);
    if (!files.length) throw bad('لم يتم اختيار ملفات');
    const stage = (await db.query('select kind from stages where id=$1', [o.current_stage_id])).rows[0];
    const kind = stage?.kind === 'design' && req.body.kind === 'design' ? 'design' : 'execution';
    for (const f of files) {
      await db.query('insert into order_files(order_id, kind, path, original_name, mime, uploaded_by) values ($1,$2,$3,$4,$5,$6)', [o.id, kind, f.path, f.original_name, f.mime, req.user.id]);
    }
    await logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `رفع ${files.length} ملف`, false, req.user.id);
    return { ok: true, files };
  }));
});

r.post('/orders/:id/note', async (req, res) => {
  res.json(await tx(async (db) => {
    const o = await canSeeOrder(db, req, int(req.params.id));
    const note = str(req.body.note, 'الملاحظة', { required: true });
    const clarify = !!req.body.clarification;
    await logStage(db, o.id, o.current_stage_id, clarify ? 'clarification' : 'note', req.user.id, note, false, req.user.id);
    if (clarify) await notifyPerm(db, 'custody.issue', { kind: 'clarification', title: `طلب توضيح من ${req.user.full_name} - ${o.order_no}`, body: note, link: `/orders/${o.id}` });
    return { ok: true };
  }));
});

r.get('/history', async (req, res) => {
  res.json(await many(`
    select c.id, c.custody_no, c.status, c.weight_issued::text, c.issued_at, c.closed_at, o.order_no, o.title, s.name as stage_name,
           st.returned_weight::text, st.scrap_weight::text, st.actual_loss::text, st.normal_loss::text, st.abnormal_loss::text, st.status as settlement_status
    from custodies c join orders o on o.id=c.order_id join stages s on s.id=c.stage_id
    left join settlements st on st.custody_id=c.id and st.status <> 'reversed'
    where c.worker_id=$1 order by c.id desc limit 200`, [req.user.id]));
});

export default r;
