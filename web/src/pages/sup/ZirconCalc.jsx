import { useEffect, useState } from 'react';
import { fmtW } from '../../format.js';
import { Btn, Card, Input, Page, askConfirm } from '../../ui.jsx';

// حاسبة الزركون: وزن الزركون = (الوزن القائم − وزن الكيس) × عدد القطع
const n = (v) => Number(String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫,]/g, '.')) || 0;
const BAG = 0.383; // وزن الكيس ثابت
const KEY = 'zircon-calc-v1';
const row = () => ({ gross: '', count: '' });
const fresh = () => Array.from({ length: 7 }, () => row());
const load = () => { try { const r = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(r) && r.length ? r : fresh(); } catch { return fresh(); } };
const filled = (r) => n(r.gross) > 0 && n(r.count) > 0;
const zircon = (r) => (n(r.gross) - BAG) * n(r.count);
const dec = (v) => v.replace(/[^\d٠-٩.,٫]/g, '');

export default function ZirconCalc() {
  const [rows, setRows] = useState(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* تخزين غير متاح */ } }, [rows]);
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const total = rows.filter(filled).reduce((s, r) => s + zircon(r), 0);
  const count = rows.filter(filled).reduce((s, r) => s + n(r.count), 0);
  const clear = async () => { if (await askConfirm('مسح كل الصفوف والبدء من جديد؟')) setRows(fresh()); };
  return (
    <Page title="حاسبة الزركون" subtitle="وزن الزركون = (الوزن القائم − وزن الكيس 0.383) × عدد القطع"
      actions={<div className="hrow gap no-print"><Btn kind="ghost" onClick={() => window.print()}>طباعة</Btn><Btn kind="ghost" onClick={clear}>مسح الكل</Btn></div>}>
      <Card pad={false}>
        <div className="table-responsive">
          <table className="table zc-table mb-0">
            <thead><tr><th style={{ width: 44 }}>م</th><th>الوزن القائم</th><th>عدد القطع</th><th>وزن الكيس</th><th>وزن الزركون</th><th className="no-print" style={{ width: 44 }} /></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const z = zircon(r);
                return (
                  <tr key={i}>
                    <td className="n muted">{i + 1}</td>
                    <td><Input inputMode="decimal" dir="ltr" value={r.gross} onChange={(e) => set(i, 'gross', dec(e.target.value))} placeholder="0.000" /></td>
                    <td><Input inputMode="numeric" dir="ltr" value={r.count} onChange={(e) => set(i, 'count', e.target.value.replace(/[^\d٠-٩]/g, ''))} placeholder="0" /></td>
                    <td className="n muted" dir="ltr">{BAG.toFixed(3)}</td>
                    <td className={`n zc-out ${filled(r) && z < 0 ? 'text-danger' : ''}`} dir="ltr">{filled(r) ? fmtW(z) : '—'}</td>
                    <td className="no-print">{rows.length > 1 && <Btn size="sm" kind="ghost" title="حذف الصف" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Btn>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3 no-print"><Btn kind="ghost" onClick={() => setRows([...rows, row()])}>+ إضافة صف</Btn></div>
        <div className="zc-total">
          <span>إجمالي وزن الزركون{count ? <small> · {count} قطعة</small> : null}</span>
          <b dir="ltr">{fmtW(total)} <small>جم</small></b>
        </div>
      </Card>
    </Page>
  );
}
