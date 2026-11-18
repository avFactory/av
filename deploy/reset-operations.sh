#!/usr/bin/env bash
# تصفير التشغيل للبدء الفعلي (مرة واحدة): يأخذ نسخة احتياطية كاملة أولاً، ثم يطلب التأكيد، ثم يحذف
# الطلبات والعهد وحركات الذهب والفواتير والمدفوعات وحركات المخزون. العملاء والمنتجات والمستخدمون والإعدادات تبقى.
set -euo pipefail
cd "$(dirname "$0")/.."

q() { docker compose exec -T db psql -U goldadmin -d goldfactory -Atc "$1"; }

echo "========================================================"
echo "  تصفير الطلبات والعهد للبدء الفعلي — مصنع AV"
echo "========================================================"
echo "الموجود الآن:"
echo "  الطلبات:        $(q 'select count(*) from orders')"
echo "  العهد:          $(q 'select count(*) from custodies')"
echo "  حركات الذهب:    $(q 'select count(*) from gold_ledger')"
echo "  الفواتير:       $(q 'select count(*) from invoices')"
echo "  المدفوعات:      $(q 'select count(*) from payments')"
echo "  حركات الألماس:  $(q 'select count(*) from stone_movements')"
echo
echo "سيُحذف كل ما سبق، ويصبح رصيد الخزنة والعمال والخامات والألماس = صفر."
echo "يبقى: العملاء، المنتجات، الموظفون والعمال، المراحل، الأجور، الإعدادات."
echo
read -r -p "للمتابعة اكتب RESET ثم Enter: " ans
# تجاهل الرموز المخفية التي ترسلها بعض الطرفيات (نهاية السطر، علامات الاتجاه، المسافات) وحالة الأحرف
ans=$(printf '%s' "$ans" | LC_ALL=C tr -cd 'A-Za-z' | tr 'a-z' 'A-Z')
if [ "$ans" != "RESET" ]; then echo "أُلغي — لم يُحذف شيء (المكتوب لم يطابق RESET)."; exit 1; fi

# نسخة احتياطية كاملة قبل الحذف (للتراجع عند الحاجة)
DIR=/var/backups/goldfactory
mkdir -p "$DIR"; chmod 700 "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U goldadmin -Fc goldfactory > "$DIR/before-reset-$TS.dump"
chmod 600 "$DIR/before-reset-$TS.dump"
[ -s "$DIR/before-reset-$TS.dump" ] || { echo "✗ فشلت النسخة الاحتياطية — لم يُحذف شيء"; exit 1; }
echo "✓ نسخة احتياطية: $DIR/before-reset-$TS.dump"

docker compose exec -T db psql -U goldadmin -d goldfactory -v ON_ERROR_STOP=1 < deploy/reset-operations.sql
echo
echo "✓ تم التصفير. ابدأ بإدخال رصيد الخزنة الفعلي: المخزون ← إضافة ذهب للخزنة."
