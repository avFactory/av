import { bad } from './http.js';

/** تسجيل حركة ذهب (قيد وزن مزدوج: من موقع إلى موقع) */
export async function post(db, m) {
  const r = await db.query(
    `insert into gold_ledger(movement_no, kind, material_id, weight, from_type, from_ref, to_type, to_ref,
       order_id, custody_id, settlement_id, worker_id, stage_id, batch_id, reverses_id, reason, created_by)
     values (next_doc_no('MV'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
    [m.kind, m.material_id, m.weight, m.from[0], m.from[1] ?? null, m.to[0], m.to[1] ?? null,
     m.order_id ?? null, m.custody_id ?? null, m.settlement_id ?? null, m.worker_id ?? null, m.stage_id ?? null,
     m.batch_id ?? null, m.reverses_id ?? null, m.reason ?? null, m.user_id ?? null]
  );
  return r.rows[0];
}

/** يتجاهل الأوزان الصفرية */
export async function postIf(db, m) {
  if (Number(m.weight) > 0) return post(db, m);
  return null;
}

export async function balance(db, type, ref, materialId) {
  const r = await db.query(
    `select coalesce(sum(case when to_type=$1 and coalesce(to_ref,0)=coalesce($2,0) then weight else 0 end)
                   - sum(case when from_type=$1 and coalesce(from_ref,0)=coalesce($2,0) then weight else 0 end), 0)::text as b
     from gold_ledger where material_id=$3 and ((to_type=$1 and coalesce(to_ref,0)=coalesce($2,0)) or (from_type=$1 and coalesce(from_ref,0)=coalesce($2,0)))`,
    [type, ref ?? null, materialId]
  );
  return r.rows[0].b;
}

/** قفل استشاري على موقع لمنع السحب المتزامن الذي يتجاوز الرصيد */
export async function lockLocation(db, type, ref, materialId) {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`${type}:${ref ?? 0}:${materialId}`]);
}

export async function requireBalance(db, type, ref, materialId, needed, msg) {
  await lockLocation(db, type, ref, materialId);
  const b = await balance(db, type, ref, materialId);
  const r = await db.query('select ($1::numeric >= $2::numeric) as ok', [b, needed]);
  if (!r.rows[0].ok) throw bad(`${msg} (المتاح: ${Number(b).toFixed(3)} جم)`);
  return b;
}

/** حركة عكسية لحركة سابقة - لا تعديل ولا حذف */
export async function reverse(db, mv, reason, userId) {
  return post(db, {
    kind: 'reversal', material_id: mv.material_id, weight: mv.weight,
    from: [mv.to_type, mv.to_ref], to: [mv.from_type, mv.from_ref],
    order_id: mv.order_id, custody_id: mv.custody_id, settlement_id: mv.settlement_id,
    worker_id: mv.worker_id, stage_id: mv.stage_id, reverses_id: mv.id, reason, user_id: userId,
  });
}

export const LOC_LABELS = {
  external: 'خارج المصنع', vault: 'الخزنة/المخزون', order: 'تحت التشغيل (بالطلب)', worker: 'لدى العامل',
  scrap: 'بقايا قابلة للاسترداد', loss_normal: 'عجز طبيعي', loss_suspense: 'عجز تحت المراجعة',
  loss_abnormal: 'عجز غير طبيعي معتمد', delivered: 'مسلَّم للعميل', variance: 'فروقات تسوية/جرد', finished: 'منتجات جاهزة بالمخزون', findings: 'خامات المصنع',
};
