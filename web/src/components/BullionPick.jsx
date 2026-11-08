import { Field, Input } from '../ui.jsx';

/** السبائك: سبيكة أو جنيه، ووزن الجنيه/السبيكة المطلوب للقطعة الواحدة */
export default function BullionPick({ f, setF }) {
  const num = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '');
  return (
    <div className="grid g2 align-items-end">
      <Field label="النوع"><div className="chips">{[['bar', 'سبائك'], ['coin', 'جنيهات']].map(([k, l]) => <button key={k} type="button" className={`chip ${f.bullion_type === k ? 'on' : ''}`} onClick={() => setF({ ...f, bullion_type: k })}>{l}</button>)}</div></Field>
      <Field label={f.bullion_type === 'coin' ? 'وزن الجنيه المطلوب للقطعة الواحدة (جم)' : 'وزن السبيكة المطلوب للقطعة الواحدة (جم)'}>
        <Input dir="ltr" inputMode="decimal" value={f.bullion_weight ?? ''} onChange={(e) => setF({ ...f, bullion_weight: num(e.target.value) })} placeholder="مثال: 8" /></Field>
    </div>
  );
}

