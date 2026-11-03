import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Card, Field, Input, Loader, Page, useAction, useFetch } from '../../ui.jsx';
import PricingSheet from '../../components/PricingSheet.jsx';

/** إدارة صفحة التسعيرة: سعر الذهب، الثوابت، والرابط الخارجي */
export default function Pricing() {
  const { can } = useAuth();
  const { data, reload } = useFetch('/admin/pricing');
  const [s, setS] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setS(data); }, [data]);
  if (!s) return <Loader />;
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
    <Page title="التسعيرة" subtitle="نفس ورقة التسعيرة في Excel — الزائر برابط خارجي يُدخل الأوزان فقط">
      <div className="grid g2 mb">
        <Card title="سعر الذهب">
          <div className="grid g2">
            <Field label="سعر الذهب الصافي عيار 24 (ر.س/جم)"><Input dir="ltr" value={s.gold24} onChange={(e) => setS({ ...s, gold24: e.target.value })} /></Field>
            <Field label="آخر تحديث" hint="يتحدث تلقائياً عند تغيير السعر"><Input type="date" value={s.updated_at || ''} onChange={(e) => setS({ ...s, updated_at: e.target.value })} /></Field>
          </div>
          <div className="hrow end mt"><Btn loading={busy} onClick={save}>حفظ التسعيرة</Btn></div>
        </Card>
        <Card title="الرابط الخارجي">
          <p className="small text-body-secondary">أي شخص لديه هذا الرابط يفتح التسعيرة بدون تسجيل دخول، ولا يرى أي شيء آخر في النظام، ويستطيع إدخال الأوزان فقط (لا تُحفظ).</p>
          <input className="form-control mb-2" dir="ltr" readOnly value={url} onFocus={(e) => e.target.select()} />
          <div className="hrow gap wrap">
            <Btn onClick={copy}>نسخ الرابط</Btn>
            <a className="btn btn-success" href={`https://wa.me/?text=${encodeURIComponent(`تسعيرة منتجات AV:\n${url}`)}`} target="_blank" rel="noreferrer">إرسال واتساب</a>
            <a className="btn btn-outline-secondary" href={url} target="_blank" rel="noreferrer">فتح كما يراه الزائر</a>
            {can('settings.manage') && <Btn kind="danger" loading={busy} onClick={() => rotate('full')}>إيقاف الرابط وإنشاء رابط جديد</Btn>}
          </div>
          <hr />
          <h3 className="h6">التسعيرة المختصرة</h3>
          <p className="small text-body-secondary">نفس التسعيرة لكن بأعمدة مختصرة فقط: المنتج، الأوزان، تكاليف المصنع (للتصاميم الذهب)، والسعر شامل الضريبة للقطاعي. التكاليف والفائدة لا تصل لجهاز الزائر إطلاقاً.</p>
          <input className="form-control mb-2" dir="ltr" readOnly value={shortUrl} onFocus={(e) => e.target.select()} />
          <div className="hrow gap wrap">
            <Btn onClick={() => copyText(shortUrl)}>نسخ الرابط</Btn>
            <a className="btn btn-success" href={`https://wa.me/?text=${encodeURIComponent(`التسعيرة المختصرة لمنتجات AV:\n${shortUrl}`)}`} target="_blank" rel="noreferrer">إرسال واتساب</a>
            <a className="btn btn-outline-secondary" href={shortUrl} target="_blank" rel="noreferrer">فتح كما يراه الزائر</a>
            {can('settings.manage') && <Btn kind="danger" loading={busy} onClick={() => rotate('short')}>إيقاف الرابط وإنشاء رابط جديد</Btn>}
          </div>
        </Card>
      </div>
      <Card title="الثوابت والأوزان الافتراضية" actions={<Btn size="sm" loading={busy} onClick={save}>حفظ</Btn>}>
        <p className="small text-body-secondary">الخانات القابلة للتعديل هنا (المصنعية، تكاليف المصنع، الفائدة، سعر القيراط، سعر اللؤلؤ) لا يستطيع الزائر تغييرها. الأوزان هنا هي القيم الافتراضية التي تظهر للزائر قبل أن يكتب.</p>
        <PricingSheet data={s} mode="admin" rows={s.rows} onRowsChange={(rows) => setS({ ...s, rows })} />
      </Card>
    </Page>
  );
}
