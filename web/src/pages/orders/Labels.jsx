import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qrUrl } from '../../api.js';
import { Btn, Loader } from '../../ui.jsx';

/** ملصقات قابلة للطباعة: رقم الطلب + QR + البيانات الأساسية */
export default function Labels() {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const ids = (sp.get('ids') || '').split(',').filter(Boolean);
    Promise.all(ids.map((id) => api.get(`/orders/${id}`).then((d) => d.order))).then(setRows);
  }, [sp]);
  if (!rows) return <Loader />;
  return (
    <div style={{ padding: 16 }}>
      <div className="no-print row gap mb"><Btn onClick={() => window.print()}>طباعة الملصقات</Btn><span className="muted">مقاس الملصق 62×38 مم</span></div>
      <div className="labels">
        {rows.map((o) => (
          <div key={o.id} className="label">
            <img src={qrUrl(o.qr_token)} alt="QR" />
            <div>
              <img src="/logo.png" alt="AV" style={{ height: '5mm', width: 'auto', display: 'block' }} />
              <b>{o.order_no}</b>
              <div>{o.title}</div>
              <div>{o.material_name}</div>
              <div>الكمية: {o.quantity}{o.size ? ` · مقاس ${o.size}` : ''}</div>
              {o.shop_name && <div>{o.shop_name}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
