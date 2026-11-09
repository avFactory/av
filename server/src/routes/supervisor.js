import { Router } from 'express';
import { orderThumb } from '../lib/orderThumb.js';
import { pool, tx, many, one } from '../db.js';
import { requirePerm, has } from '../lib/auth.js';
import { bad, notFound, forbidden, conflict, int, str, weight as W } from '../lib/http.js';
import * as custody from '../lib/custody.js';
import { embeddedStonesGrams } from '../lib/production.js';
import * as ledger from '../lib/ledger.js';
import { sendXlsx } from '../lib/xlsx.js';
import { normalizeScan } from '../lib/shortName.js';
import { audit } from '../lib/audit.js';

const r = Router();
const SUP = requirePerm('custody.issue', 'custody.receive', 'custody.view_all');

/** الصفحة الرئيسية للمشرف: البطاقات الأربع */
r.get('/summary', SUP, async (_req, res) => {
  const row = await one(`
    select
      (select count(*) from orders o join stages s on s.id=o.current_stage_id
        where o.status='in_production' and s.handles_gold
          and not exists (select 1 from custodies c where c.order_id=o.id and c.status in ('open','under_review')))::int as awaiting_issue,
      (select count(*) from custodies where status='open')::int as with_workers,
      (select count(*) from custodies where status='open' and work_state='finished')::int as awaiting_receive,
      (select count(*) from custodies where status='open' and worker_ack_at is null)::int as pending_ack,
      (select count(*) from custodies where status='open' and worker_ack_at is null and worker_rejected_at is not null)::int as rejected,
      (select count(*) from settlements where status in ('pending_review','investigating'))::int as abnormal,
      (select coalesce(sum(weight_issued),0) from custodies where status='open')::text as with_workers_weight,
      (select count(distinct worker_id) from custodies where status='open')::int as active_workers`);
  res.json(row);
});

/** الطلبات بانتظار التسليم (المرحلة الحالية تتضمن ذهباً ولا توجد عهدة مفتوحة) */
r.get('/awaiting-issue', SUP, async (_req, res) => {
  res.json(await many(`
    select o.id, o.order_no, o.title, o.quantity, o.due_date, o.assigned_worker_id, s.name as stage_name, m.name as material_name,
           u.full_name as assigned_worker_name, ${orderThumb()} as thumb,
           coalesce((select balance from gold_balances b where b.loc_type='order' and b.loc_ref=o.id and b.material_id=o.material_id),0)::text as order_balance
    from orders o join stages s on s.id=o.current_stage_id join materials m on m.id=o.material_id
    left join users u on u.id=o.assigned_worker_id
    where o.status='in_production' and s.handles_gold
      and not exists (select 1 from custodies c where c.order_id=o.id and c.status in ('open','under_review'))
    order by o.due_date nulls last, o.id`));
});

/** قائمة العمال مع ملخص العهد */
r.get('/workers', requirePerm('workers.view', 'custody.issue', 'custody.receive'), async (req, res) => {
  const qs = req.query.q ? `%${req.query.q}%` : null;
  res.json(await many(`
    select u.id, u.full_name, u.employee_no, u.specialty, u.kind, d.name as department,
      (select count(*) from custodies c where c.worker_id=u.id and c.status='open')::int as open_count,
      (select count(*) from custodies c where c.worker_id=u.id and c.status='open' and c.work_state='finished')::int as finished_count,
      (select coalesce(sum(weight_issued),0) from custodies c where c.worker_id=u.id and c.status='open')::text as open_weight,
      -- الذهب الصافي (ما يعادله عيار 24) = الوزن × العيار ÷ 24
      (select coalesce(sum(c.weight_issued * m.karat / 24.0),0) from custodies c join materials m on m.id=c.material_id where c.worker_id=u.id and c.status='open')::numeric(16,4)::text as open_pure,
      (select count(*) from settlements s join custodies c on c.id=s.custody_id where c.worker_id=u.id and s.status in ('pending_review','investigating'))::int as review_count,
      (select count(*) from custodies c where c.worker_id=u.id and c.status='open' and c.worker_ack_at is null)::int as pending_ack,
      (select count(*) from custodies c where c.worker_id=u.id and c.status='open' and c.worker_ack_at is null and c.worker_rejected_at is not null)::int as rejected_count
    from users u left join departments d on d.id=u.department_id
    where u.role_code='worker' and u.active
      and ($1::text is null or u.full_name ilike $1 or u.employee_no ilike $1 or u.username ilike $1)
    order by open_count desc, u.kind, u.full_name`, [qs]));
});

/** ملف العامل الكامل */
r.get('/workers/:id', requirePerm('workers.view', 'custody.issue', 'custody.receive'), async (req, res) => {
  const id = int(req.params.id);
  const w = await one(`select u.id, u.full_name, u.employee_no, u.specialty, u.phone, u.kind, d.name as department
                       from users u left join departments d on d.id=u.department_id where u.id=$1 and u.role_code='worker'`, [id]);
  if (!w) throw notFound('العامل غير موجود');
  const custodies = await many(`
    select c.*, c.weight_issued::text, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, o.due_date, coalesce(s.name, 'عهدة عامة') as stage_name, m.name as material_name,
      st.id as settlement_id, st.settlement_no, st.status as settlement_status, st.returned_weight::text, st.scrap_weight::text,
      st.actual_loss::text, st.normal_loss::text, st.abnormal_loss::text, st.received_at,
      (s.expected_hours is not null and c.status='open' and c.issued_at + (s.expected_hours || ' hours')::interval < now()) as late
    from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
    left join settlements st on st.custody_id=c.id and st.status <> 'reversed'
    where c.worker_id=$1 and c.status <> 'reversed' order by c.issued_at desc limit 300`, [id]);
  const totals = await one(`
    select
      coalesce(sum(case when kind='issue' and reverses_id is null then weight end),0)::text as received_total,
      coalesce(sum(case when kind='return' then weight end),0)::text as returned_total,
      coalesce(sum(case when kind='scrap_return' then weight end),0)::text as scrap_total,
      coalesce(sum(case when kind='normal_loss' then weight end),0)::text as normal_loss_total,
      coalesce(sum(case when kind in ('abnormal_pending','abnormal_loss') then weight end),0)::text as abnormal_loss_total
    from gold_ledger g where worker_id=$1 and not exists (select 1 from gold_ledger r where r.reverses_id=g.id)`, [id]);
  const balances = await many(`select b.material_id, m.name, b.balance::text from gold_balances b join materials m on m.id=b.material_id
                               where b.loc_type='worker' and b.loc_ref=$1 and b.balance <> 0`, [id]);
  const assigned = await many(`select o.id, o.order_no, o.title, s.name as stage_name, o.stage_state from orders o join stages s on s.id=o.current_stage_id
                               where o.assigned_worker_id=$1 and o.status='in_production'
                                 and not exists (select 1 from custodies c where c.order_id=o.id and c.worker_id=$1 and c.status='open')`, [id]);
  const recent = await many(`select g.movement_no, g.kind, g.weight::text, g.created_at, o.order_no, s.name as stage_name
                             from gold_ledger g left join orders o on o.id=g.order_id left join stages s on s.id=g.stage_id
                             where g.worker_id=$1 order by g.id desc limit 20`, [id]);
  const stones = await many(`select l.lot_no, l.stone_type, o.order_no,
         sum(case m.kind when 'issue' then m.carats when 'return' then -m.carats when 'used' then -m.carats when 'lost' then -m.carats else 0 end)::text as carats,
         sum(case m.kind when 'issue' then m.count when 'return' then -m.count when 'used' then -m.count when 'lost' then -m.count else 0 end)::int as count
       from stone_movements m join stone_lots l on l.id=m.lot_id left join orders o on o.id=m.order_id
       where m.worker_id=$1 and m.kind <> 'reversal' and not exists (select 1 from stone_movements r where r.reverses_id=m.id)
       group by l.lot_no, l.stone_type, o.order_no having sum(case m.kind when 'issue' then m.carats when 'return' then -m.carats when 'used' then -m.carats when 'lost' then -m.carats else 0 end) <> 0`, [id]);
  res.json({ worker: w, custodies, totals, balances, assigned, recent, stones });
});

/** البحث عن طلب بالرقم أو رمز QR */
r.get('/lookup', requirePerm('scan.use', 'custody.issue', 'custody.receive', 'orders.view'), async (req, res) => {
  const code = normalizeScan(req.query.code);
  const byId = req.query.id ? int(req.query.id) : null;
  if (!code && !byId) throw bad('أدخل رقم الطلب أو امسح الرمز');
  const token = code.includes('/') ? code.split('/').pop() : code;
  const o = await one(`
    select o.id, o.order_no, o.title, o.status, o.quantity, o.material_id, o.current_stage_id, o.design_status, o.design_approval_required,
           o.pearl_weight::text, o.stone_weight::text, o.zircon_weight::text, o.set_pearl_weight::text, o.set_stone_weight::text, o.set_zircon_weight::text, o.stones_confirmed_at,
           o.assigned_worker_id, ${orderThumb()} as thumb, s.name as stage_name, s.handles_gold, m.name || coalesce(' ' || case o.color when 'yellow' then 'أصفر' when 'white' then 'أبيض' when 'rose' then 'روز' end, '') as material_name, m.karat, o.color
    from orders o left join stages s on s.id=o.current_stage_id join materials m on m.id=o.material_id
    where ($2::int is not null and o.id=$2) or ($2::int is null and (o.qr_token=lower($1) or upper(o.order_no)=upper($1) or (length($1) >= 10 and regexp_replace(o.order_no, '[^0-9]', '', 'g')=$1) or o.order_no ilike '%-' || lpad($1, 6, '0')))`, [token, byId]);
  if (!o) throw notFound('لم يتم العثور على الطلب');
  if (req.user.role_code === 'worker' && o.assigned_worker_id !== req.user.id) {
    const mine = await one("select 1 from custodies where order_id=$1 and worker_id=$2 and status <> 'reversed' limit 1", [o.id, req.user.id]);
    if (!mine) throw forbidden('هذا الطلب غير مسند إليك');
  }
  o.order_balance = await ledger.balance(pool, 'order', o.id, o.material_id);
  o.stones = await embeddedStonesGrams(pool, o.id);
  o.open_custodies = await many("select c.id, c.custody_no, c.worker_id, u.full_name, c.weight_issued::text from custodies c join users u on u.id=c.worker_id where c.order_id=$1 and c.status='open'", [o.id]);
  res.json(o);
});

/**
 * تأكيد وزن الحجر والزركون واللؤلؤ المركبة في الطلب (بدون مخزون):
 * يُخصم تلقائياً من وزن الميزان عند الاستلام والوزن النهائي، ولا يُسجَّل كحركة ذهب.
 */
r.post('/orders/:id/set-stones', requirePerm('custody.issue', 'custody.receive'), async (req, res) => {
  res.json(await tx(async (db) => {
    const id = int(req.params.id);
    const o = (await db.query('select id, order_no, status, current_stage_id, set_pearl_weight::text, set_stone_weight::text, set_zircon_weight::text from orders where id=$1 for update', [id])).rows[0];
    if (!o) throw notFound('الطلب غير موجود');
    if (!['approved', 'in_production', 'on_hold'].includes(o.status)) throw conflict('لا يمكن تعديل وزن الأحجار لطلب غير قيد التصنيع');
    const v = (x, l) => (x == null || x === '' || Number(x) === 0 ? null : W(x, l));
    const vals = [v(req.body.pearl_weight, 'وزن اللؤلؤ'), v(req.body.stone_weight, 'وزن الحجر'), v(req.body.zircon_weight, 'وزن الزركون')];
    await db.query('update orders set set_pearl_weight=$2, set_stone_weight=$3, set_zircon_weight=$4, stones_confirmed_at=now(), stones_confirmed_by=$5, updated_at=now() where id=$1', [id, ...vals, req.user.id]);
    const g = await embeddedStonesGrams(db, id);
    const parts = [vals[1] && `حجر ${Number(vals[1])} جم`, vals[2] && `زركون ${Number(vals[2])} جم`, vals[0] && `لؤلؤ ${Number(vals[0])} جم`].filter(Boolean);
    await db.query("insert into order_stage_log(order_id, stage_id, event, user_id, note) values ($1,$2,'note',$3,$4)",
      [id, o.current_stage_id, req.user.id, `تأكيد وزن الأحجار المركبة: ${parts.join('، ') || 'لا يوجد'} (يُخصم ${Number(g.confirmed)} جم من وزن الميزان)`]);
    await audit(db, req, 'order.set_stones', 'order', id, { before: { pearl: o.set_pearl_weight, stone: o.set_stone_weight, zircon: o.set_zircon_weight }, after: { pearl: vals[0], stone: vals[1], zircon: vals[2] } });
    return { ok: true, confirmed_grams: g.confirmed, stones: g };
  }));
});

r.post('/issue', requirePerm('custody.issue'), async (req, res) => {
  res.json(await tx((db) => custody.issue(db, req, req.body)));
});

/** تقسيم طلب واحد على عدة عمال: عهدة مستقلة لكل عامل (وزنه وقطعه وعجزه) في معاملة واحدة */
r.post('/issue-split', requirePerm('custody.issue'), async (req, res) => {
  const orderId = int(req.body.order_id, 'الطلب');
  const parts = Array.isArray(req.body.parts) ? req.body.parts : [];
  if (parts.length < 1) throw bad('أضف عاملاً واحداً على الأقل');
  if (parts.length > 50) throw bad('عدد العمال كبير جداً');
  const ids = parts.map((p) => int(p.worker_id, 'العامل'));
  if (new Set(ids).size !== ids.length) throw bad('لا يمكن تكرار العامل نفسه - اجمع وزنه في سطر واحد');
  const key = str(req.body.idempotency_key, 'idempotency', { max: 80 });
  res.json(await tx(async (db) => {
    const results = [];
    for (const [i, p] of parts.entries()) {
      const r1 = await custody.issue(db, req, {
        worker_id: p.worker_id, note: str(req.body.note, 'ملاحظات') || `تقسيم الطلب على ${parts.length} عمال`,
        idempotency_key: key ? `${key}-p${i}` : null,
        items: [{ order_id: orderId, weight: p.weight, pieces: p.pieces, notes: p.notes, stones_weight: p.stones_weight }],
      });
      results.push({ worker_id: ids[i], ...r1 });
    }
    return { parts: results };
  }));
});

r.post('/preview', requirePerm('custody.receive'), async (req, res) => {
  const p = await custody.preview(pool, int(req.body.custody_id), req.body.returned_weight, req.body.scrap_weight, req.body.stones_weight);
  delete p.custody;
  res.json(p);
});

r.post('/receive', requirePerm('custody.receive'), async (req, res) => {
  res.json(await tx((db) => custody.receive(db, req, req.body)));
});

/** العهد المفتوحة لعامل (لشاشة الاستلام) */
r.get('/workers/:id/open', requirePerm('custody.receive', 'custody.view_all'), async (req, res) => {
  const id = int(req.params.id);
  const rows = await many(`
    select c.id, c.custody_no, c.order_id, c.material_id, c.finding_id, (c.weight_issued - c.weight_used)::numeric(16,4)::text as weight_issued, c.gross_weight::text, c.stones_weight::text, c.pieces, c.loss_rate_snapshot::text,
           c.issued_at, c.work_state, c.worker_ack_at, c.worker_rejected_at, c.worker_reject_reason, c.worker_declared_returned::text, c.worker_declared_scrap::text, c.worker_declared_used::text,
           coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, coalesce(s.name, 'عهدة عامة') as stage_name, m.name as material_name,
           ${orderThumb()} as thumb
    from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
    where c.worker_id=$1 and c.status='open' order by c.issued_at`, [id]);
  for (const x of rows) x.stones_now = (await embeddedStonesGrams(pool, x.order_id, id)).total;
  res.json(rows);
});

/** حالات العجز غير الطبيعي */
r.get('/reviews', requirePerm('loss.review', 'loss.investigate', 'loss.approve'), async (req, res) => {
  const status = req.query.all ? null : ['pending_review', 'investigating'];
  res.json(await many(`
    select st.*, st.weight_issued::text, st.returned_weight::text, st.scrap_weight::text, st.actual_loss::text, st.allowed_loss::text,
      st.normal_loss::text, st.abnormal_loss::text, st.gain_weight::text, st.rate_snapshot::text, st.recovered_weight::text,
      c.custody_no, c.worker_id, w.full_name as worker_name, coalesce(o.order_no, 'عهدة عامة') as order_no, o.id as order_id, coalesce(s.name, 'عهدة عامة') as stage_name, m.name as material_name,
      rb.full_name as received_by_name, rv.full_name as reviewed_by_name, rs.full_name as resolved_by_name
    from settlements st join custodies c on c.id=st.custody_id join users w on w.id=c.worker_id left join orders o on o.id=c.order_id
    left join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
    left join users rb on rb.id=st.received_by left join users rv on rv.id=st.reviewed_by left join users rs on rs.id=st.resolved_by
    where ($1::text[] is null and (st.abnormal_loss > 0 or st.gain_weight > 0 or st.status <> 'approved')) or st.status = any($1::text[])
    order by st.received_at desc limit 300`, [status]));
});

r.post('/reviews/:id', requirePerm('loss.review', 'loss.approve'), async (req, res) => {
  res.json(await tx((db) => custody.review(db, req, int(req.params.id), req.body)));
});
r.post('/reviews/:id/investigation', requirePerm('loss.investigate'), async (req, res) => {
  res.json(await tx((db) => custody.investigate(db, req, int(req.params.id), req.body)));
});
r.post('/settlements/:id/reverse', requirePerm('custody.reverse'), async (req, res) => {
  res.json(await tx((db) => custody.reverseSettlement(db, req, int(req.params.id), req.body.reason)));
});
r.post('/custodies/:id/reverse', requirePerm('custody.reverse'), async (req, res) => {
  res.json(await tx((db) => custody.reverseIssue(db, req, int(req.params.id), req.body.reason)));
});

/** كشف جلسة تسليم/استلام للطباعة والتوقيع */
r.get('/batches/:id', requirePerm('custody.issue', 'custody.receive', 'custody.view_all', 'worker.self'), async (req, res) => {
  const b = await one(`select b.*, w.full_name as worker_name, w.employee_no, s.full_name as supervisor_name
                       from custody_batches b join users w on w.id=b.worker_id join users s on s.id=b.supervisor_id where b.id=$1`, [int(req.params.id)]);
  if (!b) throw notFound();
  if (req.user.role_code === 'worker' && b.worker_id !== req.user.id) throw forbidden();
  const lines = b.kind === 'issue'
    ? await many(`select c.custody_no as doc_no, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, coalesce(s.name, 'عهدة عامة') as stage_name, m.name as material_name, c.gross_weight::text, c.stones_weight::text,
                    c.weight_issued::text as weight, c.pieces, c.loss_rate_snapshot::text as rate, c.notes, c.status, c.worker_ack_at, c.worker_rejected_at, c.worker_reject_reason
                  from custodies c left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id join materials m on m.id=c.material_id
                  where c.issue_batch_id=$1 order by c.id`, [b.id])
    : await many(`select st.settlement_no as doc_no, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title, coalesce(s.name, 'عهدة عامة') as stage_name, m.name as material_name, st.weight_issued::text,
                    st.gross_returned::text, st.stones_weight::text, st.returned_weight::text, st.scrap_weight::text, st.actual_loss::text, st.allowed_loss::text,
                    st.abnormal_loss::text, st.gain_weight::text, st.status, st.reason, st.pieces_returned as pieces, c.finished_at as worker_handover_at, c.worker_ack_at
                  from settlements st join custodies c on c.id=st.custody_id left join orders o on o.id=c.order_id left join stages s on s.id=c.stage_id
                  join materials m on m.id=c.material_id where st.receive_batch_id=$1 order by st.id`, [b.id]);
  res.json({ batch: b, lines });
});

/** توقيع العامل على الكشف (إن لم يوقع أثناء الجلسة) */
r.post('/batches/:id/sign', requirePerm('custody.issue', 'custody.receive', 'worker.self'), async (req, res) => {
  const { saveSignature } = await import('../lib/uploads.js');
  const out = await tx(async (db) => {
    const b = (await db.query('select * from custody_batches where id=$1 for update', [int(req.params.id)])).rows[0];
    if (!b) throw notFound();
    if (req.user.role_code === 'worker' && b.worker_id !== req.user.id) throw forbidden();
    if (b.signature_path) throw bad('الكشف موقع مسبقاً');
    const p = await saveSignature(db, req.body.signature, req.user.id);
    if (!p) throw bad('التوقيع مطلوب');
    await db.query('update custody_batches set signature_path=$2, signed_at=now() where id=$1', [b.id, p]);
    if (b.kind === 'issue') await db.query('update custodies set worker_ack_at=coalesce(worker_ack_at, now()) where issue_batch_id=$1', [b.id]);
    return { ok: true };
  });
  res.json(out);
});

/** سجل عمليات المشرف - كل حركة ذهب مع البحث والتصفية والتصدير */
async function movementsQuery(req) {
  const f = req.query;
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.worker_id) add('g.worker_id = ?', int(f.worker_id));
  if (f.order) add('o.order_no ilike ?', `%${f.order}%`);
  if (f.kind) add('g.kind = ?', String(f.kind));
  if (f.stage_id) add('g.stage_id = ?', int(f.stage_id));
  if (f.from) add('g.created_at >= ?::date', String(f.from));
  if (f.to) add("g.created_at < ?::date + interval '1 day'", String(f.to));
  if (f.user_id) add('g.created_by = ?', int(f.user_id));
  if (req.user.role_code === 'worker') add('g.worker_id = ?', req.user.id);
  const sql = `
    select g.id, g.movement_no, g.kind, g.weight::text, g.from_type, g.to_type, g.created_at, g.reason, g.reverses_id,
           coalesce(o.order_no, case when c.kind = 'general' then 'عهدة عامة' end) as order_no, w.full_name as worker_name, s.name as stage_name, m.name as material_name, u.full_name as user_name,
           st.settlement_no, st.status as settlement_status, st.abnormal_loss::text, st.actual_loss::text, c.custody_no, c.notes,
           exists (select 1 from gold_ledger r where r.reverses_id=g.id) as reversed
    from gold_ledger g left join orders o on o.id=g.order_id left join users w on w.id=g.worker_id left join stages s on s.id=g.stage_id
    join materials m on m.id=g.material_id left join users u on u.id=g.created_by left join settlements st on st.id=g.settlement_id
    left join custodies c on c.id=g.custody_id
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by g.id desc limit ${Math.min(Number(f.limit) || 500, 5000)}`;
  return many(sql, params);
}

r.get('/movements', requirePerm('custody.view_all', 'inventory.view', 'reports.view'), async (req, res) => {
  res.json(await movementsQuery(req));
});

export const KIND_LABELS = {
  allocate: 'تخصيص من الخزنة للطلب', customer_gold_in: 'ذهب مستلم من العميل', stock_in: 'إضافة للخزنة', stock_out: 'صرف من الخزنة',
  issue: 'تسليم للعامل', return: 'استلام من العامل', general_issue: 'عهدة عامة من الخزنة للعامل', general_return: 'إرجاع عهدة عامة للخزنة', scrap_return: 'بقايا مستردة', normal_loss: 'عجز طبيعي',
  abnormal_pending: 'عجز غير طبيعي (معلق)', abnormal_loss: 'عجز غير طبيعي', abnormal_loss_approved: 'اعتماد عجز غير طبيعي',
  loss_recovered: 'عجز مسترد بعد التحقيق', gain_pending: 'زيادة وزن (معلقة)', reversal: 'حركة عكسية (تصحيح)',
  delivery: 'تسليم للعميل', to_finished_stock: 'إدخال منتج جاهز للمخزون', from_finished_stock: 'صرف منتج جاهز لطلب',
  final_excess: 'فائض الوزن النهائي للبقايا', final_gain: 'زيادة الوزن النهائي', scrap_to_vault: 'تحويل بقايا للخزنة',
  dealloc: 'إرجاع ذهب الطلب للخزنة', stock_adjust: 'تسوية جرد', convert_out: 'تحويل مادة (صادر)', convert_in: 'تحويل مادة (وارد)',
};

r.get('/movements.xlsx', requirePerm('custody.view_all', 'inventory.view', 'reports.view'), async (req, res) => {
  const rows = await movementsQuery({ ...req, query: { ...req.query, limit: 5000 } });
  await sendXlsx(res, 'سجل الحركات', [
    ['رقم الحركة', 'movement_no'], ['التاريخ', (r) => new Date(r.created_at).toLocaleString('ar-SA-u-nu-latn')], ['النوع', (r) => KIND_LABELS[r.kind] || r.kind],
    ['رقم الطلب', 'order_no'], ['العامل', 'worker_name'], ['المرحلة', 'stage_name'], ['المادة', 'material_name'], ['الوزن (جم)', (r) => Number(r.weight)],
    ['من', (r) => ledger.LOC_LABELS[r.from_type]], ['إلى', (r) => ledger.LOC_LABELS[r.to_type]], ['المستخدم', 'user_name'],
    ['التسوية', 'settlement_no'], ['حالة الاعتماد', 'settlement_status'], ['العجز', 'actual_loss'], ['السبب/ملاحظات', (r) => r.reason || r.notes || ''],
  ], rows, 'movements.xlsx');
});

export default r;
