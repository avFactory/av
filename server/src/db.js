import pg from 'pg';

// numeric -> نص للحفاظ على الدقة؛ int8 -> رقم
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://goldadmin:goldadmin@localhost:5432/goldfactory';
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: Number(process.env.PG_POOL || 20) });

export async function q(text, params) {
  return pool.query(text, params);
}
export async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}
export async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/**
 * تنفيذ داخل معاملة قاعدة بيانات. يعيد المحاولة تلقائياً عند تعارض التزامن
 * (serialization_failure / deadlock) لضمان عمل عدة مستخدمين بالوقت نفسه.
 */
export async function tx(fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if ((e.code === '40001' || e.code === '40P01') && attempt < retries) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}
