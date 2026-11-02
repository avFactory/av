#!/usr/bin/env bash
# نسخ احتياطي يومي لقاعدة البيانات والملفات المرفوعة. جدولة مقترحة (cron):
#   15 2 * * * /path/to/scripts/backup.sh >> /var/log/gold-backup.log 2>&1
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL required}"
DEST="${BACKUP_DIR:-/var/backups/goldfactory}"
UPLOADS="${UPLOAD_DIR:-$(dirname "$0")/../server/uploads}"
KEEP_DAYS="${KEEP_DAYS:-30}"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$DEST/db-$TS.dump"
tar -czf "$DEST/uploads-$TS.tar.gz" -C "$UPLOADS" . 2>/dev/null || true
find "$DEST" -type f -mtime +"$KEEP_DAYS" -delete
echo "backup ok $TS"
# الاسترجاع: pg_restore --clean --no-owner -d "$DATABASE_URL" db-XXXX.dump
