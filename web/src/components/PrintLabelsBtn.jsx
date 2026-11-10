import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../ui.jsx';
import { labelsToZpl, zebraSend } from '../zebra.js';

/** إعدادات الطباعة المحفوظة على هذا الجهاز (تُضبط من صفحة الملصقات) */
export const loadLabelCfg = () => {
  const d = { mode: 'browser', dpi: 203, w: 50, h: 25, darkness: '' };
  try { return { ...d, ...JSON.parse(localStorage.getItem('zebra_cfg') || '{}') }; } catch { return d; }
};
export const labelOpts = (cfg) => ({ dpi: Number(cfg.dpi) || 203, w: Number(cfg.w) || 50, h: Number(cfg.h) || 25, darkness: cfg.darkness === '' || cfg.darkness == null ? null : Number(cfg.darkness) });

/** طباعة عبر إطار مخفي في نفس الصفحة (بدون فتح تبويب جديد) */
function printViaFrame(ids) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    let finished = false;
    const done = () => { if (finished) return; finished = true; window.removeEventListener('message', onMsg); setTimeout(() => f.remove(), 1500); resolve(); };
    const onMsg = (e) => { if (e.origin === location.origin && e.data === 'labels-printed') done(); };
    window.addEventListener('message', onMsg);
    setTimeout(done, 120000);
    f.src = `/print/labels?auto=1&embed=1&ids=${ids.join(',')}`;
    document.body.appendChild(f);
  });
}

export async function printLabels(ids) {
  const cfg = loadLabelCfg();
  if (cfg.mode === 'zebra' && cfg.device) {
    const rows = await api.get(`/orders/labels?ids=${ids.join(',')}`);
    await zebraSend(cfg.device, await labelsToZpl(rows, labelOpts(cfg)));
    return 'zebra';
  }
  await printViaFrame(ids);
  return 'browser';
}

/** زر طباعة الملصق: يطبع مباشرة من نفس الصفحة، مع رابط صغير لإعدادات الطباعة */
export default function PrintLabelsBtn({ ids, children = 'طباعة الملصق' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy || !ids.length) return;
    setBusy(true);
    try {
      const how = await printLabels(ids);
      if (how === 'zebra') toast("أُرسلت الملصقات للطابعة", "ok");
    } catch (e) {
      toast(`${e.message} — افتح إعدادات الطباعة`, 'bad');
    } finally { setBusy(false); }
  };
  return (
    <div className="btn-group">
      <button type="button" className="btn btn-outline-secondary" onClick={go} disabled={busy}>
        {busy && <span className="spinner-border spinner-border-sm me-1" />}{children}
      </button>
      <Link className="btn btn-outline-secondary px-2" to={`/print/labels?ids=${ids.join(',')}`} title="إعدادات الطباعة ومعاينة الملصق" aria-label="إعدادات الطباعة">⚙</Link>
    </div>
  );
}
