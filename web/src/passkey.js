// الدخول بالبصمة أو الوجه (Passkeys): الجهاز يتحقق من البصمة/الوجه ويرسل توقيعاً رقمياً فقط
import { startAuthentication, startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';
import { api } from './api.js';

export const passkeySupported = () => browserSupportsWebAuthn();
export const platformAvailable = () => platformAuthenticatorIsAvailable().catch(() => false);

/** اسم تقريبي للجهاز لعرضه في قائمة البصمات */
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'جهاز';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return `${os}${br ? ` · ${br}` : ''}`;
}

const friendly = (e) => {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'AbortError') return 'أُلغي التحقق أو انتهت مهلته';
  if (n === 'InvalidStateError') return 'هذا الجهاز مسجل مسبقاً لهذا الحساب';
  if (n === 'NotSupportedError' || n === 'SecurityError') return 'المتصفح لا يدعم الدخول بالبصمة على هذا الرابط';
  return e?.message || 'تعذر التحقق';
};

export async function loginWithPasskey() {
  const { options, challenge_id: cid } = await api.post('/auth/passkey/login-options', {});
  let response;
  try { response = await startAuthentication({ optionsJSON: options }); } catch (e) { throw new Error(friendly(e)); }
  return api.post('/auth/passkey/login', { challenge_id: cid, response });
}

export async function registerPasskey(name = deviceName()) {
  const { options, challenge_id: cid } = await api.post('/auth/passkeys/options', {});
  let response;
  try { response = await startRegistration({ optionsJSON: options }); } catch (e) { throw new Error(friendly(e)); }
  return api.post('/auth/passkeys', { challenge_id: cid, response, device_name: name });
}
