#!/usr/bin/env bash
# نسخ احتياطي خارج السيرفر: يشفّر نسخة اليوم (قاعدة البيانات + الملفات) ويرفعها لتخزين سحابي عبر rclone.
# التجهيز مرة واحدة (انظر deploy/SECURITY.md):
#   1) apt-get install -y rclone gnupg && rclone config        ← أنشئ وجهة باسم offsite (Google Drive / Dropbox / S3 / SFTP)
#   2) openssl rand -base64 48 > /root/.av-backup.key && chmod 600 /root/.av-backup.key   ← احفظ نسخة من هذا المفتاح خارج السيرفر!
#   3) أضف إلى /opt/av/.env السطر: OFFSITE_REMOTE=offsite:av-backups
# الاسترجاع: rclone copy offsite:av-backups/av-YYYYMMDD.tar.gpg . && gpg --batch --passphrase-file /root/.av-backup.key -d av-YYYYMMDD.tar.gpg | tar x
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(grep -E '^OFFSITE_REMOTE=' .env 2>/dev/null | cut -d= -f2- || true)
KEEP_DAYS=$(grep -E '^OFFSITE_KEEP_DAYS=' .env 2>/dev/null | cut -d= -f2- || true); KEEP_DAYS=${KEEP_DAYS:-90}
KEY=/root/.av-backup.key
SRC=/var/backups/goldfactory
D=$(date +%Y%m%d)
[ -n "$REMOTE" ] || { echo "⚠ OFFSITE_REMOTE غير مضبوط في .env — تخطي"; exit 0; }
command -v rclone >/dev/null || { echo "✗ rclone غير مثبت"; exit 1; }
[ -s "$KEY" ] || { echo "✗ مفتاح التشفير $KEY غير موجود"; exit 1; }
ls "$SRC"/*-"$D".* >/dev/null 2>&1 || { echo "✗ لا توجد نسخة محلية لليوم $D في $SRC"; exit 1; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/av-$D.tar.gpg"
# أرشيف نسخة اليوم ثم تشفيره AES256 (الملفات تحتوي هويات وسجلات تجارية وسجلات مالية)
tar -C "$SRC" -cf - $(cd "$SRC" && ls *-"$D".*) | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "$KEY" -o "$OUT"
sha256sum "$OUT" | awk '{print $1}' > "$OUT.sha256"
rclone copy "$OUT" "$REMOTE" --retries 5 --low-level-retries 10
rclone copy "$OUT.sha256" "$REMOTE" --retries 5
# التحقق أن الملف وصل بنفس الحجم
LOCAL=$(stat -c %s "$OUT"); REMOTE_SIZE=$(rclone size "$REMOTE/av-$D.tar.gpg" --json | sed -E 's/.*"bytes":([0-9]+).*/\1/')
[ "$LOCAL" = "$REMOTE_SIZE" ] || { echo "✗ حجم الملف في السحابة لا يطابق ($LOCAL ≠ $REMOTE_SIZE)"; exit 1; }
# الاحتفاظ بآخر KEEP_DAYS يوماً في السحابة
rclone delete "$REMOTE" --min-age "${KEEP_DAYS}d" --include "av-*" || true
echo "✓ offsite $D → $REMOTE ($(numfmt --to=iec "$LOCAL"))"
