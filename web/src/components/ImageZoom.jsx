import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MIN = 1;
const MAX = 5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * صورة قابلة للتكبير والتصغير:
 * أزرار + / − / إعادة، عجلة الماوس، النقر المزدوج، السحب للتحريك، والقرص بإصبعين على الجوال.
 */
function useZoom(fit = 'cover') {
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const box = useRef(null);
  const nat = useRef(null); // المقاس الأصلي للصورة
  const drag = useRef(null);
  const pinch = useRef(null);

  // يبقى التحريك داخل حدود الصورة المكبّرة
  const bound = useCallback((s, x, y) => {
    if (!Number.isFinite(s) || !Number.isFinite(x) || !Number.isFinite(y)) return { s: 1, x: 0, y: 0 };
    const el = box.current;
    if (!el || s <= 1) return { s: Math.max(s, 1), x: 0, y: 0 };
    const w = el.clientWidth, h = el.clientHeight;
    const { dw, dh } = shown(w, h, nat.current, fit, s);
    const mx = Math.max(0, (dw - w) / 2), my = Math.max(0, (dh - h) / 2);
    return { s, x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
  }, [fit]);

  // تكبير حول نقطة (موضع الماوس أو منتصف الإصبعين)
  const zoomAt = useCallback((next, cx, cy) => {
    setZ((p) => {
      const s = clamp(typeof next === 'function' ? next(p.s) : next, MIN, MAX);
      const el = box.current;
      if (!el) return { ...p, s };
      const r = el.getBoundingClientRect();
      const ox = cx == null ? 0 : cx - (r.left + r.width / 2);
      const oy = cy == null ? 0 : cy - (r.top + r.height / 2);
      const k = s / p.s;
      return bound(s, ox - (ox - p.x) * k, oy - (oy - p.y) * k);
    });
  }, [bound]);

  const reset = () => setZ({ s: 1, x: 0, y: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); zoomAt((s) => s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const handlers = {
    onDoubleClick: (e) => (z.s > 1 ? reset() : zoomAt(2.5, e.clientX, e.clientY)),
    onPointerDown: (e) => {
      if (e.pointerType === 'touch') return;
      if (z.s <= 1) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX - z.x, y: e.clientY - z.y };
    },
    // القيم تُحسب فوراً (وليس داخل دالة التحديث المؤجلة) حتى لا تُقرأ بعد رفع الإصبع/الماوس
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const x = e.clientX - d.x, y = e.clientY - d.y;
      setZ((p) => bound(p.s, x, y));
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onTouchStart: (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: z.s };
      } else if (e.touches.length === 1 && z.s > 1) {
        drag.current = { x: e.touches[0].clientX - z.x, y: e.touches[0].clientY - z.y };
      }
    },
    onTouchMove: (e) => {
      if (pinch.current && e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const target = pinch.current.s * (d / (pinch.current.d || 1));
        zoomAt(target, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      } else if (drag.current && e.touches.length === 1) {
        e.preventDefault();
        const d = drag.current, t = e.touches[0];
        const x = t.clientX - d.x, y = t.clientY - d.y;
        setZ((p) => bound(p.s, x, y));
      }
    },
    onTouchEnd: () => { pinch.current = null; drag.current = null; },
    onTouchCancel: () => { pinch.current = null; drag.current = null; },
  };
  return { z, box, nat, fit, handlers, zoomAt, reset };
}

/** مقاس الصورة المعروضة (ملء الإطار أو احتواؤها) عند مستوى تكبير s */
function shown(w, h, n, fit, s) {
  if (!n || !n.w || !n.h) return { dw: w * s, dh: h * s };
  const base = fit === 'contain' ? Math.min(w / n.w, h / n.h) : Math.max(w / n.w, h / n.h);
  return { dw: n.w * base * s, dh: n.h * base * s };
}

function Controls({ z, zoomAt, reset, extra }) {
  return (
    <div className="zoom-ctl" onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="تكبير" title="تكبير" onClick={() => zoomAt(z.s * 1.5)}>+</button>
      <span>{Math.round(z.s * 100)}%</span>
      <button type="button" aria-label="تصغير" title="تصغير" disabled={z.s <= 1} onClick={() => zoomAt(z.s / 1.5)}>−</button>
      <button type="button" aria-label="إعادة" title="إعادة الحجم" disabled={z.s === 1} onClick={reset}>⟲</button>
      {extra}
    </div>
  );
}

/**
 * الصورة تُرسم كخلفية بمقاس محسوب (وليس تكبير طبقة كاملة بـ transform):
 * المتصفح يرسم الجزء الظاهر فقط، فلا تختفي الصفحة مع الصور الكبيرة عالية الدقة.
 */
function Stage({ src, preview, alt, zoom, className = '' }) {
  const { z, box, nat, fit, handlers } = zoom;
  const [, setReady] = useState(0);
  // نسخة خفيفة للعرض، والأصل بالدقة الكاملة يُحمّل فقط عند التكبير
  const [hi, setHi] = useState(!preview);
  useEffect(() => { setHi(!preview); }, [src, preview]);
  useEffect(() => {
    if (hi || z.s <= 1) return undefined;
    let alive = true;
    const im = new Image();
    im.onload = () => { if (alive) setHi(true); };
    im.src = src;
    return () => { alive = false; };
  }, [hi, z.s, src]);
  const shownSrc = hi ? src : preview;
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    let alive = true;
    nat.current = null;
    const im = new Image();
    im.onload = () => { if (alive) { nat.current = { w: im.naturalWidth, h: im.naturalHeight }; setReady((n) => n + 1); } };
    im.src = preview || src;
    return () => { alive = false; };
  }, [src, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [box]);
  const { dw, dh } = shown(size.w, size.h, nat.current, fit, z.s);
  const left = (size.w - dw) / 2 + z.x, top = (size.h - dh) / 2 + z.y;
  return (
    <div ref={box} className={`zoom-stage ${className} ${z.s > 1 ? 'zoomed' : ''}`} {...handlers}>
      <div className="zoom-img" role="img" aria-label={alt}
        style={{ backgroundImage: `url("${shownSrc}")`, backgroundSize: `${dw}px ${dh}px`, backgroundPosition: `${left}px ${top}px` }} />
    </div>
  );
}

/** صورة المنتج مع أدوات التكبير وزر ملء الشاشة */
export default function ImageZoom({ src, preview, alt, images = [], previews = [], index = 0, onIndex }) {
  const zoom = useZoom();
  const [full, setFull] = useState(false);
  useEffect(() => { zoom.reset(); }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="zoom-wrap">
        <Stage src={src} preview={preview} alt={alt} zoom={zoom} />
        <Controls z={zoom.z} zoomAt={zoom.zoomAt} reset={zoom.reset}
          extra={<button type="button" aria-label="ملء الشاشة" title="ملء الشاشة" onClick={() => setFull(true)}>⛶</button>} />
      </div>
      {full && <Viewer images={images.length ? images : [src]} previews={previews} index={Math.max(0, images.indexOf(src))} alt={alt} onClose={() => setFull(false)} onIndex={onIndex} start={index} />}
    </>
  );
}

/** عرض بملء الشاشة مع التنقل بين الصور */
function Viewer({ images, previews = [], index, alt, onClose, onIndex }) {
  const [i, setI] = useState(index);
  const zoom = useZoom('contain');
  const go = (d) => { const n = (i + d + images.length) % images.length; setI(n); zoom.reset(); onIndex?.(n); };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(1);
      else if (e.key === 'ArrowRight') go(-1);
      else if (e.key === '+' || e.key === '=') zoom.zoomAt(zoom.z.s * 1.5);
      else if (e.key === '-') zoom.zoomAt(zoom.z.s / 1.5);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  });
  return createPortal(
    <div className="zoom-viewer" role="dialog" aria-modal="true">
      <Stage src={images[i]} preview={previews[i]} alt={alt} zoom={zoom} className="full" />
      <button type="button" className="zoom-close" aria-label="إغلاق" onClick={onClose}>×</button>
      {images.length > 1 && <>
        <button type="button" className="zoom-nav prev" aria-label="السابقة" onClick={() => go(-1)}>›</button>
        <button type="button" className="zoom-nav next" aria-label="التالية" onClick={() => go(1)}>‹</button>
        <div className="zoom-count">{i + 1} / {images.length}</div>
      </>}
      <Controls z={zoom.z} zoomAt={zoom.zoomAt} reset={zoom.reset} />
    </div>,
    document.body,
  );
}
