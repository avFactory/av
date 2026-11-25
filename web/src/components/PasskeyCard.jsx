import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDT } from '../format.js';
import { Btn, Card, useAction, useFetch, askConfirm } from '../ui.jsx';
import { passkeySupported, platformAvailable, registerPasskey } from '../passkey.js';
import { t } from '../i18n.js';

/** «الدخول بالبصمة أو الوجه»: تفعيله على هذا الجهاز، وقائمة الأجهزة المفعلة مع الحذف */
export default function PasskeyCard({ className = 'mt' }) {
  const { data, reload } = useFetch('/auth/passkeys');
  const [run, busy] = useAction();
  const [platform, setPlatform] = useState(null);
  useEffect(() => { platformAvailable().then(setPlatform); }, []);
  if (!passkeySupported()) return null;
  const add = () => run(async () => { await registerPasskey(); reload(); }, 'تم تفعيل الدخول بالبصمة على هذا الجهاز');
  const del = async (p) => { if (await askConfirm(t('إلغاء الدخول بالبصمة من «{d}»؟', { d: p.device_name }), { danger: true, ok: t('نعم، ألغِ') })) run(async () => { await api.del(`/auth/passkeys/${p.id}`); reload(); }, 'تم الإلغاء'); };
  return (
    <Card title={t('الدخول بالبصمة أو الوجه')} className={className}>
      <p className="small text-body-secondary">{t('ادخل بلمسة إصبع أو بالتعرف على الوجه بدل كتابة كلمة المرور. البصمة لا تخرج من جهازك أبداً — الجهاز يتحقق منها ويرسل توقيعاً آمناً فقط.')}</p>
      {platform === false && <div className="alert alert-light border small">{t('هذا الجهاز لا يحتوي قارئ بصمة أو وجه مفعّل — يمكن استخدام مفتاح أمان أو جوال قريب بدلاً منه.')}</div>}
      {(data || []).length > 0 && (
        <div className="d-grid gap-1 mb-2">{data.map((p) => (
          <div key={p.id} className="hrow between border rounded-3 p-2 small">
            <span>👆 <b>{p.device_name || t('جهاز')}</b> · {t('أُضيف')} {fmtDT(p.created_at)}{p.last_used_at ? ` · ${t('آخر دخول')} ${fmtDT(p.last_used_at)}` : ''}</span>
            <Btn size="sm" kind="ghost" onClick={() => del(p)}>{t('إلغاء')}</Btn>
          </div>))}
        </div>
      )}
      <Btn loading={busy} onClick={add}>👆 {t('تفعيل البصمة على هذا الجهاز')}</Btn>
    </Card>
  );
}
