import { useState } from 'react';
import { api } from '../../api.js';
import { Btn, Card, Field, Input, Loader, Page, useAction, useFetch } from '../../ui.jsx';

export default function Roles() {
  const { data, reload } = useFetch('/admin/roles');
  const [edit, setEdit] = useState({});
  const [nr, setNr] = useState({ code: '', name: '' });
  const [run, busy] = useAction();
  if (!data) return <Loader />;
  const groups = {};
  for (const p of data.perms) (groups[p.grp] ||= []).push(p);
  const permsOf = (r) => edit[r.code] ?? r.perms;
  const toggle = (r, code) => { const cur = permsOf(r); setEdit({ ...edit, [r.code]: cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code] }); };
  return (
    <Page title="الأدوار والصلاحيات" subtitle="الصلاحيات قابلة للتخصيص لكل دور، ويمكن إضافة/منع صلاحيات لمستخدم محدد من صفحة الموظفين">
      <div className="grid">
        {data.roles.map((r) => (
          <Card key={r.code} title={`${r.name} (${r.code})`} actions={edit[r.code] && <Btn size="sm" loading={busy} onClick={() => run(async () => { await api.put(`/admin/roles/${r.code}`, { perms: edit[r.code] }); setEdit({ ...edit, [r.code]: undefined }); reload(); }, 'تم حفظ الصلاحيات')}>حفظ</Btn>}>
            <div className="grid g3">
              {Object.entries(groups).map(([g, ps]) => (
                <div key={g}><b className="small">{g}</b>{ps.map((p) => <label key={p.code} className="check small" style={{ display: 'flex' }}><input type="checkbox" checked={permsOf(r).includes(p.code)} onChange={() => toggle(r, p.code)} />{p.name}</label>)}</div>
              ))}
            </div>
          </Card>
        ))}
        <Card title="دور جديد">
          <div className="hrow gap wrap">
            <Field label="الرمز (إنجليزي)"><Input value={nr.code} onChange={(e) => setNr({ ...nr, code: e.target.value })} dir="ltr" /></Field>
            <Field label="الاسم"><Input value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} /></Field>
            <Btn style={{ alignSelf: 'end' }} onClick={() => run(async () => { await api.put(`/admin/roles/${nr.code}`, { name: nr.name, perms: [] }); setNr({ code: '', name: '' }); reload(); }, 'تمت الإضافة')}>إضافة</Btn>
          </div>
        </Card>
      </div>
    </Page>
  );
}
