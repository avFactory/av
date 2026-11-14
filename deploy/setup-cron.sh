#!/usr/bin/env bash
# جدولة النسخ الاحتياطي اليومي (2:15 صباحاً) — آمن للتكرار
cd "$(dirname "$0")/.."
CRON="15 2 * * * bash $(pwd)/deploy/backup.sh >> /var/log/goldfactory-backup.log 2>&1 # goldfactory"
# النسخ خارج السيرفر (مشفّر) الساعة 3:15 — يعمل فقط إن ضُبط OFFSITE_REMOTE في .env
OFF="15 3 * * * bash $(pwd)/deploy/offsite-backup.sh >> /var/log/goldfactory-offsite.log 2>&1 # goldfactory-offsite"
if ( crontab -l 2>/dev/null | grep -v goldfactory || true; echo "$CRON"; echo "$OFF" ) | crontab - 2>/dev/null; then
  echo "✓ النسخ الاحتياطي اليومي مجدول (قاعدة البيانات + الملفات)"
else
  echo "⚠ تعذر جدولة النسخ الاحتياطي - ثبّت cron: apt-get install -y cron"
fi
