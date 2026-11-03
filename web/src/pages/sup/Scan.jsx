import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useScanner } from '../../useScanner.js';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtW, DESIGN_STATUS } from '../../format.js';
import { Card, Page, ScanInput, useToast, Kv, LinkBtn, Badge } from '../../ui.jsx';

/** مسح QR الطلب للوصول المباشر لبياناته (مع تطبيق الصلاحيات في الخادم) */
export default function Scan() {
  const { can } = useAuth();
  const toast = useToast();
  const [o, setO] = useState(null);
  const scan = async (code) => { try { setO(await api.get(`/sup/lookup?code=${encodeURIComponent(code)}`)); } catch (e) { setO(null); toast(e.message, 'bad'); } };
  const [sp] = useSearchParams();
  useEffect(() => { if (sp.get('code')) scan(sp.get('code')); }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  useScanner(scan);
  return (
    <Page title="مسح QR" subtitle="امسح ملصق الطلب بالكاميرا أو قارئ الباركود">
      <ScanInput onScan={scan} />
      {o && (
        <Card className="mt" title={<span>{o.order_no} — {o.title}</span>} actions={<Badge tone="gold">{o.stage_name || o.status}</Badge>}>
          <Kv items={[['المادة', o.material_name], ['الكمية', o.quantity], ['رصيد ذهب الطلب', `${fmtW(o.order_balance)} جم`], ['حالة التصميم', DESIGN_STATUS[o.design_status]],
            ['لدى العمال', o.open_custodies.map((c) => `${c.full_name} (${fmtW(c.weight_issued)})`).join('، ') || '—']]} />
          <div className="hrow gap wrap mt">
            {can('orders.view') && <LinkBtn to={`/orders/${o.id}`} kind="dark">فتح الطلب</LinkBtn>}
            {can('custody.issue', 'custody.receive', 'orders.advance', 'scan.use') && <LinkBtn to={`/sup/casting?order=${o.id}`} kind="primary">الصب</LinkBtn>}
            {can('custody.issue') && o.handles_gold && !o.open_custodies.length && <LinkBtn to={`/sup/issue?order=${o.id}`} kind="primary">تسليم لعامل</LinkBtn>}
            {can('custody.receive') && o.open_custodies.map((c) => <LinkBtn key={c.id} to={`/sup/receive?worker=${c.worker_id}`}>استلام من {c.full_name}</LinkBtn>)}
            {!can('orders.view') && <Link to="/" className="link">رجوع</Link>}
          </div>
        </Card>
      )}
    </Page>
  );
}
