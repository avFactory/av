import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate({ log = true } = {}) {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
      await c.query('COMMIT');
      if (log) console.log('applied', f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`migration ${f} failed: ${e.message}`);
    } finally {
      c.release();
    }
  }
  // إنشاء حساب مدير النظام الأول إن لم يوجد
  const admin = await pool.query("select 1 from users where role_code='admin' limit 1");
  if (!admin.rowCount) {
    const pw = process.env.ADMIN_PASSWORD || 'ChangeMe!2026';
    await pool.query(
      "insert into users(username, password_hash, full_name, role_code, employee_no) values ($1,$2,$3,'admin','ADM-1')",
      [process.env.ADMIN_USERNAME || 'admin', bcrypt.hashSync(pw, 10), 'مدير النظام']
    );
    if (log) console.log(`created admin user "${process.env.ADMIN_USERNAME || 'admin'}" - change the password after first login`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
