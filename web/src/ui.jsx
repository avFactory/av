// مكونات الواجهة المشتركة
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { t } from './i18n.js';

// ------------------------------------------------------------- بيانات من الخادم + تحديث فوري
const LiveCtx = createContext(null);
export function LiveProvider({ children }) {
  const subs = useRef(new Set());
  const { me } = useAuth();
  const loggedIn = !!me;
  useEffect(() => {
    if (!loggedIn) return undefined;
    let es;
    let stop = false;
    let dropped = false;
    // تحديث كل الشاشات المفتوحة (عند عودة الاتصال أو الجوال من السكون): ما فات أثناء الانقطاع لا يضيع
    const refreshAll = () => subs.current.forEach((fn) => fn(['*']));
    const connect = () => {
      if (stop) return;
      es = new EventSource('/api/events');
      es.onopen = () => { if (dropped) { dropped = false; refreshAll(); } };
      es.onmessage = (e) => {
        try {
          const { tables } = JSON.parse(e.data);
          subs.current.forEach((fn) => fn(tables));
        } catch { /* ignore */ }
      };
      es.onerror = () => { dropped = true; es.close(); setTimeout(connect, 4000); };
    };
    connect();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refreshAll);
    // شبكة أمان: تحديث كل دقيقة والصفحة ظاهرة (لو تأخر حدث فوري لأي سبب)
    const safety = setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, 60000);
    return () => {
      stop = true; es?.close(); clearInterval(safety);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refreshAll);
    };
  }, [loggedIn]);
  return <LiveCtx.Provider value={subs}>{children}</LiveCtx.Provider>;
}

/** جلب بيانات مع إعادة التحميل التلقائي عند تغير الجداول المحددة (تحديثات فورية) */
export function useFetch(url, { live = [], deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const subs = useContext(LiveCtx);
  const load = useCallback(async () => {
    if (!url) { setLoading(false); return; }
    try {
      setData(await api.get(url));
      setError(null);
    } catch (e) { setError(e); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    if (!subs || !live.length) return undefined;
    const fn = (tables) => { if (tables.includes('*') || tables.some((t) => live.includes(t))) load(); };
    subs.current.add(fn);
    return () => subs.current.delete(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, load, live.join()]);
  return { data, error, loading, reload: load, setData };
}

// ------------------------------------------------------------- التنبيهات
const ToastCtx = createContext(() => {});
// ------------------------------------------------------------- رسائل التأكيد والتنبيه (بدل نوافذ المتصفح) في منتصف الصفحة
let openDialog = null;
/** نافذة تأكيد: تعيد true عند الموافقة */
export function askConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    if (!openDialog) { resolve(window.confirm(message)); return; }
    openDialog({ kind: 'confirm', message, ...opts, resolve });
  });
}
/** نافذة تنبيه بزر واحد */
export function showAlert(message, opts = {}) {
  return new Promise((resolve) => {
    if (!openDialog) { window.alert(message); resolve(true); return; }
    openDialog({ kind: 'alert', message, ...opts, resolve });
  });
}

function DialogHost() {
  const [d, setD] = useState(null);
  const okRef = useRef(null);
  useEffect(() => { openDialog = (x) => setD(x); return () => { openDialog = null; }; }, []);
  const close = useCallback((v) => { setD((cur) => { cur?.resolve(v); return null; }); }, []);
  useEffect(() => {
    if (!d) return undefined;
    okRef.current?.focus();
    const k = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [d, close]);
  if (!d) return null;
  const danger = d.danger ?? (d.kind === 'confirm' && /حذف|إلغاء|إيقاف|رفض/.test(d.message));
  const title = d.title || t(d.kind === 'alert' ? 'تنبيه' : danger ? 'تأكيد الحذف' : 'تأكيد');
  const okLabel = d.ok || t(d.kind === 'alert' ? 'حسناً' : danger && /حذف/.test(d.message) ? 'نعم، احذف' : 'تأكيد');
  return (
    <div className="cdlg" role="alertdialog" aria-modal="true" aria-labelledby="cdlg-t" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className={`cdlg-card${danger ? ' danger' : ''}`}>
        <div className="cdlg-ic" aria-hidden="true">{d.kind === 'alert' ? 'i' : danger ? '!' : '✓'}</div>
        <h3 id="cdlg-t" className="cdlg-t">{title}</h3>
        <div className="cdlg-m">{d.message}</div>
        <div className={`cdlg-b${d.kind === 'alert' ? ' one' : ''}`}>
          <button ref={okRef} type="button" className={`btn btn-lg ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{okLabel}</button>
          {d.kind === 'confirm' && <button type="button" className="btn btn-lg btn-outline-secondary" onClick={() => close(false)}>{d.cancel || t('إلغاء')}</button>}
        </div>
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), type === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <DialogHost />
      <div className="toast-container position-fixed bottom-0 end-0 p-3 toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast show border-0 shadow ${t.type === 'bad' ? 'text-bg-danger' : t.type === 'ok' ? 'text-bg-success' : 'text-bg-dark'}`}>
            <div className="toast-body fw-semibold">{t.msg}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** تنفيذ عملية مع حالة انتظار ورسالة خطأ */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    if (busy) return undefined;
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(t(success), 'ok');
      return r;
    } catch (e) {
      toast(t(e.message || 'حدث خطأ'), 'bad');
      throw e;
    } finally { setBusy(false); }
  }, [busy, toast]);
  return [run, busy];
}

// ------------------------------------------------------------- عناصر أساسية
// تحويل أنواع الأزرار إلى أصناف Bootstrap
const BTN = { primary: 'btn-primary', dark: 'btn-dark', ghost: 'btn-outline-secondary', danger: 'btn-danger', ok: 'btn-success' };
const BSIZE = { sm: 'btn-sm', lg: 'btn-lg', xl: 'btn-lg btn-xl' };
const btnCls = (kind, size) => `btn ${BTN[kind] || `btn-${kind}`} ${BSIZE[size] || ''} d-inline-flex align-items-center justify-content-center gap-2`;
export function Btn({ kind = 'primary', size, className = '', loading, children, ...p }) {
  return (
    <button className={`${btnCls(kind, size)} ${className}`} disabled={loading || p.disabled} {...p}>
      {loading ? <span className="spinner-border spinner-border-sm" /> : null}{children}
    </button>
  );
}
export const LinkBtn = ({ to, kind = 'ghost', size, children, className = '' }) => <Link to={to} className={`${btnCls(kind, size)} ${className}`}>{children}</Link>;

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card shadow-sm ${className}`}>
      {(title || actions) && <header className="card-header bg-transparent d-flex flex-wrap gap-2 justify-content-between align-items-center py-3"><h3 className="h6 fw-bold mb-0">{title}</h3><div className="d-flex flex-wrap align-items-center gap-2">{actions}</div></header>}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="form-label mb-0 field-l">{label}</span>}
      {children}
      {hint && <span className="form-text mt-0">{hint}</span>}
      {error && <span className="invalid-feedback d-block">{error}</span>}
    </label>
  );
}

export const Input = (p) => <input className="form-control" {...p} />;
export const Textarea = (p) => <textarea className="form-control" rows={3} {...p} />;
export function Select({ options, placeholder, ...p }) {
  return (
    <select className="form-select" {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

/** حقل وزن: لوحة أرقام على الجوال، يقبل الأرقام العربية */
export function WeightInput({ value, onChange, big, ...p }) {
  return (
    <input className={`form-control weight ${big ? 'weight-big' : ''}`} inputMode="decimal" autoComplete="off" dir="ltr" placeholder="0.000"
      value={value} onChange={(e) => onChange(e.target.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').replace(/[^\d.]/g, ''))} {...p} />
  );
}

const BADGE = { ok: 'bg-success-subtle text-success-emphasis', warn: 'bg-warning-subtle text-warning-emphasis', bad: 'bg-danger-subtle text-danger-emphasis',
  info: 'bg-info-subtle text-info-emphasis', gold: 'badge-gold', muted: 'bg-body-secondary text-body-secondary border' };
export const Badge = ({ tone = 'muted', children }) => <span className={`badge rounded-pill fw-semibold ${BADGE[tone] || BADGE.muted}`}>{children}</span>;
export function StatusBadge({ map, value }) {
  const [label, tone] = map[value] || [value, 'muted'];
  return <Badge tone={tone}>{t(label)}</Badge>;
}
/** شارة تصنيف العميل: ذهبي / فضي / عادي */
export function TierBadge({ name, color }) {
  if (!name) return <span className="muted">—</span>;
  return <span className={`tier tier-${color || 'other'}`}>{color === 'gold' ? '★ ' : color === 'silver' ? '☆ ' : ''}{name}</span>;
}
export const Empty = ({ children = 'لا توجد بيانات' }) => <div className="empty text-center text-body-secondary py-5">{children}</div>;
export const Loader = () => <div className="loader d-flex justify-content-center align-items-center gap-2 py-5 text-body-secondary"><span className="spinner-border spinner-border-sm text-primary" /> جارٍ التحميل…</div>;
export function ErrorBox({ error }) { return error ? <div className="alert alert-danger">{error.message}</div> : null; }

const PageSlotCtx = createContext(null);
/**
 * رأس الصفحة. inline: العنوان ثم أدوات الصفحة (البحث، الخطوات...) في نفس الصف.
 * يمكن لأي مكوّن داخل الصفحة وضع عناصر في صف العنوان عبر <PageActions>.
 */
export function Page({ title, subtitle, actions, children, back, inline }) {
  const [slot, setSlot] = useState(null);
  return (
    <div className="page container-fluid">
      <div className={`page-h${inline ? ' inline' : ''}`}>
        <div>
          {back && <Link to={back} className="back">→ رجوع</Link>}
          <h1>{title}</h1>
          {subtitle && <p className="text-body-secondary mb-0">{subtitle}</p>}
        </div>
        <div className="hrow gap wrap no-print page-actions" ref={setSlot}>{actions}</div>
      </div>
      <PageSlotCtx.Provider value={slot}>{children}</PageSlotCtx.Provider>
    </div>
  );
}
/** وضع عناصر في صف عنوان الصفحة (بجانب اسم الصفحة) */
export function PageActions({ children }) {
  const slot = useContext(PageSlotCtx);
  return slot ? createPortal(children, slot) : null;
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${wide ? 'modal-xl' : ''}`}>
          <div className="modal-content border-0 shadow-lg">
            <div className="modal-header"><h5 className="modal-title fw-bold">{title}</h5><button type="button" className="btn-close ms-0 me-auto" onClick={onClose} aria-label="إغلاق" /></div>
            <div className="modal-body d-grid gap-3">{children}</div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

/** جدول بسيط: columns = [[عنوان, دالة أو مفتاح, {className}]] */
export function Table({ columns, rows, onRow, empty, rowClass }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-responsive table-wrap">
      <table className="table table-hover align-middle mb-0">
        <thead><tr>{columns.map((c, i) => <th key={i} className={c[2]?.className}>{c[0]}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={`${onRow ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}`}>
              {columns.map((c, j) => <td key={j} className={c[2]?.className} data-label={c[0]}>{typeof c[1] === 'function' ? c[1](r) : r[c[1]] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="nav nav-tabs flex-nowrap mb-3 tabs" role="tablist">
      {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={value === k} className={`nav-link text-nowrap ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

/** أزرار أوضاع احترافية (بدل التبويبات): أيقونة + عنوان + وصف قصير */
export function ModeTiles({ tiles, value, onChange }) {
  return (
    <div className="mode-tiles mb-3" role="tablist">
      {tiles.map(([k, icon, label, hint]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={`mode-tile${value === k ? ' on' : ''}`} onClick={() => onChange(k)}>
          <span className="mt-ic" aria-hidden="true">{icon}</span>
          <span className="mt-tx"><b>{label}</b>{hint && <small>{hint}</small>}</span>
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, tone, to, sub, onClick }) {
  const body = (
    <>
      <span className="stat-l">{label}</span>
      <span className="stat-v">{value}{unit && <small> {unit}</small>}</span>
      {sub && <span className="stat-s">{sub}</span>}
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} className={`stat stat-${tone || 'plain'} text-start w-100`}>{body}</button>;
  return to ? <Link to={to} className={`stat stat-${tone || 'plain'}`}>{body}</Link> : <div className={`stat stat-${tone || 'plain'}`}>{body}</div>;
}

// ------------------------------------------------------------- التوقيع الإلكتروني
export function SignaturePad({ onChange, height = 180 }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
  }, [height]);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true; const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); ctx.lineTo(...pos(e)); ctx.stroke(); dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current.toDataURL('image/png')); };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); };
  return (
    <div className="sig">
      <canvas ref={ref} style={{ height }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <div className="sig-f"><span className="muted">وقّع داخل المربع</span><button type="button" className="link" onClick={clear}>مسح</button></div>
    </div>
  );
}

// ------------------------------------------------------------- مسح QR (كاميرا أو قارئ باركود USB)
export function ScanInput({ onScan, placeholder = t('امسح QR أو اكتب رقم الطلب'), autoFocus = true }) {
  const [v, setV] = useState('');
  const [cam, setCam] = useState(false);
  const submit = (e) => { e?.preventDefault(); const s = v.trim(); if (s) { onScan(s); setV(''); } };
  return (
    <div>
      <form className="input-group input-group-lg scan" onSubmit={submit}>
        <span className="input-group-text scan-ic" aria-hidden>⌁</span>
        <input className="form-control" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} dir="auto" />
        <Btn type="submit" kind="dark">{t('بحث')}</Btn>
        <Btn type="button" kind="ghost" onClick={() => setCam(true)}>{t('الكاميرا')}</Btn>
      </form>
      {cam && <CameraScanner onClose={() => setCam(false)} onScan={(s) => { setCam(false); onScan(s); }} />}
    </div>
  );
}

function CameraScanner({ onScan, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stream;
    let raf;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code', 'code_128'] }) : null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped) return;
          const v = video.current;
          if (v.readyState >= 2) {
            let found = null;
            if (detector) {
              const r = await detector.detect(v).catch(() => []);
              found = r[0]?.rawValue;
            } else {
              canvas.width = v.videoWidth; canvas.height = v.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              found = jsQR(img.data, img.width, img.height)?.data;
            }
            if (found) { navigator.vibrate?.(80); onScan(found); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { setErr(t('تعذر فتح الكاميرا - اسمح بالوصول أو استخدم قارئ الباركود')); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onScan]);
  return (
    <Modal open onClose={onClose} title="مسح رمز QR">
      {err ? <div className="alert alert-danger">{err}</div> : <video ref={video} className="cam" playsInline muted />}
    </Modal>
  );
}

export function Confirm({ open, title, children, onConfirm, onClose, busy, danger, confirmText = 'تأكيد' }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {children}
      <div className="hrow gap end mt">
        <Btn kind="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn kind={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmText}</Btn>
      </div>
    </Modal>
  );
}

/** نافذة إدخال سبب (للتصحيح/الإلغاء) */
export function ReasonModal({ open, title, label = 'السبب', onSubmit, onClose, busy, danger }) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(''); }, [open]);
  return (
    <Confirm open={open} title={title} onClose={onClose} busy={busy} danger={danger} onConfirm={() => onSubmit(v)} confirmText="تنفيذ">
      <Field label={label}><Textarea value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
    </Confirm>
  );
}

export function Kv({ items }) {
  return (
    <dl className="kv">
      {items.filter(Boolean).map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}
    </dl>
  );
}

export function Search({ value, onChange, placeholder = 'بحث…' }) {
  return <input className="form-control search" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

// ------------------------------------------------------------- الوضع الداكن / الفاتح
/** زر تبديل الوضع الداكن والفاتح — يُحفظ الاختيار على هذا الجهاز لكل صفحات الموقع */
export function ThemeToggle({ light = false, className = '' }) {
  const read = () => document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const sync = () => setTheme(read());
    window.addEventListener('av-theme', sync);
    return () => window.removeEventListener('av-theme', sync);
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.dataset.themeLock = '1';
    root.setAttribute('data-bs-theme', next);
    try { localStorage.setItem('av_theme', next); } catch { /* ignore */ }
    window.dispatchEvent(new Event('av-theme'));
  };
  const dark = theme === 'dark';
  return (
    <button type="button" className={`btn btn-sm theme-toggle ${light ? 'btn-outline-light' : 'btn-outline-secondary'} ${className}`} onClick={toggle}
      title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'} aria-label={dark ? 'التبديل للوضع الفاتح' : 'التبديل للوضع الداكن'}>
      {dark ? '☀' : '☾'}
    </button>
  );
}

/** اختيار عدة ملفات بالتتابع (كل اختيار يُضاف للقائمة) مع معاينة وحذف */
/** عرض الصورة مكبرة فوق الصفحة (للتأكد من تفاصيل المنتج) — إغلاق بالنقر أو Esc */
export function Lightbox({ src, alt = '', onClose }) {
  useEffect(() => {
    if (!src) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [src, onClose]);
  if (!src) return null;
  return createPortal(
    <div className="lightbox" role="dialog" aria-label="عرض الصورة" onClick={onClose}>
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="lightbox-x" aria-label="إغلاق" onClick={onClose}>×</button>
    </div>,
    document.body,
  );
}

/** صورة مصغرة تُكبَّر عند النقر */
export function ZoomThumb({ src, full, className = '', alt = '' }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <button type="button" className={`zoom-thumb ${className}`} title="اضغط لتكبير الصورة" onClick={(e) => { e.stopPropagation(); setOpen(true); }}><img src={src} alt={alt} /></button>
      <Lightbox src={open ? full || src : null} alt={alt} onClose={() => setOpen(false)} />
    </>
  );
}

const IMG_RE = /\.(jpe?g|png|webp|gif|heic|heif|bmp)(\?|$)/i;
const okType = (f, accept) => !accept || accept === '*' || accept.split(',').some((a) => { a = a.trim(); return a.endsWith('/*') ? (f.type || '').startsWith(a.slice(0, -1)) : a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : f.type === a; }) || (accept.includes('image/') && IMG_RE.test(f.name));

/** ملفات من السحب والإفلات (من سطح المكتب أو واتساب ويب/ديسكتوب) أو من رابط صورة مسحوبة */
async function filesFromTransfer(dt, accept) {
  const files = [...(dt?.files || [])].filter((f) => okType(f, accept));
  if (files.length) return files;
  // بعض المتصفحات تسحب الصورة كرابط فقط: نحاول تحميلها
  const html = dt?.getData?.('text/html') || '';
  const url = (html.match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || (dt?.getData?.('text/uri-list') || '').split('\n').find((x) => x && !x.startsWith('#'));
  if (!url) return [];
  try {
    const r = await fetch(url);
    const b = await r.blob();
    if (!b.type.startsWith('image/')) return [];
    return [new File([b], `whatsapp-${Date.now()}.${(b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: b.type })];
  } catch { return []; }
}

/**
 * اختيار ملفات/صور مع معاينة: زر الإضافة، السحب والإفلات (من واتساب أو سطح المكتب)، واللصق Ctrl+V.
 * globalPaste: يستقبل اللصق من أي مكان في الصفحة (لنموذج واحد نشط). النقر على الصورة يكبّرها.
 */
export function FilePicker({ label, value = [], onChange, accept = 'image/*', max = 20, hint, main = null, onMain, globalPaste = false }) {
  const ref = useRef(null);
  const [urls, setUrls] = useState([]);
  const [drag, setDrag] = useState(false);
  const [zoom, setZoom] = useState(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => {
    const u = value.map((f) => (f.type?.startsWith('image/') ? URL.createObjectURL(f) : null));
    setUrls(u);
    return () => u.forEach((x) => x && URL.revokeObjectURL(x));
  }, [value]);
  const add = useCallback((list) => {
    if (!list.length) return;
    const { value: v, onChange: oc } = latest.current;
    oc([...v, ...list].slice(0, max));
    if (ref.current) ref.current.value = '';
  }, [max]);
  useEffect(() => {
    if (!globalPaste) return undefined;
    const h = (e) => {
      const fs = [...(e.clipboardData?.files || [])].filter((f) => okType(f, accept));
      if (!fs.length) return;
      e.preventDefault();
      add(fs.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `paste-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png')}`, { type: f.type }))));
    };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, [globalPaste, accept, add]);
  const onDrop = async (e) => {
    e.preventDefault(); setDrag(false);
    add(await filesFromTransfer(e.dataTransfer, accept));
  };
  return (
    <div className={`field file-pick ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!drag) setDrag(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={onDrop}>
      {label && <span className="form-label mb-0 field-l">{label}</span>}
      <div className="file-pick-grid">
        {value.map((f, i) => (
          <div key={`${f.name}-${i}`} className={`file-pick-item ${onMain && main === i ? 'main' : ''}`} title={f.name}>
            {urls[i] ? <img src={urls[i]} alt="" className="zoomable" onClick={() => setZoom(urls[i])} /> : <span className="file-pick-name">{f.name.split('.').pop().toUpperCase()}<small>{f.name}</small></span>}
            <button type="button" className="file-pick-x" aria-label="حذف" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
            {onMain && <button type="button" className="file-pick-star" title={main === i ? 'الصورة الرئيسية' : 'تعيين كصورة رئيسية'} onClick={() => onMain(i)}>{main === i ? '★ الرئيسية' : '☆'}</button>}
          </div>
        ))}
        {value.length < max && (
          <button type="button" className="file-pick-add" onClick={() => ref.current?.click()}>
            <b>+</b><span>{value.length ? 'إضافة المزيد' : 'إضافة ملفات'}</span>
          </button>
        )}
        {value.length < max && <div className="file-pick-drop">⇩ اسحب الصور هنا من واتساب أو جهازك{globalPaste ? ' — أو الصقها Ctrl+V' : ''}</div>}
      </div>
      <input ref={ref} type="file" hidden multiple accept={accept} onChange={(e) => add([...e.target.files])} />
      {hint && <span className="form-text mt-0">{hint}</span>}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

/** توحيد النص العربي للبحث (أ/إ/آ ← ا، ى ← ي، ة ← ه) */
const normAr = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ً-ْ]/g, '').trim();

/** قائمة اختيار مع بحث: options = [[value, label, extra?, thumbUrl?]] — يبحث في الاسم وأي نص إضافي، ويعرض صورة مصغرة إن وُجدت */
export function SearchSelect({ value, onChange, options = [], placeholder = 'ابحث…', emptyLabel }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const cur = options.find((o) => String(o[0]) === String(value));
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const words = normAr(q).split(/\s+/).filter(Boolean);
  const list = options.filter((o) => { const hay = normAr(`${o[1]} ${o[2] || ''}`); return words.every((w) => hay.includes(w)); }).slice(0, 60);
  const pick = (v) => { onChange(v); setQ(''); setOpen(false); };
  const thumbs = options.some((o) => o[3]);
  return (
    <div className={`search-select position-relative${cur?.[3] && !open ? ' has-thumb' : ''}`} ref={boxRef}>
      {cur?.[3] && !open && <img className="ss-sel-thumb" src={cur[3]} alt="" />}
      <input className="form-control" value={open ? q : cur?.[1] || ''} placeholder={cur ? cur[1] : placeholder}
        onFocus={() => { setOpen(true); setQ(''); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && open && list[0]) { e.preventDefault(); pick(String(list[0][0])); } if (e.key === 'Escape') setOpen(false); }} />
      {open && (
        <div className="dropdown-menu show w-100 shadow" style={{ maxHeight: 280, overflowY: 'auto' }}>
          {emptyLabel && <button type="button" className={`dropdown-item ${!value ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>{emptyLabel}</button>}
          {list.map((o) => (
            <button key={o[0]} type="button" className={`dropdown-item text-wrap d-flex align-items-center gap-2 ${String(o[0]) === String(value) ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(String(o[0]))}>
              {thumbs && (o[3] ? <img className="ss-thumb" src={o[3]} alt="" loading="lazy" /> : <span className="ss-thumb ss-thumb-empty" />)}
              <span>{o[1]}</span>
            </button>
          ))}
          {!list.length && <span className="dropdown-item-text small text-body-secondary">لا توجد نتائج</span>}
        </div>
      )}
    </div>
  );
}
