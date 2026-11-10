import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// تثبيت النظام كتطبيق على الجوال والكمبيوتر (PWA)
let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const reg = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
  }
}

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const KEY = 'install_hint_closed';
const HIDE_ON = ['/print/', '/i/', '/t/', '/p/', '/s/'];

/** زر عائم "تثبيت التطبيق": أندرويد/كمبيوتر بضغطة، وآيفون بشرح "مشاركة ← إضافة إلى الشاشة الرئيسية" */
export default function InstallApp() {
  const loc = useLocation();
  const [, force] = useState(0);
  const [closed, setClosed] = useState(() => { try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch { return false; } });
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  if (closed || standalone() || HIDE_ON.some((p) => loc.pathname.startsWith(p))) return null;
  const ios = isIOS();
  if (!deferred && !ios) return null;
  const close = () => { setClosed(true); try { localStorage.setItem(KEY, String(Date.now() + 14 * 864e5)); } catch { /* ignore */ } };
  const install = async () => {
    if (ios) { setIosHelp(true); return; }
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null; force((n) => n + 1);
  };
  return (
    <div className="install-app no-print" role="dialog" aria-label="تثبيت التطبيق">
      <img src="/icon-192.png" alt="" />
      <div className="grow">
        <b>ثبّت تطبيق مصنع AV</b>
        {iosHelp
          ? <div className="small">اضغط زر <b>المشاركة</b> ⬆️ أسفل Safari ثم <b>«إضافة إلى الشاشة الرئيسية»</b> ثم <b>إضافة</b>.</div>
          : <div className="small">افتحه من الشاشة الرئيسية مثل أي تطبيق، بملء الشاشة.</div>}
      </div>
      {!iosHelp && <button type="button" className="btn btn-sm btn-warning fw-bold" onClick={install}>تثبيت</button>}
      <button type="button" className="btn-close btn-close-white" aria-label="إغلاق" onClick={close} />
    </div>
  );
}
