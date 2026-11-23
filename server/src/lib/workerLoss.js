import { conflict } from './http.js';
import * as ledger from './ledger.js';
import { notifyUsers } from './notify.js';
import { audit } from './audit.js';
// العجز على حساب العامل (مثل دالة Excel):
//   العجز الفعلي   = ما سُلّم للعامل − ما استلمه المشرف فعلاً
//   العجز المسموح  = الوزن المستلم × نسبة مهنة العامل (أو نسبة المرحلة)
//   على حساب العامل = إجمالي العجز في الشهر − إجمالي المسموح (على مجموع الشغل، وليس طلباً طلباً)
// المراجعة قد تستثني حالة (قبول العجز/لا مسؤولية) أو تخصم ما استُرد. التسويات المصححة بحركة عكسية لا تُحسب.
// الزيادة (عجز سالب في التسوية) تُخصم تلقائياً من عجز الشهر
export const EFF_ACT = `case
    when st.review_decision in ('accept_loss', 'no_fault') then 0
    when st.review_decision = 'recovered' then st.actual_loss - st.recovered_weight
    else st.actual_loss end`;
export const EFF_ALLOW = `case when st.review_decision in ('accept_loss', 'no_fault') then 0 else st.allowed_loss end`;

export const MONTH = `date_trunc('month', st.received_at at time zone 'Asia/Riyadh')::date`;

/** حركات العجز لعامل في شهر (YYYY-MM-01) */
export async function workerLossRows(db, workerId, month) {
  return (await db.query(`select st.id as settlement_id, st.settlement_no, c.order_id, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title,
      coalesce(s.name, 'عهدة عامة') as stage_name, st.received_at, st.weight_issued::text as issued, st.returned_weight::text as returned,
      (${EFF_ACT})::numeric(16,4)::text as actual_loss, (${EFF_ALLOW})::numeric(16,4)::text as allowed,
      ((${EFF_ACT}) - (${EFF_ALLOW}))::numeric(16,4)::text as net, st.rate_snapshot::text as rate, st.status, m.karat
    from settlements st join custodies c on c.id = st.custody_id left join orders o on o.id = c.order_id left join stages s on s.id = c.stage_id
    join materials m on m.id = c.material_id
    where c.worker_id = $1 and ${MONTH} = $2::date and st.status <> 'reversed'
    order by st.received_at desc`, [workerId, month])).rows;
}

/** إجماليات الشهر: على حساب العامل = الإجمالي − المسموح (لا يقل عن صفر) */
export function monthTotals(rows) {
  const s = (f) => rows.reduce((a, r) => a + f(r), 0);
  const actual = s((r) => Number(r.actual_loss));
  const allowed = s((r) => Number(r.allowed));
  const net = actual - allowed;
  const netPure = s((r) => (Number(r.actual_loss) - Number(r.allowed)) * Number(r.karat) / 24);
  return { actual, allowed, charged: Math.max(0, round4(net)), charged_pure: Math.max(0, round4(netPure)) };
}
const round4 = (x) => Math.round(x * 10000) / 10000;

/** ملخص الشهر لكل العمال */
export async function monthlyLossSummary(db, month) {
  return (await db.query(`select u.id as worker_id, u.full_name, u.employee_no, u.specialty, count(*)::int as settlements,
      sum(${EFF_ACT})::numeric(16,4)::text as actual, sum(${EFF_ALLOW})::numeric(16,4)::text as allowed,
      greatest(sum((${EFF_ACT}) - (${EFF_ALLOW})), 0)::numeric(16,4)::text as charged,
      greatest(sum(((${EFF_ACT}) - (${EFF_ALLOW})) * m.karat / 24.0), 0)::numeric(16,4)::text as charged_pure,
      count(*) filter (where st.status in ('pending_review', 'investigating'))::int as under_review
    from settlements st join custodies c on c.id = st.custody_id join users u on u.id = c.worker_id join materials m on m.id = c.material_id
    where ${MONTH} = $1::date and st.status <> 'reversed'
    group by u.id order by greatest(sum((${EFF_ACT}) - (${EFF_ALLOW})), 0) desc, u.full_name`, [month])).rows;
}

/** نسبة العجز لعامل حسب مهنته (null إن لم تُحدد) */
export async function specialtyRate(db, workerId) {
  const r = (await db.query(`select r.rate_percent::text as rate from users u join specialty_loss_rates r
      on u.specialty is not null and (u.specialty = r.specialty or u.specialty like '%' || r.specialty || '%' or replace(u.specialty, 'أ', 'ا') like '%' || replace(r.specialty, 'أ', 'ا') || '%')
    where u.id = $1 order by length(r.specialty) desc limit 1`, [workerId])).rows[0];
  return r ? r.rate : null;
}

export const monthStart = (v) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(v || ''));
  if (m) return `${m[1]}-${m[2]}-01`;
  const now = new Date(Date.now() + 3 * 3600 * 1000); // توقيت الرياض
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

// ------------------------------------------------------------------ إقفال الشهر: تثبيت العجز المعلق على العامل

/** العجز المعلق (لم يُثبَّت) لعامل: لكل شهر وعيار — للعرض في حسابه وصفحة الإقفال */
export async function heldLossSummary(db, workerId = null) {
  return (await db.query(`select c.worker_id, u.full_name, u.employee_no, u.kind, to_char(${MONTH}, 'YYYY-MM') as month, m.id as material_id, m.name as material_name, m.karat,
      count(*)::int as settlements,
      sum(st.actual_loss - coalesce(st.recovered_weight, 0))::numeric(16,4)::text as held,
      sum(st.allowed_loss)::numeric(16,4)::text as allowed,
      count(*) filter (where st.status in ('pending_review', 'investigating'))::int as under_review
    from settlements st join custodies c on c.id=st.custody_id join users u on u.id=c.worker_id join materials m on m.id=c.material_id
    where st.loss_held and st.loss_fixed_at is null and st.status <> 'reversed' and ($1::int is null or c.worker_id=$1)
    group by c.worker_id, u.full_name, u.employee_no, u.kind, ${MONTH}, m.id, m.name, m.karat
    order by ${MONTH}, u.full_name`, [workerId])).rows;
}

/**
 * تثبيت عجز شهر على عامل/ماكينة: العجز المعلق في رصيده يخرج إلى العجز الطبيعي (حتى المسموح) والباقي غير طبيعي،
 * ويُعلَّم الشهر مقفلاً لتسوياته. التسويات تحت المراجعة تمنع الإقفال حتى تُنهى.
 */
export async function fixWorkerMonth(db, req, workerId, month, note = null) {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`lossfix:${workerId}:${month}`]);
  const rows = (await db.query(`select st.id, st.status, st.settlement_no, st.actual_loss, coalesce(st.recovered_weight, 0) as recovered, st.allowed_loss, c.material_id
    from settlements st join custodies c on c.id=st.custody_id
    where c.worker_id=$1 and ${MONTH} = $2::date and st.loss_held and st.loss_fixed_at is null and st.status <> 'reversed' for update of st`, [workerId, month])).rows;
  if (!rows.length) return { fixed: [], count: 0 };
  const rev = rows.filter((r) => ['pending_review', 'investigating'].includes(r.status));
  if (rev.length) throw conflict(`توجد ${rev.length} تسوية تحت المراجعة لهذا العامل في الشهر (${rev.map((r) => r.settlement_no).join('، ')}) — أنهِ المراجعة أولاً`);
  const w = (await db.query('select full_name from users where id=$1', [workerId])).rows[0];
  const byMat = new Map();
  for (const r of rows) {
    const g = byMat.get(r.material_id) || { actual: 0, allowed: 0, n: 0 };
    g.actual += Number(r.actual_loss) - Number(r.recovered); // الزيادة المغطاة عجزها سالب فتُخصم
    g.allowed += Number(r.allowed_loss); g.n++;
    byMat.set(r.material_id, g);
  }
  const fixed = [];
  const r4 = (x) => Math.round(x * 10000) / 10000;
  for (const [mat, g] of byMat) {
    const actual = Math.max(0, r4(g.actual));
    const normal = r4(Math.min(actual, g.allowed));
    const abnormal = r4(actual - normal);
    const reason = `إقفال عجز شهر ${month.slice(0, 7)} — ${w.full_name}${note ? `: ${note}` : ''}`;
    const base = { material_id: mat, worker_id: workerId, user_id: req.user.id, reason };
    if (normal > 0) await ledger.post(db, { ...base, kind: 'month_loss_normal', weight: normal.toFixed(4), from: ['worker', workerId], to: ['loss_normal', null] });
    if (abnormal > 0) await ledger.post(db, { ...base, kind: 'month_loss_abnormal', weight: abnormal.toFixed(4), from: ['worker', workerId], to: ['loss_abnormal', null] });
    await db.query(`insert into worker_loss_closings(worker_id, month, material_id, actual, allowed, normal, abnormal, settlements, note, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (worker_id, month, material_id) do update set actual = worker_loss_closings.actual + excluded.actual, allowed = worker_loss_closings.allowed + excluded.allowed,
        normal = worker_loss_closings.normal + excluded.normal, abnormal = worker_loss_closings.abnormal + excluded.abnormal, settlements = worker_loss_closings.settlements + excluded.settlements`,
      [workerId, month, mat, actual.toFixed(4), r4(g.allowed).toFixed(4), normal.toFixed(4), abnormal.toFixed(4), g.n, note, req.user.id]);
    fixed.push({ material_id: mat, actual, allowed: r4(g.allowed), normal, abnormal, settlements: g.n });
  }
  await db.query('update settlements set loss_fixed_at=now() where id = any($1::int[])', [rows.map((r) => r.id)]);
  const tot = r4(fixed.reduce((a, f) => a + f.actual, 0));
  await notifyUsers(db, [workerId], { kind: 'loss', title: `ثُبّت عجز شهر ${month.slice(0, 7)} على حسابك`, body: `${tot.toFixed(3)} جم (المسموح ${r4(fixed.reduce((a, f) => a + f.allowed, 0)).toFixed(3)} جم)`, link: '/w/losses' });
  await audit(db, req, 'loss.month_fix', 'worker', workerId, { month, fixed });
  return { fixed, count: rows.length };
}
