// كشف حساب العامل/الماكينة بالذهب: كل حركة دخلت حسابه (مدين: مسلَّم له منا أو محوّل له) أو خرجت منه
// (دائن: مستلم منه لنا أو محوّل لعامل آخر أو عجز مثبت)، مع الرصيد بعد كل حركة لكل عيار وبالصافي عيار 24.
const r4 = (x) => Math.round(Number(x) * 10000) / 10000;

export async function workerStatement(db, workerId, { from = null, to = null, materialId = null } = {}, labels = {}) {
  const w = (await db.query('select id, full_name, employee_no, kind, specialty from users where id=$1', [workerId])).rows[0];
  if (!w) return null;
  const mine = `((g.to_type='worker' and g.to_ref=$1) or (g.from_type='worker' and g.from_ref=$1)) and ($4::int is null or g.material_id=$4)`;
  const dir = `case when g.to_type='worker' and g.to_ref=$1 then 1 else -1 end`;
  // الرصيد الافتتاحي قبل بداية الفترة (لكل عيار)
  const opening = from ? (await db.query(`select g.material_id, m.name, m.karat, sum(${dir} * g.weight)::numeric(16,4)::text as w
      from gold_ledger g join materials m on m.id=g.material_id where ${mine} and g.created_at < ($2::date)::timestamptz and ($3::date is null or true) group by 1,2,3`, [workerId, from, null, materialId])).rows : [];
  const rows = (await db.query(`select g.id, g.movement_no, g.kind, g.weight::text, g.created_at, g.reason, ${dir} as dir, g.material_id, m.name as material_name, m.karat,
      o.order_no, coalesce(o.title, '') as title, s.name as stage_name, rv.kind as reverses_kind,
      exists (select 1 from gold_ledger x where x.reverses_id=g.id) as reversed,
      -- الطرف الآخر: عامل آخر في التحويل، أو الطلب/الخزنة
      case when g.to_type='worker' and g.to_ref=$1 then g.from_type else g.to_type end as other_type
    from gold_ledger g join materials m on m.id=g.material_id left join orders o on o.id=g.order_id left join stages s on s.id=g.stage_id
    left join gold_ledger rv on rv.id=g.reverses_id
    where ${mine} and ($2::date is null or g.created_at >= ($2::date)::timestamptz) and ($3::date is null or g.created_at < ($3::date + 1)::timestamptz)
    order by g.created_at, g.id`, [workerId, from, to, materialId])).rows;
  // تحويلات بين العمال: الطرف الآخر من سجل التحويلات
  const trs = (await db.query(`select t.custody_id, t.new_custody_id, t.from_worker, t.to_worker, uf.full_name as from_name, ut.full_name as to_name, c1.order_id as from_order, t.decided_at
    from custody_transfers t join users uf on uf.id=t.from_worker join users ut on ut.id=t.to_worker left join custodies c1 on c1.id=t.custody_id
    where t.status='accepted' and (t.from_worker=$1 or t.to_worker=$1)`, [workerId])).rows;
  const bal = new Map(opening.map((o) => [o.material_id, Number(o.w)]));
  let pure = opening.reduce((a, o) => a + Number(o.w) * o.karat / 24, 0);
  const out = [];
  let debit = 0, credit = 0, debitPure = 0, creditPure = 0;
  for (const g of rows) {
    const wgt = Number(g.weight);
    const b = r4((bal.get(g.material_id) || 0) + g.dir * wgt);
    bal.set(g.material_id, b);
    pure = r4(pure + g.dir * wgt * g.karat / 24);
    if (g.dir > 0) { debit += wgt; debitPure += wgt * g.karat / 24; } else { credit += wgt; creditPure += wgt * g.karat / 24; }
    const label = g.kind === 'reversal' ? `تصحيح: إلغاء ${labels[g.reverses_kind] || g.reverses_kind || ''}` : labels[g.kind] || g.kind;
    // هل الحركة جزء من تحويل بين عاملين؟ (نفس الطلب وفي وقت القبول)
    const tr = trs.find((t) => Math.abs(new Date(t.decided_at) - new Date(g.created_at)) < 120000
      && ((g.dir > 0 && t.to_worker === workerId) || (g.dir < 0 && t.from_worker === workerId)));
    const party = tr ? (g.dir > 0 ? `محوّل من ${tr.from_name}` : `محوّل إلى ${tr.to_name}`)
      : g.dir > 0 ? (g.other_type === 'vault' ? 'من الخزنة' : g.other_type === 'order' ? 'من ذهب الطلب' : g.other_type === 'findings' ? 'من الخامات' : g.other_type === 'variance' ? 'فروقات' : '')
        : ({ vault: 'إلى الخزنة', order: 'إلى ذهب الطلب', findings: 'إلى الخامات', scrap: 'بقايا', loss_normal: 'عجز طبيعي', loss_abnormal: 'عجز غير طبيعي', loss_suspense: 'عجز تحت المراجعة' }[g.other_type] || '');
    out.push({ ...g, label, party, debit: g.dir > 0 ? g.weight : null, credit: g.dir < 0 ? g.weight : null, balance: b.toFixed(4), balance_pure: pure.toFixed(4) });
  }
  const balances = [...bal].filter(([, v]) => Math.abs(v) > 1e-9);
  const mats = new Map(rows.map((g) => [g.material_id, { name: g.material_name, karat: g.karat }]).concat(opening.map((o) => [o.material_id, { name: o.name, karat: o.karat }])));
  return {
    worker: w, from, to, rows: out,
    opening: opening.map((o) => ({ material_id: o.material_id, name: o.name, karat: o.karat, weight: o.w })),
    opening_pure: r4(opening.reduce((a, o) => a + Number(o.w) * o.karat / 24, 0)).toFixed(4),
    totals: { debit: r4(debit).toFixed(4), credit: r4(credit).toFixed(4), debit_pure: r4(debitPure).toFixed(4), credit_pure: r4(creditPure).toFixed(4),
      balances: balances.map(([id, v]) => ({ material_id: id, name: mats.get(id)?.name, karat: mats.get(id)?.karat, weight: v.toFixed(4) })), balance_pure: pure.toFixed(4) },
  };
}
