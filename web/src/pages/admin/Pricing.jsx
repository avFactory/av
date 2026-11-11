import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Card, Input, Loader, Page, useAction, useFetch } from '../../ui.jsx';
import PricingSheet from '../../components/PricingSheet.jsx';

/** إدارة صفحة التسعيرة: سعر الذهب، الثوابت، والرابط الخارجي */
export default function Pricing() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/admin/pricing');
  const [s, setS] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setS(data); }, [data]);
  if (!s) return <Loader />;
  const manage = can('pricing.manage');
  const url = `${location.origin}/p/${s.token}`;
  const shortUrl = `${location.origin}/p/${s.token_short}`;
  const copyText = async (u) => { try { await navigator.clipboard.writeText(u); } catch { window.prompt('انسخ الرابط', u); } };
  const copy = () => copyText(url);
  const save = () => run(async () => { setS(await api.put('/admin/pricing', { gold24: s.gold24, updated_at: s.updated_at, rows: s.rows })); }, 'تم حفظ التسعيرة');
  const rotate = (which = 'full') => {
    if (!window.confirm('إنشاء رابط جديد؟ الرابط القديم سيتوقف فوراً عن العمل لكل من لديه.')) return;
    run(async () => { await api.post('/admin/pricing/token', { which }); reload(); }, 'تم إنشاء رابط جديد').catch(() => {});
  };
  return (
    <Page title="التسعيرة" subtitle="نفس ورقة التسعيرة في Excel — الزائر برابط خارجي يُدخل الأوزان فقط"
      actions={manage && (
        <div className="pricing-admin-gold">
          <label><span>سعر الذهب الصافي عيار 24 (ر.س/جم)</span><Input dir="ltr" value={s.gold24} onChange={(e) => setS({ ...s, gold24: e.target.value })} /></label>
          <label><span>آخر تحديث</span><Input type="date" value={s.updated_at || ''} onChange={(e) => setS({ ...s, updated_at: e.target.value })} /></label>
          <Btn loading={busy} onClick={save}>حفظ السعر</Btn>
        </div>
      )}>
      <div className="grid g2 mb align-items-start">
        {s.token && <details className="card shadow-sm link-drop">
          <summary>رابط التسعيرة الكاملة</summary>
          <div className="link-drop-body">
          <p className="small text-body-secondary">أي شخص لديه هذا الرابط يفتح التسعيرة بكل أعمدتها بدون تسجيل دخول، ولا يرى أي شيء آخر في النظام، ويستطيع إدخال الأوزان فقط (لا تُحفظ).</p>
          <input className="form-control mb-2" dir="ltr" readOnly value={url} onFocus={(e) => e.target.select()} />
          <div className="hrow gap wrap">
            <Btn onClick={copy}>نسخ الرابط</Btn>
            <a className="btn btn-success" href={`https://wa.me/?text=${encodeURIComponent(`التسعيرة الكاملة لمنتجات AV:\n${url}`)}`} target="_blank" rel="noreferrer">إرسال واتساب</a>
            <a className="btn btn-outline-secondary" href={url} target="_blank" rel="noreferrer">فتح كما يراه الزائر</a>
            {can('links.pricing') && <Btn kind="danger" loading={busy} onClick={() => rotate('full')}>إيقاف الرابط وإنشاء رابط جديد</Btn>}
          </div>
          </div>
        </details>}
        {s.token_short && <details className="card shadow-sm link-drop">
          <summary>رابط التسعيرة المختصرة</summary>
          <div className="link-drop-body">
          <p className="small text-body-secondary">أعمدة مختصرة فقط: المنتج، الأوزان، تكاليف المصنع (للتصاميم الذهب)، والسعر شامل الضريبة للقطاعي. التكاليف والفائدة لا تصل لجهاز الزائر إطلاقاً.</p>
          <input className="form-control mb-2" dir="ltr" readOnly value={shortUrl} onFocus={(e) => e.target.select()} />
          <div className="hrow gap wrap">
            <Btn onClick={() => copyText(shortUrl)}>نسخ الرابط</Btn>
            <a className="btn btn-success" href={`https://wa.me/?text=${encodeURIComponent(`التسعيرة المختصرة لمنتجات AV:\n${shortUrl}`)}`} target="_blank" rel="noreferrer">إرسال واتساب</a>
            <a className="btn btn-outline-secondary" href={shortUrl} target="_blank" rel="noreferrer">فتح كما يراه الزائر</a>
            {can('links.pricing_short') && <Btn kind="danger" loading={busy} onClick={() => rotate('short')}>إيقاف الرابط وإنشاء رابط جديد</Btn>}
          </div>
          </div>
        </details>}
      </div>
      {manage && <><Card title="الثوابت والأوزان الافتراضية" actions={<Btn size="sm" loading={busy} onClick={save}>حفظ</Btn>}>
        <p className="small text-body-secondary">الخانات القابلة للتعديل هنا (المصنعية، تكاليف المصنع، الفائدة، سعر القيراط، سعر اللؤلؤ) لا يستطيع الزائر تغييرها. الأوزان هنا هي القيم الافتراضية التي تظهر للزائر قبل أن يكتب.</p>
        <PricingSheet data={s} mode="admin" rows={s.rows} onRowsChange={(rows) => setS({ ...s, rows })} />
      </Card>
      </>}
    </Page>
  );
}
