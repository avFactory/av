import { useState } from 'react';
import { api } from '../api.js';
import { LANGS, applyLang, getLang, t } from '../i18n.js';

/** اختيار اللغة: شاشة كاملة أول مرة للعامل، أو نافذة من زر اللغة. الاختيار يُحفظ على الحساب ويُعاد تحميل الصفحة. */
export default function LangPicker({ first = false, onClose }) {
  const [busy, setBusy] = useState(false);
  const pick = async (code) => {
    setBusy(true);
    try { await api.post('/auth/lang', { lang: code }); } catch { /* يُحفظ محلياً على الأقل */ }
    applyLang(code);
    window.location.reload();
  };
  return (
    <div className="lang-pick" role="dialog" aria-modal="true" onMouseDown={(e) => !first && e.target === e.currentTarget && onClose?.()}>
      <div className="lang-card">
        <img src="/logo-gold.png" alt="AV" width="56" height="56" />
        <h2>اختر لغتك</h2>
        <div className="lang-sub">Choose your language · ভাষা বেছে নিন · भाषा चुनें · زبان منتخب کریں</div>
        <div className="lang-grid">
          {LANGS.map((l) => (
            <button key={l.code} type="button" disabled={busy} dir={l.dir} className={`lang-btn${!first && getLang() === l.code ? ' on' : ''}`} onClick={() => pick(l.code)}>{l.name}</button>
          ))}
        </div>
        {first ? <div className="lang-note">{t('يمكنك تغييرها لاحقاً من زر اللغة في الأعلى')}</div>
          : <button type="button" className="btn btn-link mt-2" onClick={onClose}>{t('إلغاء')}</button>}
      </div>
    </div>
  );
}
