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
            <Field label="الاسم المختصر (يظهر على الملصق)" hint="حتى 3 كلمات — يُترك فارغاً ليُستنتج تلقائياً"><Input value={f.short_name || ''} onChange={set('short_name')} placeholder={autoShortName(f.shop_name) || 'مثال: اديار'} /></Field>
            <Field label="التصنيف"><Select value={f.tier_id || ''} onChange={set('tier_id')} placeholder="عميل عادي (افتراضي)" options={(tiers || []).map((t) => [t.id, t.name])} /></Field>
            <Field label="اسم المستخدم للمتجر" hint="واحد للمحل وكل فروعه"><Input value={f.username || ''} onChange={set('username')} dir="ltr" /></Field>
            <Field label="كلمة مرور الحساب الرئيسي"><Input type="password" value={f.password || ''} onChange={set('password')} dir="ltr" autoComplete="new-password" /></Field>
          </div>
          <div className="card">
            <div className="card-header bg-transparent d-flex justify-content-between align-items-center py-2">
              <b>الفروع <span className="text-body-secondary small fw-normal">(اختياري) — نفس اسم المستخدم، ولكل فرع كلمة مرور ورقم تواصل مختلفان</span></b>
              <Btn size="sm" kind="ghost" onClick={() => setF({ ...f, branches: [...(f.branches || []), { name: '', city: '', phone: '', password: '' }] })}>+ إضافة فرع</Btn>
            </div>
            <div className="card-body d-grid gap-2">
              {!(f.branches || []).length && <span className="text-body-secondary small">لا فروع — الحساب الرئيسي فقط</span>}
              {(f.branches || []).map((b, i) => {
                const upd = (k) => (e) => setF({ ...f, branches: f.branches.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) });
                return (
                  <div key={i} className="grid g4 align-items-end">
                    <Field label={`اسم الفرع ${i + 1} *`}><Input value={b.name} onChange={upd('name')} placeholder="مثال: فرع العليا" /></Field>
                    <Field label="المدينة"><Input value={b.city} onChange={upd('city')} /></Field>
                    <Field label="رقم تواصل الفرع *"><Input value={b.phone} onChange={upd('phone')} dir="ltr" placeholder="05xxxxxxxx" /></Field>
                    <div className="d-flex gap-2 align-items-end">
                      <Field label="كلمة مرور الفرع *" className="flex-grow-1"><Input type="password" value={b.password} onChange={upd('password')} dir="ltr" autoComplete="new-password" /></Field>
                      <Btn size="sm" kind="ghost" onClick={() => setF({ ...f, branches: f.branches.filter((_, j) => j !== i) })}>حذف</Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {(f.branches || []).length > 0 && (!f.username || !f.password) && <div className="alert alert-warning small">الفروع تحتاج اسم مستخدم وكلمة مرور للحساب الرئيسي.</div>}
          {phoneIssue(f) && <div className="alert alert-warning small">{phoneIssue(f)}</div>}
          {shortErr(f.short_name) && <div className="alert alert-warning small">{shortErr(f.short_name)}</div>}
          <div className="hrow end"><Btn loading={busy} disabled={!f.shop_name || !!shortErr(f.short_name) || ((f.branches || []).length > 0 && (!f.username || !f.password || !!phoneIssue(f) || f.branches.some((b) => !b.name || (b.password || '').length < 8)))}
            onClick={() => run(async () => { await api.post('/admin/customers', f); setF(null); reload(); }, 'تمت الإضافة')}>حفظ</Btn></div>
        </>}
      </Modal>
    </Page>
  );
}

const pk = (v) => String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '').slice(-9);
/** كل فرع يحتاج رقم تواصل خاصاً به: غير مكرر بين الفروع ومختلف عن جوال المحل */
function phoneIssue(f) {
  const seen = new Map();
  if (pk(f.phone).length >= 9) seen.set(pk(f.phone), 'جوال المحل');
  for (const b of f.branches || []) {
    const k = pk(b.phone), n = b.name || 'فرع';
    if (k.length < 9) return `أدخل رقم تواصل "${n}" (9 أرقام على الأقل)`;
    if (seen.has(k)) return `رقم تواصل "${n}" مكرر مع ${seen.get(k)} — لكل فرع رقم مختلف`;
    seen.set(k, `"${n}"`);
  }
  return null;
}

export function autoShortName(shop) {
  const G = new Set(['شركة', 'شركه', 'مؤسسة', 'مؤسسه', 'مجموعة', 'محل', 'محلات', 'معرض', 'معارض', 'مصنع', 'متجر', 'ذهب', 'الذهب', 'للذهب', 'والذهب', 'وللذهب', 'مجوهرات', 'المجوهرات', 'للمجوهرات', 'والمجوهرات', 'وللمجوهرات', 'مصوغات', 'للمصوغات', 'والمصوغات', 'الماس', 'الألماس', 'للألماس', 'والألماس', 'تجارية', 'التجارية', 'للتجارة', 'تجارة', 'و', 'ل']);
  const w = String(shop || '').replace(/[()،,.\-_/]+/g, ' ').split(/\s+/).filter(Boolean);
  const k = w.filter((x) => !G.has(x.toLowerCase()));
  return (k.length ? k : w).slice(0, 3).join(' ');
}
const shortErr = (v) => (v && v.trim().split(/\s+/).length > 3 ? 'الاسم المختصر لا يتجاوز 3 كلمات' : null);

const IST = { new: ['جديد', 'info'], update: ['موجود - إضافة فروع', 'gold'], exists: ['موجود - سيُتجاوز', 'muted'], error: ['خطأ', 'bad'] };
function ImportModal({ imp, setImp, busy, run, onDone }) {
  if (!imp) return null;
  const parse = (file) => run(async () => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await api.post('/admin/customers/import/parse', fd);
    setImp({ step: 2, rows: r.rows, plans: r.plans });
  });
  const plans = imp.plans || [];
  const fresh = plans.filter((p) => p.status === 'new');
  const upd = plans.filter((p) => p.status === 'update');
  const errors = plans.filter((p) => p.status === 'error');
  const newBranches = plans.filter((p) => p.status !== 'error').reduce((s, p) => s + p.branches.filter((b) => !b.exists).length, 0);
  const actionable = fresh.length + upd.length;
  return (
    <Modal open onClose={() => setImp(null)} title="استيراد العملاء من Excel" wide>
      {imp.step === 1 && <>
        <div className="alert alert-info small">
          ارفع ملف Excel أو CSV فيه صف عناوين. الأعمدة بأي ترتيب، والمطلوب فقط <b>اسم المحل</b>.
          الأعمدة المدعومة: اسم المحل، اسم المالك، الجوال، جوال 2، البريد، المدينة، العنوان، الرقم الضريبي، السجل التجاري، الفئة، ملاحظات، اسم المستخدم، كلمة المرور، <b>الفرع</b>.
        </div>
        <div className="card"><div className="card-body small">
          <b>الفروع:</b> اسم المستخدم <b>واحد</b> للمحل وكل فروعه، وكلمة المرور تختلف:
          <ul className="mb-0 mt-1">
            <li>صف <b>بدون</b> عمود "الفرع" = الحساب الرئيسي للمحل (بياناته وكلمة مروره).</li>
            <li>كل صف <b>فيه</b> "الفرع" = فرع بكلمة مرور خاصة و<b>رقم تواصل خاص</b> (عمود "الجوال" في صف الفرع إلزامي ومختلف لكل فرع وعن جوال المحل).</li>
            <li>صفوف الفروع تحت المحل يمكن أن تترك اسم المحل واسم المستخدم فارغين.</li>
          </ul>
          <table className="table table-sm table-bordered mt-2 mb-0 keep" style={{ maxWidth: 680 }}>
            <thead><tr><th>اسم المحل</th><th>اسم المستخدم</th><th>الفرع</th><th>كلمة المرور</th><th>الجوال</th></tr></thead>
            <tbody><tr><td>ذهب الشرق</td><td dir="ltr">sharq</td><td></td><td dir="ltr">Main#2026</td><td dir="ltr">0551000000</td></tr>
              <tr><td>ذهب الشرق</td><td dir="ltr">sharq</td><td>فرع الخبر</td><td dir="ltr">Khobar#2026</td><td dir="ltr">0551000001</td></tr>
              <tr><td></td><td></td><td>فرع الظهران</td><td dir="ltr">Dhahran#2026</td><td dir="ltr">0551000002</td></tr></tbody>
          </table>
        </div></div>
        <div className="small muted">العملاء المضافون يكونون <b>معتمدين</b> مباشرة. العميل الموجود مسبقاً لا تُغيَّر بياناته، وتُضاف له فروعه الجديدة فقط.</div>
        <label className="btn btn-primary btn-lg" style={{ justifySelf: 'start' }}>{busy ? 'جارٍ القراءة…' : 'اختيار الملف'}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files[0] && parse(e.target.files[0])} /></label>
      </>}
      {imp.step === 2 && <>
        <div className="hrow gap wrap">
          <Badge tone="info">{fresh.length} محل جديد</Badge>
          {upd.length > 0 && <Badge tone="gold">{upd.length} محل موجود تُضاف له فروع</Badge>}
          <Badge>{plans.filter((p) => p.status === 'exists').length} موجود مسبقاً</Badge>
          {newBranches > 0 && <Badge tone="ok">{newBranches} فرع جديد</Badge>}
          {errors.length > 0 && <Badge tone="bad">{errors.length} به أخطاء</Badge>}
        </div>
        <Table rows={plans.map((p, i) => ({ ...p, id: i }))} rowClass={(p) => (p.status === 'error' ? 'row-bad' : '')} columns={[
          ['المحل', (p) => <b>{p.shop_name || '—'}</b>], ['الجوال', (p) => <span dir="ltr">{p.phone || ''}</span>], ['المدينة', 'city'], ['الفئة', 'tier'],
          ['اسم المستخدم', (p) => (p.username ? <span dir="ltr">{p.username}</span> : '—')],
          ['الفروع', (p) => (p.branches.length ? <div className="d-flex flex-wrap gap-1">{p.branches.map((b) => <span key={b.name} className={`badge rounded-pill ${b.exists ? 'bg-body-secondary text-body-secondary' : 'bg-success-subtle text-success-emphasis'}`}>{b.name}{b.phone ? <> — <bdi>{b.phone}</bdi></> : ''}{b.exists ? ' (موجود)' : ''}</span>)}</div> : '—')],
          ['الحالة', (p) => <Badge tone={IST[p.status][1]}>{IST[p.status][0]}</Badge>],
          ['ملاحظة', (p) => <span className="small">{p.errors.join('، ')}{['exists', 'update'].includes(p.status) ? `مطابق لـ: ${p.existing_name}` : ''}</span>],
        ]} />
        {errors.length > 0 && <div className="alert alert-danger small">المحلات المعلّمة بالأحمر لن تُضاف. صححها في الملف وارفعه مرة أخرى، أو أضف السليمة الآن.</div>}
        {plans.some((p) => p.create_main_user) && <div className="small muted">أصحاب حسابات المتجر الرئيسية يُطلب منهم تغيير كلمة المرور عند أول دخول.</div>}
        <div className="hrow gap end">
          <Btn kind="ghost" onClick={() => setImp({ step: 1 })}>ملف آخر</Btn>
          <Btn loading={busy} disabled={!actionable} onClick={() => run(async () => {
            const r = await api.post('/admin/customers/import/commit', { rows: imp.rows, skip_errors: true });
            setImp(null); onDone();
            return r;
          }, 'تم الاستيراد')}>{errors.length ? `إضافة السليمة (${actionable})` : `اعتماد (${fresh.length} محل${newBranches ? ` + ${newBranches} فرع` : ''})`}</Btn>
        </div>
      </>}
    </Modal>
  );
}
