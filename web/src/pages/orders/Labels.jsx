import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Btn, Loader, ErrorBox } from '../../ui.jsx';

/** ملصقات الطلبات 62×38 مم: طلب واحد للبيانات، QR مضمّن، وطباعة تلقائية عند الجاهزية (?auto=1) */
export default function Labels() {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [roll, setRoll] = useState(() => { try { return localStorage.getItem('label_roll') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('label_roll', roll ? '1' : '0'); } catch { /* ignore */ } }, [roll]);
  useEffect(() => { api.get(`/orders/labels?ids=${encodeURIComponent(sp.get('ids') || '')}`).then(setRows).catch(setErr); }, [sp]);

  // الطباعة فور اكتمال الخطوط وصورة الشعار
  useEffect(() => {
    if (!rows?.length || sp.get('auto') !== '1') return;
    const logo = new Image();
    logo.src = '/logo.png';
    Promise.all([document.fonts?.ready, logo.decode?.().catch(() => {})]).then(() => setTimeout(() => window.print(), 50));
  }, [rows, sp]);

  if (err) return <div style={{ padding: 16 }}><ErrorBox error={err} /></div>;
  if (!rows) return <Loader />;
  return (
    <div className="labels-page" style={{ padding: 16 }}>
      {roll && <style>{'@media print { @page { size: 62mm 38mm; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; } .labels-page { padding: 0 !important; } .labels { display: block !important; } .label { border: 0 !important; border-radius: 0 !important; } .label:not(:last-child) { break-after: page; page-break-after: always; } }'}</style>}
      <div className="no-print row gap wrap mb">
        <Btn onClick={() => window.print()}>طباعة الملصقات ({rows.length})</Btn>
        <label className="check"><input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} /> طابعة ملصقات (ملصق واحد لكل ورقة 62×38 مم)</label>
        <span className="muted small">بدون هذا الخيار تُطبع الملصقات متجاورة على ورق A4</span>
      </div>
      <div className="labels">
        {rows.map((o) => (
          <div key={o.id} className="label">
            {/* SVG مولَّد من الخادم بمكتبة qrcode من رمز الطلب فقط */}
            <div className="label-qr" dangerouslySetInnerHTML={{ __html: o.qr_svg }} />
            <div className="label-info">
              <img className="label-logo" src="/logo.png" alt="AV" />
              <span className="label-no">{o.order_no}</span>
              <span className="label-title">{o.title}</span>
              <span className="label-line">{o.material_name}</span>
              <span className="label-line">الكمية {o.quantity}{o.size ? ` · مقاس ${o.size}` : ''}</span>
              {o.shop_name && <span className="label-line label-shop">{o.shop_name}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
