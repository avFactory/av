// تعريف ورقة "التسعيرة" ومعادلاتها (مطابقة لملف Excel). الأوزان فقط قابلة للإدخال للزائر.
// ملف مشترك: يستخدمه الخادم (التسعيرة المختصرة تُحسب على الخادم) والواجهة (web/src/pricingSheet.js).
// سعر الذهب عيار 18 = سعر 24 × 18 / 24.

export const SECTIONS = [
  {
    id: 'diamond', title: 'تسعيرة الألماس المخبري للمتجر والفرع', kind: 'diamond',
    rows: [
      { id: 'd_0_3', name: 'منتج من 0 الى 3 قيراط', c: 130, e: 0.892, g: 0.25, ct: 600, profit: 250 },
      { id: 'd_3p', name: 'منتج اكثر من 3 قيراط', c: 130, e: 19, g: 32.5, ct: 600, base: 300, step: 100 },
      { id: 'tennis', name: 'اساور التنس', c: 130, e: 55, g: 18, ct: 280, base: 300, step: 100 },
    ],
  },
  {
    id: 'special', title: 'تسعيرة التصاميم الخاصة', kind: 'diamond',
    rows: [
      { id: 's_0_3', name: 'منتج من 0 الى 3 قيراط', c: 130, e: 4.6, g: 3.5, ct: 600, profit: 350 },
      { id: 's_3p', name: 'منتج اكثر من 3 قيراط', c: 130, e: 55, g: 41, ct: 600, base: 350, step: 200 },
    ],
  },
  {
    id: 'gold', title: 'تسعيرة التصاميم الذهب', kind: 'gold',
    rows: [
      { id: 'italian', name: 'التصاميم الإيطالية', c: 49, e: 1.71, cost: 0, profit: 250 },
      { id: 'other', name: 'التصاميم الأخرى', c: 39, e: 1.36, cost: 0, profit: 250 },
      { id: 'names', name: 'الأسماء', c: 1, e: 1.8, cost: 180, profit: 170 },
      { id: 'letters', name: 'الاحرف', c: 1, e: 1.81, cost: 100, profit: 150 },
    ],
  },
  {
    id: 'pearl', title: 'تسعيرة التصاميم اللؤلؤ', kind: 'pearl',
    rows: [
      { id: 'pearl_strand', name: 'اللؤلؤ بالبت', c: 1, e: 0.997, g: 42, pp: 100, per: 36, profit: 250 },
      { id: 'pearl_bead', name: 'اللؤلؤ بالحبة', c: 1, e: 0, g: 1, pp: 5, per: 1, profit: 250 },
    ],
  },
];

// الأعمدة لكل نوع: [المفتاح، العنوان، نوع الخانة] — input = وزن يدخله الزائر، const = ثابت يعدّله المدير فقط
export const COLUMNS = {
  diamond: [
    ['name', 'المنتج'], ['b', 'سعر الذهب'], ['c', 'المصنعية', 'const'], ['d', 'سعر الذهب شامل المصنعية'], ['e', 'الوزن الاجمالي', 'input'],
    ['f', 'تكلفة المنتج'], ['g', 'وزن الألماس المخبري', 'input'], ['h', 'تكلفة الألماس المخبري'], ['i', 'سعر المصنع'], ['j', 'الفائدة'],
    ['k', 'سعر المنتج مع الفائدة'], ['l', 'الضريبة'], ['m', 'شامل الضريبة للقطاعي'], ['n', 'شامل الضريبة للجملة'], ['o', 'ضريبة الجملة'],
  ],
  gold: [
    ['name', 'المنتج'], ['b', 'سعر الذهب'], ['c', 'المصنعية', 'const'], ['d', 'سعر الذهب شامل المصنعية'], ['e', 'الوزن الإجمالي', 'input'],
    ['f', 'سعر المصنع'], ['g', 'تكاليف المصنع', 'const:cost'], ['h', 'الفائدة', 'const:profit'], ['i', 'سعر المنتج مع الفائدة'], ['j', 'الضريبة'],
    ['k', 'شامل الضريبة للقطاعي'], ['l', 'شامل الضريبة للجملة'], ['m', 'ضريبة الجملة'],
  ],
  pearl: [
    ['name', 'المنتج'], ['b', 'سعر الذهب'], ['c', 'المصنعية', 'const'], ['d', 'سعر الذهب شامل المصنعية'], ['e', 'وزن الذهب', 'input'],
    ['f', 'سعر المصنع'], ['g', 'طول / عدد اللؤلؤ', 'input'], ['h', 'قيمة اللؤلؤ'], ['i', 'الفائدة', 'const:profit'], ['j', 'سعر المنتج مع الفائدة'],
    ['k', 'الضريبة'], ['l', 'شامل الضريبة للقطاعي'], ['m', 'شامل الضريبة للجملة'], ['n', 'ضريبة الجملة'],
  ],
};

/** دمج الثوابت المحفوظة (من المدير) مع القيم الافتراضية */
export const withOverrides = (row, rows) => ({ ...row, ...((rows || {})[row.id] || {}) });

/** حساب صف واحد (نفس معادلات Excel) */
export function calc(kind, r, gold24, vat = 15) {
  const t = vat / 100;
  const n = (x) => Number(x) || 0;
  const b = n(gold24) * 18 / 24;
  const c = n(r.c);
  const d = b + c;
  const e = n(r.e);
  const f = e * d;
  if (kind === 'diamond') {
    const g = n(r.g);
    const h = g * n(r.ct);
    const i = h + f;
    // الفائدة: ثابتة، أو تزيد مع وزن الألماس فوق 3 قيراط
    const j = r.base != null ? (g > 3 ? (g - 3) * n(r.step) + n(r.base) : n(r.base)) : n(r.profit);
    const k = j + i;
    const l = k * t;
    const o = i * t;
    return { b, c, d, e, f, g, h, i, j, k, l, m: l + k, n: i + o, o };
  }
  if (kind === 'gold') {
    const g = n(r.cost);
    const h = n(r.profit);
    const i = f + g + h;
    const j = i * t;
    const m = (g + f) * t;
    return { b, c, d, e, f, g, h, i, j, k: j + i, l: f + g + m, m };
  }
  // اللؤلؤ: بالبت (السعر لكل 36 سم) أو بالحبة
  const g = n(r.g);
  const h = (g / n(r.per || 1)) * n(r.pp);
  const i = n(r.profit);
  const j = i + h + f;
  const k = j * t;
  const nn = (j - i) * t;
  return { b, c, d, e, f, g, h, i, j, k, l: k + j, m: (j - i) + nn, n: nn };
}

// أعمدة التسعيرة المختصرة (مثل ملف Excel المختصر): المنتج والأوزان والسعر الشامل للقطاعي فقط
export const SHORT_COLUMNS = { diamond: ['name', 'e', 'g', 'm'], gold: ['name', 'e', 'g', 'k'], pearl: ['name', 'e', 'g', 'l'] };

export const money = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
