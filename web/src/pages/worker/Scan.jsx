import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { ScanInput, useToast } from '../../ui.jsx';

/** العامل يمسح QR لرؤية مهمته (الخادم يرفض الطلبات غير المسندة إليه) */
export default function WScan() {
  const nav = useNavigate();
  const toast = useToast();
  const scan = async (code) => {
    try {
      const o = await api.get(`/sup/lookup?code=${encodeURIComponent(code)}`);
      const t = await api.get('/w/tasks');
      const ids = [o.id, ...(o.group || []).map((g) => g.id)];
      const c = t.custodies.find((x) => ids.includes(x.order_id));
      nav(c ? `/w/custody/${c.id}` : `/w/orders/${o.id}`);
    } catch (e) { toast(e.message, 'bad'); }
  };
  return <div className="wk-body"><h2>مسح QR الطلب</h2><ScanInput onScan={scan} /></div>;
}
