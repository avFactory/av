import { useEffect, useRef } from 'react';

/**
 * التقاط قارئ الباركود (يعمل كلوحة مفاتيح سريعة جداً وينتهي بـ Enter) في أي صفحة،
 * ما دام المؤشر ليس داخل حقل كتابة (الحقول تستقبل المسح بنفسها).
 */
export function useScanner(onScan, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return undefined;
    let buf = '';
    let last = 0;
    let first = 0;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const now = performance.now();
      if (now - last > 80) { buf = ''; first = now; }
      last = now;
      if (e.key === 'Enter') {
        const code = buf.trim();
        // القارئ يكتب 6 رموز أو أكثر بمتوسط أقل من 50 مللي ثانية للحرف
        if (code.length >= 6 && (now - first) / code.length < 50) { e.preventDefault(); cb.current(code); }
        buf = '';
        return;
      }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
