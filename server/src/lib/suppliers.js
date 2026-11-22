// موردو الخامات: رصيد الذهب الصافي المقدم لكل مورد
import { bad, notFound } from './http.js';

export const supplierBalanceSql = `coalesce((select sum(case when e.kind in ('findings_in','gold_in') then -e.pure else e.pure end) from gold_supplier_entries e where e.supplier_id=s.id), 0)`;

export async function listSuppliers(db, { all = false } = {}) {
  return (await db.query(`select s.*, ${supplierBalanceSql}::numeric(16,4)::text as balance,
      coalesce((select sum(e.pure) from gold_supplier_entries e where e.supplier_id=s.id and e.kind not in ('findings_in','gold_in')), 0)::numeric(16,4)::text as gold_out,
      coalesce((select sum(e.pure) from gold_supplier_entries e where e.supplier_id=s.id and e.kind in ('findings_in','gold_in')), 0)::numeric(16,4)::text as received
    from gold_suppliers s where $1 or s.active order by s.id`, [all])).rows;
}

export async function supplierEntry(db, { supplierId, kind, weight, karat, materialId = null, findingId = null, ledgerId = null, note = null, userId }) {
  const s = (await db.query('select id, name, active from gold_suppliers where id=$1 for update', [supplierId])).rows[0];
  if (!s) throw notFound('المورد غير موجود');
  if (!s.active) throw bad('المورد موقوف');
  const pure = (Number(weight) * Number(karat || 24) / 24).toFixed(4);
  return (await db.query(`insert into gold_supplier_entries(entry_no, supplier_id, kind, weight, karat, pure, material_id, finding_id, ledger_id, note, created_by)
    values (next_doc_no('GSE'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [supplierId, kind, weight, karat || 24, pure, materialId, findingId, ledgerId, note, userId])).rows[0];
}
