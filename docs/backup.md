# النسخ الاحتياطي والاستعادة

نُفذ التصدير والاستيراد على عينتي قبول اصطناعيتين في 2026-09-23. نتائج التحقق النهائية في `status.md`. مرجع الإجراءات [أدوات الإدارة الرسمية](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/administration.md) و[document_exporter](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/management/commands/document_exporter.py).

أوقف المسح والرفع وأي n8n، وانتظر انتهاء مهام الاستيراد. خذ تصديراً في نافذة صيانة بعد إيقاف webserver حتى لا تتغير المستندات أثناء التصدير. تبقى db وbroker شغالتين. من جذر المشروع:

```powershell
$backupName = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Path "runtime/export/$backupName" -ErrorAction Stop | Out-Null
docker compose stop webserver
if ($LASTEXITCODE -ne 0) { throw 'Stop failed' }
try {
    docker compose run --rm --no-deps webserver document_exporter "/usr/src/paperless/export/$backupName"
    if ($LASTEXITCODE -ne 0) { throw 'Export failed; do not mark this backup complete' }
} finally {
    docker compose start webserver
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Webserver restart failed; restore service manually' }
}
```

انسخ مجلد التصدير الناتج مع compose.yaml والكتالوج وملفات التشغيل ونسخة .env إلى وجهة مشفرة خارج الجهاز. احتفظ أيضاً بملفات staging وconsume غير المستوردة بصورة منفصلة. تصدير المستندات لا يحفظ إعدادات تشغيل Docker؛ لذلك .env وCompose مطلوبان. اعتبر ملفات التصدير حساسة ولا ترفعها إلى Git. سجّل SHA256 للملفات وعدد المستندات ووقت النسخة وإصدار الصورة، ولا تضع علامة اكتمال قبل التحقق من النسخة الخارجية.

سياسة أولية: نسخة يومية، 7 يومية و4 أسبوعية و6 شهرية؛ هدف فقد البيانات الأقصى 24 ساعة، ووقت استعادة مستهدف 4 ساعات إلى أن يقاس فعلياً. لا حذف آلي للنسخ في هذه المرحلة. لا جدولة مفعلة بعد.

## تجربة الاستعادة

استخدم مجلداً مستقلاً واسم مشروع Compose مختلفاً ووحدات تخزين فارغة. أوقف خدمة الإنتاج أثناء الاختبار لتجنب تعارض المنفذ، أو عدل منفذ نسخة الاختبار وحدها. انسخ ملف التشغيل و.env المطابقين للنسخة الاحتياطية، وضع محتويات التصدير في runtime/export/restore. لا توجّه consume إلى مجلد الإنتاج.

```powershell
docker compose -p nas-archive-restore up -d db broker
docker compose -p nas-archive-restore run --rm webserver document_importer /usr/src/paperless/export/restore
# تابع فقط بعد نجاح الاستيراد؛ لا تستورد إلى قاعدة الإنتاج.
docker compose -p nas-archive-restore up -d --wait
```

تحقق من تسجيل الدخول وعدد المستندات والوسوم والحقول، وافتح الأصل والنسخة المؤرشفة لعينات عربية وإنجليزية وقارن البصمات، ثم تحقق من البحث والصلاحيات. لا تصف النسخ بأنه موثوق حتى تنجح هذه التجربة. بعد الاختبار أوقف نسخة الاستعادة وأعد تشغيل الإنتاج. قبل ترقية المحرك خذ نسخة ناجحة واحتفظ بالإصدار السابق؛ لا تخفض الإصدار على قاعدة مهاجرة، بل استعد النسخة في وحدات جديدة.

لتجربة هذه المرحلة استخدمت نسخة الاستعادة المنفذ المحلي 18000، واسم المشروع `nas-archive-restore`، ووحدات مستقلة ومجلد consume مستقل، مع تركيب التصدير للقراءة فقط. يقارن `python scripts/test_restore.py` تسجيل الدخول والكتالوج والبيانات وبصمات الأصل وPDF والبحث بالعربية والإنجليزية. هو مخصص لعينتي القبول ويشترط وجودهما وحدهما. بيانات التصدير والتقارير تحت runtime، ولا توجد نسخة خارج الجهاز أو جدولة تلقائية بعد.
