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
  const pad = 2 * d;
  // QR على اليمين
  const qrSide = Math.min(H - 2 * pad, 27 * d);
  const { size, bits } = o.qr_matrix;
  const cell = Math.floor(qrSide / size);
  const qrPx = cell * size;
  const qx = W - pad - qrPx, qy = Math.round((H - qrPx) / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (bits[y * size + x] === '1') ctx.fillRect(qx + x * cell, qy + y * cell, cell, cell);
  // النصوص على يسار QR بمحاذاة يمين
  const right = qx - 2 * d, left = pad, maxW = right - left;
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  const lines = [];
  const pt = (n) => (n / 72) * dpi; // نقطة طباعية → نقاط الطابعة
  const logo = await loadImg('/logo.png');
  lines.push([`700 ${pt(7.6)}px 'Courier New', monospace`, o.order_no, 'ltr']);
  lines.push([`700 ${pt(8)}px ${FONT}`, o.title]);
  lines.push([`400 ${pt(7)}px ${FONT}`, o.material_name]);
  lines.push([`400 ${pt(7)}px ${FONT}`, `الكمية ${o.quantity}${o.size ? ` · مقاس ${o.size}` : ''}`]);
  if (o.shop_name) lines.push([`400 ${pt(6.8)}px ${FONT}`, o.shop_name]);
  // توسيط كتلة النص عمودياً بجانب QR
  const sizeOf = (f) => parseFloat(f.split(' ')[1]);
  const logoH = logo ? 4.5 * d + 0.8 * d : 0;
  const blockH = logoH + lines.filter((l) => l[1]).reduce((a, l) => a + sizeOf(l[0]) * 1.3, 0);
  let y = Math.max(pad, (H - blockH) / 2);
  if (logo) { const lh = 4.5 * d, lw = (logo.width / logo.height) * lh; ctx.drawImage(logo, right - lw, y, lw, lh); y += logoH; }
  for (const [font, text, dir] of lines) {
    if (!text) continue;
    ctx.font = font; ctx.direction = dir || 'rtl';
    const size = parseFloat(font.split(' ')[1]);
    if (y + size > H - pad) break;
    ctx.fillText(fit(ctx, String(text), maxW), right, y);
    y += size * 1.3;
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
        if (px[i + 3] > 0 && lum < 140) byte |= 0x80 >> b;
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
