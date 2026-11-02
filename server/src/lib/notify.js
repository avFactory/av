import { pool } from '../db.js';

/** إشعار داخلي لمستخدمين محددين */
export async function notifyUsers(db, userIds, { kind, title, body = null, link = null }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await db.query(
    `insert into notifications(user_id, kind, title, body, link)
     select u, $2, $3, $4, $5 from unnest($1::int[]) u`,
    [ids, kind, title, body, link]
  );
}

/** إشعار لكل من يملك صلاحية معينة */
export async function notifyPerm(db, perm, payload) {
  const r = await db.query(
    `select u.id from users u
     where u.active and u.role_code <> 'customer' and not ($1 = any(u.denied_perms))
       and (exists (select 1 from role_permissions rp where rp.role_code = u.role_code and rp.perm_code = $1) or $1 = any(u.extra_perms))`,
    [perm]
  );
  await notifyUsers(db, r.rows.map((x) => x.id), payload);
}

/** إشعار العميل (داخلي + قنوات خارجية عند تفعيلها) */
export async function notifyCustomer(db, customerId, payload) {
  if (!customerId) return;
  const r = await db.query('select id from users where customer_id = $1 and active', [customerId]);
  await notifyUsers(db, r.rows.map((x) => x.id), payload);
  const c = (await db.query('select phone, email from customers where id = $1', [customerId])).rows[0];
  const ch = (await db.query("select value from settings where key='notify_channels'")).rows[0]?.value || {};
  const text = `${payload.title}${payload.body ? ' - ' + payload.body : ''}`;
  if (c?.phone && ch.whatsapp) await db.query("insert into outbound_messages(channel, recipient, body) values ('whatsapp',$1,$2)", [c.phone, text]);
  if (c?.phone && ch.sms) await db.query("insert into outbound_messages(channel, recipient, body) values ('sms',$1,$2)", [c.phone, text]);
  if (c?.email && ch.email) await db.query("insert into outbound_messages(channel, recipient, body) values ('email',$1,$2)", [c.email, text]);
}

/**
 * مرسل القنوات الخارجية. يعمل عند ضبط متغيرات البيئة:
 *  WHATSAPP_TOKEN + WHATSAPP_PHONE_ID  (WhatsApp Business Cloud API)
 *  SMS_WEBHOOK_URL                      (مزود SMS عبر Webhook - JSON {to, text})
 *  EMAIL_WEBHOOK_URL                    (مزود بريد عبر Webhook - JSON {to, subject, text})
 * بدون إعداد تُعلَّم الرسالة skipped ولا يُرسل شيء.
 */
export async function dispatchOutbound() {
  const { rows } = await pool.query("select * from outbound_messages where status='queued' order by id limit 20");
  for (const m of rows) {
    try {
      let sent = false;
      if (m.channel === 'whatsapp' && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
        const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: m.recipient, type: 'text', text: { body: m.body } }),
        });
        if (!r.ok) throw new Error(`whatsapp ${r.status}`);
        sent = true;
      } else if (m.channel === 'sms' && process.env.SMS_WEBHOOK_URL) {
        const r = await fetch(process.env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: m.recipient, text: m.body }) });
        if (!r.ok) throw new Error(`sms ${r.status}`);
        sent = true;
      } else if (m.channel === 'email' && process.env.EMAIL_WEBHOOK_URL) {
        const r = await fetch(process.env.EMAIL_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: m.recipient, subject: 'إشعار من المصنع', text: m.body }) });
        if (!r.ok) throw new Error(`email ${r.status}`);
        sent = true;
      }
      await pool.query('update outbound_messages set status=$2, sent_at=now() where id=$1', [m.id, sent ? 'sent' : 'skipped']);
    } catch (e) {
      await pool.query("update outbound_messages set status='failed', error=$2 where id=$1", [m.id, String(e.message)]);
    }
  }
}
