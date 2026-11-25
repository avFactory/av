// واجهة العامل: لا يرى إلا عهده وطلباته
import { Router } from 'express';
import { workerLossRows, monthTotals, monthStart, heldLossSummary } from '../lib/workerLoss.js';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, forbidden, notFound, int, str, weight as W } from '../lib/http.js';
import { notifyPerm, resolveNotifs } from '../lib/notify.js';
import { saveSignature, upload, registerFiles } from '../lib/uploads.js';
import { advance, lockOrder, logStage } from '../lib/production.js';
import { audit } from '../lib/audit.js';
import { orderThumb } from '../lib/orderThumb.js';
import { is3D, addInternalImages } from '../lib/internalImages.js';
import { advanceGroup, set3d, queue3d, d3List, d3Done, setPriority } from '../lib/orderGroup3d.js';
import { checkAckWeight, workerCloseStage } from '../lib/workerClose.js';
import { createReturnRequest, cancelReturnRequest } from '../lib/partialReturn.js';
import { createTransfer, acceptTransfer, rejectTransfer, cancelTransfer, transferCols } from '../lib/transfer.js';

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
  if (o.assigned_worker_id === req.user.id || is3D(req.user)) return o;
  // أي بند من نفس الطلب مسند للعامل أو لديه عهدة عليه ← يرى الطلب كاملاً
  const c = await db.query(`select 1 from orders x where (x.id=$1 or (x.cart_ref is not null and x.cart_ref = $3))
      and (x.assigned_worker_id=$2 or exists (select 1 from custodies k where k.order_id=x.id and k.worker_id=$2 and k.status <> 'reversed')) limit 1`, [orderId, req.user.id, o.cart_ref]);
  if (!c.rowCount) throw forbidden('هذا الطلب غير مسند إليك');
  return o;
}

r.get('/tasks', async (req, res) => {
  const custodies = await many(`
    select c.id, c.custody_no, c.order_id, c.finding_id, (c.weight_issued - c.weight_used)::numeric(16,4)::text as weight_issued, c.pieces, c.status, c.work_state, c.worker_ack_at, c.worker_rejected_at, c.worker_reject_reason, c.issued_at, c.started_at,
           c.worker_declared_returned::text, c.worker_declared_scrap::text, c.worker_declared_used::text, c.issue_batch_id,
           coalesce(case when gc.n > 1 then o.cart_ref end, o.order_no, 'عهدة عامة') as order_no,
           coalesce(case when gc.n > 1 then 'الطلب كامل · ' || gc.n || ' أصناف' end, o.title, c.purpose, 'عهدة عامة') as title, o.due_date, o.size, o.notes as order_notes, coalesce(s.name, 'عهدة عامة') as stage_name, s.required_fields, coalesce(s.worker_closes, false) as worker_closes, c.gross_weight::text,
           (select json_build_object('id', q.id, 'weight', q.weight::text, 'note', q.note) from custody_return_requests q where q.custody_id=c.id and q.status='pending') as return_request, m.name as material_name, c.kind, c.purpose,
           coalesce(
             (select f.path from order_files f where f.order_id=o.id and f.mime like 'image/%' order by (f.kind='design') desc, (f.kind='reference') desc, (f.kind='sketch') desc, f.id desc limit 1),
             (select pm.path from product_media pm where pm.product_id=o.product_id and pm.kind='image' order by pm.sort, pm.id limit 1)) as thumb
    from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
    left join lateral (select count(*)::int n from orders x where o.cart_ref is not null and x.cart_ref=o.cart_ref and x.status not in ('cancelled','rejected')) gc on true
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
  const files = await many(`select * from (
      select id::text as id, kind, path, original_name, mime, created_at, 0 as src, id as n from order_files where order_id=$1
      union all select 'p' || id, 'product', path, 'صورة المنتج', case kind when 'video' then 'video/mp4' else 'image/jpeg' end, null, 1, id from product_media where product_id=$2
    ) x order by src, n`, [o.id, o.product_id || 0]);
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
    // بنود الطلب كاملة (الطلب يُعامل كقطعة واحدة)
    // فريق 3D: كل منتجات الطلب بكل صورها وملفاتها واحتياج التصميم/الطباعة
    items3d: is3D(req.user) ? await many(`select x.id, x.order_no, x.title, x.product_type, x.quantity, x.size, x.notes, x.color, x.needs_3d_design, x.needs_3d_print, x.d3_checked_at, x.priority, x.d3_design_done_at, x.d3_print_done_at,
        s.name as stage_name, s.kind as stage_kind,
        coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'path', f.path, 'mime', f.mime, 'name', f.original_name) order by (f.kind='model3d'), f.id) from order_files f where f.order_id=x.id), '[]'::jsonb)
          || coalesce((select jsonb_agg(jsonb_build_object('id', 'p' || pm.id, 'kind', 'product', 'path', pm.path, 'mime', case pm.kind when 'video' then 'video/mp4' else 'image/jpeg' end, 'name', 'صورة المنتج') order by pm.sort, pm.id) from product_media pm where pm.product_id=x.product_id), '[]'::jsonb) as files
      from orders x left join stages s on s.id=x.current_stage_id
      where (x.id=$1 or ($2::text is not null and x.cart_ref=$2)) and x.status not in ('cancelled','rejected') order by x.order_no`, [o.id, o.cart_ref]) : null,
    group: o.cart_ref ? await many(`select o.id, o.order_no, o.title, o.product_type, o.quantity, o.size, o.notes, o.color, o.pearl_weight::text, o.stone_weight::text, o.zircon_weight::text,
        s.name as stage_name, ${orderThumb()} as thumb
      from orders o left join stages s on s.id=o.current_stage_id where o.cart_ref=$1 and o.status not in ('cancelled','rejected') order by o.order_no`, [o.cart_ref]) : [],
  });
});

/** قبول العامل للعهدة = توقيعه الإلكتروني (يُسجل التاريخ والوقت وعنوان الجهاز) */
r.post('/custody/:id/ack', async (req, res) => {
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة لم تعد مفتوحة');
    if (c.worker_ack_at) return { ok: true, already: true };
    const ackStage = c.stage_id ? (await db.query('select * from stages where id=$1', [c.stage_id])).rows[0] : null;
    const ackW = checkAckWeight(c, ackStage, req.body);
    await db.query('update custodies set worker_ack_at=now(), ack_ip=$2, worker_rejected_at=null, worker_reject_reason=null, ack_weight=$3 where id=$1', [c.id, req.ip, ackW]);
    await resolveNotifs(db, `custody_reject:${c.id}`, `✓ قبلها ${req.user.full_name} بعد التصحيح`);
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
    await notifyPerm(db, 'custody.issue', { ref: `custody_reject:${c.id}`, kind: 'reject', title: `${req.user.full_name} رفض استلام ${o?.order_no || 'عهدة عامة'}`, body: reason, link: `/sup/workers/${req.user.id}` });
    await audit(db, req, 'custody.reject', 'custody', c.id, { reason });
    return { ok: true };
  }));
});

/** تحويل جزء من العهدة للمشرف (يؤكده المشرف بالوزن) */
r.post('/custody/:id/return-request', async (req, res) => {
  res.json(await tx((db) => createReturnRequest(db, req, req.params.id, req.body)));
});
r.post('/return-requests/:id/cancel', async (req, res) => {
  res.json(await tx((db) => cancelReturnRequest(db, req, req.params.id)));
});

/** تحويل الطلب لعامل المرحلة التالية */
r.get('/workers', async (req, res) => {
  res.json(await many(`select u.id, u.full_name, u.employee_no, u.specialty, u.kind from users u where u.role_code='worker' and u.active and u.kind <> 'machine' and u.id <> $1 order by nullif(regexp_replace(coalesce(u.employee_no,''),'[^0-9]','','g'),'')::numeric nulls last, u.employee_no nulls last, u.full_name`, [req.user.id]));
});
r.get('/transfers', async (req, res) => {
  const q = `select ${transferCols}, coalesce(o.title, sc.purpose, 'عهدة عامة') as title, coalesce(s.name, 'عهدة عامة') as stage_name,
      coalesce(case when (select count(*) from orders x where x.cart_ref=o.cart_ref and x.status not in ('cancelled','rejected')) > 1 then o.cart_ref end, o.order_no, 'عهدة عامة') as order_no,
      ${orderThumb()} as thumb
    from custody_transfers t join users fw on fw.id=t.from_worker join users tw on tw.id=t.to_worker join custodies sc on sc.id=t.custody_id left join orders o on o.id=t.order_id
    left join stages s on s.id=o.current_stage_id where t.status='pending' and `;
  res.json({ incoming: await many(q + 't.to_worker=$1 order by t.id', [req.user.id]), outgoing: await many(q + 't.from_worker=$1 order by t.id', [req.user.id]) });
});
r.post('/custody/:id/transfer', async (req, res) => {
  res.json(await tx((db) => createTransfer(db, req, req.params.id, req.body)));
});
r.post('/transfers/:id/accept', async (req, res) => {
  res.json(await tx((db) => acceptTransfer(db, req, req.params.id, req.body)));
});
r.post('/transfers/:id/reject', async (req, res) => {
  res.json(await tx((db) => rejectTransfer(db, req, req.params.id, req.body)));
});
r.post('/transfers/:id/cancel', async (req, res) => {
  res.json(await tx((db) => cancelTransfer(db, req, req.params.id)));
});

// قبول العهدة = بدء العمل تلقائياً (لا إيقاف مؤقت). "start" باقٍ فقط لتوافق التطبيقات القديمة
const transitions = {
  start: { from: ['not_started'], to: 'in_progress' },
};

r.post('/custody/:id/:action', async (req, res, next) => {
  if (!transitions[req.params.action]) return next();
  res.json(await tx(async (db) => {
    const c = await myCustody(db, req, req.params.id, true);
    if (c.status !== 'open') throw conflict('العهدة مغلقة');
    if (!c.worker_ack_at) throw conflict('يجب قبول استلام العهدة أولاً');
    const t = transitions[req.params.action];
    if (c.work_state === t.to) return { ok: true, already: true }; // بدأ تلقائياً بالقبول
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
    // مرحلة يديرها عاملها (الجودة والوزن النهائي): يعتمد الوزن النهائي وينقل الطلب للفوترة
    if (stage?.worker_closes) return workerCloseStage(db, req, c, stage, req.body);
    // العامل لا يملك ميزاناً: الوزن الفعلي يعتمده المشرف عند الاستلام (لا يُشترط تسجيل أوزان أو صور من العامل)
    void stage;
    await db.query("update custodies set work_state='finished', finished_at=now() where id=$1", [c.id]);
    await db.query("insert into custody_work_log(custody_id, event, reason, user_id) values ($1,'finish',$2,$3)", [c.id, str(req.body.note, 'ملاحظة'), req.user.id]);
    const o = (await db.query('select order_no from orders where id=$1', [c.order_id])).rows[0];
    await logStage(db, c.order_id, c.stage_id, 'completed', req.user.id, 'أنهى العامل المرحلة - بانتظار الاستلام', false, req.user.id);
    await notifyPerm(db, 'custody.receive', { kind: 'receive', title: `${req.user.full_name} أنهى ${stage?.name || 'العهدة العامة'} - ${o?.order_no || c.purpose || 'عهدة عامة'}`, body: 'بانتظار الاستلام', link: `/sup/receive?worker=${req.user.id}`, ref: `custody_finish:${c.id}` });
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

r.post('/orders/:id/files', upload.array('files', 20), async (req, res) => {
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

/** طابور مرحلة 3D (فريق 3D فقط) */
r.get('/3d', async (req, res) => {
  if (!is3D(req.user)) throw forbidden('لفريق 3D فقط');
  res.json(await queue3d(pool));
});
/** صفحة التصاميم / الطباعة لفريق 3D: كل منتج على حدة (الحالية أو المنجزة) */
for (const kind of ['design', 'print']) {
  r.get(`/3d/${kind}`, async (req, res) => {
    if (!is3D(req.user)) throw forbidden('لفريق 3D فقط');
    res.json(await d3List(pool, kind, req.query.done === '1'));
  });
}
r.post('/orders/:id/priority', async (req, res) => {
  if (!is3D(req.user)) throw forbidden('لفريق 3D فقط');
  res.json(await tx((db) => setPriority(db, req, int(req.params.id), req.body.priority)));
});
r.post('/orders/:id/3d-done', async (req, res) => {
  res.json(await tx((db) => d3Done(db, req, int(req.params.id), req.body)));
});
r.post('/orders/:id/3d', async (req, res) => {
  if (!is3D(req.user)) throw forbidden('لفريق 3D فقط');
  res.json(await tx((db) => set3d(db, req, int(req.params.id), req.body)));
});
r.post('/orders/:id/group-advance', async (req, res) => {
  if (!is3D(req.user)) throw forbidden('لفريق 3D فقط');
  res.json(await tx((db) => advanceGroup(db, req, int(req.params.id))));
});

/** صور داخلية على الطلب (فريق 3D فقط) */
r.post('/orders/:id/internal', upload.array('files', 20), async (req, res) => {
  res.json(await tx((db) => addInternalImages(db, req, int(req.params.id))));
});
/** صور وملفات تصميم 3D على منتج (بند) في الطلب — فريق 3D فقط، ولا تظهر للعميل */
r.post('/orders/:id/3d-files', upload.array('files', 20), async (req, res) => {
  res.json(await tx((db) => addInternalImages(db, req, int(req.params.id), { model3d: true })));
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

/** العجز على حساب العامل في شهر: لكل طلب العجز الفعلي والمسموح والمحمّل عليه */
r.get('/losses', async (req, res) => {
  const month = monthStart(req.query.month);
  const rows = await workerLossRows(pool, req.user.id, month);
  const advance = await one('select amount::text, grams::text, price_per_gram::text, created_at from worker_advances where worker_id=$1 and month=$2', [req.user.id, month]);
  const months = await many(`select distinct to_char(date_trunc('month', st.received_at at time zone 'Asia/Riyadh'), 'YYYY-MM') as m
    from settlements st join custodies c on c.id=st.custody_id where c.worker_id=$1 and st.status <> 'reversed' order by 1 desc limit 12`, [req.user.id]);
  res.json({ month: month.slice(0, 7), rows, totals: monthTotals(rows), advance, months: months.map((x) => x.m), held: await heldLossSummary(pool, req.user.id) });
});

/** العجز المعلق في حسابي (لم يُثبَّت بإقفال الشهر) */
r.get('/held', async (req, res) => {
  const rows = await heldLossSummary(pool, req.user.id);
  res.json({ held: rows.reduce((a, r) => a + Number(r.held), 0).toFixed(4), rows });
});

/** حركات الذهب للعامل: كل ما دخل عهدته أو خرج منها (تسليم، استلام، استلام جزئي، تحويل، عجز، تعديل، تصحيح) مع الرصيد */
r.get('/movements', async (req, res) => {
  const rows = await many(`
    select g.id, g.movement_no, g.kind, g.weight::text, g.created_at, g.reason, g.reverses_id, g.from_type, g.to_type,
           case when g.to_type='worker' and g.to_ref=$1 then 1 else -1 end as dir,
           coalesce(o.order_no, case when c.kind='general' then 'عهدة عامة' end) as order_no, m.name as material_name, m.karat,
           exists (select 1 from gold_ledger r where r.reverses_id=g.id) as reversed, rv.kind as reverses_kind
    from gold_ledger g join materials m on m.id=g.material_id left join orders o on o.id=g.order_id left join custodies c on c.id=g.custody_id
    left join gold_ledger rv on rv.id=g.reverses_id
    where (g.to_type='worker' and g.to_ref=$1) or (g.from_type='worker' and g.from_ref=$1)
    order by g.id desc limit 300`, [req.user.id]);
  res.json(rows);
});

r.get('/history', async (req, res) => {
  res.json(await many(`
    select c.id, c.custody_no, c.status, c.weight_issued::text, c.weight_used::text, c.issued_at, c.closed_at, c.kind,
           (select coalesce(sum(g.weight),0)::text from gold_ledger g where g.custody_id=c.id and g.kind='partial_return'
              and not exists (select 1 from gold_ledger r where r.reverses_id=g.id)) as handed_partial,
           (select count(*)::int from settlements x where x.custody_id=c.id and x.status='reversed') as corrections, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, coalesce(s.name, 'عهدة عامة') as stage_name,
           st.returned_weight::text, st.scrap_weight::text, st.actual_loss::text, st.normal_loss::text, st.abnormal_loss::text, st.status as settlement_status
    from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id
    left join settlements st on st.custody_id=c.id and st.status <> 'reversed'
    where c.worker_id=$1 and c.status <> 'reversed' order by c.id desc limit 300`, [req.user.id]));
});

export default r;
