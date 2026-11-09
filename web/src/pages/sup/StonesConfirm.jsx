import { useState } from 'react';
import { api, fileUrl } from '../../api.js';
import { fmtW, fmtDT } from '../../format.js';
import { Btn, Card, Field, ScanInput, WeightInput, useAction, useToast } from '../../ui.jsx';

const n = (v) => Number(v || 0);

/**
 * تأكيد وزن الحجر والزركون واللؤلؤ المركبة في الطلب (بدون مخزون):
 * الوزن المؤكد يُخصم تلقائياً من وزن الميزان عند استلام الذهب من العامل وعند الوزن النهائي،
 * فلا يُحسب كذهب ولا يؤثر على رصيد الذهب أو العجز.
 */
export default function StonesConfirm() {
  const toast = useToast();
  const [run, busy] = useAction();
  const [o, setO] = useState(null);
  const [f, setF] = useState({});
  const pick = (code) => api.get(`/sup/lookup?code=${encodeURIComponent(code)}`).then((x) => {
    setO(x);
    const val = (set, req) => (set != null ? String(n(set)) : req != null && n(req) > 0 ? String(n(req)) : '');
    setF({ stone_weight: val(x.set_stone_weight, x.stone_weight), zircon_weight: val(x.set_zircon_weight, x.zircon_weight), pearl_weight: val(x.set_pearl_weight, x.pearl_weight) });
  }).catch((e) => toast(e.message, 'bad'));
  const grams = n(f.stone_weight) * 0.2 + n(f.zircon_weight) + n(f.pearl_weight);
  const save = () => run(async () => {
    const r = await api.post(`/sup/orders/${o.id}/set-stones`, f);
    setO({ ...o, stones: r.stones, stones_confirmed_at: new Date().toISOString(), set_stone_weight: f.stone_weight || null, set_zircon_weight: f.zircon_weight || null, set_pearl_weight: f.pearl_weight || null });
  }, 'تم تأكيد وزن الأحجار');
  const req = [n(o?.stone_weight) && `حجر ${n(o.stone_weight)} قيراط`, n(o?.zircon_weight) && `زركون ${n(o.zircon_weight)} جم`, n(o?.pearl_weight) && `لؤلؤ ${n(o.pearl_weight)} جم`].filter(Boolean);
  return (
    <div className="grid">
      <ScanInput onScan={pick} placeholder="امسح QR الطلب أو اكتب رقمه لتأكيد وزن الحجر والزركون المركب فيه" />
      {o && (
        <Card title={<span>{o.order_no} — {o.title}</span>}>
          <div className="d-flex gap-3 align-items-start flex-wrap mb-3">
            {o.thumb && <img src={fileUrl(o.thumb, 400)} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }} />}
            <div className="small">
              <div>{o.material_name} · المرحلة: {o.stage_name || '—'}</div>
              <div className="muted">المطلوب في الطلب: {req.length ? req.join('، ') : 'لا يوجد'}</div>
              {o.stones_confirmed_at && <div className="text-success">آخر تأكيد: {fmtDT(o.stones_confirmed_at)}</div>}
            </div>
          </div>
          <div className="grid g3">
            <Field label="وزن الحجر (قيراط)" hint="1 قيراط = 0.2 جم"><WeightInput value={f.stone_weight || ''} onChange={(v) => setF({ ...f, stone_weight: v })} /></Field>
            <Field label="وزن الزركون (جم)"><WeightInput value={f.zircon_weight || ''} onChange={(v) => setF({ ...f, zircon_weight: v })} /></Field>
            <Field label="وزن اللؤلؤ (جم)"><WeightInput value={f.pearl_weight || ''} onChange={(v) => setF({ ...f, pearl_weight: v })} /></Field>
          </div>
          <div className="alert alert-info small my-3">
            يُخصم <b>{fmtW(grams, 4)} جم</b> من وزن الميزان عند استلام الطلب من العامل وعند الوزن النهائي — بدون مخزون وبدون أي حركة على رصيد الذهب.
            {n(o.stones?.used) - n(o.stones?.confirmed) > 0 && <> ويُضاف له ألماس مخبري مركب من المخزون {fmtW(n(o.stones.used) - n(o.stones.confirmed), 4)} جم.</>}
          </div>
          <Btn loading={busy} disabled={!['approved', 'in_production', 'on_hold'].includes(o.status)} onClick={save}>تأكيد وزن الأحجار</Btn>
        </Card>
      )}
    </div>
  );
}
