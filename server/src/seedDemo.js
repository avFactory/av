// بيانات تجريبية اختيارية للتجربة فقط (npm run seed:demo) - كل الأسماء موسومة بـ "تجريبي"
// تعمل عبر واجهة API نفسها لضمان تطبيق كل قواعد العمل. لا تشغلها على قاعدة الإنتاج.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
const PW = 'Demo#2026';

let cookie = '';
async function call(method, path, body) {
  const res = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
  return data;
}

async function main() {
  await call('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PW });
  const lookups = await call('GET', '/lookups');
  const stage = (name) => lookups.stages.find((s) => s.name === name).id;
  const m21 = lookups.materials.find((m) => m.karat === 21).id;
  const m18 = lookups.materials.find((m) => m.karat === 18).id;

  await call('POST', '/admin/employees', { username: 'demo_sup', password: PW, full_name: 'المشرف (تجريبي)', role_code: 'supervisor', employee_no: 'SUP-01' });
  await call('POST', '/admin/employees', { username: 'demo_pm', password: PW, full_name: 'مدير الإنتاج (تجريبي)', role_code: 'production_manager' });
  await call('POST', '/admin/employees', { username: 'demo_acc', password: PW, full_name: 'المحاسب (تجريبي)', role_code: 'accountant' });
  await call('POST', '/admin/employees', { username: 'demo_inv', password: PW, full_name: 'مسؤول المخزون (تجريبي)', role_code: 'inventory_officer' });
  const specs = ['الصب', 'التشبيك', 'التلميع', 'تركيب الأحجار', 'التجهيز', 'الجودة'];
  const workers = [];
  for (let i = 1; i <= 12; i++) {
    const w = await call('POST', '/admin/employees', { username: `demo_w${i}`, password: PW, full_name: `عامل تجريبي ${i}`, role_code: 'worker', employee_no: `W-${String(i).padStart(3, '0')}`, specialty: specs[i % specs.length] });
    workers.push(w.id);
  }
  // نسب تجريبية فقط - يجب على مدير المصنع تحديد النسب الحقيقية
  for (const [n, r] of [['الصب', '0.2'], ['التشبيك', '0.1'], ['التلميع', '0.15'], ['تجهيز الذهب والألماس المخبري', '0.05'], ['تركيب الأحجار والألماس المخبري', '0.05'], ['الغسيل', '0.02'], ['التشييك والجودة والوزن النهائي', '0.02']]) {
    await call('POST', `/admin/stages/${stage(n)}/rate`, { rate_percent: r, note: 'قيمة تجريبية - يحددها مدير المصنع' });
  }
  await call('POST', '/inventory/gold/in', { material_id: m21, weight: '2500', note: 'رصيد تجريبي' });
  await call('POST', '/inventory/gold/in', { material_id: m18, weight: '800', note: 'رصيد تجريبي' });
  await call('POST', '/catalog/labor-rates', { name: 'أجرة افتراضية (تجريبية)', scope: 'default', method: 'per_gram', rate: '12' });
  const c = await call('POST', '/admin/customers', { shop_name: 'محل تجريبي للذهب', owner_name: 'مالك تجريبي', phone: '0500000000', city: 'الرياض', vat_number: '300000000000003', username: 'demo_shop', password: PW });
  const types = ['خاتم', 'سلسال', 'أسورة', 'حلق'];
  for (let i = 1; i <= 8; i++) {
    const o = await call('POST', '/orders', { title: `${types[i % 4]} تجريبي ${i}`, product_type: types[i % 4], karat: 21, color: 'yellow', quantity: 1 + (i % 3), customer_id: i % 2 ? c.id : null, route_id: 2, due_date: new Date(Date.now() + (i - 3) * 86400000).toISOString().slice(0, 10) });
    await call('POST', `/orders/${o.id}/advance`);
    await call('POST', `/orders/${o.id}/advance`);
    if (i <= 5) await call('POST', '/sup/issue', { worker_id: workers[i - 1], items: [{ order_id: o.id, weight: String(10 + i * 2.5) }] });
  }
  console.log('Demo data ready. Users: demo_sup / demo_w1..12 / demo_shop / demo_pm / demo_acc / demo_inv — password', PW);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
