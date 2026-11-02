import { useMemo, useState } from 'react';
import { fmtW } from '../format.js';
import { Loader, Search, useFetch, Empty } from '../ui.jsx';

/** اختيار العامل بالبحث السريع (الاسم أو الرقم) - بطاقات كبيرة */
export default function WorkerPicker({ onPick, mode }) {
  const { data } = useFetch('/sup/workers', { live: ['custodies'] });
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim();
    let l = data || [];
    if (s) l = l.filter((w) => w.full_name.includes(s) || (w.employee_no || '').toLowerCase().includes(s.toLowerCase()));
    if (mode === 'receive') l = [...l].sort((a, b) => b.finished_count - a.finished_count || b.open_count - a.open_count);
    return l;
  }, [data, q, mode]);
  if (!data) return <Loader />;
  return (
    <div className="grid">
      <Search value={q} onChange={setQ} placeholder="ابحث باسم العامل أو رقمه…" />
      {!list.length && <Empty>لا يوجد عامل مطابق</Empty>}
      <div className="pick-grid">
        {list.map((w) => (
          <button key={w.id} className="pick" onClick={() => onPick(w)} disabled={mode === 'receive' && !w.open_count}>
            <b>{w.full_name}</b>
            <span className="muted">{w.employee_no || '—'} · {w.specialty || w.department || 'عامل'}</span>
            <span className="small">
              {w.open_count ? <>لديه <b>{w.open_count}</b> طلب · <span dir="ltr">{fmtW(w.open_weight)}</span> جم</> : <span className="muted">لا توجد عهدة</span>}
              {w.finished_count > 0 && <> · <b style={{ color: 'var(--ok)' }}>{w.finished_count} منتهٍ</b></>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
