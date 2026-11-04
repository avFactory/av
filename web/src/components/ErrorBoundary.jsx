import { Component } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * يمنع الشاشة البيضاء: أي خطأ في جزء من الواجهة يظهر رسالة بدلاً من اختفاء الصفحة كاملة،
 * ويُعاد المحاولة تلقائياً عند الانتقال لصفحة أخرى.
 */
class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI error:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="container py-5 text-center" role="alert">
        <h2 className="h5 fw-bold mb-2">حدث خطأ في عرض هذه الصفحة</h2>
        <p className="text-body-secondary mb-3">لم تتأثر بياناتك. أعد تحميل الصفحة أو ارجع للخلف.</p>
        <div className="d-flex gap-2 justify-content-center">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>إعادة تحميل الصفحة</button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => { this.setState({ error: null }); window.history.back(); }}>رجوع</button>
        </div>
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
