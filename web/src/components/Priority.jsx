import { t } from '../i18n.js';

// أولوية المنتج: 0 ليس مستعجلاً، 1 مستعجل، 2 مستعجل جداً
export const PRIORITIES = [[0, 'ليس مستعجلاً', 'secondary'], [1, 'مستعجل', 'warning'], [2, 'مستعجل جداً', 'danger']];

/** شارة الأولوية (لا تظهر لغير المستعجل) */
export function PriorityBadge({ value }) {
  const p = PRIORITIES[Number(value) || 0];
  if (!Number(value)) return null;
  return <span className={`badge text-bg-${p[2]} prio-badge`}>{Number(value) === 2 ? '🔥 ' : '⚡ '}{t(p[1])}</span>;
}

/** اختيار الأولوية لمنتج واحد */
export function PriorityChips({ value, onChange, busy }) {
  const v = Number(value) || 0;
  return (
    <div className="d-flex gap-1 flex-wrap prio-chips" role="group" aria-label={t('الأولوية')}>
      {PRIORITIES.map(([k, l, tone]) => (
        <button key={k} type="button" disabled={busy} className={`chip chip-sm prio-${tone} ${v === k ? 'on' : ''}`} onClick={() => v !== k && onChange(k)}>{t(l)}</button>
      ))}
    </div>
  );
}
