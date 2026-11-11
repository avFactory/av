// خامات المصنع: سلاسل، أقفال، كور سحب... (ذهب بعيار محدد، قطع + وزن)
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, notFound, int, str, weight as W, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyUsers } from '../lib/notify.js';
import * as ledger from '../lib/ledger.js';
import { getWorker } from '../lib/custody.js';

const r = Router();
export const FINDING_CATEGORIES = ['سلسلة', 'قفل', 'كور سحب', 'حلقة', 'وصلة', 'أخرى'];

const LIST = `select f.*, f.unit_weight::text, m.name as material_name, m.karat,
    coalesce((select sum(b.balance) from gold_balances b where b.loc_type='findings' and b.loc_ref=f.id), 0)::numeric(16,4)::text as stock_weight,
    coalesce((select sum(x.pieces) from finding_moves x where x.finding_id=f.id), 0)::int as stock_pieces,
    coalesce((select sum(c.weight_issued - c.weight_used) from custodies c where c.finding_id=f.id and c.status in ('open','under_review')), 0)::numeric(16,4)::text as at_workers
  from findings f join materials m on m.id=f.material_id`;

r.get('/', requirePerm('inventory.view', 'custody.issue', 'findings.manage'), async (_req, res) => {
  res.json({ findings: await many(`${LIST} order by f.active desc, f.category, f.name`), categories: FINDING_CATEGORIES });
});

const vals = (b) => [str(b.name, 'اسم الخامة', { required: true, max: 120 }), str(b.category, 'النوع', { required: true, max: 40 }),
  int(b.material_id, 'العيار'), b.unit_weight ? W(b.unit_weight, 'وزن القطعة') : null, str(b.sku, 'الرمز', { max: 40 }), str(b.notes, 'ملاحظات', { max: 500 })];

r.post('/', requirePerm('findings.manage'), async (req, res) => {
  const f = await one(`insert into findings(name, category, material_id, unit_weight, sku, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [...vals(req.body), req.user.id]);
  await audit(pool, req, 'finding.create', 'finding', f.id, f);
  res.json(f);
});

r.put('/:id', requirePerm('findings.manage'), async (req, res) => {
  const id = int(req.params.id);
  const before = await one('select * from findings where id=$1', [id]);
  if (!before) throw notFound();
  const v = vals(req.body);
  // تغيير العيار بعد وجود رصيد يُفسد الدفتر
  if (v[2] !== before.material_id && (await one("select 1 from gold_ledger where (from_type='findings' and from_ref=$1) or (to_type='findings' and to_ref=$1) limit 1", [id])))
    throw bad('لا يمكن تغيير عيار خامة لها حركات - أضف خامة جديدة');
  await pool.query('update findings set name=$2, category=$3, material_id=$4, unit_weight=$5, sku=$6, notes=$7, active=$8 where id=$1', [id, ...v, req.body.active !== false]);
  await audit(pool, req, 'finding.update', 'finding', id, { before, after: req.body });
  res.json({ ok: true });
});

/** إضافة رصيد خامات: شراء من خارج المصنع، أو تصنيع من ذهب الخزنة */
r.post('/:id/in', requirePerm('findings.manage'), async (req, res) => {
  res.json(await tx(async (db) => {
    const f = (await db.query('select * from findings where id=$1 and active', [int(req.params.id)])).rows[0];
    if (!f) throw notFound('الخامة غير موجودة');
    const weight = W(req.body.weight, 'الوزن');
    const pieces = int(req.body.pieces ?? 0, 'عدد القطع', { min: 0 });
    const source = oneOf(req.body.source || 'external', ['external', 'vault'], 'المصدر');
    const note = str(req.body.note, 'البيان', { max: 300 }) || (source === 'vault' ? 'تصنيع خامات من ذهب الخزنة' : 'شراء/استلام خامات');
    if (source === 'vault') await ledger.requireBalance(db, 'vault', null, f.material_id, weight, 'رصيد الخزنة من هذا العيار غير كافٍ');
    const mv = await ledger.post(db, { kind: 'findings_in', material_id: f.material_id, weight, from: [source, null], to: ['findings', f.id], reason: `${f.name}: ${note}`, user_id: req.user.id });
    await db.query('insert into finding_moves(finding_id, kind, pieces, weight, note, created_by) values ($1,$2,$3,$4,$5,$6)', [f.id, 'in', pieces, weight, note, req.user.id]);
    await audit(db, req, 'finding.in', 'finding', f.id, { pieces, weight, source, note, movement: mv.movement_no });
    return { ok: true };
  }));
});

/**
 * صرف خامات لعامل كعهدة عامة: تخرج من مخزون الخامات وتصبح ذهباً لدى العامل.
 * عند إضافتها على طلب يُخصم وزنها من هذه العهدة عند استلام المشرف.
 */
r.post('/issue', requirePerm('custody.issue'), async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('اختر خامة واحدة على الأقل');
  res.json(await tx(async (db) => {
    const workerId = int(req.body.worker_id, 'العامل');
    const worker = await getWorker(db, workerId);
    const batch = (await db.query(`insert into custody_batches(batch_no, kind, worker_id, supervisor_id, note) values (next_doc_no('ISS'),'issue',$1,$2,'صرف خامات') returning *`,
      [workerId, req.user.id])).rows[0];
    const out = [];
    for (const it of items) {
      const f = (await db.query('select * from findings where id=$1 and active for update', [int(it.finding_id, 'الخامة')])).rows[0];
      if (!f) throw notFound('الخامة غير موجودة');
      const pieces = int(it.pieces ?? 0, 'عدد القطع', { min: 0 });
      const weight = W(it.weight, `وزن ${f.name}`);
      await ledger.requireBalance(db, 'findings', f.id, f.material_id, weight, `رصيد "${f.name}" غير كافٍ`);
      const stockPieces = Number((await db.query('select coalesce(sum(pieces),0) n from finding_moves where finding_id=$1', [f.id])).rows[0].n);
      if (pieces > stockPieces) throw bad(`عدد قطع "${f.name}" المتوفر ${stockPieces}`);
      const purpose = `خامات: ${f.name}${pieces ? ` × ${pieces}` : ''}`;
      const c = (await db.query(`insert into custodies(custody_no, kind, purpose, order_id, worker_id, supervisor_id, stage_id, material_id, weight_issued, gross_weight, pieces,
          loss_rate_snapshot, issue_batch_id, finding_id) values (next_doc_no('CUS'),'general',$1,null,$2,$3,null,$4,$5,$5,$6,0,$7,$8) returning *`,
        [purpose, workerId, req.user.id, f.material_id, weight, pieces, batch.id, f.id])).rows[0];
      await ledger.post(db, { kind: 'findings_issue', material_id: f.material_id, weight, from: ['findings', f.id], to: ['worker', workerId], custody_id: c.id, worker_id: workerId, batch_id: batch.id, reason: purpose, user_id: req.user.id });
      await db.query('insert into finding_moves(finding_id, kind, pieces, weight, custody_id, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [f.id, 'issue', -pieces, weight, c.id, worker.full_name, req.user.id]);
      out.push({ custody_id: c.id, custody_no: c.custody_no, name: f.name, pieces, weight });
    }
    await notifyUsers(db, [workerId], { kind: 'custody', title: `بانتظار قبولك: خامات (${out.length})`, body: out.map((x) => `${x.name} ${x.weight} جم`).join('، ') + ' — افتح مهامك واضغط قبول الاستلام', link: '/w' });
    await audit(db, req, 'finding.issue', 'custody_batch', batch.id, { worker: worker.full_name, items: out });
    return { batch_id: batch.id, batch_no: batch.batch_no, custodies: out };
  }));
});

/** عهد الخامات المفتوحة لدى عامل (لاختيار ما أضافه على الطلب عند الاستلام) */
r.get('/worker/:id', requirePerm('custody.receive', 'custody.issue', 'custody.view_all'), async (req, res) => {
  // مصادر الإضافة على الطلب عند الاستلام: عهد الخامات + العهدة العامة (ذهب بدون طلب) لدى العامل
  res.json(await many(`select c.id, c.custody_no, c.material_id, m.name as material_name, f.id as finding_id,
      coalesce(f.name, 'عهدة عامة' || coalesce(' - ' || c.purpose, '')) as name, coalesce(f.category, 'عهدة عامة') as category, f.unit_weight::text,
      c.pieces, (c.weight_issued - c.weight_used)::numeric(16,4)::text as available, (c.finding_id is null) as general,
      c.pieces - coalesce((select sum(a.pieces) from custody_additions a where a.source_custody_id=c.id and not a.reversed), 0) as pieces_left
    from custodies c left join findings f on f.id=c.finding_id join materials m on m.id=c.material_id
    where c.worker_id=$1 and c.status='open' and (c.finding_id is not null or c.kind='general') and c.weight_issued > c.weight_used order by (c.finding_id is null) desc, c.issued_at`, [int(req.params.id)]));
});

/** حركات خامة */
r.get('/:id/moves', requirePerm('inventory.view', 'findings.manage'), async (req, res) => {
  res.json(await many(`select x.*, x.weight::text, u.full_name as user_name, o.order_no, c.custody_no
    from finding_moves x left join users u on u.id=x.created_by left join orders o on o.id=x.order_id left join custodies c on c.id=x.custody_id
    where x.finding_id=$1 order by x.id desc limit 300`, [int(req.params.id)]));
});

export default r;
