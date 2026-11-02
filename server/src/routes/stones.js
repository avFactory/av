// إدارة الألماس والأحجار الكريمة: الدفعات، التسليم للعمال، الاستخدام، المرتجع، المتبقي
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { upload, registerFiles } from '../lib/uploads.js';

const r = Router();
const CT = (v, name = 'القيراط') => {
  const s = String(v ?? '').trim();
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(s)) throw bad(`${name} غير صالح`);
  return s;
};

r.get('/', requirePerm('stones.view'), async (_req, res) => {
  res.json(await many(`select l.*, l.unit_price::text, b.stock_carats::text, b.stock_count, b.with_workers_carats::text, b.with_workers_count,
      b.used_carats::text, b.used_count, b.lost_carats::text, b.total_in_carats::text, b.total_in_count,
      (select path from stone_media sm where sm.lot_id=l.id order by id limit 1) as photo
    from stone_lots l join stone_lot_balances b on b.lot_id=l.id order by l.id desc`));
});

r.get('/:id', requirePerm('stones.view'), async (req, res) => {
  const id = int(req.params.id);
  const lot = await one('select l.*, b.stock_carats::text, b.stock_count, b.with_workers_carats::text, b.used_carats::text from stone_lots l join stone_lot_balances b on b.lot_id=l.id where l.id=$1', [id]);
  if (!lot) throw notFound();
  const movements = await many(`select m.*, m.carats::text, o.order_no, w.full_name as worker_name, s.name as stage_name, u.full_name as user_name,
      exists(select 1 from stone_movements r where r.reverses_id=m.id) as reversed
    from stone_movements m left join orders o on o.id=m.order_id left join users w on w.id=m.worker_id left join stages s on s.id=m.stage_id
    left join users u on u.id=m.created_by where m.lot_id=$1 order by m.id desc`, [id]);
  const media = await many('select * from stone_media where lot_id=$1', [id]);
  res.json({ lot, movements, media });
});

r.post('/', requirePerm('stones.manage'), upload.array('files', 10), async (req, res) => {
  const b = req.body;
  res.json(await tx(async (db) => {
    const files = await registerFiles(db, req.files, req.user.id);
    const lot = (await db.query(`insert into stone_lots(lot_no, stone_type, color, clarity, cut_shape, certificate_no, unit_price, notes, created_by)
      values (next_doc_no('STN'),$1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [str(b.stone_type, 'نوع الحجر', { required: true }), str(b.color, 'اللون'), str(b.clarity, 'النقاء'), str(b.cut_shape, 'الشكل'),
       str(b.certificate_no, 'الشهادة'), b.unit_price ? b.unit_price : null, str(b.notes, 'ملاحظات'), req.user.id])).rows[0];
    for (const f of files) await db.query('insert into stone_media(lot_id, path) values ($1,$2)', [lot.id, f.path]);
    await db.query("insert into stone_movements(lot_id, kind, carats, count, note, created_by) values ($1,'in',$2,$3,$4,$5)",
      [lot.id, CT(b.carats), int(b.count ?? 0, 'العدد', { min: 0 }), 'رصيد افتتاحي/استلام', req.user.id]);
    await audit(db, req, 'stone.create', 'stone_lot', lot.id, { lot_no: lot.lot_no, carats: b.carats, count: b.count });
    return lot;
  }));
});

/** حركات الأحجار: إضافة، تسليم لعامل على طلب، مرتجع، مستخدم (مركب)، مفقود */
r.post('/:id/move', requirePerm('stones.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const kind = oneOf(req.body.kind, ['in', 'issue', 'return', 'used', 'lost', 'adjust_in', 'adjust_out'], 'نوع الحركة');
    const carats = CT(req.body.carats);
    const count = int(req.body.count ?? 0, 'العدد', { min: 0 });
    const orderId = req.body.order_id ? int(req.body.order_id) : null;
    const workerId = req.body.worker_id ? int(req.body.worker_id) : null;
    const note = str(req.body.note, 'ملاحظات');
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`stone:${id}`]);
    const bal = (await db.query('select * from stone_lot_balances where lot_id=$1', [id])).rows[0];
    if (!bal) throw notFound();
    if (['issue', 'return', 'used', 'lost'].includes(kind) && (!orderId || !workerId)) throw bad('حدد الطلب والعامل');
    if (['issue', 'adjust_out'].includes(kind) && (Number(bal.stock_carats) < Number(carats) || Number(bal.stock_count) < count)) throw bad('رصيد الدفعة في المخزن غير كافٍ');
    if (['return', 'used', 'lost'].includes(kind)) {
      const w = (await db.query(`select coalesce(sum(case kind when 'issue' then carats else -carats end),0) c, coalesce(sum(case kind when 'issue' then count else -count end),0) n
        from stone_movements m where lot_id=$1 and worker_id=$2 and order_id=$3 and kind in ('issue','return','used','lost')
        and not exists (select 1 from stone_movements r where r.reverses_id=m.id)`, [id, workerId, orderId])).rows[0];
      if (Number(w.c) < Number(carats) || Number(w.n) < count) throw bad('الكمية أكبر مما لدى العامل من هذه الدفعة لهذا الطلب');
    }
    if (['adjust_in', 'adjust_out', 'lost'].includes(kind) && !note) throw bad('السبب مطلوب لهذه الحركة');
    let stageId = null;
    if (orderId) stageId = (await db.query('select current_stage_id from orders where id=$1', [orderId])).rows[0]?.current_stage_id ?? null;
    const mv = (await db.query(`insert into stone_movements(lot_id, kind, carats, count, order_id, worker_id, stage_id, note, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [id, kind, carats, count, orderId, workerId, stageId, note, req.user.id])).rows[0];
    await audit(db, req, `stone.${kind}`, 'stone_lot', id, { carats, count, orderId, workerId, note });
    return mv;
  }));
});

r.post('/movements/:id/reverse', requirePerm('stones.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const reason = str(req.body.reason, 'السبب', { required: true });
    const mv = (await db.query('select * from stone_movements where id=$1', [int(req.params.id)])).rows[0];
    if (!mv || mv.kind === 'reversal') throw notFound();
    if ((await db.query('select 1 from stone_movements where reverses_id=$1', [mv.id])).rowCount) throw conflict('معكوسة مسبقاً');
    const rv = (await db.query(`insert into stone_movements(lot_id, kind, carats, count, order_id, worker_id, stage_id, reverses_id, note, created_by)
      values ($1,'reversal',$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [mv.lot_id, mv.carats, mv.count, mv.order_id, mv.worker_id, mv.stage_id, mv.id, reason, req.user.id])).rows[0];
    await audit(db, req, 'stone.reverse', 'stone_movement', mv.id, { reason });
    return rv;
  }));
});

export default r;
