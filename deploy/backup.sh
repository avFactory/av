#!/usr/bin/env bash
# نسخ احتياطي يومي:
#  - قاعدة البيانات: نسخة كاملة كل يوم (صغيرة)
#  - الملفات المرفوعة (صور الطلبات، المستندات، التواقيع):
#      نسخة كاملة يوم الجمعة (uploads-full-YYYYMMDD.tar.gz)
#      وباقي الأيام الملفات الجديدة/المعدلة فقط منذ آخر نسخة كاملة (uploads-inc-YYYYMMDD.tar.gz)
#  - الاحتفاظ 35 يوماً (5 نسخ كاملة أسبوعية على الأقل)
# الاسترجاع الكامل للملفات: فك آخر full ثم آخر inc بعده فوقه:
#   tar -xzf uploads-full-XXXX.tar.gz -C /المجلد  &&  tar --listed-incremental=/dev/null -xzf uploads-inc-YYYY.tar.gz -C /المجلد
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-/var/backups/goldfactory}
KEEP_DAYS=${KEEP_DAYS:-35}
mkdir -p "$DIR"; chmod 700 "$DIR"
D=$(date +%Y%m%d)

# نسخة الملفات من مجلد على القرص (GNU tar): كاملة أسبوعياً، وتفاضلية يومياً
uploads_backup() {
  local SRC=$1 BASE="$DIR/.uploads-full.snar" last_full
  last_full=$(ls -1t "$DIR"/uploads-full-*.tar.gz 2>/dev/null | head -1 || true)
  if [ "$(date +%u)" = 5 ] || [ ! -s "$BASE" ] || [ -z "$last_full" ] || [ -n "$(find "$last_full" -mtime +7 2>/dev/null)" ] || [ "${FORCE_FULL:-0}" = 1 ]; then
    rm -f "$BASE.new"
    tar --listed-incremental="$BASE.new" --exclude=./.thumbs -czf "$DIR/uploads-full-$D.tar.gz.part" -C "$SRC" .
    mv "$DIR/uploads-full-$D.tar.gz.part" "$DIR/uploads-full-$D.tar.gz"; mv "$BASE.new" "$BASE"
    rm -f "$DIR/uploads-inc-$D.tar.gz"
    # النسخ اليومية الكاملة بالصيغة القديمة: يُبقى آخرها فقط (النسخة الكاملة الجديدة تحتويها)
    ls -1t "$DIR"/uploads-[0-9]*.tar.gz 2>/dev/null | tail -n +2 | xargs -r rm -f
    echo "uploads: full ($(du -h "$DIR/uploads-full-$D.tar.gz" | cut -f1))"
  else
    local TMP; TMP=$(mktemp); cp "$BASE" "$TMP"
    tar --listed-incremental="$TMP" --exclude=./.thumbs -czf "$DIR/uploads-inc-$D.tar.gz.part" -C "$SRC" .
    rm -f "$TMP"; mv "$DIR/uploads-inc-$D.tar.gz.part" "$DIR/uploads-inc-$D.tar.gz"
    echo "uploads: changes since $(basename "$last_full") ($(du -h "$DIR/uploads-inc-$D.tar.gz" | cut -f1))"
  fi
}

if [ "${UPLOADS_SRC:-}" ]; then
  uploads_backup "$UPLOADS_SRC"   # للاختبار
  exit 0
fi

docker compose exec -T db pg_dump -U goldadmin -Fc goldfactory > "$DIR/db-$D.dump"
# مجلد الملفات على قرص السيرفر (volume التطبيق)؛ إن تعذر تحديده: نسخة كاملة من داخل الحاوية كالسابق
SRC=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/uploads"}}{{.Source}}{{end}}{{end}}' "$(docker compose ps -q app)" 2>/dev/null || true)
if [ -n "$SRC" ] && [ -d "$SRC" ] && tar --version 2>/dev/null | grep -q GNU; then
  uploads_backup "$SRC"
else
  docker compose exec -T app tar czf - --exclude=uploads/.thumbs -C /data uploads > "$DIR/uploads-full-$D.tar.gz"
  echo "uploads: full (fallback)"
fi
# نسخة من ملف الإعدادات (كلمات المرور) للاسترجاع الكامل — محمية 600 ومشفرة عند الرفع خارج السيرفر
cp .env "$DIR/env-$D.txt" 2>/dev/null || true
chmod 600 "$DIR"/*-"$D".* 2>/dev/null || true
find "$DIR" -maxdepth 1 -type f -name '*-[0-9]*' -mtime +"$KEEP_DAYS" -delete
rm -f "$DIR"/*.part
echo "✓ backup $D"
