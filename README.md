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

## 2. بوابة المسح الضوئي والاستيراد السريع (Scanner Web UI & Bridge)

يوفر النظام واجهة ويب مستقلة باللغة العربية أولاً لربط الماسح الضوئي (`EPSON WF-C5890 Series`) والاستيراد السلس بنقرة واحدة دون الحاجة لأوامر الطرفية أو فتح برنامج NAPS2 يدوياً:

- **رابط الواجهة**: **http://localhost:8001**
- **تشغيل خادم المسح في الخلفية**:
  ```powershell
  ./scripts/Start-ScannerBridge.ps1 -OpenBrowser
  ```
- **إيقاف خادم المسح**:
  ```powershell
  ./scripts/Stop-ScannerBridge.ps1
  ```
- **تفعيل التشغيل التلقائي مع بدء ويندوز**:
  ```powershell
  ./scripts/Register-StartupBridge.ps1
  ```
- **إنشاء اختصارات سطح المكتب**:
  ```powershell
  ./scripts/Create-DesktopShortcuts.ps1
  ```

### مميزات الواجهة:
- **اختيار القسم الفوري**: بطاقات تفاعلية لتصنيف المستندات فورياً (`شخصي`، `الرنين`، `تناسق`، `NAS FM`).
- **خيارات المسح المتقدمة**:
  - اختيار جهاز المسح المكتشف تلقائياً عبر مشغل WIA.
  - مصدر التلقيم: تلقائي / مسطح الزجاج (Flatbed) / مغذي المستندات (ADF وجه واحد) / مغذي المستندات (ADF وجهين Duplex).
  - نمط الألوان: ملون (Color) / تدرج الرمادي (Grayscale) / أسود وأبيض (Monochrome).
  - دقة المسح: 150 DPI / 300 DPI (الافتراضي الموصى به) / 600 DPI.
  - التصحيح الآلي لزاوية الميلان (Auto-Deskew).
- **مؤشر المسار الحي (Pipeline Tracker)**:
  `الاتصال بالماسح` ➔ `المسح الضوئي` ➔ `حفظ الأصل والأمان` ➔ `الترحيل لـ Paperless` ➔ `المعالجة وOCR` ➔ `جاهز`.
- **فتح الوثيقة مباشرة**: نقرة واحدة للانتقال إلى صفحة الوثيقة المفهرسة داخل Paperless (`http://localhost:8000/documents/<id>/details`).
- **استيراد ملف يدوي**: منطقة سحب وإفلات (Drag & Drop) للملفات والصور (PDF, PNG, JPG, TIFF) تسلك نفس مسار الأمان وكشف التكرار.
- **كشف التكرار الرقمي**: فحص فوري ببصمة SHA-256 لمنع تكرار الوثائق الممسوحة مسبقاً مع خيار التجاوز عند الحاجة.

---

## 3. المسح الضوئي عبر PowerShell (CLI Alternative)

لمن يفضل استخدام موجه الأوامر بدلاً من الواجهة:

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

---

## 4. المعالجة الذكية للوثائق (AI Document Processing)

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

## 5. المزامنة السحابية إلى Google Drive وSheets

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

## 6. الفحوصات الآلية واختبار دورة الحياة

- **تشغيل جميع اختبارات الوحدة الـ 42**:
  ```powershell
  python -m unittest discover -s tests -p "test_*.py" -v
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
