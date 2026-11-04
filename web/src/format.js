let decimals = 3;
export const setDecimals = (d) => { decimals = Number(d) || 3; };
export const fmtW = (v, d = decimals) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtMoney = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س');
export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—');
export const fmtDT = (v) => (v ? new Date(v).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtPct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 5 })}%`);

/** حساب العجز بالأعداد الصحيحة (1/10000 جم) - مطابق لدالة قاعدة البيانات، والخادم هو المرجع النهائي */
const U = (v) => Math.round(Number(String(v || 0).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) * 10000);
export function calcLoss(issued, returned, scrap, rate) {
  const i = U(issued), r = U(returned), s = U(scrap);
  const actual = i - r - s;
  const allowed = Math.round((i * Number(rate || 0)) / 100);
  const normal = Math.max(0, Math.min(actual, allowed));
  const abnormal = Math.max(0, actual - allowed);
  const gain = Math.max(0, -actual);
  const f = (x) => x / 10000;
  return { actual: f(actual), allowed: f(allowed), normal: f(normal), abnormal: f(abnormal), gain: f(gain) };
}
export const sub = (a, b) => (U(a) - U(b)) / 10000;

export const STATUS = {
  pending_review: ['بانتظار المراجعة', 'warn'], quoted: ['عرض مرسل', 'info'], approved: ['معتمد', 'info'], in_production: ['قيد التصنيع', 'gold'],
  ready: ['جاهز للتسليم', 'ok'], delivered: ['تم التسليم', 'ok'], cancelled: ['ملغي', 'muted'], rejected: ['مرفوض', 'bad'],
};
export const CUSTODY_STATUS = { open: ['لدى العامل', 'gold'], under_review: ['تحت المراجعة', 'warn'], closed: ['مغلقة', 'ok'], reversed: ['ملغاة بحركة عكسية', 'muted'] };
export const SETTLEMENT_STATUS = { approved: ['معتمدة', 'ok'], pending_review: ['بانتظار المراجعة', 'warn'], investigating: ['قيد التحقيق', 'bad'], resolved: ['تم البت', 'ok'], reversed: ['مصححة', 'muted'] };
export const WORK_STATE = { not_started: 'لم يبدأ', in_progress: 'جارٍ العمل', paused: 'متوقف', finished: 'منتهٍ - بانتظار الاستلام' };
export const DESIGN_STATUS = { not_required: 'غير مطلوب', pending_upload: 'بانتظار التصميم', sent: 'مرسل للعميل', approved: 'معتمد', changes_requested: 'تعديل مطلوب', rejected: 'مرفوض' };
export const COLORS = { yellow: 'أصفر', white: 'أبيض', rose: 'روز' };
export const METHODS = { per_gram: 'لكل جرام', per_piece: 'لكل قطعة', fixed: 'ثابتة للطلب', manual: 'يدوية (تتطلب اعتماد)' };
export const KINDS = {
  allocate: 'تخصيص من الخزنة', customer_gold_in: 'ذهب من العميل', stock_in: 'إضافة للخزنة', stock_out: 'صرف من الخزنة', issue: 'تسليم للعامل', general_issue: 'عهدة عامة للعامل', general_return: 'إرجاع عهدة عامة للخزنة',
  return: 'استلام من العامل', scrap_return: 'بقايا مستردة', normal_loss: 'عجز طبيعي', abnormal_pending: 'عجز غير طبيعي (معلق)', abnormal_loss: 'عجز غير طبيعي',
  abnormal_loss_approved: 'اعتماد عجز غير طبيعي', loss_recovered: 'مسترد بعد التحقيق', gain_pending: 'زيادة وزن', reversal: 'حركة عكسية',
  delivery: 'تسليم للعميل', to_finished_stock: 'إدخال للمخزون الجاهز', from_finished_stock: 'صرف من المخزون الجاهز', final_excess: 'فائض الوزن النهائي',
  final_gain: 'زيادة الوزن النهائي', scrap_to_vault: 'بقايا إلى الخزنة', dealloc: 'إرجاع للخزنة', stock_adjust: 'تسوية جرد', convert_out: 'تحويل مادة (صادر)', convert_in: 'تحويل مادة (وارد)',
};
export const LOCS = {
  external: 'خارج المصنع', vault: 'الخزنة', order: 'تحت التشغيل', worker: 'لدى العامل', scrap: 'بقايا قابلة للاسترداد', loss_normal: 'عجز طبيعي',
  loss_suspense: 'عجز تحت المراجعة', loss_abnormal: 'عجز غير طبيعي', delivered: 'مسلّم للعملاء', variance: 'فروقات', finished: 'منتجات جاهزة',
};

/** عناصر عرض أحجار الطلب/المنتج (الألماس واللؤلؤ والحجر والزركون) لمكوّن Kv */
export function stoneItems(o) {
  const out = (o.diamond_details || []).map((d, i, a) => [`الألماس المخبري${a.length > 1 ? ` ${i + 1}` : ''}`, `${[d.shape, d.size, d.color, d.clarity].filter(Boolean).join(' ')} · ${Number(d.carats)} قيراط${d.count ? ` · ${d.count} حبة` : ''}`]);
  if (Number(o.pearl_weight) > 0) out.push(['وزن اللؤلؤ', `${Number(o.pearl_weight)} جم`]);
  if (Number(o.stone_weight) > 0) out.push(['وزن الحجر', `${Number(o.stone_weight)} قيراط`]);
  if (Number(o.zircon_weight) > 0) out.push(['وزن الزركون', `${Number(o.zircon_weight)} جم`]);
  return out;
}
