#!/usr/bin/env bash
# تحديث النظام لآخر نسخة من الفرع الرئيسي: bash /opt/av/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main
docker compose up -d --build
docker image prune -f >/dev/null
echo "✅ تم التحديث"
