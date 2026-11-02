// إدارة الألماس والأحجار الكريمة: الدفعات، التسليم للعمال، الاستخدام، المرتجع، المتبقي
import { Router } from 'express';
import { pool, tx, many, one } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, conflict, notFound, int, str, oneOf } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { upload, registerFiles } from '../lib/uploads.js';
import { sendXlsx } from '../lib/xlsx.js';

const r = Router();
const CT = (v, name = 'القيراط') => {
  const s = String(v ?? '').trim();
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(s)) throw bad(`${name} غير صالح`);
  return s;
};

r.get('/', requirePerm('stones.view'), async (_req, res) => {
  res.json(await many(`select l.*, l.unit_price::text, l.min_carats::text, b.stock_carats::text, b.stock_count, b.with_workers_carats::text, b.with_workers_count,
      b.used_carats::text, b.used_count, b.lost_carats::text, b.total_in_carats::text, b.total_in_count,
      s.name as shape_name, s.icon as shape_icon, s.sort_order as shape_sort,
      (select path from stone_media sm where sm.lot_id=l.id order by id limit 1) as photo
    from stone_lots l join stone_lot_balances b on b.lot_id=l.id join stone_shapes s on s.id=l.shape_id
    where l.active
    order by s.sort_order, s.name, (l.size_unit='mm') desc, l.size_value nulls last, l.size_label, l.id`));
});

// ------------------------------------------------------------------ تصنيفات القصّة
const ICONS = ['round', 'oval', 'pear', 'heart', 'marquise', 'square', 'emerald', 'baguette', 'other'];
r.get('/shapes', requirePerm('stones.view'), async (_req, res) => {
  res.json(await many(`select s.*, count(l.id)::int as items from stone_shapes s left join stone_lots l on l.shape_id=s.id and l.active
                       group by s.id order by s.sort_order, s.name`));
});
r.post('/shapes', requirePerm('stones.manage'), async (req, res) => {
  const max = (await one('select coalesce(max(sort_order),0)+1 n from stone_shapes where sort_order < 99')).n;
  const sh = await one('insert into stone_shapes(name, icon, sort_order) values ($1,$2,$3) returning *',
    [str(req.body.name, 'اسم التصنيف', { required: true, max: 60 }), oneOf(req.body.icon || 'other', ICONS, 'الشكل'), max]).catch((e) => { if (e.code === '23505') throw bad('التصنيف موجود مسبقاً'); throw e; });
  await audit(pool, req, 'stone_shape.create', 'stone_shape', sh.id, sh);
  res.json(sh);
});
r.put('/shapes/:id', requirePerm('stones.manage'), async (req, res) => {
  const id = int(req.params.id);
  const before = await one('select * from stone_shapes where id=$1', [id]);
  if (!before) throw notFound();
  await pool.query('update stone_shapes set name=$2, icon=$3, sort_order=$4, active=$5 where id=$1',
    [id, str(req.body.name ?? before.name, 'اسم التصنيف', { required: true, max: 60 }), oneOf(req.body.icon ?? before.icon, ICONS, 'الشكل'),
     req.body.sort_order != null ? int(req.body.sort_order, 'الترتيب') : before.sort_order, req.body.active ?? before.active]);
  await audit(pool, req, 'stone_shape.update', 'stone_shape', id, { before, after: req.body });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ استيراد المخزون من Excel / CSV
const norm = (x) => String(x ?? '').trim().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').toLowerCase();
const ALIASES = { 'رواند': 'راوند', 'round': 'راوند', 'بيضاوي': 'اوفال', 'oval': 'اوفال', 'دمعه': 'دمعة', 'pear': 'دمعة', 'قلب': 'قلب', 'heart': 'قلب',
  'marquise': 'ماركيز', 'princess': 'مربع', 'square': 'مربع', 'baguette': 'باجيت' };

/** تفكيك اسم الصنف إلى تصنيف + مقاس، مثل "راوند 1.3 mm" أو "اوفال0.25" */
export function parseStoneName(raw, shapes) {
  const name = String(raw ?? '').trim();
  const n = norm(name);
  const cands = [...shapes.filter((s) => s.name !== 'أخرى').map((s) => [norm(s.name), s.name]), ...Object.entries(ALIASES).map(([a, t]) => [norm(a), t])]
    .sort((a, b) => b[0].length - a[0].length);
  const stoneType = /طبيعي/.test(n) ? 'ألماس طبيعي' : 'ألماس';
  for (const [key, shapeName] of cands) {
    if (n.startsWith(key)) {
      const rest = n.slice(key.length).trim();
      const num = rest.match(/\d+(?:\.\d+)?/);
      const isMm = /mm|مم|ملم/.test(rest);
      if (!num) return { shape: shapeName, size_label: rest || null, size_unit: 'other', size_value: null, stone_type: stoneType };
      return { shape: shapeName, size_label: isMm ? `${num[0]} mm` : num[0], size_unit: isMm ? 'mm' : 'other', size_value: num[0], stone_type: stoneType };
    }
  }
  return { shape: 'أخرى', size_label: name, size_unit: 'other', size_value: null, stone_type: stoneType };
}

function parseCarats(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v >= 0 ? v.toFixed(4) : null;
  const s = String(v).trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/[,،\s]/g, '');
  if (s === '' || /^[-–—]+$/.test(s)) return '0';
  return /^\d+(\.\d+)?$/.test(s) ? Number(s).toFixed(4) : null;
}

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => (/\.(xlsx|csv)$/i.test(f.originalname) ? cb(null, true) : cb(bad('ارفع ملف Excel (xlsx) أو CSV'))) });

/** قراءة الملف: لكل صف، أول خلية نصية = اسم الصنف، وأول قيمة رقمية (أو "-") = الرصيد بالقيراط */
r.post('/import/parse', requirePerm('stones.manage'), memUpload.single('file'), async (req, res) => {
  if (!req.file) throw bad('اختر الملف');
  let table = [];
  if (/\.csv$/i.test(req.file.originalname)) {
    table = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.split(/[,;\t]/));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (c) => { let v = c.value; if (v && typeof v === 'object') v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : null); cells.push(v); });
      table.push(cells);
    });
  }
  const rows = [];
  for (const cells of table) {
    const texts = cells.filter((c) => typeof c === 'string' && c.trim() && parseCarats(c) === null);
    const nums = cells.map(parseCarats).filter((x) => x !== null);
    const name = texts[0]?.trim();
    if (!name || /اسم|المخزون|الالماس في|الماس في/.test(norm(name)) && !nums.length) continue;
    if (!nums.length && !cells.some((c) => typeof c === 'string' && /^[-–—]+$/.test(c.trim()))) {
      rows.push({ name, carats: '0', note: 'لا يوجد رصيد في الملف' });
      continue;
    }
    rows.push({ name, carats: nums[nums.length - 1] ?? '0' });
  }
  if (!rows.length) throw bad('لم يتم العثور على أصناف في الملف');
  res.json({ rows });
});

async function planImport(db, rows) {
  const shapes = (await db.query('select * from stone_shapes')).rows;
  const plan = [];
  for (const r0 of rows) {
    const name = str(r0.name, 'اسم الصنف', { required: true, max: 200 });
    const target = parseCarats(r0.carats);
    if (target === null) throw bad(`رصيد غير صالح للصنف "${name}"`);
    const p = r0.shape ? { ...parseStoneName(name, shapes), shape: r0.shape, size_label: r0.size_label ?? parseStoneName(name, shapes).size_label } : parseStoneName(name, shapes);
    const shape = shapes.find((s) => s.name === p.shape);
    const lot = (await db.query(`select l.id, l.lot_no, b.stock_carats::text from stone_lots l join stone_lot_balances b on b.lot_id=l.id
        where l.active and l.shape_id=$1 and coalesce(l.size_label,'')=coalesce($2,'') and l.stone_type=$3 and l.color is null and l.clarity is null`,
      [shape.id, p.size_label, p.stone_type])).rows[0];
    const current = lot ? lot.stock_carats : '0';
    const diff = Number((Number(target) - Number(current)).toFixed(4));
    plan.push({ name, shape: shape.name, shape_id: shape.id, size_label: p.size_label, size_unit: p.size_unit, size_value: p.size_value, stone_type: p.stone_type,
      lot_id: lot?.id ?? null, lot_no: lot?.lot_no ?? null, current, target, diff, action: !lot ? 'create' : diff === 0 ? 'none' : 'adjust' });
  }
  return plan;
}

r.post('/import/preview', requirePerm('stones.manage'), async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw bad('لا توجد أصناف');
  res.json({ plan: await planImport(pool, rows) });
});

/** اعتماد الاستيراد: إنشاء الأصناف الجديدة وتسوية رصيد الموجودة إلى الرصيد الفعلي (بحركات موثقة) */
r.post('/import/commit', requirePerm('stones.manage'), async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) throw bad('لا توجد أصناف');
  const note = str(req.body.note, 'البيان') || 'رصيد افتتاحي من ملف المخزون';
  res.json(await tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('stone_import'))");
    const plan = await planImport(db, rows);
    let created = 0, adjusted = 0;
    for (const p of plan) {
      let lotId = p.lot_id;
      if (!lotId) {
        lotId = (await db.query(`insert into stone_lots(lot_no, stone_type, cut_shape, shape_id, size_label, size_unit, size_value, notes, created_by)
          values (next_doc_no('STN'),$1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [p.stone_type, p.shape, p.shape_id, p.size_label, p.size_unit, p.size_value, `مستورد: ${p.name}`, req.user.id])).rows[0].id;
        created++;
        if (Number(p.target) > 0) await db.query("insert into stone_movements(lot_id, kind, carats, count, note, created_by) values ($1,'in',$2,0,$3,$4)", [lotId, p.target, note, req.user.id]);
      } else if (p.diff !== 0) {
        await db.query('select pg_advisory_xact_lock(hashtext($1))', [`stone:${lotId}`]);
        await db.query('insert into stone_movements(lot_id, kind, carats, count, note, created_by) values ($1,$2,$3,0,$4,$5)',
          [lotId, p.diff > 0 ? 'adjust_in' : 'adjust_out', Math.abs(p.diff).toFixed(4), `${note} (من ${p.current} إلى ${p.target})`, req.user.id]);
        adjusted++;
      }
    }
    await audit(db, req, 'stone.import', 'stone_lot', null, { note, items: plan.length, created, adjusted, total_carats: plan.reduce((s, p) => s + Number(p.target), 0).toFixed(4) });
    return { items: plan.length, created, adjusted };
  }));
});

r.get('/inventory.xlsx', requirePerm('stones.view'), async (_req, res) => {
  const rows = await many(`select s.name as shape, l.size_label, l.stone_type, l.color, l.clarity, l.lot_no, b.stock_carats, b.stock_count, b.with_workers_carats, b.used_carats
    from stone_lots l join stone_lot_balances b on b.lot_id=l.id join stone_shapes s on s.id=l.shape_id where l.active
    order by s.sort_order, (l.size_unit='mm') desc, l.size_value nulls last, l.size_label`);
  await sendXlsx(res, 'مخزون الألماس', [['التصنيف', 'shape'], ['الصنف / المقاس', 'size_label'], ['النوع', 'stone_type'], ['اللون', 'color'], ['النقاء', 'clarity'], ['رقم الصنف', 'lot_no'],
    ['المخزون (قيراط)', (x) => Number(x.stock_carats)], ['العدد', 'stock_count'], ['لدى العمال (قيراط)', (x) => Number(x.with_workers_carats)], ['مستخدم (قيراط)', (x) => Number(x.used_carats)]], rows, 'diamonds-inventory.xlsx');
});

r.get('/:id', requirePerm('stones.view'), async (req, res) => {
  const id = int(req.params.id);
  const lot = await one(`select l.*, l.min_carats::text, l.unit_price::text, s.name as shape_name, b.stock_carats::text, b.stock_count, b.with_workers_carats::text, b.used_carats::text
    from stone_lots l join stone_lot_balances b on b.lot_id=l.id join stone_shapes s on s.id=l.shape_id where l.id=$1`, [id]);
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
    const shape = (await db.query('select * from stone_shapes where id=$1', [int(b.shape_id, 'التصنيف')])).rows[0];
    if (!shape) throw bad('التصنيف غير موجود');
    const sizeLabel = str(b.size_label, 'المقاس', { max: 60 });
    const num = sizeLabel?.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
    const isMm = /mm|مم|ملم/i.test(sizeLabel || '');
    const files = await registerFiles(db, req.files, req.user.id);
    const lot = (await db.query(`insert into stone_lots(lot_no, stone_type, color, clarity, cut_shape, shape_id, size_label, size_unit, size_value, min_carats, certificate_no, unit_price, notes, created_by)
      values (next_doc_no('STN'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [str(b.stone_type, 'نوع الحجر') || 'ألماس', str(b.color, 'اللون'), str(b.clarity, 'النقاء'), shape.name, shape.id,
       isMm && num ? `${num} mm` : sizeLabel, isMm ? 'mm' : 'other', num, b.min_carats ? CT(b.min_carats, 'حد التنبيه') : null,
       str(b.certificate_no, 'الشهادة'), b.unit_price ? b.unit_price : null, str(b.notes, 'ملاحظات'), req.user.id]).catch((e) => { if (e.code === '23505') throw bad('هذا الصنف موجود مسبقاً في نفس التصنيف - أضف الكمية عبر "حركة"'); throw e; })).rows[0];
    for (const f of files) await db.query('insert into stone_media(lot_id, path) values ($1,$2)', [lot.id, f.path]);
    const carats = b.carats ? CT(b.carats) : '0';
    if (Number(carats) > 0) await db.query("insert into stone_movements(lot_id, kind, carats, count, note, created_by) values ($1,'in',$2,$3,$4,$5)",
      [lot.id, carats, int(b.count || 0, 'العدد', { min: 0 }), 'رصيد افتتاحي/استلام', req.user.id]);
    await audit(db, req, 'stone.create', 'stone_lot', lot.id, { lot_no: lot.lot_no, shape: shape.name, size: lot.size_label, carats });
    return lot;
  }));
});

/** تعديل بيانات الصنف (لا يغير الأرصدة - الأرصدة بالحركات فقط) */
r.put('/:id', requirePerm('stones.manage'), async (req, res) => {
  const id = int(req.params.id);
  const b = req.body;
  res.json(await tx(async (db) => {
    const l = (await db.query('select * from stone_lots where id=$1 for update', [id])).rows[0];
    if (!l) throw notFound();
    const shapeId = b.shape_id ? int(b.shape_id) : l.shape_id;
    const shape = (await db.query('select name from stone_shapes where id=$1', [shapeId])).rows[0];
    if (!shape) throw bad('التصنيف غير موجود');
    const sizeLabel = b.size_label !== undefined ? str(b.size_label, 'المقاس', { max: 60 }) : l.size_label;
    const num = sizeLabel?.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
    const isMm = /mm|مم|ملم/i.test(sizeLabel || '');
    await db.query(`update stone_lots set shape_id=$2, cut_shape=$3, size_label=$4, size_unit=$5, size_value=$6, stone_type=$7, color=$8, clarity=$9,
        min_carats=$10, unit_price=$11, certificate_no=$12, notes=$13, active=$14 where id=$1`,
      [id, shapeId, shape.name, isMm && num ? `${num} mm` : sizeLabel, isMm ? 'mm' : 'other', num, str(b.stone_type ?? l.stone_type, 'النوع', { required: true }),
       b.color !== undefined ? str(b.color, 'اللون') : l.color, b.clarity !== undefined ? str(b.clarity, 'النقاء') : l.clarity,
       b.min_carats !== undefined ? (b.min_carats === '' || b.min_carats === null ? null : CT(b.min_carats, 'حد التنبيه')) : l.min_carats,
       b.unit_price !== undefined ? (b.unit_price === '' ? null : b.unit_price) : l.unit_price, b.certificate_no !== undefined ? str(b.certificate_no, 'الشهادة') : l.certificate_no,
       b.notes !== undefined ? str(b.notes, 'ملاحظات') : l.notes, b.active ?? l.active]).catch((e) => { if (e.code === '23505') throw bad('يوجد صنف بنفس التصنيف والمقاس'); throw e; });
    await audit(db, req, 'stone.update', 'stone_lot', id, { before: l, after: b });
    return { ok: true };
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
