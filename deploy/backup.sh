#!/usr/bin/env bash
# نسخ احتياطي يومي: قاعدة البيانات + الملفات المرفوعة (صور الطلبات، المستندات، التواقيع). يحتفظ بآخر 30 يوماً.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/var/backups/goldfactory
mkdir -p "$DIR"
chmod 700 "$DIR"
D=$(date +%Y%m%d)
docker compose exec -T db pg_dump -U goldadmin -Fc goldfactory > "$DIR/db-$D.dump"
docker compose exec -T app tar czf - --exclude=uploads/.thumbs -C /data uploads > "$DIR/uploads-$D.tar.gz"
# نسخة من ملف الإعدادات (كلمات المرور) للاسترجاع الكامل — محمية 600 ومشفرة عند الرفع خارج السيرفر
cp .env "$DIR/env-$D.txt" 2>/dev/null || true
chmod 600 "$DIR"/*-"$D".*
find "$DIR" -type f -mtime +30 -delete
echo "✓ backup $D"
