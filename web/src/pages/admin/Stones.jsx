import { useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtDT, fmtMoney } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, useAction, useFetch, Textarea } from '../../ui.jsx';

const MK = { in: 'إضافة', issue: 'تسليم لعامل', return: 'مرتجع من عامل', used: 'مستخدم (مركب)', lost: 'مفقود', adjust_in: 'تسوية زيادة', adjust_out: 'تسوية نقص', reversal: 'عكس حركة' };

export default function Stones() {
  const { can, lookups } = useAuth();
  const { data, reload } = useFetch('/stones');
  const { data: orders } = useFetch('/orders?status=in_production');
  const [f, setF] = useState(null);
  const [mv, setMv] = useState(null);
  const [lot, setLot] = useState(null);
  const [run, busy] = useAction();
  const openLot = (l) => run(async () => setLot(await api.get(`/stones/${l.id}`)));
  const create = () => run(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (k !== 'files' && v != null) fd.append(k, v);
    for (const x of f.files || []) fd.append('files', x);
    await api.post('/stones', fd); setF(null); reload();
  }, 'تمت إضافة الدفعة');
  if (!data) return <Loader />;
  return (
    <Page title="إدارة الألماس والأحجار" subtitle="الوزن بالقيراط - كل حركة مرتبطة بطلب وعامل ومرحلة" actions={can('stones.manage') && <Btn onClick={() => setF({ stone_type: 'ألماس' })}>دفعة أحجار جديدة</Btn>}>
      <div className="card"><Table rows={data} onRow={openLot} columns={[
        ['', (l) => (l.photo ? <img src={fileUrl(l.photo)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} /> : null)],
        ['الدفعة', 'lot_no'], ['النوع', (l) => <b>{l.stone_type}</b>], ['اللون', 'color'], ['النقاء', 'clarity'], ['الشكل', 'cut_shape'], ['الشهادة', 'certificate_no'],
        ['بالمخزن (قيراط/عدد)', (l) => <span className="n">{l.stock_carats} / {l.stock_count}</span>], ['لدى العمال', (l) => <span className="n">{l.with_workers_carats} / {l.with_workers_count}</span>],
        ['مستخدم', (l) => <span className="n">{l.used_carats} / {l.used_count}</span>], ['مفقود', 'lost_carats'], ['السعر', (l) => (l.unit_price ? fmtMoney(l.unit_price) : '—')],
        ['', (l) => can('stones.manage') && <Btn size="sm" kind="ghost" onClick={(e) => { e.stopPropagation(); setMv({ lot: l, kind: 'issue' }); }}>حركة</Btn>],
      ]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title="دفعة أحجار جديدة" wide>
        {f && <>
          <div className="grid g3">
            {[['stone_type', 'نوع الحجر *'], ['carats', 'الوزن بالقيراط *'], ['count', 'العدد'], ['color', 'اللون'], ['clarity', 'النقاء'], ['cut_shape', 'شكل القطع'], ['certificate_no', 'رقم الشهادة'], ['unit_price', 'السعر (عند الحاجة)']].map(([k, l]) => <Field key={k} label={l}><Input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          </div>
          <Field label="الصور والشهادة"><input type="file" multiple onChange={(e) => setF({ ...f, files: e.target.files })} /></Field>
          <Field label="ملاحظات"><Textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Btn loading={busy} onClick={create}>حفظ</Btn>
        </>}
      </Modal>
      <Modal open={!!mv} onClose={() => setMv(null)} title={`حركة أحجار - ${mv?.lot.lot_no}`}>
        {mv && <>
          <Field label="نوع الحركة"><Select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })} options={Object.entries(MK).filter(([k]) => k !== 'reversal')} /></Field>
          {['issue', 'return', 'used', 'lost'].includes(mv.kind) && <>
            <Field label="الطلب"><Select value={mv.order_id || ''} onChange={(e) => setMv({ ...mv, order_id: e.target.value })} placeholder="—" options={(orders || []).map((o) => [o.id, `${o.order_no} - ${o.title}`])} /></Field>
            <Field label="العامل"><Select value={mv.worker_id || ''} onChange={(e) => setMv({ ...mv, worker_id: e.target.value })} placeholder="—" options={(lookups?.workers || []).map((w) => [w.id, w.full_name])} /></Field>
          </>}
          <div className="grid g2">
            <Field label="قيراط"><Input dir="ltr" inputMode="decimal" value={mv.carats || ''} onChange={(e) => setMv({ ...mv, carats: e.target.value })} /></Field>
            <Field label="العدد"><Input inputMode="numeric" value={mv.count || ''} onChange={(e) => setMv({ ...mv, count: e.target.value })} /></Field>
          </div>
          <Field label="ملاحظة / سبب"><Input value={mv.note || ''} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
          <Btn loading={busy} onClick={() => run(async () => { await api.post(`/stones/${mv.lot.id}/move`, mv); setMv(null); reload(); }, 'تم تسجيل الحركة')}>تسجيل</Btn>
        </>}
      </Modal>
      <Modal open={!!lot} onClose={() => setLot(null)} title={`الدفعة ${lot?.lot.lot_no}`} wide>
        {lot && <>
          <div className="files">{lot.media.map((m) => <a key={m.id} href={fileUrl(m.path)} target="_blank" rel="noreferrer"><img src={fileUrl(m.path)} alt="" /></a>)}</div>
          <Table rows={lot.movements} rowClass={(m) => (m.reversed ? 'row-warn' : '')} columns={[['الحركة', (m) => MK[m.kind]], ['قيراط', 'carats'], ['العدد', 'count'], ['الطلب', 'order_no'], ['العامل', 'worker_name'], ['المرحلة', 'stage_name'], ['ملاحظة', 'note'], ['بواسطة', 'user_name'], ['التاريخ', (m) => fmtDT(m.created_at)],
            ['', (m) => can('stones.manage') && m.kind !== 'reversal' && !m.reversed && <Btn size="sm" kind="ghost" onClick={() => { const reason = window.prompt('سبب العكس'); if (reason) run(async () => { await api.post(`/stones/movements/${m.id}/reverse`, { reason }); setLot(await api.get(`/stones/${lot.lot.id}`)); reload(); }, 'تم'); }}>عكس</Btn>]]} />
        </>}
      </Modal>
    </Page>
  );
}
