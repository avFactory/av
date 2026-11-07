// كشف حساب العميل: حركات المبالغ (ريال) والذهب (جرام بعيار + ما يعادله صافي عيار 24) مع الرصيد التراكمي
const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;
const r4 = (x) => Math.round(Number(x || 0) * 10000) / 10000;

/** كل حركات العميل مرتبة بالتاريخ (المدين يزيد ما على العميل، والدائن ينقصه) */
export async function statementRows(db, customerId) {
  const q = (sql) => db.query(sql, [customerId]).then((r) => r.rows);
  const invoices = await q(`select i.id, i.invoice_no, i.invoice_type, i.issue_date as at, i.total::text, i.vat_amount::text,
      coalesce(sum(l.amount) filter (where l.kind in ('labor','stage_labor')), 0)::text as labor,
      coalesce(sum(l.amount) filter (where l.kind = 'stones'), 0)::text as stones,
      coalesce(sum(l.amount) filter (where l.kind not in ('labor','stage_labor','stones')), 0)::text as other,
      (select x.invoice_no from invoices x where x.id=i.credit_for_id) as credit_for
    from invoices i left join invoice_lines l on l.invoice_id=i.id where i.customer_id=$1 and i.status='issued' group by i.id`);
  const payments = await q(`select id, payment_no, kind, amount::text, method, reference, received_at as at from payments where customer_id=$1`);
  // الذهب: تسليم الطلبات (مباع للعميل) والذهب المستلم منه على الطلبات — بدون الحركات المعكوسة
  const gold = await q(`select g.id, g.kind, g.weight::text, g.created_at as at, m.karat, o.id as order_id, o.order_no
    from gold_ledger g join orders o on o.id=g.order_id join materials m on m.id=g.material_id
    where o.customer_id=$1 and g.kind in ('delivery', 'customer_gold_in') and g.reverses_id is null
      and not exists (select 1 from gold_ledger r where r.reverses_id=g.id)`);
  const entries = await q(`select e.*, e.money_debit::text, e.money_credit::text, e.gold_debit::text, e.gold_credit::text, (e.entry_date::timestamp + interval '12 hours') as at
    from customer_entries e where e.customer_id=$1 and not e.reversed`);

  const PAY = { cash: 'نقداً', transfer: 'تحويل', card: 'بطاقة', cheque: 'شيك', other: 'أخرى' };
  const ENT = { opening: 'رصيد افتتاحي', gold_payment: 'سداد ذهب', money_adjust: 'تسوية مبالغ', gold_adjust: 'تسوية ذهب' };
  const rows = [];
  for (const i of invoices) {
    const credit = i.invoice_type === 'credit_note';
    const parts = [Number(i.labor) && `أجور ${r2(i.labor)}`, Number(i.stones) && `ألماس مخبري ${r2(i.stones)}`, Number(i.other) && `أخرى ${r2(i.other)}`, Number(i.vat_amount) && `ضريبة ${r2(i.vat_amount)}`].filter(Boolean);
    rows.push({ at: i.at, type: credit ? 'credit_note' : 'invoice', ref: i.invoice_no, link: { kind: 'invoice', id: i.id },
      description: `${credit ? `إشعار دائن (مرتجع)${i.credit_for ? ` للفاتورة ${i.credit_for}` : ''}` : 'فاتورة'}${parts.length ? ` — ${parts.join('، ')}` : ''}`,
      labor: credit ? -r2(i.labor) : r2(i.labor), stones: credit ? -r2(i.stones) : r2(i.stones),
      money_debit: credit ? 0 : r2(i.total), money_credit: credit ? r2(i.total) : 0 });
  }
  for (const p of payments) {
    const refund = p.kind === 'refund';
    rows.push({ at: p.at, type: refund ? 'refund' : 'payment', ref: p.payment_no,
      description: `${refund ? 'مبلغ مُعاد للعميل' : p.kind === 'advance' ? 'دفعة مقدمة' : 'مبلغ مستلم'} (${PAY[p.method] || p.method})${p.reference ? ` — ${p.reference}` : ''}`,
      money_debit: refund ? r2(p.amount) : 0, money_credit: refund ? 0 : r2(p.amount) });
  }
  for (const g of gold) {
    const sold = g.kind === 'delivery';
    rows.push({ at: g.at, type: sold ? 'gold_sale' : 'gold_in', ref: g.order_no, link: { kind: 'order', id: g.order_id }, karat: g.karat,
      description: sold ? `ذهب الطلب ${g.order_no} (مسلَّم)` : `ذهب مستلم من العميل على الطلب ${g.order_no}`,
      gold_debit: sold ? r4(g.weight) : 0, gold_credit: sold ? 0 : r4(g.weight) });
  }
  for (const e of entries) {
    rows.push({ at: e.at, type: e.kind, ref: e.entry_no, entry_id: e.id, karat: e.karat, document: e.document_path,
      description: `${ENT[e.kind] || e.kind}${e.description ? ` — ${e.description}` : ''}`,
      money_debit: r2(e.money_debit), money_credit: r2(e.money_credit), gold_debit: r4(e.gold_debit), gold_credit: r4(e.gold_credit) });
  }
  // الرصيد الافتتاحي أولاً في يومه
  rows.sort((a, b) => new Date(a.at) - new Date(b.at) || (a.type === 'opening' ? -1 : b.type === 'opening' ? 1 : 0));
  for (const r of rows) {
    for (const k of ['money_debit', 'money_credit', 'gold_debit', 'gold_credit']) r[k] = r[k] || 0;
    r.pure_debit = r4(r.gold_debit * (r.karat || 24) / 24);
    r.pure_credit = r4(r.gold_credit * (r.karat || 24) / 24);
  }
  return rows;
}

/** كشف الحساب لفترة: رصيد ما قبل الفترة، الحركات بالرصيد التراكمي، والإجماليات والرصيد حسب العيار */
export async function buildStatement(db, customerId, { from, to } = {}) {
  const all = await statementRows(db, customerId);
  const day = (d) => new Date(new Date(d).getTime() + 3 * 3600e3).toISOString().slice(0, 10); // توقيت الرياض
  let money = 0, pure = 0;
  const byKarat = {};
  const opening = { money: 0, pure: 0 };
  const rows = [];
  const tot = { money_debit: 0, money_credit: 0, gold_debit: 0, gold_credit: 0, pure_debit: 0, pure_credit: 0, labor: 0, stones: 0 };
  for (const r of all) {
    money = r2(money + r.money_debit - r.money_credit);
    pure = r4(pure + r.pure_debit - r.pure_credit);
    if (r.karat) byKarat[r.karat] = r4((byKarat[r.karat] || 0) + r.gold_debit - r.gold_credit);
    const d = day(r.at);
    if (from && d < from) { opening.money = money; opening.pure = pure; continue; }
    if (to && d > to) continue;
    rows.push({ ...r, date: d, money_balance: money, pure_balance: pure });
    for (const k of Object.keys(tot)) tot[k] = (k === 'labor' || k === 'stones' ? r2 : r4)(tot[k] + (r[k] || 0));
  }
  const closing = rows.length ? { money: rows[rows.length - 1].money_balance, pure: rows[rows.length - 1].pure_balance } : { ...opening };
  return { rows, opening, closing, totals: tot, balance: { money, pure, by_karat: byKarat } };
}
