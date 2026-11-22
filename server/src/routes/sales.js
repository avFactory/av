// مدير المبيعات: يساعد العملاء الذين لا يعرفون الطلب من المتجر — يضيف للسلة ثم يختار العميل (والفرع) ويرسل الطلب باسمه
import { Router } from 'express';
import { tx, many } from '../db.js';
import { requirePerm } from '../lib/auth.js';
import { bad, notFound, int } from '../lib/http.js';
import { notifyCustomer } from '../lib/notify.js';
import { placeStoreCart } from './store.js';

const r = Router();
r.use(requirePerm('store.sales'));

/** العملاء المعتمدون وفروعهم (لاختيار صاحب الطلب) */
r.get('/customers', async (_req, res) => {
  res.json(await many(`select c.id, c.shop_name, c.owner_name, c.phone, c.city,
      coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name) order by b.id) from customer_branches b where b.customer_id=c.id and b.active), '[]') as branches
    from customers c where c.status='approved' order by c.shop_name`));
});

/** إرسال السلة باسم العميل المختار */
r.post('/orders', async (req, res) => {
  const customerId = int(req.body.customer_id, 'العميل');
  res.json(await tx(async (db) => {
    const c = (await db.query("select id, shop_name, status from customers where id=$1", [customerId])).rows[0];
    if (!c) throw notFound('العميل غير موجود');
    if (c.status !== 'approved') throw bad('حساب العميل غير معتمد');
    let branch = null;
    if (req.body.branch_id) {
      branch = (await db.query('select id, name from customer_branches where id=$1 and customer_id=$2 and active', [int(req.body.branch_id), c.id])).rows[0];
      if (!branch) throw bad('الفرع غير موجود لهذا العميل');
    }
    const out = await placeStoreCart(db, req, req.body.items, { customer_id: c.id, branch_id: branch?.id || null, shop_name: c.shop_name, branch_name: branch?.name || null, seller: req.user.full_name });
    const refs = [out.stock_ref, out.make_ref].filter(Boolean).join(' و ');
    await notifyCustomer(db, c.id, { kind: 'order', title: `أُرسل طلب باسمكم من ${req.user.full_name} (المبيعات)`, body: refs, link: '/store/orders' });
    return { ...out, customer: c.shop_name, branch: branch?.name || null };
  }));
});

export default r;
