// الاسم المختصر للعميل على الملصقات: حذف الكلمات العامة (شركة، مؤسسة، ذهب، مجوهرات...) وأقصى 3 كلمات
import { bad } from './http.js';

const GENERIC = new Set(['شركة', 'شركه', 'مؤسسة', 'مؤسسه', 'موسسة', 'مؤسسات', 'مجموعة', 'مجموعه', 'محل', 'محلات', 'معرض', 'معارض', 'مصنع', 'مصانع', 'متجر',
  'ذهب', 'الذهب', 'للذهب', 'والذهب', 'وللذهب', 'مجوهرات', 'المجوهرات', 'للمجوهرات', 'والمجوهرات', 'وللمجوهرات', 'مصوغات', 'للمصوغات', 'والمصوغات',
  'الماس', 'الألماس', 'للألماس', 'والألماس', 'للالماس', 'والالماس',
  'تجارية', 'التجارية', 'للتجارة', 'تجارة', 'و', 'ل', 'ذ.م.م', 'ذمم', 'المحدودة', 'محدودة',
  'co', 'company', 'est', 'jewelry', 'jewellery', 'jewels', 'gold', 'llc']);

export function autoShortName(shop) {
  const words = String(shop || '').replace(/[()،,.\-_/]+/g, ' ').split(/\s+/).filter(Boolean);
  const keep = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  return (keep.length ? keep : words).slice(0, 3).join(' ');
}

/** تحقق من الاسم المختصر المُدخل: حتى 3 كلمات و 30 حرفاً */
export function cleanShortName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (s.split(' ').length > 3) throw bad('الاسم المختصر لا يتجاوز 3 كلمات');
  if (s.length > 30) throw bad('الاسم المختصر طويل (30 حرفاً كحد أقصى)');
  return s;
}

// أحرف تظهر عندما يكتب قارئ الباركود أحرفاً لاتينية ولوحة المفاتيح على العربي
const AR_KEYS = { 'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l', 'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm' };

/** تطبيع ما يقرؤه الماسح: أرقام عربية ← لاتينية، وأحرف لوحة المفاتيح العربية ← لاتينية */
export function normalizeScan(code) {
  let s = String(code || '').trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (/[؀-ۿ]/.test(s)) s = s.replace(/لا/g, 'b').replace(/[؀-ۿ]/g, (ch) => AR_KEYS[ch] ?? ch);
  return s;
}
