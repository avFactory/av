// تقارير العجز والأداء
import { Router } from 'express';
import { many } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { sendXlsx } from '../lib/xlsx.js';

const r = Router();

function lossQuery(group, q) {
  const cols = {
    worker: "w.id as key, w.full_name as label",
    stage: "s.id as key, coalesce(s.name, 'عهدة عامة') as label",
    order: "o.id as key, coalesce(o.order_no || ' - ' || o.title, 'عهدة عامة') as label",
    material: "m.id as key, m.name as label",
  }[group];
  if (!cols) return null;
  const params = [q.from || '2000-01-01', q.to || '2999-12-31'];
  return many(`select ${cols}, count(st.id)::int as settlements,
      sum(st.weight_issued)::text as issued, sum(st.returned_weight)::text as returned, sum(st.scrap_weight)::text as scrap,
      sum(st.actual_loss)::text as actual_loss, sum(st.normal_loss)::text as normal_loss, sum(st.abnormal_loss)::text as abnormal_loss,
      sum(st.recovered_weight)::text as recovered, sum(st.gain_weight)::text as gain,
      case when sum(st.weight_issued) > 0 then round(100 * sum(st.actual_loss) / sum(st.weight_issued), 4)::text end as loss_pct,
      count(*) filter (where st.status in ('pending_review','investigating'))::int as open_cases,
      count(*) filter (where st.review_decision='worker_responsible')::int as worker_responsible
    from settlements st join custodies c on c.id=st.custody_id join users w on w.id=c.worker_id left join stages s on s.id=c.stage_id
    left join orders o on o.id=c.order_id join materials m on m.id=c.material_id
    where st.status <> 'reversed' and st.received_at >= $1::date and st.received_at < $2::date + 1
    group by 1, 2 order by sum(st.abnormal_loss) desc nulls last, 2`, params);
}

r.get('/losses/:group', requirePerm('reports.view', 'loss.review'), async (req, res, next) => {
  const q = lossQuery(req.params.group, req.query);
  if (!q) return next();
  res.json(await q);
});

r.get('/losses/:group.xlsx', requirePerm('reports.view', 'loss.review'), async (req, res, next) => {
  const q = lossQuery(req.params.group, req.query);
  if (!q) return next();
  await sendXlsx(res, 'تقرير العجز', [['البيان', 'label'], ['عدد التسويات', 'settlements'], ['المسلم (جم)', (x) => Number(x.issued)], ['المرتجع', (x) => Number(x.returned)],
    ['البقايا', (x) => Number(x.scrap)], ['العجز الفعلي', (x) => Number(x.actual_loss)], ['العجز الطبيعي', (x) => Number(x.normal_loss)], ['العجز غير الطبيعي', (x) => Number(x.abnormal_loss)],
    ['المسترد بعد التحقيق', (x) => Number(x.recovered)], ['نسبة العجز %', 'loss_pct'], ['حالات مفتوحة', 'open_cases']], await q, `losses-${req.params.group}.xlsx`);
});

r.get('/workers', requirePerm('reports.view', 'employees.manage'), async (req, res) => {
  res.json(await many(`select u.id, u.full_name, u.employee_no, d.name as department,
      count(c.id) filter (where c.status='closed')::int as completed, count(c.id) filter (where c.status='open')::int as open,
      coalesce(sum(c.weight_issued) filter (where c.status='closed'),0)::text as weight_processed,
      coalesce(sum(st.abnormal_loss),0)::text as abnormal_loss,
      case when sum(c.weight_issued) filter (where st.id is not null) > 0 then round(100*sum(st.actual_loss)/sum(c.weight_issued) filter (where st.id is not null),4)::text end as loss_pct,
      round(avg(extract(epoch from (st.received_at - c.issued_at))/3600)::numeric,1)::text as avg_hours,
      count(c.id) filter (where s.expected_hours is not null and coalesce(st.received_at, now()) > c.issued_at + (s.expected_hours || ' hours')::interval)::int as late_count
    from users u left join departments d on d.id=u.department_id left join custodies c on c.worker_id=u.id and c.status <> 'reversed'
      and c.issued_at >= $1::date and c.issued_at < $2::date + 1
    left join stages s on s.id=c.stage_id left join settlements st on st.custody_id=c.id and st.status <> 'reversed'
    where u.role_code='worker' group by u.id, d.name order by completed desc`, [req.query.from || '2000-01-01', req.query.to || '2999-12-31']));
});

export default r;
