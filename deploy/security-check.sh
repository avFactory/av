#!/usr/bin/env bash
# فحص أمني سريع للسيرفر (للقراءة فقط — لا يغيّر شيئاً): bash /opt/av/deploy/security-check.sh
cd "$(dirname "$0")/.."
B() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok() { echo "✓ $*"; }; bad() { echo "✗ $*"; }; warn() { echo "⚠ $*"; }

B "المنافذ المفتوحة على السيرفر"
ss -tlnpH 2>/dev/null | awk '{print $4, $6}' | sed 's/users:((//; s/,pid.*//' | sort -u
if ss -tlnH | awk '{print $4}' | grep -qE '(^|[^0-9])5432$'; then bad "منفذ قاعدة البيانات 5432 مفتوح على السيرفر!"; else ok "منفذ قاعدة البيانات 5432 غير مكشوف"; fi

B "المنافذ المنشورة من Docker (يجب أن تكون 80 و443 فقط)"
docker ps --format '{{.Names}}\t{{.Ports}}'
PUB=$(docker ps --format '{{.Ports}}' | grep -oE '0\.0\.0\.0:[0-9]+|:::[0-9]+' | grep -oE '[0-9]+$' | sort -u | tr '\n' ' ')
[ "$(echo $PUB)" = "443 80" ] || [ "$(echo $PUB)" = "80 443" ] && ok "المنشور: $PUB" || warn "منافذ منشورة: $PUB"

B "مستخدم التشغيل والقيود داخل الحاويات"
for c in $(docker ps --format '{{.Names}}'); do
  u=$(docker exec "$c" id -un 2>/dev/null || echo "?")
  ro=$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$c"); nnp=$(docker inspect -f '{{.HostConfig.SecurityOpt}}' "$c"); caps=$(docker inspect -f '{{.HostConfig.CapDrop}}' "$c")
  echo "$c: user=$u readonly=$ro security=$nnp cap_drop=$caps"
done

B "الملفات الحساسة"
stat -c '%a %U %n' .env /var/backups/goldfactory /root/.av-backup.key 2>/dev/null
[ "$(stat -c %a .env 2>/dev/null)" = 600 ] && ok ".env صلاحياته 600" || bad ".env ليس 600 — نفّذ: chmod 600 $(pwd)/.env"

B "SSH"
sshd -T 2>/dev/null | grep -Ei '^(port|passwordauthentication|permitrootlogin|maxauthtries|kbdinteractiveauthentication) '
sshd -T 2>/dev/null | grep -qi '^passwordauthentication no' && ok "الدخول بكلمة المرور مغلق" || warn "الدخول بكلمة المرور مفتوح"

B "جدار الحماية و Fail2ban"
ufw status 2>/dev/null | head -12 || warn "ufw غير مثبت"
fail2ban-client status sshd 2>/dev/null | grep -E 'Currently|Total' || warn "Fail2ban غير مفعّل"

B "آخر محاولات الدخول الفاشلة على SSH (آخر 24 ساعة)"
journalctl -u ssh -u sshd --since "24 hours ago" --no-pager 2>/dev/null | grep -Ei 'Failed password|Invalid user|authentication failure' | tail -10
echo "— أكثر العناوين محاولةً:"
journalctl -u ssh -u sshd --since "7 days ago" --no-pager 2>/dev/null | grep -Eio 'from [0-9a-f.:]+' | awk '{print $2}' | sort | uniq -c | sort -rn | head -10
echo "— آخر دخول ناجح:"; last -n 5 -a 2>/dev/null | head -6

B "شهادة HTTPS"
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2- | tr -d '"' | cut -d, -f1 | awk '{print $1}')
echo "الدومين: $DOMAIN"
echo | timeout 10 openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null || warn "تعذر قراءة الشهادة"
curl -sI "http://$DOMAIN" | grep -iE '^(HTTP|location)' | head -2

B "النسخ الاحتياطي"
ls -lh /var/backups/goldfactory 2>/dev/null | tail -4
[ -n "$(find /var/backups/goldfactory -name 'db-*.dump' -mtime -1 2>/dev/null)" ] && ok "نسخة قاعدة بيانات خلال آخر 24 ساعة" || bad "لا توجد نسخة حديثة لقاعدة البيانات"
grep -q '^OFFSITE_REMOTE=' .env && { tail -2 /var/log/goldfactory-offsite.log 2>/dev/null; } || warn "النسخ خارج السيرفر غير مفعّل (انظر deploy/SECURITY.md)"

B "أخطاء الواجهة المسجلة (آخر 10)"
docker compose logs app --since 72h 2>/dev/null | grep client-error | tail -10 || true
