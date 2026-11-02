// مكونات الواجهة المشتركة
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import jsQR from 'jsqr';
import { api } from './api.js';

// ------------------------------------------------------------- بيانات من الخادم + تحديث فوري
const LiveCtx = createContext(null);
export function LiveProvider({ children }) {
  const subs = useRef(new Set());
  useEffect(() => {
    let es;
    let stop = false;
    const connect = () => {
      if (stop) return;
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          const { tables } = JSON.parse(e.data);
          subs.current.forEach((fn) => fn(tables));
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); setTimeout(connect, 4000); };
    };
    connect();
    return () => { stop = true; es?.close(); };
  }, []);
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
    const fn = (tables) => { if (tables.some((t) => live.includes(t))) load(); };
    subs.current.add(fn);
    return () => subs.current.delete(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, load, live.join()]);
  return { data, error, loading, reload: load, setData };
}

// ------------------------------------------------------------- التنبيهات
const ToastCtx = createContext(() => {});
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
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}
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
      if (success) toast(success, 'ok');
      return r;
    } catch (e) {
      toast(e.message || 'حدث خطأ', 'bad');
      throw e;
    } finally { setBusy(false); }
  }, [busy, toast]);
  return [run, busy];
}

// ------------------------------------------------------------- عناصر أساسية
export function Btn({ kind = 'primary', size, className = '', loading, children, ...p }) {
  return (
    <button className={`btn btn-${kind} ${size ? 'btn-' + size : ''} ${className}`} disabled={loading || p.disabled} {...p}>
      {loading ? <span className="spin" /> : null}{children}
    </button>
  );
}
export const LinkBtn = ({ to, kind = 'ghost', size, children, className = '' }) => <Link to={to} className={`btn btn-${kind} ${size ? 'btn-' + size : ''} ${className}`}>{children}</Link>;

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <header className="card-h"><h3>{title}</h3><div className="row gap">{actions}</div></header>}
      <div className={pad ? 'card-b' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-l">{label}</span>}
      {children}
      {hint && <span className="field-h">{hint}</span>}
      {error && <span className="field-e">{error}</span>}
    </label>
  );
}

export const Input = (p) => <input className="input" {...p} />;
export const Textarea = (p) => <textarea className="input" rows={3} {...p} />;
export function Select({ options, placeholder, ...p }) {
  return (
    <select className="input" {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

/** حقل وزن: لوحة أرقام على الجوال، يقبل الأرقام العربية */
export function WeightInput({ value, onChange, big, ...p }) {
  return (
    <input className={`input weight ${big ? 'weight-big' : ''}`} inputMode="decimal" autoComplete="off" dir="ltr" placeholder="0.000"
      value={value} onChange={(e) => onChange(e.target.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').replace(/[^\d.]/g, ''))} {...p} />
  );
}

export const Badge = ({ tone = 'muted', children }) => <span className={`badge badge-${tone}`}>{children}</span>;
export function StatusBadge({ map, value }) {
  const [label, tone] = map[value] || [value, 'muted'];
  return <Badge tone={tone}>{label}</Badge>;
}
export const Empty = ({ children = 'لا توجد بيانات' }) => <div className="empty">{children}</div>;
export const Loader = () => <div className="loader"><span className="spin" /> جارٍ التحميل…</div>;
export function ErrorBox({ error }) { return error ? <div className="alert alert-bad">{error.message}</div> : null; }

export function Page({ title, subtitle, actions, children, back }) {
  return (
    <div className="page">
      <div className="page-h">
        <div>
          {back && <Link to={back} className="back">→ رجوع</Link>}
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <div className="row gap wrap no-print">{actions}</div>
      </div>
      {children}
    </div>
  );
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
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="modal-h"><h3>{title}</h3><button className="x" onClick={onClose} aria-label="إغلاق">×</button></header>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

/** جدول بسيط: columns = [[عنوان, دالة أو مفتاح, {className}]] */
export function Table({ columns, rows, onRow, empty, rowClass }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
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
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

export function Stat({ label, value, unit, tone, to, sub }) {
  const body = (
    <>
      <span className="stat-l">{label}</span>
      <span className="stat-v">{value}{unit && <small> {unit}</small>}</span>
      {sub && <span className="stat-s">{sub}</span>}
    </>
  );
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
export function ScanInput({ onScan, placeholder = 'امسح QR أو اكتب رقم الطلب', autoFocus = true }) {
  const [v, setV] = useState('');
  const [cam, setCam] = useState(false);
  const submit = (e) => { e?.preventDefault(); const s = v.trim(); if (s) { onScan(s); setV(''); } };
  return (
    <div>
      <form className="scan" onSubmit={submit}>
        <span className="scan-ic" aria-hidden>⌁</span>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} dir="auto" />
        <Btn type="submit" kind="dark">بحث</Btn>
        <Btn type="button" kind="ghost" onClick={() => setCam(true)}>الكاميرا</Btn>
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
      } catch { setErr('تعذر فتح الكاميرا - اسمح بالوصول أو استخدم قارئ الباركود'); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onScan]);
  return (
    <Modal open onClose={onClose} title="مسح رمز QR">
      {err ? <div className="alert alert-bad">{err}</div> : <video ref={video} className="cam" playsInline muted />}
    </Modal>
  );
}

export function Confirm({ open, title, children, onConfirm, onClose, busy, danger, confirmText = 'تأكيد' }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {children}
      <div className="row gap end mt">
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
  return <input className="input search" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}
