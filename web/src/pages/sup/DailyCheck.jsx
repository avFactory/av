import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { fmtW, fmtDT } from '../../format.js';
import { Btn, Card, Field, Input, Loader, Page, Table, WeightInput, useAction, useFetch, askConfirm } from '../../ui.jsx';

const n = (v) => Number(String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g, '')) || 0;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const blank = (d) => ({ gross: '', bags: '', bag_weight: d?.bag_weight || '0.383', spoons: '', spoon_weight: d?.spoon_weight || '0.750', boxes_weight: '', other_weight: '', other_note: '', note: '' });

/** المطابقة اليومية (تحت الصب): الوزن القائم − (الأكياس × وزن الكيس) − (المعالق × وزن المعلق) − العلب − وزن آخر = الوزن الباقي */
export default function DailyCheck() {
  const [date, setDate] = useState(today());
  const { data, reload } = useFetch(`/casting/daily?date=${date}`, { deps: [date] });
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data && !f) setF(blank(data.defaults)); }, [data, f]);
  if (!data || !f) return <Loader />;
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const bagsW = n(f.bags) * n(f.bag_weight);
  const spoonsW = n(f.spoons) * n(f.spoon_weight);
  const deduct = bagsW + spoonsW + n(f.boxes_weight) + n(f.other_weight);
  const net = n(f.gross) - deduct;
  const save = () => run(async () => {
    await api.post('/casting/daily', { ...f, check_date: date });
    setF(blank({ bag_weight: f.bag_weight, spoon_weight: f.spoon_weight })); reload();
  }, 'تم حفظ المطابقة');
  const del = async (r) => { if (await askConfirm(`حذف سطر المطابقة (قائم ${fmtW(r.gross)} جم)؟`, { danger: true })) run(async () => { await api.del(`/casting/daily/${r.id}`); reload(); }, 'تم الحذف'); };
  const tot = (k) => data.rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  return (
    <Page title="مطابقة يومية" subtitle="الوزن القائم بعد خصم الأكياس والمعالق والعلب" actions={<Input type="date" value={date} max={today()} onChange={(e) => { setDate(e.target.value || today()); }} style={{ maxWidth: 180 }} />}>
      <div className="daily-check">
        <Card title="إضافة مطابقة">
          <div className="grid g2">
            <Field label="الوزن القائم (جم) *"><WeightInput big value={f.gross} onChange={set('gross')} autoFocus /></Field>
            <div />
            <Field label="عدد الأكياس"><Input inputMode="numeric" value={f.bags} onChange={(e) => setF({ ...f, bags: e.target.value.replace(/[^\d٠-٩]/g, '') })} /></Field>
            <Field label="وزن الكيس (جم)" hint="يمكن تعديله"><WeightInput value={f.bag_weight} onChange={set('bag_weight')} /></Field>
            <Field label="عدد المعالق"><Input inputMode="numeric" value={f.spoons} onChange={(e) => setF({ ...f, spoons: e.target.value.replace(/[^\d٠-٩]/g, '') })} /></Field>
            <Field label="وزن المعلق (جم)" hint="يمكن تعديله"><WeightInput value={f.spoon_weight} onChange={set('spoon_weight')} /></Field>
            <Field label="وزن العلب (جم)"><WeightInput value={f.boxes_weight} onChange={set('boxes_weight')} /></Field>
            <div />
            <Field label="وزن آخر (جم)"><WeightInput value={f.other_weight} onChange={set('other_weight')} /></Field>
            <Field label="بيان الوزن الآخر"><Input value={f.other_note} onChange={set('other_note')} placeholder="مثلاً: ورق، شريط…" /></Field>
          </div>
          <Field label="ملاحظة" className="mt"><Input value={f.note} onChange={set('note')} /></Field>
        </Card>
        <Card title="الحساب">
          <div className="dc-calc">
            <div><span>الوزن القائم</span><b dir="ltr">{fmtW(n(f.gross))}</b></div>
            <div className="minus"><span>الأكياس ({n(f.bags)} × {n(f.bag_weight)})</span><b dir="ltr">− {fmtW(bagsW)}</b></div>
            <div className="minus"><span>المعالق ({n(f.spoons)} × {n(f.spoon_weight)})</span><b dir="ltr">− {fmtW(spoonsW)}</b></div>
            <div className="minus"><span>العلب</span><b dir="ltr">− {fmtW(n(f.boxes_weight))}</b></div>
            <div className="minus"><span>وزن آخر{f.other_note ? ` (${f.other_note})` : ''}</span><b dir="ltr">− {fmtW(n(f.other_weight))}</b></div>
            <div className={`dc-net ${net < 0 ? 'bad' : ''}`}><span>الوزن الباقي</span><b dir="ltr">{fmtW(net)} <small>جم</small></b></div>
          </div>
          {net < 0 && <div className="small text-danger mt-2">الخصومات أكبر من الوزن القائم — راجع الأرقام</div>}
          <Btn size="lg" className="w-100 mt-3" loading={busy} disabled={!(n(f.gross) > 0) || net < 0} onClick={save}>حفظ المطابقة</Btn>
        </Card>
      </div>
      <Card className="mt" pad={false} title={`مطابقات ${date}${data.rows.length ? ` (${data.rows.length})` : ''}`}>
        <Table rows={data.rows} empty="لا توجد مطابقات في هذا اليوم" columns={[
          ['الوقت', (r) => fmtDT(r.created_at)],
          ['القائم', (r) => <span className="n">{fmtW(r.gross)}</span>],
          ['الأكياس', (r) => (r.bags ? <span className="n">{r.bags} × {Number(r.bag_weight)}</span> : '—')],
          ['المعالق', (r) => (r.spoons ? <span className="n">{r.spoons} × {Number(r.spoon_weight)}</span> : '—')],
          ['العلب', (r) => (Number(r.boxes_weight) ? <span className="n">{fmtW(r.boxes_weight)}</span> : '—')],
          ['آخر', (r) => (Number(r.other_weight) ? <span className="n">{fmtW(r.other_weight)}{r.other_note ? ` (${r.other_note})` : ''}</span> : '—')],
          ['الباقي', (r) => <b className="n">{fmtW(r.net)}</b>],
          ['بواسطة', (r) => <span className="small">{r.created_by_name}{r.note ? ` · ${r.note}` : ''}</span>],
          ['', (r) => <Btn size="sm" kind="ghost" onClick={() => del(r)}>حذف</Btn>],
        ]} />
        {data.rows.length > 1 && <div className="dc-total"><span>المجموع</span><span>القائم <b dir="ltr">{fmtW(tot('gross'))}</b></span><span>الباقي <b dir="ltr">{fmtW(tot('net'))}</b> جم</span></div>}
      </Card>
      {data.days.length > 0 && (
        <Card className="mt" title="آخر 30 يوماً">
          <div className="chips">{data.days.map((d) => <button key={d.date} type="button" className={`chip ${d.date === date ? 'on' : ''}`} onClick={() => setDate(d.date)}>{d.date} · {d.n} · الباقي <b dir="ltr">{fmtW(d.net)}</b></button>)}</div>
        </Card>
      )}
    </Page>
  );
}
