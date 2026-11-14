#!/usr/bin/env bash
# تقوية السيرفر (تشغيل مرة واحدة كـ root): bash /opt/av/deploy/harden-server.sh
#  - صلاحيات الملفات الحساسة (.env والنسخ الاحتياطية)
#  - جدار الحماية: SSH + 80 + 443 فقط
#  - Fail2ban لمنع تخمين كلمات المرور على SSH
#  - تحديثات الأمان التلقائية
#  - SSH: يمنع الدخول بكلمة المرور فقط إن وُجد مفتاح SSH مسجل (حتى لا تُقفل خارج السيرفر)
# متغيرات اختيارية: SSH_PORT=2222 (تغيير منفذ SSH) — FORCE_KEYS=1 (إغلاق كلمة المرور حتى بدون فحص المفاتيح — غير مستحسن)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "شغّل السكربت بصلاحية root"; exit 1; }
cd "$(dirname "$0")/.."
APP_DIR=$(pwd)
SSH_PORT=${SSH_PORT:-22}
ok() { echo "✓ $*"; }
warn() { echo "⚠ $*"; }

# 1) صلاحيات الملفات الحساسة
if [ -f .env ]; then chown root:root .env && chmod 600 .env && ok ".env: للقراءة من root فقط (600)"; fi
mkdir -p /var/backups/goldfactory && chown root:root /var/backups/goldfactory && chmod 700 /var/backups/goldfactory
find /var/backups/goldfactory -type f -exec chmod 600 {} + 2>/dev/null || true
ok "النسخ الاحتياطية: مجلد 700 وملفات 600"
[ -f /root/.av-backup.key ] && chmod 600 /root/.av-backup.key

# 2) الحزم
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ufw fail2ban unattended-upgrades >/dev/null
ok "تثبيت ufw و fail2ban و unattended-upgrades"

# 3) تحديثات الأمان التلقائية (بدون أسئلة)
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
ok "تحديثات الأمان التلقائية مفعّلة"

# 4) SSH
KEYS=0
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -s "$f" ] && grep -qE '^(ssh-|ecdsa-|sk-)' "$f" && KEYS=1
done
mkdir -p /etc/ssh/sshd_config.d
{
  echo "# تقوية SSH (goldfactory)"
  echo "Port $SSH_PORT"
  echo "MaxAuthTries 3"
  echo "LoginGraceTime 30"
  echo "X11Forwarding no"
  echo "PermitEmptyPasswords no"
  echo "ClientAliveInterval 300"
  echo "ClientAliveCountMax 2"
  if [ "$KEYS" = 1 ] || [ "${FORCE_KEYS:-0}" = 1 ]; then
    echo "PasswordAuthentication no"
    echo "KbdInteractiveAuthentication no"
    echo "PermitRootLogin prohibit-password"
  fi
} > /etc/ssh/sshd_config.d/99-goldfactory.conf
if sshd -t; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  if [ "$KEYS" = 1 ] || [ "${FORCE_KEYS:-0}" = 1 ]; then ok "SSH: الدخول بالمفاتيح فقط، و3 محاولات كحد أقصى"
  else warn "SSH: لا يوجد مفتاح SSH مسجل — تُرك الدخول بكلمة المرور مفعّلاً حتى لا تُقفل خارج السيرفر. أضف مفتاحك ثم أعد تشغيل السكربت."; fi
else
  rm -f /etc/ssh/sshd_config.d/99-goldfactory.conf; warn "إعدادات SSH غير صالحة — لم تُطبق"
fi

# 5) Fail2ban: حظر ساعة بعد 5 محاولات فاشلة خلال 10 دقائق، وتصاعدي للمتكرر
cat > /etc/fail2ban/jail.d/goldfactory.local <<EOF
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
bantime.increment = true
bantime.maxtime = 1w
backend = systemd

[sshd]
enabled = true
port = $SSH_PORT
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 && systemctl restart fail2ban && ok "Fail2ban يعمل على SSH"

# 6) جدار الحماية: لا يُسمح إلا بـ SSH و80 و443
# ملاحظة: Docker ينشر المنافذ متجاوزاً ufw، لذلك لا يُنشر في docker-compose إلا 80 و443 (Caddy) — قاعدة البيانات بلا منفذ منشور
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "$SSH_PORT"/tcp >/dev/null
ufw limit "$SSH_PORT"/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
[ "$SSH_PORT" != 22 ] && ufw delete allow 22/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null && ok "جدار الحماية: $SSH_PORT و80 و443 فقط"

echo
echo "تم. افحص الوضع بالكامل بـ: bash $APP_DIR/deploy/security-check.sh"
[ "$SSH_PORT" != 22 ] && echo "⚠ منفذ SSH الآن $SSH_PORT — افتح جلسة جديدة للتجربة قبل إغلاق الجلسة الحالية: ssh -p $SSH_PORT root@السيرفر"
exit 0
