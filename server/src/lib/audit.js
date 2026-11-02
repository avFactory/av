export async function audit(db, req, action, entity, entityId, details) {
  await db.query(
    'insert into audit_log(user_id, action, entity, entity_id, details, ip) values ($1,$2,$3,$4,$5,$6)',
    [req?.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, req?.ip ?? null]
  );
}
