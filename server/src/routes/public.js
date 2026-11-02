// المتجر العام: تصفح المنتجات بدون تسجيل دخول. لا أسعار مصنعية ولا إرسال طلبات للزوار.
import { Router } from 'express';
import { many, one } from '../db.js';
import { notFound, int } from '../lib/http.js';

const r = Router();
const COLS = `p.id, p.sku, p.name, p.product_type, p.description, p.karats, p.colors, p.approx_weight::text, p.final_weight::text, p.sizes, p.availability,
  case when p.availability = 'available' and p.stock_qty > 0 then true else false end as in_stock,
  coalesce((select json_agg(json_build_object('path', m.path, 'kind', m.kind) order by m.sort, m.id) from product_media m where m.product_id=p.id), '[]') as media`;

r.get('/products', async (req, res) => {
  const f = req.query;
  const rows = await many(`select ${COLS} from products p where p.active and p.availability <> 'unavailable'
      and ($1::text is null or p.product_type=$1) and ($2::int is null or $2 = any(p.karats)) and ($3::text is null or p.name ilike $3 or p.sku ilike $3)
    order by p.id desc limit 500`, [f.type || null, f.karat ? int(f.karat) : null, f.q ? `%${f.q}%` : null]);
  const types = await many("select distinct product_type from products where active and availability <> 'unavailable' order by 1");
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ products: rows, types: types.map((t) => t.product_type) });
});

r.get('/products/:id', async (req, res) => {
  const p = await one(`select ${COLS} from products p where p.id=$1 and p.active and p.availability <> 'unavailable'`, [int(req.params.id)]);
  if (!p) throw notFound('المنتج غير متوفر');
  res.json(p);
});

export default r;
