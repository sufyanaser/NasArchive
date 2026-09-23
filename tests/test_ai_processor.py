"""Unit tests for intelligent Arabic document analyzer and metadata extraction."""
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from ai_processor import ArabicDocumentAnalyzer


class AIProcessorTests(unittest.TestCase):
    def test_extract_official_document_number(self):
        text = """
        جمهورية العراق
        وزارة التجارة
        العدد: 0042/ص-2026
        التاريخ: 2026-09-23
        الموضوع: تزويد مواد أولية
        """
        res = ArabicDocumentAnalyzer.extract_document_number(text)
        self.assertEqual(res.value, '0042/ص-2026')
        self.assertGreaterEqual(res.confidence, 0.90)

    def test_extract_entry_number(self):
        text = "وارد قيد رقم: 00987-ق بتسلسل رسمي"
        res = ArabicDocumentAnalyzer.extract_entry_number(text)
        self.assertEqual(res.value, '00987-ق')
        self.assertGreaterEqual(res.confidence, 0.85)

    def test_extract_dates_normalization(self):
        text = "كتاب صادر بتاريخ 2026/09/23 وتاريخ الورود: 2026/09/25 إلى الدائرة"
        doc_date, inc_date = ArabicDocumentAnalyzer.extract_dates(text)
        self.assertEqual(doc_date.value, '2026-09-23')
        self.assertEqual(inc_date.value, '2026-09-25')

    def test_extract_subject_or_title(self):
        text = """
        إلى / شركة الرنين
        الموضوع : مذكرة تفاهم سنوية لتوريد التجهيزات
        تحية طيبة وبعد...
        """
        res = ArabicDocumentAnalyzer.extract_subject_or_title(text, fallback_title='scan_001.pdf')
        self.assertIn('مذكرة تفاهم سنوية', res.value)
        self.assertGreaterEqual(res.confidence, 0.90)

    def test_extract_parties(self):
        text = """
        من: وزارة التعليم العالي
        إلى: شركة الرنين للمقاولات
        """
        sender, recipient = ArabicDocumentAnalyzer.extract_parties(text)
        self.assertEqual(sender.value, 'وزارة التعليم العالي')
        self.assertEqual(recipient.value, 'شركة الرنين للمقاولات')

    def test_department_classification(self):
        text_raneen = "تجهيزات خاصة بفرع شركة الرنين الطبية"
        res1 = ArabicDocumentAnalyzer.classify_department(text_raneen)
        self.assertEqual(res1.value, 'الرنين')

        text_tanasaq = "تصميم الهوية البصرية لوكالة تناسق الإعلانية"
        res2 = ArabicDocumentAnalyzer.classify_department(text_tanasaq)
        self.assertEqual(res2.value, 'تناسق')

        text_fm = "جدول بث البرامج الإذاعية عبر NAS FM"
        res3 = ArabicDocumentAnalyzer.classify_department(text_fm)
        self.assertEqual(res3.value, 'NAS FM')

        text_personal = "عقد إيجار شقة سكنية شخصي"
        res4 = ArabicDocumentAnalyzer.classify_department(text_personal)
        self.assertEqual(res4.value, 'شخصي')

    def test_document_type_classification(self):
        text_incoming = "إشارة إلى كتابكم ذي العدد 123 نود إعلامكم..."
        self.assertEqual(ArabicDocumentAnalyzer.classify_document_type(text_incoming).value, 'كتاب وارد')

        text_outgoing = "نرجو التفضل بالموافقة على الطلب المرفق طياً"
        self.assertEqual(ArabicDocumentAnalyzer.classify_document_type(text_outgoing).value, 'كتاب صادر')

        text_internal = "مذكرة داخلية إلى كافة مسؤولي الشعب"
        self.assertEqual(ArabicDocumentAnalyzer.classify_document_type(text_internal).value, 'كتاب داخلي')

    def test_missing_fields_and_security_invariant(self):
        # Incomplete text missing document number and recipient
        text = "الموضوع: إشعار عام بدون رقم أو تفاصيل"
        analysis = ArabicDocumentAnalyzer.analyze_document(doc_id=99, content=text, title='إشعار')
        self.assertIn('رقم الكتاب', analysis.missing_fields)
        self.assertIn('الجهة المستلمة', analysis.missing_fields)
        self.assertFalse(analysis.ready_for_review)
        # CRITICAL SECURITY INVARIANT: AI must NEVER approve sync automatically
        self.assertFalse(analysis.ai_approved_sync)


if __name__ == '__main__':
    unittest.main()
