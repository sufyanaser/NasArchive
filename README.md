# NAS Archive

نظام متكامل ومؤمن لأرشفة الوثائق الشخصية والرسمية باللغة العربية أولاً على بيئة Windows، مبني على محرك Paperless-ngx المستقل مع تكامل المسح الضوئي (NAPS2)، التحليل الذكي للبيانات الوصفية، والربط أحادي الاتجاه مع Google Drive وGoogle Sheets.

---

## 1. المتطلبات والتشغيل الأولي

- **المتطلبات**: Docker Desktop (بحاويات Linux وWSL 2)، وPython 3.12 أو أحدث.
- **التشغيل لأول مرة**:
  ```powershell
  ./scripts/Initialize.ps1
  docker compose config --quiet
  docker compose pull
  ./scripts/Test-Runtime.ps1
  python scripts/provision_local.py
  ```

يفتح النظام على: **http://localhost:8000** (محلي فقط).
بيانات حساب المدير المحلي `nasadmin` يتم إنشاؤها عشوائياً في `runtime/admin-login.json`. احرص على عدم مشاركة هذا الملف أو رفعه إلى Git.

---

## 2. المسح الضوئي والاستيراد (NAPS2 Integration)

- **اكتشاف الماسحات المتصلة**:
  ```powershell
  ./scripts/Scan-Document.ps1 -ListDevices
  ```
- **المسح الضوئي المباشر وتوجيه الوثيقة للقسم**:
  ```powershell
  ./scripts/Scan-Document.ps1 -Section 'الرنين'
  ```
- **استيراد ملف PDF يدوياً**:
  ```powershell
  ./scripts/Scan-Document.ps1 -ImportFile 'path\to\document.pdf' -Section 'تناسق'
  ```

*ملاحظة*: يتم حفظ الملفات الأصلية الممسوحة فوراً في `runtime/scanned_archive/` قبل نقلها إلى مجلد الاستهلاك لتفادي فقدان الأصل وتفادي استيراد الوثائق المكررة.

---

## 3. المعالجة الذكية للوثائق (AI Document Processing)

محلل ذكي محلي لاستخراج العناوين، أرقام الكتب الإدارية، القيود، والتواريخ مع الحفاظ على الأصفار والرموز وتحديد الأقسام المقترحة مع درجات الثقة:

- **تحليل وثيقة واستعراض المقترحات**:
  ```powershell
  python scripts/ai_processor.py --doc-id <DOCUMENT_ID>
  ```
- **تطبيق المقترحات كمسودة للمراجعة البشرية**:
  ```powershell
  python scripts/ai_processor.py --doc-id <DOCUMENT_ID> --apply
  ```
- **تدقيق كامل الأرشيف وكشف البيانات الناقصة**:
  ```powershell
  python scripts/ai_processor.py --audit-all
  ```

*قاعدة أمان أساسية*: المعالجة الذكية لا تمنح موافقة المزامنة السحابية تلقائياً (`معتمد للمزامنة` يبقى دائماً `False` حتى يعتمده المراجع البشري يدوياً).

---

## 4. المزامنة السحابية إلى Google Drive وSheets

مزامنة أحادية الاتجاه خاضعة لسجل دائم يمنع التكرار ويتيح استئناف الخطوات الفاشلة دون تكرار الرفع:

- **فحص المزامنة الاستعراضي (Dry-Run)**:
  ```powershell
  python scripts/sync_cloud.py
  ```
- **مزامنة وثيقة معتمدة ومحددة**:
  ```powershell
  python scripts/sync_cloud.py --doc-id <DOCUMENT_ID>
  ```
- **المزامنة الحية (عند توفر بيانات Google Cloud)**:
  ```powershell
  python scripts/sync_cloud.py --live
  ```

شروط النشر السحابي:
1. `معتمد للمزامنة` = `True`.
2. إزالة وسم `بانتظار المراجعة`.
3. وجود وسم قسم واحد فقط (`شخصي`، `الرنين`، `تناسق`، `NAS FM`).
4. اكتمال الحقول الرسمية (رقم الكتاب، الجهة، المراجع، تاريخ المراجعة).
5. مطابقة بصمة الاعتماد الرقمية `approved_hash`.

---

## 5. الفحوصات الآلية واختبار دورة الحياة

- **تشغيل جميع اختبارات الوحدة الـ 31**:
  ```powershell
  python -m unittest discover -s tests -v
  ```
- **فحص دورة الحياة التشغيلية الكاملة (المسح ← الاستيراد ← OCR ← الذكاء الاصطناعي ← المراجعة ← المزامنة)**:
  ```powershell
  python scripts/test_lifecycle.py
  ```
- **فحص صحة الخدمات وصفحة الدخول**:
  ```powershell
  ./scripts/Test-Runtime.ps1
  ```
- **فحص الحقول الرسمية والأصفار البادئة**:
  ```powershell
  python scripts/test_custom_fields.py
  ```

للمزيد من التفاصيل، راجع الوثائق في مجلد `docs/` ومواصفات التكامل في `n8n/README.md`.
