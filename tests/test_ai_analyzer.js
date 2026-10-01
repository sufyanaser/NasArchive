const assert = require('assert');
const aiAnalyzer = require('../electron/core/ai_analyzer');

const sample = `
العدد: ١٢٣/تناسق/٢٠٢٦
رقم القيد: ٤٥٦
التاريخ: ٣٠/٠٩/٢٠٢٦
تاريخ الورود: ٠١/١٠/٢٠٢٦
إلى: شركة NAS FM
من: مديرية التخطيط العمراني في الأنبار
الموضوع: متابعة أرشفة العقود الرسمية
`;

const analysis = aiAnalyzer.analyze(sample, 'scan_20261001.pdf');

assert.strictEqual(analysis.doc_number_suggestion.value, '123/تناسق/2026', 'Arabic-Indic document numbers should normalize to ASCII digits.');
assert.strictEqual(analysis.entry_number_suggestion.value, '456', 'Arabic-Indic entry numbers should normalize to ASCII digits.');
assert.strictEqual(analysis.doc_date_suggestion.value, '2026-09-30', 'Document date should be normalized.');
assert.strictEqual(analysis.incoming_date_suggestion.value, '2026-10-01', 'Incoming date should be normalized.');
assert.strictEqual(analysis.sender_suggestion.value, 'مديرية التخطيط العمراني في الأنبار', 'Sender should be extracted.');
assert.strictEqual(analysis.recipient_suggestion.value, 'شركة NAS FM', 'Recipient should be extracted.');
assert.strictEqual(analysis.title_suggestion.value, 'متابعة أرشفة العقود الرسمية', 'Subject should become title suggestion.');
assert.strictEqual(analysis.department_suggestion.value, 'تناسق', 'Department should be detected without relying on word boundaries.');
assert.strictEqual(analysis.doc_type_suggestion.value, 'كتاب وارد', 'Default official incoming type should remain explicit.');
assert.strictEqual(analysis.ai_approved_sync, false, 'Analyzer must never auto-approve cloud sync.');
assert.strictEqual(analysis.ready_for_review, true, 'Complete metadata may be ready for human review.');

for (const key of [
  'title_suggestion',
  'doc_type_suggestion',
  'department_suggestion',
  'doc_number_suggestion',
  'entry_number_suggestion',
  'doc_date_suggestion',
  'incoming_date_suggestion',
  'sender_suggestion',
  'recipient_suggestion',
]) {
  const item = analysis[key];
  assert(Object.prototype.hasOwnProperty.call(item, 'value'), `${key} should expose value.`);
  assert(Object.prototype.hasOwnProperty.call(item, 'confidence'), `${key} should expose confidence.`);
  assert(Object.prototype.hasOwnProperty.call(item, 'source'), `${key} should expose source.`);
}

const weak = aiAnalyzer.analyze('', 'scan_1.pdf');
assert.strictEqual(weak.ready_for_review, false, 'Empty OCR should not be ready for direct approval.');
assert.strictEqual(weak.review_required, true, 'Empty OCR must require review.');

console.log('AI analyzer regression tests passed.');
