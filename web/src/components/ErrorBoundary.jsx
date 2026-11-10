import { Component } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * يمنع الشاشة البيضاء: أي خطأ في جزء من الواجهة يظهر رسالة بدلاً من اختفاء الصفحة كاملة،
 * ويُعاد المحاولة تلقائياً عند الانتقال لصفحة أخرى.
 */
// إرسال الخطأ للخادم لتشخيصه (بدون إزعاج المستخدم)
function report(error, info) {
  try {
    fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ message: String(error?.message || error).slice(0, 500), stack: String(error?.stack || '').slice(0, 2000), component: String(info?.componentStack || '').slice(0, 1000), path: location.pathname + location.search }) }).catch(() => {});
  } catch { /* ignore */ }
}

/** التعافي الصامت: أول خطأ → إعادة تحميل الصفحة، تكراره → الصفحة الرئيسية، ولا تظهر رسالة خطأ للمستخدم */
let recovering = false;
function recover() {
  if (recovering) return true; // خطأ واحد قد يُلتقط أكثر من مرة: إجراء واحد فقط لكل تحميل للصفحة
  recovering = true;
  let st = {};
  try { st = JSON.parse(sessionStorage.getItem('av_recover') || '{}'); } catch { /* ignore */ }
  const now = Date.now();
  const recent = st.t && now - st.t < 30000;
  const step = recent ? (st.step || 0) + 1 : 0;
  try { sessionStorage.setItem('av_recover', JSON.stringify({ t: now, step })); } catch { /* ignore */ }
  if (step === 0) { window.location.reload(); return true; }
  if (step === 1 && location.pathname !== '/') { window.location.replace('/'); return true; }
  return false;
}

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null, recovering: false }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('UI error:', error, info?.componentStack);
    report(error, info);
    if (this.props.fallback === undefined) this.setState({ recovering: recover() });
  }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, recovering: false }); }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // شاشة تحميل هادئة أثناء التعافي، ورسالة بسيطة فقط إن تعذّر بعد المحاولتين
    return (
      <div className="d-grid gap-3 text-center py-5" style={{ placeItems: 'center', minHeight: '60vh' }} role="status">
        <img src="/icon-192.png" alt="" style={{ width: 64, height: 64, borderRadius: 16 }} />
        {this.state.recovering
          ? <div className="spinner-border text-secondary" aria-label="جارٍ التحميل" />
          : <>
            <div className="text-body-secondary">جارٍ تحديث الصفحة…</div>
            <a className="btn btn-dark" href="/">الصفحة الرئيسية</a>
          </>}
      </div>
    );
  }
}

/** على مستوى التطبيق: يتصفّر الخطأ عند تغيير الصفحة */
export function AppErrorBoundary({ children }) {
  const loc = useLocation();
  return <Boundary resetKey={loc.pathname}>{children}</Boundary>;
}

/** لجزء صغير (مثل الصورة): عند الخطأ يُعرض البديل فقط */
export function SafeBlock({ children, fallback = null, resetKey }) {
  return <Boundary fallback={fallback} resetKey={resetKey}>{children}</Boundary>;
}
