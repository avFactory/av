// رفع الأرصدة الافتتاحية للعملاء من Excel: ذهب صافي عيار 24 ومبالغ بالريال (موجب = على العميل، سالب = له)
import ExcelJS from 'exceljs';
import { bad } from './http.js';
import { normName } from './productDup.js';

const cellText = (v) => { if (v && typeof v === 'object') v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : ''); return v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); };
const arDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[٬،,\s]/g, '');
const phoneKey = (v) => arDigits(v).replace(/\D/g, '').slice(-9);

export async function readTable(file) {
  if (/\.csv$/i.test(file.originalname)) return file.buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, '').trim()));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const table = [];
  wb.worksheets[0].eachRow({ includeEmpty: false }, (row) => { const cells = []; row.eachCell({ includeEmpty: true }, (c, i) => { cells[i - 1] = cellText(c.value); }); table.push(cells); });
  return table;
}

/** رقم بإشارة: يقبل الأرقام العربية، الفواصل، و(5) أو 5- كسالب */
export function signedNum(v) {
  let s = arDigits(v);
  if (!s || /^[-–—]+$/.test(s)) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return (neg ? -1 : 1) * Number(s);
}

const HEADERS = [
  ['shop', /اسم المحل|اسم العميل|العميل|المحل|المنشأة|shop|customer/i],
  ['phone', /جوال|هاتف|موبايل|phone|mobile/i],
  ['branch', /الفرع|فرع|branch/i],
  ['gold', /ذهب|عيار|gold/i],
  ['money', /مبلغ|ريال|نقد|مالي|money|amount|sar/i],
  ['date', /تاريخ|date/i],
  ['note', /بيان|ملاحظ|وصف|note/i],
];

export function parseOpeningTable(table) {
  const hIdx = table.findIndex((cells) => cells.some((c) => HEADERS[0][1].test(c || '')) && cells.some((c) => /ذهب|عيار|gold|مبلغ|ريال|money/i.test(c || '')));
  if (hIdx < 0) throw bad('لم يتم العثور على صف العناوين — حمّل النموذج واستخدم نفس العناوين (اسم العميل، الذهب عيار 24، المبلغ)');
  const map = {};
  table[hIdx].forEach((h, i) => { const k = HEADERS.find(([key, re]) => map[key] === undefined && re.test(h || '')); if (k) map[k[0]] = i; });
  const get = (c, k) => (map[k] === undefined ? '' : String(c[map[k]] ?? '').trim());
  const rows = table.slice(hIdx + 1).map((c) => ({ shop: get(c, 'shop'), phone: get(c, 'phone'), branch: get(c, 'branch'), gold: get(c, 'gold'), money: get(c, 'money'), date: get(c, 'date'), note: get(c, 'note') }))
    .filter((r) => (r.shop || r.phone) && !/^ملاحظ/.test(r.shop));
  if (!rows.length) throw bad('لا توجد بيانات تحت صف العناوين');
  return rows;
}

const isoDay = (v) => {
  const s = arDigits(v).replace(/\//g, '-');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

/** مطابقة كل صف بعميل (بالجوال ثم الاسم) وفرعه، والتحقق من القيم والرصيد الافتتاحي الموجود */
export async function planOpening(db, rows) {
  const custs = (await db.query(`select c.id, c.shop_name, c.short_name, c.phone, c.branches_only,
      coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name, 'phone', b.phone)) from customer_branches b where b.customer_id=c.id), '[]') as branches
    from customers c where c.status <> 'rejected'`)).rows;
  const openings = (await db.query("select id, customer_id, branch_id, gold_debit::float - gold_credit::float as gold, money_debit::float - money_credit::float as money from customer_entries where kind='opening' and not reversed")).rows;
  const seen = new Set();
  return rows.map((r, i) => {
    const errors = [];
    const pk = phoneKey(r.phone);
    let c = pk.length >= 9 ? custs.find((x) => phoneKey(x.phone) === pk || x.branches.some((b) => phoneKey(b.phone) === pk)) : null;
    const n = normName(r.shop);
    if (!c && n) c = custs.find((x) => normName(x.shop_name) === n || (x.short_name && normName(x.short_name) === n));
    if (!c) errors.push('العميل غير موجود في النظام');
    let branch = null;
    if (c) {
      const bn = normName(r.branch);
      if (bn) { branch = c.branches.find((b) => normName(b.name) === bn); if (!branch) errors.push(`الفرع "${r.branch}" غير موجود لهذا العميل`); }
      else if (pk.length >= 9 && phoneKey(c.phone) !== pk) branch = c.branches.find((b) => phoneKey(b.phone) === pk) || null;
      if (!branch && !bn && c.branches_only) errors.push('الشركة بفروع فقط — اكتب الفرع');
    }
    const gold = signedNum(r.gold), money = signedNum(r.money);
    if (gold === null) errors.push(`وزن الذهب غير صالح: ${r.gold}`);
    if (money === null) errors.push(`المبلغ غير صالح: ${r.money}`);
    if (gold === 0 && money === 0) errors.push('لا يوجد ذهب ولا مبلغ');
    const date = r.date ? isoDay(r.date) : null;
    if (r.date && !date) errors.push(`التاريخ غير صالح: ${r.date}`);
    const key = c ? `${c.id}:${branch?.id ?? 'main'}` : null;
    if (key && seen.has(key)) errors.push('مكرر في الملف لنفس العميل/الفرع');
    if (key) seen.add(key);
    const existing = c ? openings.find((o) => o.customer_id === c.id && (o.branch_id ?? null) === (branch?.id ?? null)) : null;
    return {
      i, input: r, customer_id: c?.id ?? null, shop_name: c?.shop_name ?? null, branch_id: branch?.id ?? null, branch_name: branch?.name ?? null,
      gold: gold ?? 0, money: money ?? 0, date, note: r.note || null,
      existing: existing ? { id: existing.id, gold: Math.round(existing.gold * 10000) / 10000, money: Math.round(existing.money * 100) / 100 } : null,
      errors, status: errors.length ? 'error' : existing ? 'exists' : 'new',
    };
  });
}
