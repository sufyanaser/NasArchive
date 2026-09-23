# فحص المصادر — 2026-09-23

- مستودع المستخدم `https://github.com/sufyanaser/NasArchive.git` استُنسخ بنجاح وكان فارغاً. لم يعرض `git ls-remote` أي مرجع. لا CLAUDE.md ولا كود سابق فيه. أُعيد الفحص بعد طلب الاستكمال وبقي البعيد فارغاً.
- الفرع المحلي الحالي develop غير مولود بعد (unborn): له اسم في HEAD لكن لن يظهر في GitHub قبل أول commit وpush.
- الإصدار المستقر الفعلي: **v3.2.1**، منشور في **2026-09-20 21:57:31 UTC**، وليس prerelease أو draft، بحسب [GitHub Releases API](https://api.github.com/repos/paperless-ngx/paperless-ngx/releases/latest) و[صفحة الإصدار](https://github.com/paperless-ngx/paperless-ngx/releases/tag/v3.2.1). صورة المحرك مثبتة على 3.2.1.
- [دليل الإصدار الرسمي](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/usage.md#ai-features) يثبت وجود اقتراحات LLM للعناوين والتواريخ والوسوم والجهات وأنواع المستندات، ومحادثة مستند واحد أو عدة مستندات، وفهرس RAG اختياري. يدعم Ollama محلياً وواجهات متوافقة مع OpenAI. التصنيف التقليدي بالتعلم الآلي مستقل عن LLM. توجد أيضاً خطوة workflow لتطبيق اقتراحات AI.
- ميزات AI معطلة في هذه المرحلة. لا مزود أو نموذج أو مفاتيح أُعدت، ولا نعد باستخراج رقم الكتاب والحقول المخصصة تلقائياً. ذلك يحتاج تجربة مستقلة ومراجعة بشرية.
- راجعنا [إعدادات الإصدار](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docs/configuration.md) و[Compose الرسمي](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docker/compose/docker-compose.postgres.yml). استُخدم PostgreSQL 18 وValkey 9، ومفتاح المراقبة في هذا الإصدار هو PAPERLESS_CONSUMER_POLLING_INTERVAL.
- فُحص [تعريف الحقول](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/models.py) و[serializers](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/serialisers.py) لتحديد أنواع الحقول وصيغة API.
- لم يُستنسخ upstream داخل المشروع ولم يُعدّل. ملفات sources في مشروع ChatGPT بقيت دون تعديل.
- أكد التشغيل الفعلي أن اسم خاصية Inbox في API هو `is_inbox_tag` وأن إعداد OCR الحالي هو `auto`. صُححت الملفات بناءً على استجابة API وفحص Django، وأعيد اختبار التشغيل دون تحذيرات إعدادات.
