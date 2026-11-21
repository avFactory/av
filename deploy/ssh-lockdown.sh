#!/usr/bin/env bash
# منع تخمين كلمة مرور SSH من الإنترنت، مع إبقاء الدخول بكلمة المرور من:
#   - 169.254.0.1 = الطرفية في لوحة Hostinger (Browser terminal)
#   - عنوان الجلسة الحالية (حتى لا تُقفل خارج السيرفر)
#   - أي عناوين إضافية: ALLOW_IPS="1.2.3.4 5.6.7.8" bash deploy/ssh-lockdown.sh
# الدخول بمفتاح SSH يبقى مسموحاً من أي مكان. للتراجع: bash deploy/ssh-lockdown.sh --undo
set -euo pipefail
CONF=/etc/ssh/sshd_config.d/01-av-password-from-console-only.conf
reload_ssh() { systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload 2>/dev/null || true; }

if [ "${1:-}" = "--undo" ]; then
  rm -f "$CONF"; sshd -t && reload_ssh; echo "✓ أُلغي التقييد — عاد الدخول بكلمة المرور من أي مكان"; exit 0
fi
[ "$(id -u)" = 0 ] || { echo "✗ شغّله كـ root"; exit 1; }

ALLOW="169.254.0.1"
CUR=$(echo "${SSH_CLIENT:-${SSH_CONNECTION:-}}" | awk '{print $1}')
[ -n "$CUR" ] && [ "$CUR" != "169.254.0.1" ] && ALLOW="$ALLOW,$CUR"
for ip in ${ALLOW_IPS:-}; do ALLOW="$ALLOW,$ip"; done

# الملف يبدأ بـ 01 حتى يُقرأ قبل إعدادات cloud-init (أول قيمة هي المعتمدة في SSH)
cat > "$CONF" <<EOF
# goldfactory: كلمة المرور فقط من طرفية Hostinger والعناوين المسموحة — الباقي بالمفاتيح فقط
PasswordAuthentication no
KbdInteractiveAuthentication no
Match Address $ALLOW
    PasswordAuthentication yes
EOF

fail() { rm -f "$CONF"; echo "✗ $1 — لم يُطبق أي تغيير (الإعدادات السابقة كما هي)"; exit 1; }
sshd -t || fail "إعدادات SSH غير صالحة"
# التحقق الفعلي قبل التطبيق: الطرفية مسموحة، وعنوان غريب ممنوع
pa() { sshd -T -C "user=root,host=x,addr=$1" 2>/dev/null | awk '/^passwordauthentication /{print $2}'; }
[ "$(pa 169.254.0.1)" = yes ] || fail "التحقق فشل: طرفية Hostinger لن تستطيع الدخول"
[ -z "$CUR" ] || [ "$(pa "$CUR")" = yes ] || fail "التحقق فشل: جلستك الحالية لن تستطيع الدخول"
[ "$(pa 203.0.113.7)" = no ] || fail "التحقق فشل: الإنترنت ما زال يستطيع تجربة كلمات المرور"
reload_ssh
echo "✓ SSH: كلمة المرور مسموحة فقط من: $ALLOW"
echo "  البوتات من الإنترنت تُرفض مباشرة بدون تجربة كلمات مرور."
echo "  للتراجع في أي وقت: bash $(cd "$(dirname "$0")" && pwd)/ssh-lockdown.sh --undo"
