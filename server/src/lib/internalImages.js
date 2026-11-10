// الصور الداخلية للطلب: يرفعها فريق 3D فقط (حسب التخصص أو القسم)، وتظهر للموظفين والعمال ولا تظهر للعميل أبداً
import { bad, conflict, forbidden, notFound } from './http.js';
import { registerFiles } from './uploads.js';
import { logStage } from './production.js';
import { audit } from './audit.js';

const RX = /(ثري|ثرى|ثلاثي)\s*(دي|دى|الأبعاد|الابعاد)|\b3\s*d\b/i;

/** هل المستخدم من فريق 3D؟ (التخصص أو اسم القسم) */
export const is3D = (u) => !!u && u.role_code !== 'customer' && (RX.test(u.specialty || '') || RX.test(u.department_name || ''));

export async function addInternalImages(db, req, orderId) {
  if (!is3D(req.user)) throw forbidden('رفع الصور الداخلية لفريق 3D فقط');
  const o = (await db.query('select id, order_no, status, current_stage_id from orders where id=$1 for update', [orderId])).rows[0];
  if (!o) throw notFound('الطلب غير موجود');
  if (['delivered', 'cancelled', 'rejected'].includes(o.status)) throw conflict('الطلب مغلق');
  if ((req.files || []).some((f) => !/^image\//.test(f.mimetype || ''))) throw bad('الصور الداخلية يجب أن تكون صوراً فقط');
  const files = await registerFiles(db, req.files, req.user.id);
  if (!files.length) throw bad('اختر صورة');
  for (const f of files) {
    await db.query("insert into order_files(order_id, kind, path, original_name, mime, uploaded_by, customer_visible) values ($1,'internal',$2,$3,$4,$5,false)",
      [o.id, f.path, f.original_name, f.mime, req.user.id]);
  }
  await logStage(db, o.id, o.current_stage_id, 'note', req.user.id, `رفع ${files.length} صورة داخلية (3D)`, false, req.user.role_code === 'worker' ? req.user.id : null);
  await audit(db, req, 'order.internal_images', 'order', o.id, { count: files.length });
  return { ok: true, count: files.length };
}
