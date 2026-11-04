import { useState } from 'react';
import { api } from '../../api.js';
import { Btn, Card, Field, Input, Loader, Page, useAction, useFetch } from '../../ui.jsx';

/** الأدوار في شريط علوي، والضغط على الدور يعرض صلاحياته للتعديل */
export default function Roles() {
  const { data, reload } = useFetch('/admin/roles');
  const [edit, setEdit] = useState({});
  const [sel, setSel] = useState(null);
  const [nr, setNr] = useState({ code: '', name: '' });
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const groups = {};
  for (const p of data.perms) (groups[p.grp] ||= []).push(p);
  const permsOf = (r) => edit[r.code] ?? r.perms;
  const setPerms = (r, list) => setEdit({ ...edit, [r.code]: list });
  const toggle = (r, code) => { const cur = permsOf(r); setPerms(r, cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code]); };
  const toggleGroup = (r, ps) => {
    const cur = permsOf(r); const codes = ps.map((p) => p.code);
    const all = codes.every((c) => cur.includes(c));
    setPerms(r, all ? cur.filter((c) => !codes.includes(c)) : [...new Set([...cur, ...codes])]);
  };
  const active = sel === 'new' ? null : data.roles.find((r) => r.code === sel) || data.roles[0];
  const dirty = (r) => edit[r.code] !== undefined;
  const save = (r) => run(async () => { await api.put(`/admin/roles/${r.code}`, { perms: edit[r.code] }); setEdit({ ...edit, [r.code]: undefined }); reload(); }, 'تم حفظ الصلاحيات');

  return (
    <Page title="الأدوار والصلاحيات" subtitle="اختر الدور من الشريط لعرض صلاحياته وتعديلها — ويمكن إضافة/منع صلاحيات لمستخدم محدد من صفحة الموظفين">
      <div className="role-bar mb-3" role="tablist" aria-label="الأدوار">
        {data.roles.map((r) => (
          <button key={r.code} type="button" role="tab" aria-selected={active?.code === r.code} className={`role-chip${active?.code === r.code ? ' on' : ''}`} onClick={() => setSel(r.code)}>
            <b>{r.name}</b>
            <span>{permsOf(r).length} صلاحية{dirty(r) ? ' · غير محفوظ' : ''}</span>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={sel === 'new'} className={`role-chip add${sel === 'new' ? ' on' : ''}`} onClick={() => setSel('new')}><b>+ دور جديد</b><span>إضافة دور</span></button>
      </div>

      {sel === 'new' ? (
        <Card title="دور جديد">
          <div className="hrow gap wrap">
            <Field label="الرمز (إنجليزي)"><Input value={nr.code} onChange={(e) => setNr({ ...nr, code: e.target.value })} dir="ltr" /></Field>
            <Field label="الاسم"><Input value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} /></Field>
            <Btn style={{ alignSelf: 'end' }} disabled={!nr.code || !nr.name} onClick={() => run(async () => { await api.put(`/admin/roles/${nr.code}`, { name: nr.name, perms: [] }); const code = nr.code; setNr({ code: '', name: '' }); await reload(); setSel(code); }, 'تمت الإضافة')}>إضافة</Btn>
          </div>
        </Card>
      ) : active && (
        <Card title={<span>{active.name} <span className="text-body-secondary small" dir="ltr">({active.code})</span></span>}
          actions={<div className="d-flex gap-2">
            {dirty(active) && <Btn size="sm" kind="ghost" onClick={() => setEdit({ ...edit, [active.code]: undefined })}>تراجع</Btn>}
            <Btn size="sm" loading={busy} disabled={!dirty(active)} onClick={() => save(active)}>حفظ الصلاحيات</Btn>
          </div>}>
          <div className="perm-grid">
            {Object.entries(groups).map(([g, ps]) => {
              const on = ps.filter((p) => permsOf(active).includes(p.code)).length;
              return (
                <div key={g} className="perm-group">
                  <div className="perm-group-h">
                    <b>{g}</b>
                    <button type="button" className="btn btn-link btn-sm p-0" onClick={() => toggleGroup(active, ps)}>{on === ps.length ? 'إلغاء الكل' : 'تحديد الكل'}</button>
                  </div>
                  {ps.map((p) => <label key={p.code} className="check small" style={{ display: 'flex' }}><input type="checkbox" checked={permsOf(active).includes(p.code)} onChange={() => toggle(active, p.code)} />{p.name}</label>)}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </Page>
  );
}
