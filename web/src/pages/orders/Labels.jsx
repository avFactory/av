import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Btn, Loader, ErrorBox, Select, useAction } from '../../ui.jsx';
import { labelsToZpl, zebraPrinters, zebraSend, downloadZpl, drawLabel } from '../../zebra.js';

const CFG_KEY = 'zebra_cfg';
const loadCfg = () => { try { return { mode: 'browser', dpi: 203, w: 62, h: 38, darkness: '', ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { mode: 'browser', dpi: 203, w: 62, h: 38, darkness: '' }; } };

/**
 * ملصقات الطلبات 62×38 مم.
 * - طباعة المتصفح: A4 متجاورة أو طابعة ملصقات (ملصق لكل ورقة) عبر تعريف الطابعة.
 * - Zebra مباشر: أوامر ZPL عبر برنامج Zebra Browser Print المثبت على الجهاز (إعدادات كل جهاز تُحفظ فيه).
 * ?auto=1 يطبع تلقائياً بالطريقة المحفوظة على هذا الجهاز.
 */
export default function Labels() {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [roll, setRoll] = useState(() => { try { return localStorage.getItem('label_roll') === '1'; } catch { return false; } });
  const [cfg, setCfg] = useState(loadCfg);
  const [printers, setPrinters] = useState(null);
  const [zErr, setZErr] = useState('');
  const [preview, setPreview] = useState('');
  const [run, busy] = useAction();
  const autoDone = useRef(false);
  const zebra = cfg.mode === 'zebra';
  const set = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value }));
  const opts = { dpi: Number(cfg.dpi) || 203, w: Number(cfg.w) || 62, h: Number(cfg.h) || 38, darkness: cfg.darkness === '' ? null : Number(cfg.darkness) };

  useEffect(() => { try { localStorage.setItem('label_roll', roll ? '1' : '0'); } catch { /* ignore */ } }, [roll]);
  useEffect(() => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ } }, [cfg]);
  useEffect(() => { api.get(`/orders/labels?ids=${encodeURIComponent(sp.get('ids') || '')}`).then(setRows).catch(setErr); }, [sp]);

  const findPrinters = async () => {
    setZErr('');
    try {
      const list = await zebraPrinters();
      setPrinters(list);
      if (!list.length) setZErr('البرنامج يعمل لكن لم يجد طابعة Zebra. تأكد من توصيل الطابعة وتشغيلها، ثم أضفها من إعدادات Zebra Browser Print.');
      else if (!list.some((p) => p.uid === cfg.device?.uid)) setCfg((c) => ({ ...c, device: list[0] }));
      return list;
    } catch (e) { setZErr(e.message); setPrinters([]); return []; }
  };
  useEffect(() => { if (zebra && printers === null) findPrinters(); }, [zebra]); // eslint-disable-line react-hooks/exhaustive-deps

  // معاينة الملصق كما سيُرسل للطابعة
  useEffect(() => {
    if (!zebra || !rows?.length) return;
    drawLabel(rows[0], opts).then((c) => setPreview(c.toDataURL()));
  }, [zebra, rows, cfg.dpi, cfg.w, cfg.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const printZebra = async (device = cfg.device) => {
    if (!device) throw new Error('اختر طابعة Zebra أولاً');
    await zebraSend(device, await labelsToZpl(rows, opts));
  };

  // الطباعة التلقائية بالطريقة المحفوظة على هذا الجهاز
  useEffect(() => {
    if (!rows?.length || sp.get('auto') !== '1' || autoDone.current) return;
    autoDone.current = true;
    if (zebra && cfg.device) {
      run(() => printZebra(), `أُرسلت ${rows.length} ملصق للطابعة`).catch(() => {});
      return;
    }
    const logo = new Image();
    logo.src = '/logo.png';
    Promise.all([document.fonts?.ready, logo.decode?.().catch(() => {})]).then(() => setTimeout(() => window.print(), 50));
  }, [rows, sp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div style={{ padding: 16 }}><ErrorBox error={err} /></div>;
  if (!rows) return <Loader />;
  return (
    <div className="labels-page" style={{ padding: 16 }}>
      {roll && !zebra && <style>{'@media print { @page { size: 62mm 38mm; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; } .labels-page { padding: 0 !important; } .labels { display: block !important; } .label { border: 0 !important; border-radius: 0 !important; } .label:not(:last-child) { break-after: page; page-break-after: always; } }'}</style>}
      <div className="no-print mb d-grid gap-2">
        <div className="btn-group" role="group" style={{ justifySelf: 'start' }}>
          <button type="button" className={`btn ${!zebra ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setCfg((c) => ({ ...c, mode: 'browser' }))}>طباعة عادية (المتصفح)</button>
          <button type="button" className={`btn ${zebra ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setCfg((c) => ({ ...c, mode: 'zebra' }))}>طابعة Zebra مباشرة</button>
        </div>

        {!zebra ? (
          <div className="hrow gap wrap">
            <Btn onClick={() => window.print()}>طباعة الملصقات ({rows.length})</Btn>
            <label className="check"><input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} /> طابعة ملصقات (ملصق واحد لكل ورقة 62×38 مم)</label>
            <span className="muted small">بدون هذا الخيار تُطبع الملصقات متجاورة على ورق A4</span>
          </div>
        ) : (
          <div className="card"><div className="card-body d-grid gap-3">
            <div className="hrow gap wrap align-items-end">
              <div style={{ minWidth: 240 }}>
                <label className="form-label small mb-1">الطابعة</label>
                <div className="d-flex gap-2">
                  <Select value={cfg.device?.uid || ''} onChange={(e) => setCfg((c) => ({ ...c, device: (printers || []).find((p) => p.uid === e.target.value) }))}
                    placeholder={printers === null ? 'جارٍ البحث…' : 'اختر الطابعة'} options={(printers || []).map((p) => [p.uid, `${p.name}${p.connection ? ` (${p.connection})` : ''}`])} />
                  <Btn kind="ghost" onClick={findPrinters}>بحث</Btn>
                </div>
              </div>
              <div><label className="form-label small mb-1">دقة الطابعة</label>
                <Select value={String(cfg.dpi)} onChange={set('dpi')} options={[['203', '203 dpi (8 نقاط/مم)'], ['300', '300 dpi (12 نقطة/مم)'], ['600', '600 dpi']]} /></div>
              <div style={{ width: 90 }}><label className="form-label small mb-1">العرض مم</label><input className="form-control" dir="ltr" value={cfg.w} onChange={set('w')} /></div>
              <div style={{ width: 90 }}><label className="form-label small mb-1">الطول مم</label><input className="form-control" dir="ltr" value={cfg.h} onChange={set('h')} /></div>
              <div style={{ width: 110 }}><label className="form-label small mb-1">الغمق (0-30)</label><input className="form-control" dir="ltr" placeholder="افتراضي" value={cfg.darkness} onChange={set('darkness')} /></div>
            </div>
            {zErr && <div className="alert alert-warning small mb-0">{zErr}</div>}
            <div className="hrow gap wrap">
              <Btn loading={busy} disabled={!cfg.device} onClick={() => run(() => printZebra(), `أُرسلت ${rows.length} ملصق للطابعة`).catch(() => {})}>طباعة على Zebra ({rows.length})</Btn>
              <Btn kind="ghost" loading={busy} onClick={() => run(async () => downloadZpl(await labelsToZpl(rows, opts), `labels-${Date.now()}.zpl`)).catch(() => {})}>تنزيل ملف ZPL</Btn>
            </div>
            {preview && <div><div className="small muted mb-1">معاينة ما سيُطبع (أبيض وأسود بدقة الطابعة):</div><img src={preview} alt="" style={{ width: `${opts.w}mm`, height: `${opts.h}mm`, border: '1px solid #999', imageRendering: 'pixelated', background: '#fff' }} /></div>}
            <details className="small">
              <summary className="fw-semibold">طريقة التجهيز على كل جهاز (مرة واحدة)</summary>
              <ol className="mt-2 mb-0">
                <li>ثبّت تعريف الطابعة <b>ZDesigner</b> من موقع Zebra، ووصّل الطابعة (USB أو شبكة) وتأكد أنها تطبع صفحة تجربة.</li>
                <li>ثبّت برنامج <b>Zebra Browser Print</b> المجاني من موقع Zebra (ويندوز أو ماك) وشغّله، وستظهر أيقونته بجانب الساعة.</li>
                <li>من إعدادات البرنامج اختر الطابعة الافتراضية، وعند أول طباعة وافق على السماح لموقع <b dir="ltr">avfactory.sa</b>.</li>
                <li>إذا ظهر خطأ اتصال افتح الرابط <a href="https://127.0.0.1:9101/ssl_support" target="_blank" rel="noreferrer" dir="ltr">https://127.0.0.1:9101/ssl_support</a> مرة واحدة واقبل الشهادة، ثم اضغط "بحث". وإذا طلب المتصفح إذن "الوصول للشبكة المحلية/الأجهزة" اضغط سماح.</li>
                <li>اختر دقة الطابعة الصحيحة (مكتوبة أسفل الطابعة: 203 أو 300 dpi) ومقاس الملصق. الإعدادات تُحفظ على هذا الجهاز.</li>
                <li>على الجوال/التابلت (أندرويد): استخدم "طباعة عادية" مع تطبيق <b>Zebra Print Service</b> من متجر Play، أو نزّل ملف ZPL وأرسله بتطبيق Zebra Printer Setup.</li>
              </ol>
            </details>
          </div></div>
        )}
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
