import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { startListener } from './lib/events.js';
import { dispatchOutbound, notifyPerm, notifyUsers } from './lib/notify.js';
import { pool } from './db.js';

const PORT = Number(process.env.PORT || 3000);

/** فحص التأخير دورياً: الطلبات المتجاوزة لموعد التسليم والعهد المتجاوزة للمدة المتوقعة */
async function checkDelays() {
  const late = await pool.query(`update orders set delay_notified_at=now()
    where due_date < current_date and status in ('approved','in_production') and delay_notified_at is null returning id, order_no, assigned_worker_id`);
  for (const o of late.rows) {
    await notifyPerm(pool, 'orders.advance', { kind: 'delay', title: `تأخر الطلب ${o.order_no} عن موعد التسليم`, link: `/orders/${o.id}` });
    if (o.assigned_worker_id) await notifyUsers(pool, [o.assigned_worker_id], { kind: 'delay', title: `الطلب ${o.order_no} متأخر`, link: `/w/orders/${o.id}` });
  }
  const lateCustody = await pool.query(`select c.id, c.custody_no, c.worker_id, o.order_no, u.full_name from custodies c join stages s on s.id=c.stage_id
    join orders o on o.id=c.order_id join users u on u.id=c.worker_id
    where c.status='open' and s.expected_hours is not null and c.issued_at + (s.expected_hours || ' hours')::interval < now()
      and not exists (select 1 from notifications n where n.kind='delay' and n.link = '/sup/workers/' || c.worker_id || '#' || c.id)`);
  for (const c of lateCustody.rows) {
    await notifyPerm(pool, 'custody.receive', { kind: 'delay', title: `تأخر ${c.full_name} في ${c.order_no}`, body: c.custody_no, link: `/sup/workers/${c.worker_id}#${c.id}` });
  }
}

async function main() {
  await migrate();
  await startListener();
  const app = createApp();
  app.listen(PORT, () => console.log(`Gold factory server on :${PORT}`));
  setInterval(() => checkDelays().catch((e) => console.error('delay check', e.message)), 10 * 60 * 1000);
  setTimeout(() => checkDelays().catch(() => {}), 5000);
  setInterval(() => dispatchOutbound().catch((e) => console.error('outbound', e.message)), 30 * 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
