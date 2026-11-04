#!/usr/bin/env bash
# جدولة النسخ الاحتياطي اليومي (2:15 صباحاً) — آمن للتكرار
cd "$(dirname "$0")/.."
CRON="15 2 * * * bash $(pwd)/deploy/backup.sh >> /var/log/goldfactory-backup.log 2>&1 # goldfactory"
if ( crontab -l 2>/dev/null | grep -v goldfactory || true; echo "$CRON" ) | crontab - 2>/dev/null; then
  echo "✓ النسخ الاحتياطي اليومي مجدول (قاعدة البيانات + الملفات)"
else
  echo "⚠ تعذر جدولة النسخ الاحتياطي - ثبّت cron: apt-get install -y cron"
fi
