import { code128 } from '../barcode.js';
import { COLORS } from '../format.js';

const KIND = { labor: 'أجور تصنيع', stage_labor: 'أجرة مرحلة', stones: 'ألماس مخبري/أحجار', service: 'خدمة', other: 'أخرى' };
const PAY = { cash: 'نقدي', transfer: 'تحويل بنكي', card: 'البطاقة الائتمانية', cheque: 'شيك', other: 'أخرى' };
const sar = (v) => `SAR ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const w3 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dt = (d) => new Date(d).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' });

function Barcode({ text }) {
  const b = code128(text);
  return (
    <div className="inv-barcode">
      <svg viewBox={`0 0 ${b.width} 40`} preserveAspectRatio="none" aria-label={text}><path d={b.path} fill="#000" /></svg>
      <div dir="ltr">{text}</div>
    </div>
  );
}

/** الفاتورة الضريبية / الإشعار الدائن (المرتجع) بتصميم موحّد للطباعة A4 */
export default function InvoiceDoc({ data }) {
  const { invoice: i, lines, payments = [], company: c = {}, branch, link, link_qr_svg: qr } = data;
  const credit = i.invoice_type === 'credit_note';
  const rate = Number(i.vat_rate);
  const paid = payments.reduce((s, p) => s + (p.kind === 'refund' ? -1 : 1) * Number(p.amount), 0);
  const methods = [...new Set(payments.map((p) => PAY[p.method] || p.method))];
  const orders = [...new Set(lines.map((l) => l.order_no).filter(Boolean))];
  const weight = lines.reduce((s, l) => s + Number(l.weight || 0), 0);
  // عدد القطع من كمية كل طلب (مرة واحدة لكل طلب) — كمية البند قد تكون جرامات
  const pieces = [...new Map(lines.filter((l) => l.order_no).map((l) => [l.order_no, Number(l.order_qty || 0)])).values()].reduce((a, b) => a + b, 0);
  return (
    <div className="inv-doc">
      <div className="inv-top">
        <img src="/logo.png" alt="AV" className="inv-logo" />
        <div className="inv-title">{credit ? 'إشعار دائن (مرتجع)' : 'فاتورة ضريبية'}</div>
      </div>

      <div className="inv-row inv-head">
        <div>
          <div className="inv-h">{credit ? 'تفاصيل الإشعار' : 'تفاصيل الفاتورة'}</div>
          <div>رقم {credit ? 'الإشعار' : 'الفاتورة'} : <b dir="ltr">{i.invoice_no}</b></div>
          <div>الرقم الضريبي : <b dir="ltr">{c.vat_number || '—'}</b></div>
          {credit && i.credit_for_no && <div>مرجع الفاتورة الأصلية : <b dir="ltr">{i.credit_for_no}</b></div>}
          {i.credited_by && <div className="inv-muted">أُلغيت بإشعار دائن : <span dir="ltr">{i.credited_by}</span></div>}
        </div>
        <div className="inv-date">
          <div className="inv-muted">تاريخ {credit ? 'الإشعار' : 'الفاتورة'}: <span dir="ltr">{dt(i.issue_date)}</span></div>
          <Barcode text={i.invoice_no} />
        </div>
      </div>

      <div className="inv-row inv-parties">
        <div>
          <div className="inv-h u">مُصدرة من:</div>
          <div><b>{c.name || 'مصنع AV للمجوهرات'}</b></div>
          <div>{c.country || 'السعودية'}</div>
          {c.city && <div>{c.city}</div>}
          {c.address && <div>{c.address}</div>}
          {c.cr_number && <div>السجل التجاري: <span dir="ltr">{c.cr_number}</span></div>}
          {c.email && <div dir="ltr" className="inv-ltr">{c.email}</div>}
          {c.phone && <div dir="ltr" className="inv-ltr">{c.phone}</div>}
        </div>
        <div>
          <div className="inv-h u">مُصدرة إلى:</div>
          <div><b>{i.shop_name}</b>{branch?.name ? ` — ${branch.name}` : ''}</div>
          <div>السعودية</div>
          {(branch?.city || i.customer_city) && <div>{branch?.city || i.customer_city}</div>}
          {(branch?.address || i.customer_address) && <div>{branch?.address || i.customer_address}</div>}
          {i.customer_vat && <div>الرقم الضريبي: <span dir="ltr">{i.customer_vat}</span></div>}
          {i.customer_cr && <div>السجل التجاري: <span dir="ltr">{i.customer_cr}</span></div>}
          {(branch?.phone || i.customer_phone) && <div dir="ltr" className="inv-ltr">{branch?.phone || i.customer_phone}</div>}
          {i.customer_email && <div dir="ltr" className="inv-ltr">{i.customer_email}</div>}
        </div>
      </div>

      <div className="inv-row inv-parties">
        <div>
          <div className="inv-h u">تفاصيل الدفع:</div>
          <div className="inv-kv"><span>المبلغ:</span><b dir="ltr">{sar(i.total)}</b></div>
          <div className="inv-kv"><span>طريقة الدفع:</span><span>{methods.length ? methods.join('، ') : 'آجل'}</span></div>
          {!credit && <div className="inv-kv"><span>المدفوع:</span><span dir="ltr">{sar(paid)}</span></div>}
          {!credit && <div className="inv-kv"><span>المتبقي:</span><span dir="ltr">{sar(Math.max(0, Number(i.total) - paid))}</span></div>}
        </div>
        <div>
          <div className="inv-h u">تفاصيل الطلب:</div>
          {orders.length > 0 && <div className="inv-kv"><span>رقم الطلب:</span><span dir="ltr">{orders.join('، ')}</span></div>}
          {pieces > 0 && <div className="inv-kv"><span>عدد القطع:</span><span>{pieces}</span></div>}
          {weight > 0 && <div className="inv-kv"><span>إجمالي الوزن:</span><span><span dir="ltr">{w3(weight)}</span> جم</span></div>}
          <div className="inv-kv"><span>البيان:</span><span>أجور تصنيع (لا تشمل قيمة الذهب)</span></div>
        </div>
      </div>

      <table className="inv-table">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
        <tbody>
          {lines.map((l) => {
            const unitVat = Number(l.unit_price) * rate / 100;
            return (
              <tr key={l.id}>
                <td>
                  <div className="inv-prod">
                    {l.thumb_data ? <img src={l.thumb_data} alt="" /> : <span className="inv-noimg">◇</span>}
                    <div>
                      <div className="inv-pname">{l.description || l.order_title}</div>
                      {l.weight && <div className="inv-gold">الوزن: <span dir="ltr">{w3(l.weight)}</span> جم</div>}
                      <div className="inv-muted">{KIND[l.kind] || l.kind}{l.order_no ? <> · <span dir="ltr">{l.order_no}</span></> : ''}</div>
                    </div>
                  </div>
                  {(l.karat || l.size) && (
                    <div className="inv-opts">
                      <div className="inv-h u">خيارات المنتج</div>
                      {l.karat && <div className="inv-kv"><span>اللون</span><span>ذهب عيار {l.karat} {COLORS[l.color] || ''}</span></div>}
                      {l.size && <div className="inv-kv"><span>المقاس</span><span>{l.size}</span></div>}
                    </div>
                  )}
                  {l.order_notes && <div className="inv-opts"><div className="inv-h u">ملاحظة المنتج</div><div className="inv-muted">{l.order_notes}</div></div>}
                </td>
                <td className="inv-n">{Number(l.qty)}{l.unit && l.unit !== 'قطعة' ? <div className="inv-muted">{l.unit}</div> : null}</td>
                <td className="inv-n">
                  <b dir="ltr">{sar(l.unit_price)}</b>
                  <div className="inv-muted">الضريبة ({rate}%): <span dir="ltr">{sar(unitVat)}</span></div>
                  <div className="inv-muted">السعر شامل الضريبة: <span dir="ltr">{sar(Number(l.unit_price) + unitVat)}</span></div>
                </td>
                <td className="inv-n"><b dir="ltr">{sar(l.amount)}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="inv-totals">
        <div><span>الإجمالي الفرعي (غير شامل الضريبة)</span><b dir="ltr">{sar(i.subtotal)}</b></div>
        <div className="g"><span>الضريبة ({rate}%)</span><b dir="ltr">+ {sar(i.vat_amount)}</b></div>
        <div className="t"><span>{credit ? 'إجمالي المرتجع' : 'إجمالي الفاتورة'}</span><b dir="ltr">{sar(i.total)}</b></div>
      </div>
      {i.notes && <div className="inv-note">{i.notes}</div>}

      <div className="inv-contact">
        <div className="inv-h">بيانات التواصل</div>
        <div><b>{c.name || 'مصنع AV للمجوهرات'}</b></div>
        {c.phone && <div dir="ltr" className="inv-ltr">{c.phone}</div>}
        {c.email && <div dir="ltr" className="inv-ltr">{c.email}</div>}
      </div>

      {qr && (
        <div className="inv-qr">
          <a href={link} target="_blank" rel="noreferrer" aria-label="رابط الفاتورة"><span dangerouslySetInnerHTML={{ __html: qr }} /></a>
          <div>امسح الرمز لعرض {credit ? 'الإشعار' : 'الفاتورة'} إلكترونياً</div>
        </div>
      )}
      <div className="inv-foot">شكراً لتعاملكم مع {c.name || 'مصنع AV للمجوهرات'}. نتمنى لكم يوماً رائعاً!</div>
    </div>
  );
}
