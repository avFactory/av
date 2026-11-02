import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { fmtW } from '../../format.js';
import { Card, Loader, Table, useFetch, Badge } from '../../ui.jsx';

export default function SupHome() {
  const { can } = useAuth();
  const { data: s } = useFetch('/sup/summary', { live: ['custodies', 'settlements', 'orders'] });
  const { data: waiting } = useFetch('/sup/awaiting-issue', { live: ['custodies', 'orders'] });
  const { data: workers } = useFetch('/sup/workers', { live: ['custodies', 'settlements'] });
  if (!s) return <Loader />;
  const ready = (workers || []).filter((w) => w.finished_count > 0);
  return (
    <div className="page">
      {s.rejected > 0 && <Link to="/sup/workers" className="alert alert-bad mb" style={{ display: 'block', textDecoration: 'none' }}>⚠ {s.rejected} تسليم رفضه العمال - افتح ملف العامل لتصحيحه</Link>}
      <div className="page-h"><div><h1>لوحة المشرف</h1><p className="muted">الذهب لدى العمال الآن: <b dir="ltr">{fmtW(s.with_workers_weight)}</b> جم مع {s.active_workers} عامل{s.pending_ack ? ` · ${s.pending_ack} تسليم بانتظار قبول العمال` : ''}</p></div></div>
      <div className="sup-cards">
        <Link to="/sup/issue" className="sup-card"><b>{s.awaiting_issue}</b><span>طلبات بانتظار التسليم</span></Link>
        <Link to="/sup/workers" className="sup-card"><b>{s.with_workers}</b><span>طلبات موجودة لدى العمال</span></Link>
        <Link to="/sup/receive" className="sup-card"><b>{s.awaiting_receive}</b><span>طلبات بانتظار الاستلام</span></Link>
        <Link to="/sup/review" className={`sup-card ${s.abnormal ? 'alarm' : ''}`}><b>{s.abnormal}</b><span>عجز غير طبيعي يحتاج مراجعة</span></Link>
      </div>
      <div className="sup-actions">
        {can('custody.issue') && <Link to="/sup/issue" className="big-action ba-issue"><i>↧</i><span>تسليم ذهب للعامل<small>لعامل واحد أو تقسيم طلب على عدة عمال</small></span></Link>}
        {can('custody.receive') && <Link to="/sup/receive" className="big-action ba-receive"><i>↥</i><span>استلام ذهب من العامل<small>وزن واحد لكل طلب والحساب تلقائي</small></span></Link>}
        <Link to="/sup/workers" className="big-action ba-workers"><i>☷</i><span>متابعة العمال والعهد<small>ملف كامل لكل عامل</small></span></Link>
        {can('loss.review', 'loss.investigate') && <Link to="/sup/review" className={`big-action ba-review ${s.abnormal ? 'alarm' : ''}`}><i>⚠</i><span>مراجعة العجز<small>{s.abnormal ? `${s.abnormal} حالة مفتوحة` : 'لا توجد حالات مفتوحة'}</small></span></Link>}
      </div>
      <div className="grid g2 mt">
        <Card title="عمال أنهوا العمل - بانتظار الاستلام" pad={false}>
          <Table rows={ready} empty="لا يوجد" columns={[
            ['العامل', (w) => <b>{w.full_name}</b>], ['الطلبات المنتهية', 'finished_count'], ['الذهب لديه', (w) => <span className="n">{fmtW(w.open_weight)}</span>],
            ['', (w) => <Link className="btn btn-dark btn-sm" to={`/sup/receive?worker=${w.id}`}>استلام</Link>],
          ]} />
        </Card>
        <Card title="طلبات بانتظار تسليم الذهب" pad={false}>
          <Table rows={(waiting || []).slice(0, 12)} empty="لا يوجد" columns={[
            ['الطلب', (o) => <Link to={`/orders/${o.id}`} className="link">{o.order_no}</Link>], ['المرحلة', 'stage_name'], ['المادة', 'material_name'],
            ['العامل المقترح', (o) => o.assigned_worker_name || <Badge>غير محدد</Badge>],
            ['', (o) => <Link className="btn btn-primary btn-sm" to={`/sup/issue?order=${o.id}${o.assigned_worker_id ? `&worker=${o.assigned_worker_id}` : ''}`}>تسليم</Link>],
          ]} />
        </Card>
      </div>
    </div>
  );
}
