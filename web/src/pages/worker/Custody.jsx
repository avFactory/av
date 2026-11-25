import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../../api.js';
import { fmtW, fmtDT, fmtPct, WORK_STATE, calcLoss, CUSTODY_STATUS, COLORS, stoneItems } from '../../format.js';
import OrderGroupItems from '../../components/OrderGroupItems.jsx';
import { TransferModal } from '../../components/TransferTools.jsx';
import { Btn, Card, Field, Input, Loader, Textarea, WeightInput, useAction, useFetch, Badge, Kv, StatusBadge, Modal, askConfirm, FileLink } from '../../ui.jsx';
import { t, tMat, isRtl } from '../../i18n.js';

/** شاشة العهدة للعامل: تأكيد الاستلام، بدء/إيقاف العمل، تسجيل الأوزان، رفع الصور، إنهاء المرحلة */
export default function WCustody() {
  const { id } = useParams();
  const { data: tasks, reload } = useFetch('/w/tasks', { live: ['custodies'] });
  const c = tasks?.custodies.find((x) => String(x.id) === id);
  const { data: od, reload: reloadOrder } = useFetch(c?.order_id ? `/w/orders/${c.order_id}` : null, { deps: [c?.order_id] });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [decl, setDecl] = useState(null);
  const [note, setNote] = useState('');
  const [ackW, setAckW] = useState('');
  const [fin, setFin] = useState({ weight: '', weights: {}, note: '' });
  const [run, busy] = useAction();
  const [trOpen, setTrOpen] = useState(false);
  const [ret, setRet] = useState(null);
  const { data: trs, reload: reloadTr } = useFetch('/w/transfers', { live: ['custodies', 'custody_transfers'] });
  if (!tasks) return <Loader />;
  if (!c) return <div className="wk-body"><div className="alert alert-info">{t('العهدة غير موجودة أو تم استلامها.')} <Link to="/w" className="link">{t('مهامي')}</Link></div></div>;
  const d = decl || { returned: c.worker_declared_returned ?? '', scrap: c.worker_declared_scrap ?? '', used: c.worker_declared_used ?? '' };
  const act = (path, body, msg) => run(async () => { await api.post(`/w/custody/${c.id}/${path}`, body); reload(); }, msg);
  const upload = (files) => run(async () => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    await api.post(`/w/orders/${c.order_id}/files`, fd);
    reloadOrder();
  }, 'تم رفع الصور');
  const mainImg = (od?.files || []).find((f) => f.mime?.startsWith('image')) || (c.thumb ? { path: c.thumb } : null);
  const k = d.returned !== '' ? calcLoss(c.weight_issued, d.returned, d.scrap || 0, 0) : null;
  return (
    <div className="wk-body">
      <Link to="/w" className="back">{isRtl() ? '→' : '←'} {t('مهامي')}</Link>
      <Card title={<span>{t(c.order_no)}</span>} actions={c.status === 'open' ? <Badge tone="gold">{t(WORK_STATE[c.work_state])}</Badge> : <StatusBadge map={CUSTODY_STATUS} value={c.status} />}>
        {mainImg && <FileLink path={mainImg.path} image className="wk-hero-img"><img src={fileUrl(mainImg.path, 800)} alt={c.title} /></FileLink>}
        <Kv items={[[t('الوصف'), t(c.title)], [t('المرحلة الحالية'), t(c.stage_name)], [t('المادة'), tMat(c.material_name)], [t('الوزن المسلم لك'), <span dir="ltr">{fmtW(c.weight_issued)} {t('جم')}</span>],
          c.kind === 'general' && [t('نوع العهدة'), t('عهدة عامة (رصيد بدون طلب)')],
          c.kind !== 'general' && [t('عدد القطع'), c.pieces], [t('المقاس'), c.size], [t('تاريخ التسليم'), fmtDT(c.issued_at)], c.order_notes && [t('ملاحظات الطلب'), c.order_notes], od?.order?.color && [t('اللون'), t(COLORS[od.order.color] || od.order.color)], ...(od?.order ? stoneItems(od.order) : [])]} />
      </Card>
      <OrderGroupItems items={od?.group} current={c.order_id} />
      {c.status === 'open' && !c.finding_id && c.worker_ack_at && (() => {
        const pend = (trs?.outgoing || []).find((t) => t.custody_id === c.id);
        return (
          <Card title={`↪ ${t('تحويل لعامل آخر')}`}>
            {pend ? (
              <div className="hrow between wrap gap">
                <span>{t('بانتظار قبول {name}', { name: pend.to_name })} — {fmtW(pend.weight)} {t('جم')}</span>
                <Btn kind="ghost" size="sm" loading={busy} onClick={() => run(async () => { await api.post(`/w/transfers/${pend.id}/cancel`); reloadTr(); }, 'أُلغي التحويل')}>{t('إلغاء التحويل')}</Btn>
              </div>
            ) : (
              <div className="d-grid gap-2">
                <div className="small text-body-secondary">{t('زِن وحوّل العهدة مباشرة لعامل آخر — للمرحلة التالية أو في نفس المرحلة. يتأكد هو من الوزن ويقبل، والفرق يُحسب عجزاً عليك.')}</div>
                <Btn onClick={() => setTrOpen(true)}>{t('تحويل لعامل آخر')}</Btn>
              </div>
            )}
          </Card>
        );
      })()}
      {trOpen && <TransferModal custody={c} onClose={() => setTrOpen(false)} onDone={() => { reloadTr(); reload(); }} />}
      {c.status === 'open' && c.worker_ack_at && (
        <Card title={`↩ ${t('تسليم جزء من العهدة للمشرف')}`}>
          {c.return_request ? (
            <div className="hrow between wrap gap">
              <span>{t('بانتظار تأكيد المشرف')}: <b dir="ltr">{fmtW(c.return_request.weight)} {t('جم')}</b>{c.return_request.note ? ` — ${c.return_request.note}` : ''}</span>
              <Btn kind="ghost" size="sm" loading={busy} onClick={() => run(async () => { await api.post(`/w/return-requests/${c.return_request.id}/cancel`); reload(); }, 'أُلغي الطلب')}>{t('إلغاء')}</Btn>
            </div>
          ) : !ret ? (
            <div className="d-grid gap-2">
              <div className="small text-body-secondary">{t('إذا عندك ذهب زائد عن حاجتك، سلّم جزءاً منه للمشرف وكمّل شغلك بالباقي. المشرف يزنه ويؤكد.')}</div>
              <Btn kind="ghost" onClick={() => setRet({ weight: '', note: '' })}>{t('تسليم جزء للمشرف')}</Btn>
            </div>
          ) : (
            <div className="d-grid gap-2">
              <Field label={t('الوزن الذي تسلّمه (جم) — لديك {w} جم', { w: fmtW(c.weight_issued) })}><WeightInput big value={ret.weight} onChange={(v) => setRet({ ...ret, weight: v })} /></Field>
              <Field label={t('ملاحظة')}><Input value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} placeholder={t('مثال: ذهب زائد')} /></Field>
              {Number(ret.weight) > 0 && <div className={Number(ret.weight) < Number(c.weight_issued) ? 'small text-body-secondary' : 'small text-danger'}>{Number(ret.weight) < Number(c.weight_issued) ? <>{t('يبقى لديك')} <b dir="ltr">{fmtW(Number(c.weight_issued) - Number(ret.weight))} {t('جم')}</b></> : t('الوزن أكبر من أو يساوي عهدتك — لتسليم الكل اضغط «إنهاء المرحلة»')}</div>}
              <div className="grid g2">
                <Btn kind="ok" loading={busy} disabled={!(Number(ret.weight) > 0 && Number(ret.weight) < Number(c.weight_issued))} onClick={() => run(async () => { await api.post(`/w/custody/${c.id}/return-request`, ret); setRet(null); reload(); }, 'أُرسل للمشرف — سلّمه الذهب ليزنه ويؤكد')}>{t('إرسال للمشرف')}</Btn>
                <Btn kind="ghost" onClick={() => setRet(null)}>{t('إلغاء')}</Btn>
              </div>
            </div>
          )}
        </Card>
      )}
      {od?.files?.length > 0 && (
        <Card title={t('التصاميم والصور')}>
          <div className="files">{od.files.map((f) => <FileLink key={f.id} path={f.path} image={f.mime?.startsWith('image')}>{f.mime?.startsWith('image') ? <img src={fileUrl(f.path, 400)} alt={f.original_name} /> : <div className="doc">{(f.original_name || '').split('.').pop()?.toUpperCase()}</div>}<span>{f.original_name}</span></FileLink>)}</div>
        </Card>
      )}
      {c.status === 'open' && !c.worker_ack_at && (
        <Card title={t('قبول استلام العهدة')}>
          {c.worker_rejected_at && <div className="alert alert-danger mb">{t('رفضتَ هذا التسليم: {r} — بانتظار تصحيح المشرف.', { r: c.worker_reject_reason })}</div>}
          <p className="mb"><b>{t('أقر باستلام {w} جم من {m}', { w: fmtW(c.weight_issued), m: tMat(c.material_name) })}</b>{c.kind === 'general' ? t(' كعهدة عامة: {p}', { p: c.purpose }) : t(' و{n} قطعة للطلب {o}', { n: c.pieces, o: c.order_no })}.</p>
          <p className="small muted mb">{t('ضغطك على "قبول" يُسجَّل كتوقيعك الإلكتروني على العهدة بالتاريخ والوقت.')}</p>
          <div className="grid g2">
            {c.worker_closes && <div style={{ gridColumn: '1 / -1' }}><Field label={t('زِن القطعة على ميزانك (جم) *')} hint={t('وزن التسليم {w} جم', { w: fmtW(c.gross_weight || c.weight_issued) })}><WeightInput big value={ackW} onChange={setAckW} /></Field></div>}
            <Btn size="xl" kind="ok" loading={busy} disabled={c.worker_closes && !ackW} onClick={() => act('ack', c.worker_closes ? { weight: ackW } : {}, 'تم قبول العهدة')}>{t('✓ قبول الاستلام')}</Btn>
            <Btn size="xl" kind="ghost" onClick={() => setRejectOpen(true)}>{t('رفض (الوزن أو الطلب غير صحيح)')}</Btn>
          </div>
        </Card>
      )}
      {c.status === 'open' && c.worker_ack_at && c.work_state !== 'finished' && (
        <>
          {c.worker_closes ? (() => {
            const grp = (od?.group || []).length > 1 ? od.group : null;
            const total = grp ? grp.reduce((a, x) => a + (Number(fin.weights[x.id]) || 0), 0) : Number(fin.weight) || 0;
            const ok = grp ? grp.every((x) => Number(fin.weights[x.id]) > 0) : Number(fin.weight) > 0;
            const gain = total > Number(c.gross_weight || c.weight_issued) + 0.0001;
            return (
              <Card title={t('الوزن النهائي واعتماد الطلب')}>
                <div className="small text-body-secondary mb-2">{t('بعد التشييك: زِن القطعة واكتب الوزن النهائي، ثم اضغط «انتهيت» فينتقل الطلب للفوترة مباشرة.')}</div>
                {grp ? grp.map((x) => (
                  <Field key={x.id} label={`${x.title || x.product_type} — ${t('{n} قطعة', { n: x.quantity })}`}><WeightInput value={fin.weights[x.id] || ''} onChange={(v) => setFin({ ...fin, weights: { ...fin.weights, [x.id]: v } })} /></Field>
                )) : <Field label={t('الوزن النهائي على الميزان (جم) *')}><WeightInput big value={fin.weight} onChange={(v) => setFin({ ...fin, weight: v })} /></Field>}
                {grp && <div className="mb-2">{t('الإجمالي')}: <b dir="ltr">{fmtW(total)} {t('جم')}</b></div>}
                <Field label={t(gain ? 'سبب زيادة الوزن *' : 'ملاحظة')}><Input value={fin.note} onChange={(e) => setFin({ ...fin, note: e.target.value })} /></Field>
                <Btn size="xl" kind="ok" loading={busy} disabled={!ok || (gain && !fin.note)}
                  onClick={async () => { if (await askConfirm(t('اعتماد الوزن النهائي {w} جم ونقل الطلب للفوترة؟', { w: fmtW(total) }))) act('finish', grp ? { weights: fin.weights, note: fin.note } : { weight: fin.weight, note: fin.note }, 'تم — انتقل الطلب للفوترة'); }}>{t('✓ انتهيت — نقل للفوترة')}</Btn>
              </Card>
            );
          })() : <>
          <div className="small text-body-secondary">{t('بعد الانتهاء سلّم القطعة والبقايا للمشرف، وهو يزنها ويعتمد الوزن الفعلي.')}</div>
          <Btn size="xl" kind="ok" loading={busy} onClick={async () => { if (await askConfirm(t('إنهاء المرحلة وتسليمها للمشرف؟'))) act('finish', {}, 'تم إنهاء المرحلة - سلّم القطعة للمشرف'); }}>{t('إنهاء المرحلة وتسليمها')}</Btn>
          </>}
        </>
      )}
      {c.work_state === 'finished' && c.status === 'open' && <div className="alert alert-success">{t('أنهيت المرحلة. سلّم القطعة والبقايا للمشرف ليزنها ويعتمد الوزن الفعلي.')}</div>}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title={t('رفض استلام العهدة')}>
        <Field label={t('ما الخطأ؟ *')}><Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t('مثال: الوزن الفعلي 39.5 جم')} autoFocus /></Field>
        <Btn kind="danger" disabled={!rejectReason} loading={busy} onClick={() => act('reject', { reason: rejectReason }, 'أُبلغ المشرف بالرفض').then(() => { setRejectOpen(false); setRejectReason(''); })}>{t('إرسال الرفض للمشرف')}</Btn>
      </Modal>
    </div>
  );
}
