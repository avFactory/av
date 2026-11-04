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
    select c.id, c.custody_no, c.order_id, c.weight_issued::text, c.pieces, c.status, c.work_state, c.worker_ack_at, c.worker_rejected_at, c.worker_reject_reason, c.issued_at, c.started_at,
           c.worker_declared_returned::text, c.worker_declared_scrap::text, c.worker_declared_used::text, c.issue_batch_id,
           coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, o.due_date, o.size, o.notes as order_notes, coalesce(s.name, 'عهدة عامة') as stage_name, s.required_fields, m.name as material_name, c.kind, c.purpose,
           coalesce(
             (select f.path from order_files f where f.order_id=o.id and f.mime like 'image/%' order by (f.kind='design') desc, (f.kind='reference') desc, (f.kind='sketch') desc, f.id desc limit 1),
             (select pm.path from product_media pm where pm.product_id=o.product_id and pm.kind='image' order by pm.sort, pm.id limit 1)) as thumb
    from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
    where c.worker_id=$1 and c.status in ('open','under_review') order by c.issued_at`, [req.user.id]);
  // مهام بدون ذهب (مثل التصميم) مسندة للعامل
  const tasks = await many(`
    select o.id as order_id, o.order_no, o.title, o.due_date, o.stage_state, s.name as stage_name, s.kind as stage_kind, s.requires_approval,
           coalesce(
             (select f.path from order_files f where f.order_id=o.id and f.mime like 'image/%' order by (f.kind='design') desc, (f.kind='reference') desc, (f.kind='sketch') desc, f.id desc limit 1),
             (select pm.path from product_media pm where pm.product_id=o.product_id and pm.kind='image' order by pm.sort, pm.id limit 1)) as thumb
    from orders o join stages s on s.id=o.current_stage_id
    where o.assigned_worker_id=$1 and o.status='in_production' and not s.handles_gold`, [req.user.id]);
  res.json({ custodies, tasks });
});

r.get('/orders/:id', async (req, res) => {
  const o = await canSeeOrder(pool, req, int(req.params.id));
  // صور الطلب (التصميم والمرجع…) ثم صور المنتج إن كان الطلب من منتج في المتجر
  const files = await many(`select id::text, kind, path, original_name, mime, created_at from order_files where order_id=$1
    union all select 'p' || id, 'product', path, 'صورة المنتج', case kind when 'video' then 'video/mp4' else 'image/jpeg' end, null from product_media where product_id=$2
    order by kind='product', id`, [o.id, o.product_id || 0]);
  const stones = await one(`select o.color, o.pearl_weight::text, o.stone_weight::text, o.zircon_weight::text,
      coalesce((select json_agg(json_build_object('shape', s2.name, 'size', l2.size_label, 'color', l2.color, 'clarity', l2.clarity, 'carats', (d->>'carats')::numeric, 'count', (d->>'count')::int))
        from jsonb_array_elements(o.diamonds) d join stone_lots l2 on l2.id=(d->>'lot_id')::int left join stone_shapes s2 on s2.id=l2.shape_id), '[]') as diamond_details
    from orders o where o.id=$1`, [o.id]);
  const material = await one('select name from materials where id=$1', [o.material_id]);
  const stage = await one('select name, kind, handles_gold, required_fields from stages where id=$1', [o.current_stage_id]);
  const myCustodies = await many(`select c.*, c.weight_issued::text, s.name as stage_name from custodies c join stages s on s.id=c.stage_id
                                  where c.order_id=$1 and c.worker_id=$2 order by c.id desc`, [o.id, req.user.id]);
  const log = await many(`select l.event, l.note, l.created_at, s.name as stage_name from order_stage_log l left join stages s on s.id=l.stage_id
                          where l.order_id=$1 and (l.worker_id=$2 or l.user_id=$2) order by l.id desc limit 50`, [o.id, req.user.id]);
  res.json({
    order: { id: o.id, order_no: o.order_no, title: o.title, size: o.size, quantity: o.quantity, due_date: o.due_date, notes: o.notes,
             product_type: o.product_type, approx_weight: o.approx_weight, material: material?.name, stage, stage_state: o.stage_state,
             assigned_to_me: o.assigned_worker_id === req.user.id, ...stones },
    files, custodies: myCustodies, log,
  });
});

/** قبول العامل للعهدة = توقيعه الإلكتروني (يُسجل التاريخ والوقت وعنوان الجهاز) */
r.post('/custody/:id/ack', async (req, res) => {
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة لم تعد مفتوحة');
    if (c.worker_ack_at) return { ok: true, already: true };
    await db.query('update custodies set worker_ack_at=now(), ack_ip=$2, worker_rejected_at=null, worker_reject_reason=null where id=$1', [c.id, req.ip]);
    await db.query("insert into custody_work_log(custody_id, event, user_id, reason) values ($1,'ack',$2,'قبول إلكتروني')", [c.id, req.user.id]);
    await audit(db, req, 'custody.accept', 'custody', c.id, { weight: c.weight_issued, at: new Date().toISOString() });
    return { ok: true };
  }));
});

/** رفض العامل للعهدة (وزن أو طلب غير صحيح) - يُبلَّغ المشرف ليصحح التسليم */
r.post('/custody/:id/reject', async (req, res) => {
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة لم تعد مفتوحة');
    if (c.worker_ack_at) throw conflict('قبلت هذه العهدة مسبقاً - تواصل مع المشرف');
    const reason = str(req.body.reason, 'سبب الرفض', { required: true });
    await db.query('update custodies set worker_rejected_at=now(), worker_reject_reason=$2 where id=$1', [c.id, reason]);
    await db.query("insert into custody_work_log(custody_id, event, user_id, reason) values ($1,'reject',$2,$3)", [c.id, req.user.id, reason]);
    const o = (await db.query('select order_no from orders where id=$1', [c.order_id])).rows[0];
    await notifyPerm(db, 'custody.issue', { kind: 'reject', title: `${req.user.full_name} رفض استلام ${o?.order_no || 'عهدة عامة'}`, body: reason, link: `/sup/workers/${req.user.id}` });
    await audit(db, req, 'custody.reject', 'custody', c.id, { reason });
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
    if (!c.worker_ack_at) throw conflict('يجب قبول استلام العهدة أولاً');
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
    if (!c.worker_ack_at) throw conflict('يجب قبول استلام العهدة أولاً');
    const stage = (await db.query('select * from stages where id=$1', [c.stage_id])).rows[0];
    if (stage?.requires_weight && c.worker_declared_returned == null) throw bad('سجّل الوزن المرتجع والبقايا قبل إنهاء المرحلة');
    for (const f of stage?.required_fields || []) {
      if (f === 'photo') {
        const p = await db.query("select 1 from order_files where order_id=$1 and kind='execution' and uploaded_by=$2 and created_at >= $3 limit 1", [c.order_id, req.user.id, c.issued_at]);
        if (!p.rowCount) throw bad('هذه المرحلة تتطلب رفع صورة التنفيذ');
      }
    }
    await db.query("update custodies set work_state='finished', finished_at=now() where id=$1", [c.id]);
    await db.query("insert into custody_work_log(custody_id, event, reason, user_id) values ($1,'finish',$2,$3)", [c.id, str(req.body.note, 'ملاحظة'), req.user.id]);
    const o = (await db.query('select order_no from orders where id=$1', [c.order_id])).rows[0];
    await logStage(db, c.order_id, c.stage_id, 'completed', req.user.id, 'أنهى العامل المرحلة - بانتظار الاستلام', false, req.user.id);
    await notifyPerm(db, 'custody.receive', { kind: 'receive', title: `${req.user.full_name} أنهى ${stage?.name || 'العهدة العامة'} - ${o?.order_no || c.purpose || 'عهدة عامة'}`, body: 'بانتظار الاستلام', link: `/sup/receive?worker=${req.user.id}` });
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
    select c.id, c.custody_no, c.status, c.weight_issued::text, c.issued_at, c.closed_at, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, coalesce(s.name, 'عهدة عامة') as stage_name,
           st.returned_weight::text, st.scrap_weight::text, st.actual_loss::text, st.normal_loss::text, st.abnormal_loss::text, st.status as settlement_status
    from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id
    left join settlements st on st.custody_id=c.id and st.status <> 'reversed'
    where c.worker_id=$1 order by c.id desc limit 200`, [req.user.id]));
});

export default r;
