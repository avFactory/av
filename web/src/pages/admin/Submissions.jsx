import { useState } from 'react';
import { Loader, Page, Tabs, useFetch } from '../../ui.jsx';
import { SubmissionsList } from './CustomerStatement.jsx';

/** مستندات السداد المرفوعة من العملاء (مبالغ وذهب) — اعتماد أو رفض */
export default function Submissions() {
  const [st, setSt] = useState('pending');
  const { data, reload } = useFetch(`/finance/submissions?status=${st}`, { deps: [st] });
  return (
    <Page title="مستندات السداد" inline actions={<div className="page-tabs-row"><Tabs value={st} onChange={setSt} tabs={[['pending', 'بانتظار المراجعة'], ['approved', 'معتمدة'], ['rejected', 'مرفوضة']]} /></div>}>
      <div className="small text-body-secondary mb-2">يرفعها العميل من حسابه في المتجر. الاعتماد يضيف المبلغ كدفعة مستلمة، والذهب كسداد ذهب يدخل الخزنة — ويظهر في كشف حسابه.</div>
      {!data ? <Loader /> : !data.length ? <div className="text-center text-body-secondary py-5">لا توجد مستندات</div> : <SubmissionsList list={data} onDone={reload} showCustomer />}
    </Page>
  );
}
