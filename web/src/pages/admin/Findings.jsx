import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, fmtDT } from '../../format.js';
import { Badge, Btn, Field, Input, Loader, Modal, Page, Select, Table, Textarea, WeightInput, useAction, useFetch } from '../../ui.jsx';

const MOVE = { in: 'إضافة رصيد', issue: 'صرف لعامل', return: 'إرجاع من عامل', used: 'أُضيفت على طلب', out: 'صرف', reversal: 'تصحيح' };
const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, '');

/** خامات المصنع: سلاسل، أقفال، كور سحب… تُصرف للعمال كعهدة عامة وتُضاف على الطلبات عند الاستلام */
export default function Findings() {
  const { can, lookups } = useAuth();
  const { data, reload } = useFetch('/findings', { live: ['custodies'] });
  const [f, setF] = useState(null); // إضافة/تعديل خامة
  const [stock, setStock] = useState(null); // إضافة رصيد
  const [issue, setIssue] = useState(null); // صرف لعامل
  const [moves, setMoves] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const list = data.findings;
  const mats = (lookups?.materials || []).filter((m) => m.karat);
  const manage = can('findings.manage');
  const active = list.filter((x) => x.active);
  const sumW = active.reduce((a, x) => a + Number(x.stock_weight), 0);
  const sumWk = active.reduce((a, x) => a + Number(x.at_workers), 0);

  const save = () => run(async () => { if (f.id) await api.put(`/findings/${f.id}`, f); else await api.post('/findings', f); setF(null); reload(); }, 'تم الحفظ');
  const addStock = () => run(async () => { await api.post(`/findings/${stock.f.id}/in`, stock); setStock(null); reload(); }, 'تمت إضافة الرصيد');
  const doIssue = () => run(async () => {
    const items = issue.items.filter((i) => i.finding_id && Number(i.weight) > 0);
    const r = await api.post('/findings/issue', { worker_id: issue.worker_id, items });
    setIssue(null); reload(); return r;
  }, 'تم صرف الخامات للعامل — بانتظار قبوله');
  const updItem = (i, k, val) => setIssue((s) => {
    const items = s.items.map((x, j) => {
      if (j !== i) return x;
      const n = { ...x, [k]: val };
      const fd = list.find((y) => String(y.id) === String(n.finding_id));
      // الوزن يُقترح من عدد القطع × وزن القطعة
      if ((k === 'pieces' || k === 'finding_id') && fd?.unit_weight && n.pieces) n.weight = String(+(Number(fd.unit_weight) * Number(n.pieces)).toFixed(3));
      return n;
    });
    return { ...s, items };
  });

  return (
    <Page title="خامات المصنع" inline actions={<div className="page-tabs-row">
      <span className="small text-body-secondary">بالمخزون <b dir="ltr">{fmtW(sumW)}</b> جم · لدى العمال <b dir="ltr">{fmtW(sumWk)}</b> جم</span>
      <span className="d-flex gap-2">
        {can('custody.issue') && <Btn kind="ghost" onClick={() => setIssue({ worker_id: '', items: [{ finding_id: '', pieces: '', weight: '' }] })}>صرف لعامل</Btn>}
        {manage && <Btn onClick={() => setF({ name: '', category: data.categories[0], material_id: mats[0]?.id || '', unit_weight: '', sku: '', notes: '' })}>خامة جديدة</Btn>}
      </span>
    </div>}>
      <div className="small text-body-secondary mb-2">السلاسل والأقفال وكور السحب… تُصرف للعامل كعهدة (تصبح ذهباً لديه)، وعند استلام الطلب يسجّل المشرف ما أضافه العامل منها فيُخصم من عهدته ويدخل في وزن الطلب.</div>
      <div className="card"><Table rows={list} empty="لا توجد خامات — أضف أول خامة" rowClass={(x) => (x.active ? '' : 'row-warn')} columns={[
        ['الخامة', (x) => <><b>{x.name}</b>{x.sku && <span className="small text-body-secondary" dir="ltr"> {x.sku}</span>}</>],
        ['النوع', 'category'], ['العيار', (x) => x.material_name],
        ['وزن القطعة', (x) => (x.unit_weight ? <span className="n">{fmtW(x.unit_weight)}</span> : '—')],
        ['بالمخزون', (x) => <span><b className="n">{fmtW(x.stock_weight)}</b> جم <span className="small text-body-secondary">· {x.stock_pieces} قطعة</span></span>],
        ['لدى العمال', (x) => (Number(x.at_workers) ? <span className="n">{fmtW(x.at_workers)}</span> : '—')],
        ['', (x) => <span className="d-flex gap-2 justify-content-end flex-wrap">
          {!x.active && <Badge>موقوفة</Badge>}
          {manage && x.active && <Btn size="sm" kind="ghost" onClick={() => setStock({ f: x, pieces: '', weight: '', source: 'external', note: '' })}>+ رصيد</Btn>}
          <Btn size="sm" kind="ghost" onClick={() => run(async () => setMoves({ f: x, rows: await api.get(`/findings/${x.id}/moves`) }))}>الحركات</Btn>
          {manage && <Btn size="sm" kind="ghost" onClick={() => setF({ ...x, unit_weight: x.unit_weight ? String(+x.unit_weight) : '' })}>تعديل</Btn>}
        </span>],
      ]} /></div>

      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'تعديل خامة' : 'خامة جديدة'}>
        {f && <>
          <div className="grid g2">
            <Field label="اسم الخامة *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="سلسال كارتير 45 سم" /></Field>
            <Field label="النوع"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={data.categories.map((c) => [c, c])} /></Field>
            <Field label="العيار *"><Select value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })} options={mats.map((m) => [m.id, m.name])} /></Field>
            <Field label="وزن القطعة (جم)" hint="اختياري — يُقترح منه الوزن عند الصرف والإضافة"><WeightInput value={f.unit_weight} onChange={(v) => setF({ ...f, unit_weight: v })} /></Field>
            <Field label="الرمز"><Input dir="ltr" value={f.sku || ''} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          </div>
          <Field label="ملاحظات"><Textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {f.id && <label className="check mt"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> فعّالة</label>}
          <div className="hrow end mt"><Btn loading={busy} disabled={!f.name || !f.material_id} onClick={save}>حفظ</Btn></div>
        </>}
      </Modal>

      <Modal open={!!stock} onClose={() => setStock(null)} title={`إضافة رصيد — ${stock?.f.name || ''}`}>
        {stock && <>
          <div className="grid g2">
            <Field label="عدد القطع"><Input inputMode="numeric" value={stock.pieces} onChange={(e) => { const p = num(e.target.value); setStock({ ...stock, pieces: p, weight: stock.f.unit_weight && p ? String(+(Number(stock.f.unit_weight) * Number(p)).toFixed(3)) : stock.weight }); }} /></Field>
            <Field label="الوزن الإجمالي (جم) *"><WeightInput big value={stock.weight} onChange={(v) => setStock({ ...stock, weight: v })} /></Field>
          </div>
          <Field label="المصدر"><div className="chips">{[['external', 'شراء / استلام من خارج المصنع'], ['vault', 'تصنيع من ذهب الخزنة (يُخصم من الخزنة)']].map(([k, l]) => <button key={k} type="button" className={`chip ${stock.source === k ? 'on' : ''}`} onClick={() => setStock({ ...stock, source: k })}>{l}</button>)}</div></Field>
          <Field label="البيان"><Input value={stock.note} onChange={(e) => setStock({ ...stock, note: e.target.value })} placeholder="رقم الفاتورة / المورد" /></Field>
          <div className="hrow end mt"><Btn loading={busy} disabled={!(Number(stock.weight) > 0)} onClick={addStock}>إضافة</Btn></div>
        </>}
      </Modal>

      <Modal open={!!issue} onClose={() => setIssue(null)} title="صرف خامات لعامل (عهدة عامة)" wide>
        {issue && <>
          <Field label="العامل *"><Select value={issue.worker_id} onChange={(e) => setIssue({ ...issue, worker_id: e.target.value })} placeholder="اختر العامل"
            options={(lookups?.workers || []).map((w) => [w.id, `${w.kind === 'machine' ? '⚙ ' : ''}${w.full_name}${w.employee_no ? ` (${w.employee_no})` : ''}`])} /></Field>
          <div className="d-grid gap-2 mt-2">
            {issue.items.map((it, i) => {
              const fd = list.find((y) => String(y.id) === String(it.finding_id));
              return (
                <div key={i} className="grid g3 align-items-end border rounded-3 p-2">
                  <Field label="الخامة"><Select value={it.finding_id} onChange={(e) => updItem(i, 'finding_id', e.target.value)} placeholder="اختر"
                    options={active.filter((x) => Number(x.stock_weight) > 0).map((x) => [x.id, `${x.name} — ${x.material_name} (متوفر ${fmtW(x.stock_weight)} جم / ${x.stock_pieces} ق)`])} /></Field>
                  <Field label="عدد القطع"><Input inputMode="numeric" value={it.pieces} onChange={(e) => updItem(i, 'pieces', num(e.target.value))} /></Field>
                  <Field label={`الوزن (جم)${fd ? ` — حد ${fmtW(fd.stock_weight)}` : ''}`}><WeightInput value={it.weight} onChange={(v) => updItem(i, 'weight', v)} /></Field>
                </div>
              );
            })}
            <div><Btn size="sm" kind="ghost" onClick={() => setIssue({ ...issue, items: [...issue.items, { finding_id: '', pieces: '', weight: '' }] })}>+ خامة أخرى</Btn></div>
          </div>
          <div className="alert alert-light border small mt-2 mb-2">تخرج الخامات من المخزون وتصبح ذهباً في عهدة العامل. عند استلام أي طلب منه يسجّل المشرف الخامة المضافة فيُخصم وزنها من هذه العهدة، وما لم يُستخدم يُستلم من شاشة الاستلام ويعود لمخزون الخامات.</div>
          <div className="hrow end"><Btn loading={busy} disabled={!issue.worker_id || !issue.items.some((i) => i.finding_id && Number(i.weight) > 0)} onClick={doIssue}>صرف للعامل</Btn></div>
        </>}
      </Modal>

      <Modal open={!!moves} onClose={() => setMoves(null)} title={`حركات ${moves?.f.name || ''}`} wide>
        {moves && <Table rows={moves.rows} empty="لا توجد حركات" columns={[
          ['التاريخ', (m) => <span className="small text-nowrap">{fmtDT(m.created_at)}</span>], ['الحركة', (m) => MOVE[m.kind] || m.kind],
          ['القطع', (m) => (m.pieces ? <span dir="ltr">{m.pieces > 0 ? `+${m.pieces}` : m.pieces}</span> : '—')], ['الوزن', (m) => <span className="n">{fmtW(m.weight)}</span>],
          ['الطلب / العهدة', (m) => m.order_no || m.custody_no || '—'], ['البيان', (m) => <span className="small">{m.note}</span>], ['بواسطة', 'user_name'],
        ]} />}
      </Modal>
    </Page>
  );
}
