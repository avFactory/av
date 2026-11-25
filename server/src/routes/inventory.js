// المخزون: الذهب (الخزنة والبقايا)، المواد الأخرى، الجرد، التحويل الموثق بين المواد، المطابقة
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, weight as W, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import * as ledger from '../lib/ledger.js';
import { notifyPerm } from '../lib/notify.js';
import { statementRows } from '../lib/statement.js';
import { listDealers, dealerEntry } from '../lib/goldDealers.js';
import { listSuppliers, supplierEntry } from '../lib/suppliers.js';

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
    const b = req.body;
    const source = oneOf(b.source || 'purchase', ['purchase', 'customer', 'dealer', 'supplier'], 'مصدر الذهب');
    const m = int(b.material_id, 'المادة');
    const w = W(b.weight, 'الوزن');
    const mat = (await db.query('select id, name, karat from materials where id=$1', [m])).rows[0];
    if (!mat) throw notFound('المادة غير موجودة');
    let note = str(b.note, 'البيان', { required: source === 'purchase', max: 300 }) || '';
    let mv;
    if (source === 'customer') {
      // تسليم ذهب من العميل: يدخل الخزنة ويُقيد سداد ذهب في كشف حسابه
      const cid = int(b.customer_id, 'العميل');
      const c = (await db.query('select id, shop_name, branches_only from customers where id=$1', [cid])).rows[0];
      if (!c) throw notFound('العميل غير موجود');
      const branchId = b.branch_id ? int(b.branch_id, 'الفرع') : null;
      if (branchId && !(await db.query('select 1 from customer_branches where id=$1 and customer_id=$2', [branchId, cid])).rowCount) throw bad('الفرع لا يتبع العميل');
      if (!branchId && c.branches_only) throw bad('اختر الفرع (الشركة بفروع فقط)');
      mv = await ledger.post(db, { kind: 'customer_gold_payment', material_id: m, weight: w, from: ['external', cid], to: ['vault', null], reason: `تسليم ذهب من العميل ${c.shop_name}${note ? `: ${note}` : ''}`, user_id: req.user.id });
      await db.query(`insert into customer_entries(entry_no, customer_id, entry_date, kind, gold_credit, karat, description, ledger_id, created_by, branch_id)
        values (next_doc_no('CEN'),$1,(now() at time zone 'Asia/Riyadh')::date,'gold_payment',$2,$3,$4,$5,$6,$7)`,
        [cid, w, mat.karat, `تسليم ذهب للخزنة${note ? ` — ${note}` : ''}`, mv.id, req.user.id, branchId]);
    } else if (source === 'dealer') {
      // سحب من رصيد المصنع لدى جمل الصافي (ديوان الذهب / الجنيه العربي)
      const d = (await db.query('select id, name from gold_dealers where id=$1', [int(b.dealer_id, 'الجمل')])).rows[0];
      if (!d) throw notFound('الجمل غير موجود');
      mv = await ledger.post(db, { kind: 'stock_in', material_id: m, weight: w, from: ['external', null], to: ['vault', null], reason: `استلام ذهب من ${d.name}${note ? `: ${note}` : ''}`, user_id: req.user.id });
      await dealerEntry(db, { dealerId: d.id, kind: 'withdraw', weight: (Number(w) * Number(mat.karat) / 24).toFixed(4), ledgerId: mv.id, note: note || 'سحب للخزنة', userId: req.user.id });
    } else if (source === 'supplier') {
      // ذهب من مورد (مصنع لين، كنوز الشرق…): يدخل الخزنة ويُخصم صافيه من رصيده المقدم
      const s = (await db.query('select id, name from gold_suppliers where id=$1', [int(b.supplier_id, 'المورد')])).rows[0];
      if (!s) throw notFound('المورد غير موجود');
      mv = await ledger.post(db, { kind: 'stock_in', material_id: m, weight: w, from: ['external', null], to: ['vault', null], reason: `استلام ذهب من المورد ${s.name}${note ? `: ${note}` : ''}`, user_id: req.user.id });
      await supplierEntry(db, { supplierId: s.id, kind: 'gold_in', weight: w, karat: mat.karat, materialId: m, ledgerId: mv.id, note: note || 'استلام ذهب للخزنة', userId: req.user.id });
    } else {
      mv = await ledger.post(db, { kind: 'stock_in', material_id: m, weight: w, from: ['external', null], to: ['vault', null], reason: `شراء: ${note}`, user_id: req.user.id });
    }
    await audit(db, req, 'gold.in', 'gold_ledger', mv.id, { material: m, weight: w, source, note, customer_id: b.customer_id || null, dealer_id: b.dealer_id || null, supplier_id: b.supplier_id || null });
    return mv;
  }));
});

/** مصادر إضافة الذهب: العملاء (مع رصيد الذهب عليهم) وجمل الصافي (مع رصيد المصنع لديهم) */
r.get('/gold/sources', requirePerm('inventory.manage'), async (_req, res) => {
  const customers = await many(`select c.id, c.shop_name, c.branches_only,
      coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name) order by b.name) from customer_branches b where b.customer_id=c.id and b.active), '[]') as branches
    from customers c where c.status='approved' order by c.shop_name`);
  const owe = new Map();
  for (const c of customers) {
    let pure = 0;
    for (const x of await statementRows(pool, c.id, 'all')) pure += x.pure_debit - x.pure_credit;
    owe.set(c.id, Math.round(pure * 10000) / 10000);
  }
  for (const c of customers) c.pure = owe.get(c.id);
  customers.sort((a, b) => b.pure - a.pure || a.shop_name.localeCompare(b.shop_name, 'ar'));
  res.json({ customers, dealers: await listDealers(pool), suppliers: await listSuppliers(pool) });
});

// ------------------------------------------------------------------ موردو الخامات
r.get('/suppliers', requirePerm('dashboard.view', 'inventory.view', 'findings.manage', 'finance.view'), async (_req, res) => {
  const suppliers = await listSuppliers(pool, { all: true });
  const entries = await many(`select e.*, e.weight::text, e.pure::text, s.name as supplier_name, f.name as finding_name, u.full_name as created_by_name
    from gold_supplier_entries e join gold_suppliers s on s.id=e.supplier_id left join findings f on f.id=e.finding_id left join users u on u.id=e.created_by
    order by e.id desc limit 300`);
  const total = suppliers.filter((s) => s.active).reduce((a, s) => a + Number(s.balance), 0);
  res.json({ total: Math.round(total * 10000) / 10000, suppliers, entries });
});

r.post('/suppliers', requirePerm('inventory.manage', 'findings.manage'), async (req, res) => {
  const name = str(req.body.name, 'اسم المورد', { required: true, max: 120 });
  if ((await pool.query('select 1 from gold_suppliers where name=$1', [name])).rowCount) throw conflict('المورد مسجل مسبقاً');
  const s = await one('insert into gold_suppliers(name, supplies, phone, note) values ($1,$2,$3,$4) returning *',
    [name, str(req.body.supplies, 'الخامات', { max: 120 }), str(req.body.phone, 'الجوال', { max: 30 }), str(req.body.note, 'ملاحظات', { max: 300 })]);
  await audit(pool, req, 'supplier.create', 'gold_suppliers', s.id, { name });
  res.json(s);
});

r.put('/suppliers/:id', requirePerm('inventory.manage', 'findings.manage'), async (req, res) => {
  const id = int(req.params.id);
  const name = str(req.body.name, 'اسم المورد', { required: true, max: 120 });
  if ((await pool.query('select 1 from gold_suppliers where name=$1 and id<>$2', [name, id])).rowCount) throw conflict('المورد مسجل مسبقاً');
  const s = await one('update gold_suppliers set name=$2, supplies=$3, phone=$4, active=$5 where id=$1 returning *',
    [id, name, str(req.body.supplies, 'الخامات', { max: 120 }), str(req.body.phone, 'الجوال', { max: 30 }), req.body.active !== false]);
  if (!s) throw notFound('المورد غير موجود');
  await audit(pool, req, 'supplier.update', 'gold_suppliers', id, req.body);
  res.json(s);
});

/** رصيد مقدم افتتاحي (ذهب صافي لدى المورد قبل النظام) */
r.post('/suppliers/:id/opening', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const e = await supplierEntry(db, { supplierId: int(req.params.id), kind: 'opening', weight: W(req.body.weight, 'الوزن الصافي'), karat: 24, note: str(req.body.note, 'البيان', { required: true, max: 300 }), userId: req.user.id });
    await audit(db, req, 'supplier.opening', 'gold_suppliers', e.supplier_id, { entry: e.entry_no, weight: e.weight });
    return e;
  }));
});

// ------------------------------------------------------------------ جمل الصافي
r.get('/dealers', requirePerm('dashboard.view', 'inventory.manage', 'finance.view'), async (_req, res) => {
  const dealers = await listDealers(pool, { all: true });
  const entries = await many(`select e.*, e.weight::text, d.name as dealer_name, c.shop_name, u.full_name as created_by_name
    from gold_dealer_entries e join gold_dealers d on d.id=e.dealer_id left join customers c on c.id=e.customer_id left join users u on u.id=e.created_by
    order by e.id desc limit 300`);
  const total = dealers.filter((d) => d.active).reduce((a, d) => a + Number(d.balance), 0);
  res.json({ total: Math.round(total * 10000) / 10000, dealers, entries });
});

r.post('/dealers', requirePerm('inventory.manage'), async (req, res) => {
  const name = str(req.body.name, 'اسم الجمل', { required: true, max: 120 });
  if ((await pool.query('select 1 from gold_dealers where name=$1', [name])).rowCount) throw conflict('الاسم مسجل مسبقاً');
  const d = await one('insert into gold_dealers(name, phone, note) values ($1,$2,$3) returning *', [name, str(req.body.phone, 'الجوال', { max: 30 }), str(req.body.note, 'ملاحظات', { max: 300 })]);
  await audit(pool, req, 'dealer.create', 'gold_dealers', d.id, { name });
  res.json(d);
});

/** رصيد افتتاحي / إيداع يدوي لدى الجمل (مثلاً ذهب اشتراه المصنع وبقي عنده) */
r.post('/dealers/:id/deposit', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const e = await dealerEntry(db, { dealerId: int(req.params.id), kind: 'deposit', weight: W(req.body.weight, 'الوزن الصافي'), note: str(req.body.note, 'البيان', { required: true, max: 300 }), userId: req.user.id });
    await audit(db, req, 'dealer.deposit', 'gold_dealers', e.dealer_id, { entry: e.entry_no, weight: e.weight });
    return e;
  }));
});

r.post('/gold/out', requirePerm('inventory.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const m = int(req.body.material_id, 'المادة');
    const w = W(req.body.weight, 'الوزن');
    const from = oneOf(req.body.from || 'vault', ['vault', 'scrap'], 'المصدر');
    // صرف ذهب لمورد خامات (مقدماً): يُسجل في رصيده المقدم
    const supplierId = req.body.to === 'supplier' ? int(req.body.supplier_id, 'المورد') : null;
    const sup = supplierId ? (await db.query('select id, name from gold_suppliers where id=$1', [supplierId])).rows[0] : null;
    if (supplierId && !sup) throw notFound('المورد غير موجود');
    const note = str(req.body.note, 'البيان', { required: !sup, max: 300 });
    await ledger.requireBalance(db, from, null, m, w, 'الرصيد غير كافٍ');
    const mv = await ledger.post(db, { kind: 'stock_out', material_id: m, weight: w, from: [from, null], to: ['external', null], reason: sup ? `صرف ذهب للمورد ${sup.name}${note ? `: ${note}` : ''}` : note, user_id: req.user.id });
    if (sup) {
      const karat = (await db.query('select karat from materials where id=$1', [m])).rows[0]?.karat || 24;
      await supplierEntry(db, { supplierId: sup.id, kind: 'gold_out', weight: w, karat, materialId: m, ledgerId: mv.id, note: note || 'صرف ذهب مقدماً', userId: req.user.id });
    }
    await audit(db, req, 'gold.out', 'gold_ledger', mv.id, { material: m, weight: w, from, note, supplier_id: supplierId });
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
    if (['delivery', 'to_finished_stock'].includes(mv.kind)) throw conflict('التسليم للعميل يُلغى من صفحة الطلب: «إلغاء التسليم»');
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
      coalesce(sum(b.balance) filter (where b.loc_type='transit'),0) as transit,
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
  // فحص 1: رصيد كل عامل في الدفتر = مجموع عهده المفتوحة + عجز الشهر المعلق في حسابه (لم يُثبَّت بعد)
  const workerCheck = await many(`
    with led as (select loc_ref as worker_id, material_id, balance from gold_balances where loc_type='worker'),
         cus0 as (select worker_id, material_id, sum(weight_issued - weight_used) w from custodies where status='open' and worker_ack_at is not null group by 1,2
                  union all
                  select c.worker_id, c.material_id, sum(st.actual_loss - coalesce(st.recovered_weight,0)) from settlements st join custodies c on c.id=st.custody_id
                  where st.loss_held and st.loss_fixed_at is null and st.status <> 'reversed' group by 1,2),
         cus as (select worker_id, material_id, sum(w) w from cus0 group by 1,2)
    select coalesce(l.worker_id, c.worker_id) worker_id, u.full_name, m.name material, coalesce(l.balance,0)::text ledger, coalesce(c.w,0)::text custodies,
           (coalesce(l.balance,0) = coalesce(c.w,0)) ok
    from led l full join cus c on c.worker_id=l.worker_id and c.material_id=l.material_id
    join users u on u.id=coalesce(l.worker_id, c.worker_id) join materials m on m.id=coalesce(l.material_id, c.material_id)
    where coalesce(l.balance,0) <> 0 or coalesce(c.w,0) <> 0`);
  // فحص 1ب: الذهب بانتظار قبول العامل = المتبقي في عهده المفتوحة التي لم يقبلها
  const transitCheck = await many(`
    with led as (select loc_ref as worker_id, material_id, balance from gold_balances where loc_type='transit'),
         cus as (select worker_id, material_id, sum(weight_issued - weight_used) w from custodies where status='open' and worker_ack_at is null group by 1,2)
    select coalesce(l.worker_id, c.worker_id) worker_id, u.full_name, m.name material, coalesce(l.balance,0)::text ledger, coalesce(c.w,0)::text custodies,
           (coalesce(l.balance,0) = coalesce(c.w,0)) ok
    from led l full join cus c on c.worker_id=l.worker_id and c.material_id=l.material_id
    join users u on u.id=coalesce(l.worker_id, c.worker_id) join materials m on m.id=coalesce(l.material_id, c.material_id)
    where coalesce(l.balance,0) <> 0 or coalesce(c.w,0) <> 0`);
  // فحص 2: لا أرصدة سالبة في أي موقع داخلي
  const negatives = await many(`select loc_type, loc_ref, m.name, balance::text from gold_balances b join materials m on m.id=b.material_id
                                where balance < 0 and loc_type not in ('external','variance')`);
  // فحص 4: الأرصدة الجاهزة تطابق دفتر الحركات كاملاً
  const balanceDrift = await many(`with raw as (
      select loc_type, loc_ref, material_id, sum(w) b from (
        select to_type loc_type, to_ref loc_ref, material_id, weight w from gold_ledger
        union all select from_type, from_ref, material_id, -weight from gold_ledger) x group by 1,2,3)
    select coalesce(r.loc_type, t.loc_type) loc_type, coalesce(r.loc_ref, t.loc_ref) loc_ref, coalesce(r.material_id, t.material_id) material_id, coalesce(r.b,0)::text ledger, coalesce(t.balance,0)::text cached
    from raw r full join gold_balance_totals t on t.loc_type=r.loc_type and t.loc_ref is not distinct from r.loc_ref and t.material_id=r.material_id
    where coalesce(r.b,0) <> coalesce(t.balance,0)`);
  // فحص 3: معادلة كل تسوية
  const badSettlements = await many(`select settlement_no from settlements where status <> 'reversed' and returned_weight + scrap_weight + actual_loss <> weight_issued`);
  const fmt = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' && /^-?\d/.test(v) ? Number(v).toFixed(4) : v]));
  res.json({
    perMaterial: perMaterial.map(fmt), workerCheck, transitCheck, negatives, badSettlements, balanceDrift,
    ok: workerCheck.every((w) => w.ok) && transitCheck.every((w) => w.ok) && !negatives.length && !badSettlements.length && !balanceDrift.length && perMaterial.every((p) => Number(p.ledger_sum) === 0),
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
