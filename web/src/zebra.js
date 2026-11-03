// طباعة مباشرة على طابعات Zebra بلغة ZPL عبر تطبيق Zebra Browser Print المثبت على الجهاز.
// الملصق يُرسم كصورة أبيض/أسود (يدعم العربية والشعار) ثم يُرسل كأمر ^GFA.

const MM = 25.4;
const FONT = "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** يرسم ملصقاً واحداً على Canvas بحجم الطابعة الفعلي (نقاط) */
export async function drawLabel(o, { dpi = 203, w = 62, h = 38 } = {}) {
  const d = dpi / MM;
  const W = Math.round(w * d), H = Math.round(h * d);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  await document.fonts?.ready;
  const small = h < 30;
  const pad = (small ? 1.2 : 2) * d;
  // QR على اليمين بمربعات صحيحة (عدد نقاط ثابت لكل مربع) وهامش أبيض حوله ليقرأه الماسح
  const qrSide = Math.min(H - 2 * pad, 27 * d);
  const { size, bits } = o.qr_matrix;
  const quiet = 2; // مربعان أبيضان حول الرمز
  const cell = Math.max(1, Math.floor(qrSide / (size + quiet * 2)));
  const qrPx = cell * size;
  const qx = Math.round(W - pad - cell * quiet - qrPx), qy = Math.round((H - qrPx) / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (bits[y * size + x] === '1') ctx.fillRect(qx + x * cell, qy + y * cell, cell, cell);
  // النصوص في المساحة المتبقية يسار QR، في المنتصف
  const right = qx - cell * quiet - (small ? 0.5 : 1.5) * d, left = pad, maxW = right - left, cx = (left + right) / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const pt = (n) => (n / 72) * dpi; // نقطة طباعية ← نقاط الطابعة
  const k = small ? 0.9 : 1;
  const lines = [
    [`700 ${pt(7.6 * k)}px 'Courier New', monospace`, o.order_no, 'ltr'],
    [`700 ${pt(7.8 * k)}px ${FONT}`, o.title],
    [`600 ${pt(7 * k)}px ${FONT}`, o.material_name],
    [`600 ${pt(7 * k)}px ${FONT}`, `الكمية ${o.quantity}${o.size ? ` · مقاس ${o.size}` : ''}`],
  ];
  const cust = o.customer_label || null;
  if (cust) lines.push([`700 ${pt(7.8 * k)}px ${FONT}`, cust, 'rtl', true]);
  const logo = await loadImg('/logo.png');
  const sizeOf = (f) => parseFloat(f.split(' ')[1]);
  const lh = (small ? 3 : 4.5) * d;
  const gap = 1.2;
  const logoH = logo ? lh + 0.4 * d : 0;
  const blockH = logoH + lines.filter((l) => l[1]).reduce((a, l) => a + sizeOf(l[0]) * gap, 0) + (cust ? 0.6 * d : 0);
  let y = Math.max(pad, (H - blockH) / 2);
  if (logo) { const lw = (logo.width / logo.height) * lh; ctx.drawImage(logo, cx - lw / 2, y, lw, lh); y += logoH; }
  for (const [font, text, dir, sep] of lines) {
    if (!text) continue;
    ctx.font = font; ctx.direction = dir || 'rtl';
    const fs = sizeOf(font);
    if (sep) { ctx.fillRect(left + maxW * 0.1, y + 0.1 * d, maxW * 0.8, Math.max(1, Math.round(0.25 * d))); y += 0.6 * d; }
    if (y + fs > H - pad / 2) break;
    ctx.fillText(fit(ctx, String(text), maxW), cx, y);
    y += fs * gap;
  }
  return c;
}

/** تحويل Canvas إلى أمر ZPL (صورة أحادية اللون) */
export function canvasToZpl(c, { darkness = null, copies = 1 } = {}) {
  const { width: W, height: H } = c;
  const px = c.getContext('2d').getImageData(0, 0, W, H).data;
  const bpr = Math.ceil(W / 8);
  const hex = [];
  for (let y = 0; y < H; y++) {
    for (let bx = 0; bx < bpr; bx++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const x = bx * 8 + b;
        if (x >= W) continue;
        const i = (y * W + x) * 4;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (px[i + 3] > 0 && lum < 160) byte |= 0x80 >> b;
      }
      hex.push(byte.toString(16).padStart(2, '0').toUpperCase());
    }
  }
  const total = bpr * H;
  return `^XA^CI28^PW${W}^LL${H}^LH0,0${darkness != null ? `~SD${darkness}` : ''}^FO0,0^GFA,${total},${total},${bpr},${hex.join('')}^FS^PQ${copies}^XZ\n`;
}

export async function labelsToZpl(rows, opts) {
  const parts = [];
  for (const o of rows) parts.push(canvasToZpl(await drawLabel(o, opts), opts));
  return parts.join('');
}

// ---- Zebra Browser Print (تطبيق مجاني من Zebra لويندوز وماك) ----
const BASES = ['https://127.0.0.1:9101/', 'http://127.0.0.1:9100/'];
let base = null;

async function bp(path, opts = {}) {
  const tries = base ? [base] : BASES;
  let last;
  for (const b of tries) {
    try {
      const r = await fetch(b + path, { ...opts, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      base = b;
      return await r.text();
    } catch (e) { last = e; }
  }
  base = null;
  throw new Error('تعذر الاتصال ببرنامج Zebra Browser Print على هذا الجهاز. تأكد أنه مثبت ويعمل (أيقونته بجانب الساعة)، ثم أعد المحاولة.' + (last ? ` (${last.message})` : ''));
}

/** قائمة طابعات Zebra المتصلة بهذا الجهاز */
export async function zebraPrinters() {
  const out = [];
  const def = await bp('default?type=printer').catch(() => '');
  if (def && def.trim()) { try { out.push({ ...JSON.parse(def), isDefault: true }); } catch { /* ignore */ } }
  try {
    const all = JSON.parse(await bp('available'));
    for (const p of all.printer || []) if (!out.some((x) => x.uid === p.uid)) out.push(p);
  } catch { /* بعض الإصدارات لا تدعم available */ }
  return out;
}

export async function zebraSend(device, data) {
  await bp('write', { method: 'POST', body: JSON.stringify({ device, data }) });
}

export function downloadZpl(zpl, name = 'labels.zpl') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([zpl], { type: 'application/octet-stream' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
