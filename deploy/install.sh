#!/usr/bin/env bash
# تثبيت/تحديث النظام على خادم Ubuntu مع Docker. يُشغَّل من داخل مجلد المستودع: bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
if [ ! -f .env ]; then
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  DEFAULT_DOMAIN="$(echo "$IP" | tr . -).sslip.io"
  read -rp "الدومين (اضغط Enter لاستخدام $DEFAULT_DOMAIN): " DOMAIN
  DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}
  read -rsp "كلمة مرور مدير النظام (admin) - 10 أحرف على الأقل: " ADMIN_PASSWORD; echo
  [ ${#ADMIN_PASSWORD} -ge 10 ] || { echo "كلمة المرور قصيرة"; exit 1; }
  DB_PASSWORD=$(openssl rand -hex 24)
  umask 077
  printf 'DOMAIN=%s\nDB_PASSWORD=%s\nADMIN_PASSWORD=%s\n' "$DOMAIN" "$DB_PASSWORD" "$ADMIN_PASSWORD" > .env
  echo "تم إنشاء .env (احتفظ بنسخة منه في مكان آمن)"
fi
docker compose up -d --build
# جدار ناري: SSH + HTTP + HTTPS فقط
if command -v ufw >/dev/null; then
  { ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable; } >/dev/null 2>&1 \
    && echo "✓ جدار الحماية مفعّل (22, 80, 443)" || echo "⚠ تعذر ضبط جدار الحماية - تجاوز"
fi
# نسخ احتياطي يومي 2:15 صباحاً
mkdir -p /var/backups/goldfactory
CRON="15 2 * * * cd $(pwd) && docker compose exec -T db pg_dump -U goldadmin -Fc goldfactory > /var/backups/goldfactory/db-\$(date +\%Y\%m\%d).dump && find /var/backups/goldfactory -mtime +30 -delete"
if ( crontab -l 2>/dev/null | grep -v goldfactory || true; echo "$CRON" ) | crontab - 2>/dev/null; then
  echo "✓ النسخ الاحتياطي اليومي مجدول (2:15 صباحاً)"
else
  echo "⚠ تعذر جدولة النسخ الاحتياطي - ثبّت cron: apt-get install -y cron"
fi
. ./.env
echo "✅ النظام يعمل على: https://$DOMAIN  (المستخدم: admin)"
