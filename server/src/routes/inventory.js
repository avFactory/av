// المخزون: الذهب (الخزنة والبقايا)، المواد الأخرى، الجرد، التحويل الموثق بين المواد، المطابقة
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, weight as W, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import * as ledger from '../lib/ledger.js';
import { notifyPerm } from '../lib/notify.js';

const r = Router();

/** أرصدة الذهب حسب المادة والموقع */
r.get('/gold', requirePerm('inventory.view', 'custody.view_all', 'dashboard.view'), async (_req, res) => {
  const rows = await many(`select m.id as material_id, m.name, m.karat, m.color, b.loc_type, sum(b.balance)::text as balance
                           from gold_balances b join materials m on m.id=b.material_id
                           where b.loc_type <> 'external' group by m.id, b.loc_type having sum(b.balance) <> 0 order by m.id`);
  const materials = await many('select * from materials where active order by id');
  res.json({ rows, materials, labels: ledger.LOC_LABELS });
});

/** إضافة ذهب للخزنة (شراء/استلام خام) أو صرف منها لخارج المصنع */
r.post('/gold/in', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const m = int(req.body.material_id, 'المادة');
    const w = W(req.body.weight, 'الوزن');
    const note = str(req.body.note, 'البيان', { required: true });
    const mv = await ledger.post(db, { kind: 'stock_in', material_id: m, weight: w, from: ['external', null], to: ['vault', null], reason: note, user_id: req.user.id });
    await audit(db, req, 'gold.in', 'gold_ledger', mv.id, { material: m, weight: w, note });
    return mv;
  }));
});

r.post('/gold/out', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const m = int(req.body.material_id, 'المادة');
    const w = W(req.body.weight, 'الوزن');
    const from = oneOf(req.body.from || 'vault', ['vault', 'scrap'], 'المصدر');
    const note = str(req.body.note, 'البيان', { required: true });
    await ledger.requireBalance(db, from, null, m, w, 'الرصيد غير كافٍ');
    const mv = await ledger.post(db, { kind: 'stock_out', material_id: m, weight: w, from: [from, null], to: ['external', null], reason: note, user_id: req.user.id });
    await audit(db, req, 'gold.out', 'gold_ledger', mv.id, { material: m, weight: w, from, note });
    return mv;
  }));
});

/** تحويل ذهب من الخزنة إلى عامل كرصيد في عهدته (عهدة عامة بدون طلب تصنيع) */
r.post('/gold/to-worker', requirePerm('custody.issue', 'inventory.manage'), async (req, res) => {
  const { issueGeneral } = await import('../lib/custody.js');
  res.json(await tx((db) => issueGeneral(db, req, req.body)));
});

/** العهد العامة القائمة لدى العمال */
r.get('/gold/general-custodies', requirePerm('inventory.view', 'custody.view_all'), async (_req, res) => {
  res.json(await many(`select c.id, c.custody_no, c.purpose, c.status, c.work_state, (c.weight_issued - c.weight_used)::numeric(16,4)::text as weight_issued, c.finding_id, c.loss_rate_snapshot::text, c.issued_at, c.worker_ack_at, c.worker_rejected_at,
      c.worker_reject_reason, u.full_name as worker_name, u.id as worker_id, u.kind as worker_kind, m.name as material_name, s.full_name as issued_by
    from custodies c join users u on u.id=c.worker_id join materials m on m.id=c.material_id join users s on s.id=c.supervisor_id
    where c.kind='general' and c.status in ('open','under_review') order by c.issued_at desc`));
});

/** تحويل البقايا المستردة إلى الخزنة (بعد التنقية/إعادة الاستخدام) */
r.post('/gold/scrap-to-vault', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const m = int(req.body.material_id, 'المادة');
    const w = W(req.body.weight, 'الوزن');
    await ledger.requireBalance(db, 'scrap', null, m, w, 'رصيد البقايا غير كافٍ');
    const mv = await ledger.post(db, { kind: 'scrap_to_vault', material_id: m, weight: w, from: ['scrap', null], to: ['vault', null], reason: str(req.body.note, 'البيان'), user_id: req.user.id });
    await audit(db, req, 'gold.scrap_to_vault', 'gold_ledger', mv.id, { material: m, weight: w });
    return mv;
  }));
});

/** تحويل موثق ومعتمد بين مادتين (مثل سبك 24 إلى 21) - الفرق يسجل كفروقات */
r.post('/gold/convert', requirePerm('stocktake.approve'), async (req, res) => {
  res.json(await tx(async (db) => {
    const fromM = int(req.body.from_material_id, 'المادة المصدر');
    const toM = int(req.body.to_material_id, 'المادة الناتجة');
    if (fromM === toM) throw bad('اختر مادتين مختلفتين');
    const wOut = W(req.body.weight_out, 'الوزن المصروف');
    const wIn = W(req.body.weight_in, 'الوزن الناتج');
    const note = str(req.body.note, 'بيان التحويل', { required: true });
    await ledger.requireBalance(db, 'vault', null, fromM, wOut, 'رصيد المادة المصدر غير كافٍ');
    const a = await ledger.post(db, { kind: 'convert_out', material_id: fromM, weight: wOut, from: ['vault', null], to: ['variance', null], reason: note, user_id: req.user.id });
    const b = await ledger.post(db, { kind: 'convert_in', material_id: toM, weight: wIn, from: ['variance', null], to: ['vault', null], reason: `${note} (مقابل ${a.movement_no})`, user_id: req.user.id });
    await audit(db, req, 'gold.convert', 'gold_ledger', a.id, { fromM, toM, wOut, wIn, note, in: b.movement_no });
    return { out: a, in: b };
  }));
});

/** عكس حركة مخزون يدوية خاطئة */
r.post('/gold/movements/:id/reverse', requirePerm('custody.reverse', 'stocktake.approve'), async (req, res) => {
  res.json(await tx(async (db) => {
    const reason = str(req.body.reason, 'سبب التصحيح', { required: true });
    const mv = (await db.query('select * from gold_ledger where id=$1', [int(req.params.id)])).rows[0];
    if (!mv) throw notFound();
    if (mv.custody_id || mv.settlement_id) throw conflict('حركات العهدة تصحح من شاشة العهدة/التسوية');
    if (mv.kind === 'reversal') throw conflict('لا يمكن عكس حركة عكسية');
    const done = await db.query('select 1 from gold_ledger where reverses_id=$1', [mv.id]);
    if (done.rowCount) throw conflict('الحركة معكوسة مسبقاً');
    if (mv.to_type !== 'external' && mv.to_type !== 'variance') await ledger.requireBalance(db, mv.to_type, mv.to_ref, mv.material_id, mv.weight, 'لا يمكن العكس لعدم كفاية الرصيد');
    const rv = await ledger.reverse(db, mv, reason, req.user.id);
    await audit(db, req, 'gold.reverse', 'gold_ledger', mv.id, { reason, reversal: rv.movement_no });
    return rv;
  }));
});

// ------------------------------------------------------------------ الجرد ومطابقة الأرصدة
r.get('/counts', requirePerm('inventory.view'), async (_req, res) => {
  res.json(await many(`select s.*, s.system_qty::text, s.counted_qty::text, s.difference::text, m.name as material_name, i.name as item_name,
      u.full_name as counted_by_name, a.full_name as approved_by_name
    from stock_counts s left join materials m on m.id=s.material_id left join inventory_items i on i.id=s.item_id
    left join users u on u.id=s.counted_by left join users a on a.id=s.approved_by order by s.id desc limit 300`));
});

r.post('/counts', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const target = oneOf(req.body.target, ['gold', 'item'], 'نوع الجرد');
    const counted = W(req.body.counted_qty, 'الكمية المجرودة', { allowZero: true });
    let system;
    let materialId = null;
    let itemId = null;
    if (target === 'gold') {
      materialId = int(req.body.material_id, 'المادة');
      system = await ledger.balance(db, 'vault', null, materialId);
    } else {
      itemId = int(req.body.item_id, 'الصنف');
      system = (await db.query('select qty::text from inventory_item_balances where item_id=$1', [itemId])).rows[0]?.qty ?? '0';
    }
    const diff = (await db.query('select round($1::numeric - $2::numeric, 4)::text v', [counted, system])).rows[0].v;
    const c = (await db.query(`insert into stock_counts(count_no, target, material_id, item_id, system_qty, counted_qty, difference, note, counted_by, status)
      values (next_doc_no('CNT'),$1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [target, materialId, itemId, system, counted, diff, str(req.body.note, 'ملاحظات'), req.user.id, Number(diff) === 0 ? 'approved' : 'pending'])).rows[0];
    if (Number(diff) !== 0) await notifyPerm(db, 'stocktake.approve', { kind: 'stock', title: `فرق جرد ${diff} بانتظار الاعتماد`, link: '/admin/inventory' });
    await audit(db, req, 'stock.count', 'stock_count', c.id, { system, counted, diff });
    return c;
  }));
});

r.post('/counts/:id/:decision', requirePerm('stocktake.approve'), async (req, res) => {
  res.json(await tx(async (db) => {
    const c = (await db.query('select * from stock_counts where id=$1 for update', [int(req.params.id)])).rows[0];
    if (!c) throw notFound();
    if (c.status !== 'pending') throw conflict('تم البت في الجرد مسبقاً');
    const decision = oneOf(req.params.decision, ['approve', 'reject'], 'القرار');
    if (decision === 'approve') {
      const d = Number(c.difference);
      const abs = String(Math.abs(d));
      const absStr = (await db.query('select abs($1::numeric)::text v', [c.difference])).rows[0].v;
      if (c.target === 'gold') {
        await ledger.post(db, { kind: 'stock_adjust', material_id: c.material_id, weight: absStr, from: d > 0 ? ['variance', null] : ['vault', null], to: d > 0 ? ['vault', null] : ['variance', null], reason: `تسوية جرد ${c.count_no}: ${req.body.note || ''}`, user_id: req.user.id });
      } else {
        await db.query('insert into inventory_movements(item_id, kind, qty, note, created_by) values ($1,$2,$3,$4,$5)', [c.item_id, d > 0 ? 'adjust_in' : 'adjust_out', abs, `تسوية جرد ${c.count_no}`, req.user.id]);
      }
    }
    await db.query('update stock_counts set status=$2, approved_by=$3, approved_at=now() where id=$1', [c.id, decision === 'approve' ? 'approved' : 'rejected', req.user.id]);
    await audit(db, req, `stock.count.${decision}`, 'stock_count', c.id, { note: req.body.note });
    return { ok: true };
  }));
});

/** مطابقة إجمالي الذهب: المخزون + العهد + الطلبات + البقايا + الفقد = صافي الوارد */
r.get('/reconciliation', requirePerm('inventory.view', 'reports.view', 'custody.view_all'), async (_req, res) => {
  const perMaterial = await many(`
    select m.id, m.name,
      coalesce(sum(b.balance) filter (where b.loc_type='external'),0)*-1 as net_in,
      coalesce(sum(b.balance) filter (where b.loc_type='vault'),0) as vault,
      coalesce(sum(b.balance) filter (where b.loc_type='order'),0) as orders,
      coalesce(sum(b.balance) filter (where b.loc_type='worker'),0) as workers,
      coalesce(sum(b.balance) filter (where b.loc_type='scrap'),0) as scrap,
      coalesce(sum(b.balance) filter (where b.loc_type='finished'),0) as finished,
      coalesce(sum(b.balance) filter (where b.loc_type='findings'),0) as findings,
      coalesce(sum(b.balance) filter (where b.loc_type='loss_normal'),0) as loss_normal,
      coalesce(sum(b.balance) filter (where b.loc_type='loss_abnormal'),0) as loss_abnormal,
      coalesce(sum(b.balance) filter (where b.loc_type='loss_suspense'),0) as loss_suspense,
      coalesce(sum(b.balance) filter (where b.loc_type='delivered'),0) as delivered,
      coalesce(sum(b.balance) filter (where b.loc_type='variance'),0) as variance,
      coalesce(sum(b.balance),0) as ledger_sum
    from materials m left join gold_balances b on b.material_id=m.id group by m.id
    having m.active or coalesce(sum(b.balance),0) <> 0 order by m.id`);
  // فحص 1: رصيد كل عامل في الدفتر = مجموع عهده المفتوحة
  const workerCheck = await many(`
    with led as (select loc_ref as worker_id, material_id, balance from gold_balances where loc_type='worker'),
         cus as (select worker_id, material_id, sum(weight_issued - weight_used) w from custodies where status='open' group by 1,2)
    select coalesce(l.worker_id, c.worker_id) worker_id, u.full_name, m.name material, coalesce(l.balance,0)::text ledger, coalesce(c.w,0)::text custodies,
           (coalesce(l.balance,0) = coalesce(c.w,0)) ok
    from led l full join cus c on c.worker_id=l.worker_id and c.material_id=l.material_id
    join users u on u.id=coalesce(l.worker_id, c.worker_id) join materials m on m.id=coalesce(l.material_id, c.material_id)
    where coalesce(l.balance,0) <> 0 or coalesce(c.w,0) <> 0`);
  // فحص 2: لا أرصدة سالبة في أي موقع داخلي
  const negatives = await many(`select loc_type, loc_ref, m.name, balance::text from gold_balances b join materials m on m.id=b.material_id
                                where balance < 0 and loc_type not in ('external','variance')`);
  // فحص 3: معادلة كل تسوية
  const badSettlements = await many(`select settlement_no from settlements where status <> 'reversed' and returned_weight + scrap_weight + actual_loss <> weight_issued`);
  const fmt = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' && /^-?\d/.test(v) ? Number(v).toFixed(4) : v]));
  res.json({
    perMaterial: perMaterial.map(fmt), workerCheck, negatives, badSettlements,
    ok: workerCheck.every((w) => w.ok) && !negatives.length && !badSettlements.length && perMaterial.every((p) => Number(p.ledger_sum) === 0),
  });
});

// ------------------------------------------------------------------ أصناف المخزون الأخرى
r.get('/items', requirePerm('inventory.view'), async (_req, res) => {
  res.json(await many(`select i.*, coalesce(b.qty,0)::text as qty, (coalesce(b.qty,0) < i.min_qty) as low
                       from inventory_items i left join inventory_item_balances b on b.item_id=i.id where i.active order by i.category, i.name`));
});
r.post('/items', requirePerm('inventory.manage'), async (req, res) => {
  const b = req.body;
  const i = await one(`insert into inventory_items(sku, name, category, unit, min_qty, notes) values ($1,$2,$3,$4,$5,$6) returning *`,
    [str(b.sku, 'الرمز'), str(b.name, 'الاسم', { required: true }), oneOf(b.category, ['raw', 'semi', 'finished', 'supply', 'other'], 'التصنيف'), str(b.unit, 'الوحدة') || 'قطعة', b.min_qty || 0, str(b.notes, 'ملاحظات')]);
  await audit(pool, req, 'item.create', 'inventory_item', i.id, i);
  res.json(i);
});
r.put('/items/:id', requirePerm('inventory.manage'), async (req, res) => {
  const b = req.body;
  const id = int(req.params.id);
  const before = await one('select * from inventory_items where id=$1', [id]);
  if (!before) throw notFound();
  await pool.query('update inventory_items set name=$2, unit=$3, min_qty=$4, notes=$5, active=$6 where id=$1',
    [id, str(b.name ?? before.name, 'الاسم', { required: true }), b.unit ?? before.unit, b.min_qty ?? before.min_qty, b.notes ?? before.notes, b.active ?? before.active]);
  await audit(pool, req, 'item.update', 'inventory_item', id, { before, after: b });
  res.json({ ok: true });
});
r.post('/items/:id/move', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const kind = oneOf(req.body.kind, ['in', 'out', 'return'], 'نوع الحركة');
    const qty = String(req.body.qty ?? '');
    if (!/^\d+(\.\d{1,3})?$/.test(qty) || Number(qty) <= 0) throw bad('الكمية غير صالحة');
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`item:${id}`]);
    if (kind === 'out') {
      const bal = (await db.query('select coalesce(qty,0) q from inventory_item_balances where item_id=$1', [id])).rows[0]?.q ?? 0;
      if (Number(bal) < Number(qty)) throw bad(`الرصيد غير كافٍ (${bal})`);
    }
    const mv = (await db.query('insert into inventory_movements(item_id, kind, qty, order_id, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *',
      [id, kind, qty, req.body.order_id ? int(req.body.order_id) : null, str(req.body.note, 'البيان'), req.user.id])).rows[0];
    await audit(db, req, 'item.move', 'inventory_item', id, { kind, qty });
    return mv;
  }));
});
r.get('/items/:id/movements', requirePerm('inventory.view'), async (req, res) => {
  res.json(await many(`select m.*, m.qty::text, u.full_name as user_name, o.order_no from inventory_movements m left join users u on u.id=m.created_by
                       left join orders o on o.id=m.order_id where item_id=$1 order by id desc`, [int(req.params.id)]));
});

/** المنتجات الجاهزة ونصف المصنعة من واقع الطلبات والمخزون */
r.get('/products-stock', requirePerm('inventory.view'), async (_req, res) => {
  const finished = await many(`select p.id, p.sku, p.name, p.stock_qty, coalesce(b.balance,0)::text as gold_weight, m.name as material_name
                               from products p left join gold_balances b on b.loc_type='finished' and b.loc_ref=p.id left join materials m on m.id=b.material_id
                               where p.stock_qty > 0 or coalesce(b.balance,0) <> 0 order by p.name`);
  const semi = await many(`select o.id, o.order_no, o.title, s.name as stage_name, m.name as material_name,
                             (coalesce((select sum(balance) from gold_balances b where b.loc_type='order' and b.loc_ref=o.id),0)
                              + coalesce((select sum(weight_issued) from custodies c where c.order_id=o.id and c.status='open'),0))::text as gold_weight
                           from orders o join stages s on s.id=o.current_stage_id join materials m on m.id=o.material_id where o.status in ('in_production','ready') order by o.id`);
  res.json({ finished, semi });
});

export default r;
