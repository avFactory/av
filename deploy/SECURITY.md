# دليل أمن السيرفر — مصنع AV

## ما هو مطبّق تلقائياً (في الكود و docker-compose)
| الطبقة | الحماية |
|---|---|
| الشبكة | قاعدة البيانات على شبكة Docker داخلية `backend` (internal) بلا منفذ منشور ولا اتصال بالإنترنت. المنشور للعالم 80 و443 فقط (Caddy) |
| الحاويات | `no-new-privileges` للجميع. التطبيق: مستخدم `node` (غير root)، نظام ملفات للقراءة فقط، `cap_drop: ALL`، `/tmp` بدون تنفيذ. Caddy: كل الصلاحيات محذوفة عدا ربط المنافذ 80/443 |
| HTTPS | Caddy: شهادة Let's Encrypt تتجدد تلقائياً، تحويل HTTP→HTTPS تلقائي، HSTS سنة، nosniff، X-Frame-Options SAMEORIGIN، Referrer/Permissions-Policy، إخفاء Server، لوحة admin مغلقة، حد حجم الطلب 60MB |
| التطبيق | CSP مقيدة، حماية CSRF (التحقق من المصدر)، لا CORS (نفس الموقع فقط)، حد طلبات لكل IP (عام 6000/د، الروابط العامة 180/د، الدخول 120/د)، قفل محاولات الدخول الفاشلة، كلمات مرور bcrypt، جلسات HttpOnly+Secure+SameSite=Strict، فحص صلاحيات على كل مسار مع اختبار آلي |
| الملفات المرفوعة | أنواع محددة فقط (صور/فيديو/PDF/3D/zip)، رفض HTML/SVG/JS حتى لو غُيّر الامتداد، حد 50MB. **لا تُنفَّذ أبداً**: لا يوجد مفسّر PHP، وتُخدم كملفات ثابتة بسياسة `sandbox` و`nosniff`، وغير الصور/PDF تُنزَّل ولا تُفتح |
| السجلات | حجم سجلات Docker محدود (10MB × 5) |

## أوامر التنفيذ على السيرفر (مرة واحدة)
```bash
cd /opt/av && bash deploy/update.sh            # تطبيق docker-compose و Caddyfile الجديدين
bash /opt/av/deploy/harden-server.sh            # صلاحيات .env، ufw، fail2ban، تحديثات أمان، تقوية SSH
bash /opt/av/deploy/security-check.sh           # تقرير الوضع الأمني الكامل
```
- `harden-server.sh` لا يغلق الدخول بكلمة المرور إلا إذا وجد مفتاح SSH مسجلاً (حتى لا تُقفل خارج السيرفر).
- تغيير منفذ SSH اختياري: `SSH_PORT=2222 bash deploy/harden-server.sh` — افتح جلسة جديدة على المنفذ الجديد قبل إغلاق الحالية، واسمح به في جدار حماية مزود الاستضافة إن وُجد.

### إضافة مفتاح SSH (من جهازك وليس السيرفر)
```bash
ssh-keygen -t ed25519 -C "av-admin"
ssh-copy-id root@IP_السيرفر
```

## النسخ الاحتياطي خارج السيرفر (مشفّر)
```bash
apt-get install -y rclone gnupg
rclone config                                   # أنشئ وجهة باسم offsite (Google Drive / Dropbox / S3 / SFTP)
openssl rand -base64 48 > /root/.av-backup.key && chmod 600 /root/.av-backup.key
echo 'OFFSITE_REMOTE=offsite:av-backups' >> /opt/av/.env
bash /opt/av/deploy/setup-cron.sh               # يجدول النسخ الخارجي يومياً 3:15
bash /opt/av/deploy/offsite-backup.sh           # تجربة فورية
```
**احفظ محتوى `/root/.av-backup.key` في مكان آمن خارج السيرفر** (مدير كلمات مرور) — بدونه لا يمكن فك النسخ.

الاسترجاع:
```bash
rclone copy offsite:av-backups/av-YYYYMMDD.tar.gpg .
gpg --batch --passphrase-file /root/.av-backup.key -d av-YYYYMMDD.tar.gpg | tar x
docker compose exec -T db pg_restore -U goldadmin -d goldfactory --clean < db-YYYYMMDD.dump
```

## فحوصات دورية
```bash
bash /opt/av/deploy/security-check.sh                                   # كل أسبوع
fail2ban-client status sshd                                             # العناوين المحظورة
journalctl -u ssh --since "24 hours ago" | grep -E "Failed|Invalid"     # محاولات الدخول الفاشلة
```
