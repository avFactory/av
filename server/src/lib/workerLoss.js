// العجز على حساب العامل: الفرق بين ما سُلّم له وما استلمه المشرف فعلاً.
// ضمن نسبة المرحلة = عجز طبيعي (على المصنع)، والزائد عنها = على حساب العامل،
// إلا إذا قررت المراجعة غير ذلك (قبول العجز/لا مسؤولية) أو استُرد جزء منه، أو صُحّحت التسوية بحركة عكسية.
export const CHARGED = `case
    when st.status = 'reversed' then 0
    when st.review_decision in ('accept_loss', 'no_fault') then 0
    when st.review_decision = 'recovered' then greatest(st.abnormal_loss - st.recovered_weight, 0)
    else st.abnormal_loss end`;

export const MONTH = `date_trunc('month', st.received_at at time zone 'Asia/Riyadh')::date`;

/** حركات العجز لعامل في شهر (YYYY-MM-01) */
export async function workerLossRows(db, workerId, month) {
  return (await db.query(`select st.id as settlement_id, st.settlement_no, c.order_id, coalesce(o.order_no, 'عهدة عامة') as order_no, coalesce(o.title, c.purpose, 'عهدة عامة') as title,
      coalesce(s.name, 'عهدة عامة') as stage_name, st.received_at, st.weight_issued::text as issued, st.returned_weight::text as returned, st.scrap_weight::text as scrap,
      st.actual_loss::text as actual_loss, st.normal_loss::text as normal_loss, (${CHARGED})::numeric(16,4)::text as charged, st.rate_snapshot::text as rate, st.status, m.karat
    from settlements st join custodies c on c.id = st.custody_id left join orders o on o.id = c.order_id left join stages s on s.id = c.stage_id
    join materials m on m.id = c.material_id
    where c.worker_id = $1 and ${MONTH} = $2::date and st.status <> 'reversed'
    order by st.received_at desc`, [workerId, month])).rows;
}

/** ملخص العجز المحمّل على كل عامل في شهر */
export async function monthlyLossSummary(db, month) {
  return (await db.query(`select u.id as worker_id, u.full_name, u.employee_no, count(*)::int as settlements,
      sum(st.actual_loss)::numeric(16,4)::text as actual, sum(st.normal_loss)::numeric(16,4)::text as normal,
      sum(${CHARGED})::numeric(16,4)::text as charged, sum((${CHARGED}) * m.karat / 24.0)::numeric(16,4)::text as charged_pure,
      count(*) filter (where st.status in ('pending_review', 'investigating'))::int as under_review
    from settlements st join custodies c on c.id = st.custody_id join users u on u.id = c.worker_id join materials m on m.id = c.material_id
    where ${MONTH} = $1::date and st.status <> 'reversed'
    group by u.id order by sum(${CHARGED}) desc, u.full_name`, [month])).rows;
}

export const monthStart = (v) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(v || ''));
  const d = m ? `${m[1]}-${m[2]}-01` : null;
  if (d) return d;
  const now = new Date(Date.now() + 3 * 3600 * 1000); // توقيت الرياض
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
};
