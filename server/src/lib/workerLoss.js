// العجز على حساب العامل (مثل دالة Excel):
//   العجز الفعلي   = ما سُلّم للعامل − ما استلمه المشرف فعلاً
//   العجز المسموح  = الوزن المستلم × نسبة مهنة العامل (أو نسبة المرحلة)
//   على حساب العامل = إجمالي العجز في الشهر − إجمالي المسموح (على مجموع الشغل، وليس طلباً طلباً)
// المراجعة قد تستثني حالة (قبول العجز/لا مسؤولية) أو تخصم ما استُرد. التسويات المصححة بحركة عكسية لا تُحسب.
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
