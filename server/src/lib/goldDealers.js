// جمل الصافي: رصيد ذهب المصنع (صافي 24) لدى تجار الذهب الصافي
import { bad, notFound } from './http.js';

export const dealerBalanceSql = `coalesce((select sum(case when e.kind='deposit' then e.weight else -e.weight end) from gold_dealer_entries e where e.dealer_id=d.id and not e.reversed), 0)`;

export async function listDealers(db, { all = false } = {}) {
  return (await db.query(`select d.*, ${dealerBalanceSql}::text as balance,
      (select max(e.created_at) from gold_dealer_entries e where e.dealer_id=d.id) as last_at
    from gold_dealers d where $1 or d.active order by d.id`, [all])).rows;
}

export async function dealerByMethod(db, method) {
  return (await db.query('select * from gold_dealers where code=$1', [method])).rows[0] || null;
}

/** قيد على رصيد الجمل. السحب يتطلب رصيداً كافياً */
export async function dealerEntry(db, { dealerId, kind, weight, customerId = null, customerEntryId = null, ledgerId = null, note = null, userId }) {
  const d = (await db.query(`select d.id, d.name, ${dealerBalanceSql} as balance from gold_dealers d where d.id=$1 for update`, [dealerId])).rows[0];
  if (!d) throw notFound('الجمل غير موجود');
  if (kind === 'withdraw' && Number(d.balance) + 1e-6 < Number(weight)) throw bad(`رصيد الذهب لدى ${d.name} ${Number(d.balance).toFixed(3)} جم فقط`);
  return (await db.query(`insert into gold_dealer_entries(entry_no, dealer_id, kind, weight, customer_id, customer_entry_id, ledger_id, note, created_by)
    values (next_doc_no('GDE'),$1,$2,$3,$4,$5,$6,$7,$8) returning *`, [dealerId, kind, weight, customerId, customerEntryId, ledgerId, note, userId])).rows[0];
}
