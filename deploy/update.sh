#!/usr/bin/env bash
# تحديث النظام لآخر نسخة من الفرع الرئيسي: bash /opt/av/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# بعد السحب نعيد تشغيل السكربت بنسخته الجديدة (bash يقرأ الملف أثناء التنفيذ، فتغييره أثناء العمل يُفقد الخطوات الجديدة)
if [ "${1:-}" != "--after-pull" ]; then
  git pull --ff-only origin main
  exec bash deploy/update.sh --after-pull
fi
docker compose up -d --build
# إعدادات بوابة HTTPS (Caddyfile): تُطبق عند تغيّرها بعد التحقق من صحتها (لا يُعاد تشغيل Caddy بإعدادات خاطئة)
SUM=$(sha256sum Caddyfile | cut -d' ' -f1)
if [ "$SUM" != "$(cat .caddyfile.sha 2>/dev/null || true)" ]; then
  if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker compose restart caddy >/dev/null && echo "$SUM" > .caddyfile.sha && echo "✓ طُبقت إعدادات بوابة HTTPS الجديدة"
  else
    echo "⚠ إعدادات Caddyfile غير صالحة — بقيت الإعدادات السابقة تعمل"
  fi
fi
docker image prune -f >/dev/null
# التأكد من جدولة النسخ الاحتياطي (قاعدة البيانات + الملفات)
bash deploy/setup-cron.sh || true
echo "✅ تم التحديث"
