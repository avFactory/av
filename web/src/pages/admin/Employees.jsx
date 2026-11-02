import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Btn, Field, Input, Loader, Modal, Page, Select, Table, useAction, useFetch, Badge, Search } from '../../ui.jsx';

export default function Employees() {
  const { lookups, can } = useAuth();
  const [all, setAll] = useState(false);
  const { data, reload } = useFetch(`/admin/employees${all ? '?all=1' : ''}`);
  const { data: roles } = useFetch(can('roles.manage', 'employees.manage') ? '/admin/roles' : null);
  const [f, setF] = useState(null);
  const [q, setQ] = useState('');
  const [perf, setPerf] = useState(null);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const body = { ...f, stage_ids: f.stage_ids || [] };
    if (f.id) await api.put(`/admin/employees/${f.id}`, body); else await api.post('/admin/employees', body);
    setF(null); reload();
  }, 'تم الحفظ');
  const del = (u) => { if (window.confirm(`حذف ${u.full_name}؟ (إن كان مرتبطاً بحركات سيتم تعطيله فقط)`)) run(async () => { await api.del(`/admin/employees/${u.id}`); reload(); }, 'تم'); };
  if (!data) return <Loader />;
  const rows = data.filter((u) => !q || u.full_name.includes(q) || (u.employee_no || '').includes(q) || u.username.includes(q));
  return (
    <Page title="الموظفون" actions={<>
      <Search value={q} onChange={setQ} />
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> عرض المعطلين</label>
      {can('employees.manage') && <Btn onClick={() => setF({ role_code: 'worker', stage_ids: [] })}>إضافة موظف</Btn>}
    </>}>
      <div className="card"><Table rows={rows} columns={[
        ['الاسم', (u) => <b>{u.full_name}</b>], ['المستخدم', 'username'], ['الرقم', 'employee_no'], ['الدور', 'role_name'], ['القسم', 'department'], ['التخصص', 'specialty'],
        ['عهد مفتوحة', 'open_custodies'], ['الحالة', (u) => (u.active ? <Badge tone="ok">نشط</Badge> : <Badge>معطل</Badge>)],
        ['', (u) => <div className="row gap">
          <Btn size="sm" kind="ghost" onClick={() => run(async () => setPerf({ u, p: await api.get(`/admin/employees/${u.id}/performance`) }))}>الأداء</Btn>
          {can('employees.manage') && <><Btn size="sm" kind="ghost" onClick={() => setF({ ...u, password: '', stage_ids: u.stage_ids || [] })}>تعديل</Btn><Btn size="sm" kind="ghost" onClick={() => del(u)}>حذف</Btn></>}
        </div>],
      ]} /></div>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'تعديل موظف' : 'موظف جديد'} wide>
        {f && <>
          <div className="grid g3">
            <Field label="الاسم الكامل *"><Input value={f.full_name || ''} onChange={set('full_name')} /></Field>
            <Field label="اسم المستخدم *"><Input value={f.username || ''} onChange={set('username')} disabled={!!f.id} dir="ltr" /></Field>
            <Field label={f.id ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور *'}><Input type="password" value={f.password || ''} onChange={set('password')} dir="ltr" /></Field>
            <Field label="الدور"><Select value={f.role_code} onChange={set('role_code')} options={(roles?.roles || []).filter((r) => r.code !== 'customer').map((r) => [r.code, r.name])} /></Field>
            <Field label="الرقم الوظيفي"><Input value={f.employee_no || ''} onChange={set('employee_no')} /></Field>
            <Field label="القسم"><Select value={f.department_id || ''} onChange={set('department_id')} placeholder="—" options={(lookups?.departments || []).map((d) => [d.id, d.name])} /></Field>
            <Field label="التخصص"><Input value={f.specialty || ''} onChange={set('specialty')} /></Field>
            <Field label="الجوال"><Input value={f.phone || ''} onChange={set('phone')} dir="ltr" /></Field>
            {f.id && <Field label="الحالة"><Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })} options={[['1', 'نشط'], ['0', 'معطل']]} /></Field>}
          </div>
          {f.role_code === 'worker' && (
            <Field label="المراحل التي يعمل بها">
              <div className="chips">{(lookups?.stages || []).filter((s) => s.active).map((s) => {
                const on = (f.stage_ids || []).includes(s.id);
                return <button type="button" key={s.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setF({ ...f, stage_ids: on ? f.stage_ids.filter((x) => x !== s.id) : [...(f.stage_ids || []), s.id] })}>{s.name}</button>;
              })}</div>
            </Field>
          )}
          {roles && f.id && (
            <details>
              <summary className="link">صلاحيات خاصة بهذا المستخدم (إضافة / منع)</summary>
              <div className="grid g2 mt">
                {roles.perms.map((p) => {
                  const st = (f.extra_perms || []).includes(p.code) ? 'add' : (f.denied_perms || []).includes(p.code) ? 'deny' : '';
                  return (
                    <label key={p.code} className="row gap small">
                      <select className="input" style={{ width: 110, minHeight: 32, padding: 2 }} value={st} onChange={(e) => {
                        const ex = (f.extra_perms || []).filter((x) => x !== p.code); const de = (f.denied_perms || []).filter((x) => x !== p.code);
                        if (e.target.value === 'add') ex.push(p.code); if (e.target.value === 'deny') de.push(p.code);
                        setF({ ...f, extra_perms: ex, denied_perms: de });
                      }}><option value="">حسب الدور</option><option value="add">إضافة</option><option value="deny">منع</option></select>
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </details>
          )}
          <div className="row end"><Btn loading={busy} onClick={save}>حفظ</Btn></div>
        </>}
      </Modal>
      <Modal open={!!perf} onClose={() => setPerf(null)} title={`أداء ${perf?.u.full_name}`}>
        {perf && <div className="kv">
          <div><dt>مراحل مكتملة</dt><dd>{perf.p.completed}</dd></div><div><dt>مفتوحة</dt><dd>{perf.p.open}</dd></div>
          <div><dt>وزن معالج</dt><dd>{perf.p.weight_processed} جم</dd></div><div><dt>إجمالي العجز</dt><dd>{perf.p.total_loss}</dd></div>
          <div><dt>عجز غير طبيعي</dt><dd>{perf.p.abnormal_loss}</dd></div><div><dt>نسبة العجز</dt><dd>{perf.p.loss_pct ?? '—'}%</dd></div>
          <div><dt>متوسط مدة المرحلة</dt><dd>{perf.p.avg_hours ?? '—'} ساعة</dd></div>
        </div>}
      </Modal>
    </Page>
  );
}
