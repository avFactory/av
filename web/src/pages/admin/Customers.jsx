import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { fmtMoney } from '../../format.js';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, Tabs, useAction, useFetch, Badge, TierBadge } from '../../ui.jsx';

const ST = { pending: ['بانتظار الموافقة', 'warn'], approved: ['معتمد', 'ok'], rejected: ['مرفوض', 'bad'], suspended: ['موقوف', 'muted'] };

export default function Customers() {
  const nav = useNavigate();
  const { can, lookups } = useAuth();
  const [tab, setTab] = useState('');
  const { data, reload } = useFetch(`/admin/customers${tab ? `?status=${tab}` : ''}`, { live: ['notifications'] });
  const [f, setF] = useState(null);
  const [tier, setTier] = useState('');
  const [imp, setImp] = useState(null);
  const [tierF, setTierF] = useState('');
  const { data: tiers, reload: reloadTiers } = useFetch('/admin/tiers');
  const [tierColor, setTierColor] = useState('other');
  const setCustTier = (c, tid) => run(async () => { await api.put(`/admin/customers/${c.id}`, { tier_id: tid }); reload(); reloadTiers(); }, 'تم تغيير التصنيف');
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Page title="العملاء - محلات الذهب" actions={<>
      <a className="btn btn-outline-secondary" href="/api/admin/customers.xlsx">تصدير Excel</a>
      {can('customers.manage') && <Btn kind="ghost" onClick={() => setImp({ step: 1 })}>استيراد من Excel</Btn>}
      {can('customers.manage') && <Btn onClick={() => setF({})}>إضافة عميل</Btn>}
    </>}>
      <Tabs value={tab} onChange={setTab} tabs={[['', 'الكل'], ['pending', 'بانتظار الموافقة'], ['approved', 'المعتمدون'], ['suspended', 'الموقوفون']]} />
      {tiers && (
        <div className="tier-cards mb">
          <button className={`tier-card ${!tierF ? 'on' : ''}`} onClick={() => setTierF('')}><span className="muted small">كل التصنيفات</span><b>{(data || []).length}</b></button>
          {tiers.map((t) => (
            <button key={t.id} className={`tier-card ${tierF === String(t.id) ? 'on' : ''}`} onClick={() => setTierF(tierF === String(t.id) ? '' : String(t.id))}>
              <TierBadge name={t.name} color={t.color} /><b>{(data || []).filter((c) => c.tier_id === t.id).length}</b>
            </button>
          ))}
        </div>
      )}
      {!data ? <Loader /> : <div className="card"><Table rows={data.filter((c) => !tierF || String(c.tier_id) === tierF)} onRow={(c) => nav(`/admin/customers/${c.id}`)} columns={[
        ['المحل', (c) => <b>{c.shop_name}</b>], ['المالك', 'owner_name'], ['الجوال', 'phone'], ['المدينة', 'city'], ['الرقم الضريبي', 'vat_number'],
        ['التصنيف', (c) => (can('customers.manage') && tiers
          ? <span onClick={(e) => e.stopPropagation()} className="hrow gap"><TierBadge name={c.tier_name} color={c.tier_color} />
              <select className="form-select tier-select" value={c.tier_id || ''} onChange={(e) => setCustTier(c, e.target.value)} aria-label="تغيير التصنيف">{tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></span>
          : <TierBadge name={c.tier_name} color={c.tier_color} />)],
        ['الطلبات', 'orders_count'], ['الرصيد', (c) => fmtMoney(c.balance)], ['الحالة', (c) => <Badge tone={ST[c.status][1]}>{ST[c.status][0]}</Badge>],
        ['', (c) => c.status === 'pending' && can('customers.manage') && <Btn size="sm" kind="ok" onClick={(e) => { e.stopPropagation(); run(async () => { await api.put(`/admin/customers/${c.id}`, { status: 'approved' }); reload(); }, 'تمت الموافقة'); }}>موافقة</Btn>],
      ]} /></div>}
      {can('customers.manage') && (
        <div className="card card-body mt hrow gap wrap">
          <b>تصنيف جديد:</b>
          <Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="مثال: عميل بلاتيني" style={{ width: 200 }} />
          <Select value={tierColor} onChange={(e) => setTierColor(e.target.value)} options={[['gold', 'ذهبي'], ['silver', 'فضي'], ['normal', 'رمادي'], ['other', 'أزرق']]} style={{ width: 120 }} />
          <Btn size="sm" kind="ghost" disabled={!tier} onClick={() => run(async () => { await api.post('/admin/tiers', { name: tier, color: tierColor }); setTier(''); reloadTiers(); }, 'تمت الإضافة')}>إضافة تصنيف</Btn>
          <span className="small muted">يمكن تحديد أسعار مصنعية خاصة لكل تصنيف من صفحة "أجور التصنيع" (نطاق: فئة عملاء).</span>
        </div>
      )}
      <ImportModal imp={imp} setImp={setImp} busy={busy} run={run} onDone={reload} />
      <Modal open={!!f} onClose={() => setF(null)} title="عميل جديد" wide>
        {f && <>
          <div className="grid g3">
            {[['shop_name', 'اسم المحل *'], ['owner_name', 'اسم المالك'], ['phone', 'الجوال'], ['phone2', 'جوال آخر'], ['email', 'البريد'], ['city', 'المدينة'], ['address', 'العنوان'], ['vat_number', 'الرقم الضريبي'], ['cr_number', 'السجل التجاري']].map(([k, l]) => <Field key={k} label={l}><Input value={f[k] || ''} onChange={set(k)} /></Field>)}
            <Field label="التصنيف"><Select value={f.tier_id || ''} onChange={set('tier_id')} placeholder="عميل عادي (افتراضي)" options={(tiers || []).map((t) => [t.id, t.name])} /></Field>
            <Field label="اسم مستخدم للمتجر (اختياري)"><Input value={f.username || ''} onChange={set('username')} dir="ltr" /></Field>
            <Field label="كلمة المرور"><Input type="password" value={f.password || ''} onChange={set('password')} dir="ltr" /></Field>
          </div>
          <div className="hrow end"><Btn loading={busy} onClick={() => run(async () => { await api.post('/admin/customers', f); setF(null); reload(); }, 'تمت الإضافة')}>حفظ</Btn></div>
        </>}
      </Modal>
    </Page>
  );
}

const IST = { new: ['جديد', 'info'], exists: ['موجود - سيُتجاوز', 'muted'], error: ['خطأ', 'bad'] };
function ImportModal({ imp, setImp, busy, run, onDone }) {
  if (!imp) return null;
  const parse = (file) => run(async () => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await api.post('/admin/customers/import/parse', fd);
    setImp({ step: 2, rows: r.rows });
  });
  const rows = imp.rows || [];
  const fresh = rows.filter((r) => r.status === 'new');
  const errors = rows.filter((r) => r.status === 'error');
  return (
    <Modal open onClose={() => setImp(null)} title="استيراد العملاء من Excel" wide>
      {imp.step === 1 && <>
        <div className="alert alert-info small">
          ارفع ملف Excel أو CSV فيه صف عناوين. الأعمدة بأي ترتيب، والمطلوب فقط <b>اسم المحل</b>.
          الأعمدة المدعومة: اسم المحل، اسم المالك، الجوال، جوال 2، البريد، المدينة، العنوان، الرقم الضريبي، السجل التجاري، الفئة، ملاحظات،
          و(اختياري) اسم المستخدم وكلمة المرور لإنشاء حساب دخول للمتجر.
        </div>
        <div className="small muted">العملاء المضافون يكونون <b>معتمدين</b> مباشرة. العميل الموجود مسبقاً (نفس الاسم أو الجوال أو الرقم الضريبي أو السجل) يُتجاوز ولا تُغيَّر بياناته.</div>
        <label className="btn btn-primary btn-lg" style={{ justifySelf: 'start' }}>{busy ? 'جارٍ القراءة…' : 'اختيار الملف'}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files[0] && parse(e.target.files[0])} /></label>
      </>}
      {imp.step === 2 && <>
        <div className="hrow gap wrap">
          <Badge tone="info">{fresh.length} جديد</Badge><Badge>{rows.filter((r) => r.status === 'exists').length} موجود مسبقاً</Badge>
          {errors.length > 0 && <Badge tone="bad">{errors.length} به أخطاء</Badge>}
          {fresh.some((r) => r.username) && <Badge tone="gold">{fresh.filter((r) => r.username).length} حساب متجر</Badge>}
        </div>
        <Table rows={rows.map((r, i) => ({ ...r, id: i }))} rowClass={(r) => (r.status === 'error' ? 'row-bad' : '')} columns={[
          ['المحل', (r) => <b>{r.shop_name || '—'}</b>], ['المالك', 'owner_name'], ['الجوال', (r) => <span dir="ltr">{r.phone || ''}</span>], ['المدينة', 'city'],
          ['الرقم الضريبي', (r) => <span dir="ltr">{r.vat_number || ''}</span>], ['الفئة', 'tier'], ['حساب المتجر', (r) => (r.username ? <span dir="ltr">{r.username}</span> : '—')],
          ['الحالة', (r) => <Badge tone={IST[r.status][1]}>{IST[r.status][0]}</Badge>],
          ['ملاحظة', (r) => <span className="small">{r.errors.join('، ')}{r.status === 'exists' ? `مطابق لـ: ${r.existing_name}` : ''}</span>],
        ]} />
        {errors.length > 0 && <div className="alert alert-danger small">الصفوف الحمراء لن تُضاف. صححها في الملف وارفعه مرة أخرى، أو أضف الصفوف السليمة الآن.</div>}
        {fresh.some((r) => r.username) && <div className="small muted">أصحاب حسابات المتجر يُطلب منهم تغيير كلمة المرور عند أول دخول.</div>}
        <div className="hrow gap end">
          <Btn kind="ghost" onClick={() => setImp({ step: 1 })}>ملف آخر</Btn>
          <Btn loading={busy} disabled={!fresh.length} onClick={() => run(async () => {
            const r = await api.post('/admin/customers/import/commit', { rows: rows.filter((x) => x.status !== 'error') });
            setImp(null); onDone();
            return r;
          }, `تمت إضافة ${fresh.length} عميل`)}>{errors.length ? `إضافة الصفوف السليمة (${fresh.length})` : `إضافة ${fresh.length} عميل`}</Btn>
        </div>
      </>}
    </Modal>
  );
}
