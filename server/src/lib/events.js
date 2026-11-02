import pg from 'pg';
import { DATABASE_URL } from '../db.js';

// تحديثات فورية: PostgreSQL LISTEN/NOTIFY -> Server-Sent Events
const clients = new Set();
let listener = null;
let timer = null;
const pending = new Set();

export async function startListener() {
  if (listener) return;
  listener = new pg.Client({ connectionString: DATABASE_URL });
  await listener.connect();
  await listener.query('LISTEN app_events');
  listener.on('notification', (n) => {
    try { pending.add(JSON.parse(n.payload).table); } catch { /* ignore */ }
    if (!timer) timer = setTimeout(flush, 300); // تجميع التحديثات المتقاربة
  });
  listener.on('error', () => { listener = null; setTimeout(() => startListener().catch(() => {}), 3000); });
}

function flush() {
  timer = null;
  const tables = [...pending];
  pending.clear();
  const msg = `data: ${JSON.stringify({ tables })}\n\n`;
  for (const res of clients) res.write(msg);
}

export function sseHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

export async function stopListener() {
  if (listener) await listener.end().catch(() => {});
  listener = null;
}
