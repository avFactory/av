import { Link } from 'react-router-dom';
import { fileUrl } from '../api.js';

const m = (v) => (v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const g = (v) => (v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '');
const bal = (v, f) => { const n = Number(v || 0); if (!n) return <span className="text-body-secondary">0</span>; return <span className={n > 0 ? 'st-dr' : 'st-cr'}>{f(Math.abs(n))} {n > 0 ? 'مدين' : 'دائن'}</span>; };
export const fmtBal = bal;
export const money2 = m;
export const gold3 = g;

/** ملخص الرصيد: المبالغ والذهب (صافي 24 وحسب العيار) */
export function StatementSummary({ st }) {
  const ks = Object.entries(st.balance.by_karat || {}).filter(([, v]) => Number(v));
  return (
    <div className="st-sum">
      <div><span>رصيد المبالغ</span><b>{bal(st.balance.money, m)} <small>ر.س</small></b></div>
      <div><span>رصيد الذهب (صافي عيار 24)</span><b>{bal(st.balance.pure, g)} <small>جم</small></b></div>
      <div><span>رصيد الذهب حسب العيار</span><b className="st-k">{ks.length ? ks.map(([k, v]) => <span key={k}>عيار {k}: {bal(v, g)}</span>) : <span className="text-body-secondary">لا يوجد</span>}</b></div>
      <div><span>أجور / ألماس في الفترة</span><b className="st-k"><span>أجور {m(st.totals.labor) || 0}</span><span>ألماس {m(st.totals.stones) || 0}</span></b></div>
    </div>
  );
}

/** جدول كشف الحساب: مدين/دائن ورصيد للمبالغ والذهب */
export default function StatementTable({ st, staff }) {
  const link = (r) => {
    if (r.link?.kind === 'invoice') return <Link to={staff ? `/admin/invoices/${r.link.id}` : `/store/invoices/${r.link.id}`} dir="ltr">{r.ref}</Link>;
    if (r.link?.kind === 'order') return <Link to={staff ? `/orders/${r.link.id}` : `/store/orders/${r.link.id}`} dir="ltr">{r.ref}</Link>;
    return <span dir="ltr">{r.ref}</span>;
  };
  return (
    <div className="table-responsive st-wrap">
      <table className="table table-sm st-table mb-0">
        <thead>
          <tr><th rowSpan={2}>التاريخ</th><th rowSpan={2}>البيان</th><th rowSpan={2}>المرجع</th><th colSpan={3} className="st-g1">المبالغ (ر.س)</th><th colSpan={4} className="st-g2">الذهب (جم)</th></tr>
          <tr><th className="st-g1">مدين</th><th className="st-g1">دائن</th><th className="st-g1">الرصيد</th><th className="st-g2">مدين</th><th className="st-g2">دائن</th><th className="st-g2">العيار</th><th className="st-g2">الرصيد (صافي 24)</th></tr>
        </thead>
        <tbody>
          <tr className="st-open"><td /><td><b>رصيد سابق</b></td><td /><td /><td /><td>{bal(st.opening.money, m)}</td><td /><td /><td /><td>{bal(st.opening.pure, g)}</td></tr>
          {st.rows.map((r, i) => (
            <tr key={i} className={`st-${r.type}`}>
              <td className="text-nowrap">{r.date}</td>
              <td>{r.description}{r.document && <> · <a href={fileUrl(r.document)} target="_blank" rel="noreferrer">المستند</a></>}</td>
              <td className="text-nowrap">{link(r)}</td>
              <td className="n">{m(r.money_debit)}</td><td className="n">{m(r.money_credit)}</td><td className="n">{bal(r.money_balance, m)}</td>
              <td className="n">{g(r.gold_debit)}</td><td className="n">{g(r.gold_credit)}</td><td>{r.gold_debit || r.gold_credit ? r.karat : ''}</td><td className="n">{bal(r.pure_balance, g)}</td>
            </tr>
          ))}
          {!st.rows.length && <tr><td colSpan={10} className="text-center text-body-secondary py-4">لا توجد حركات في هذه الفترة</td></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan={3}><b>إجمالي الفترة</b></td><td className="n"><b>{m(st.totals.money_debit)}</b></td><td className="n"><b>{m(st.totals.money_credit)}</b></td><td className="n"><b>{bal(st.closing.money, m)}</b></td>
            <td className="n"><b>{g(st.totals.gold_debit)}</b></td><td className="n"><b>{g(st.totals.gold_credit)}</b></td><td /><td className="n"><b>{bal(st.closing.pure, g)}</b></td></tr>
        </tfoot>
      </table>
    </div>
  );
}

const SUB_ST = { pending: ['بانتظار المراجعة', 'warn'], approved: ['معتمد', 'ok'], rejected: ['مرفوض', 'bad'] };
export { SUB_ST };
