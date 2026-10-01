/**
 * NAS Archive — Native AI Document Analyzer
 * Performs rule-based semantic analysis for Arabic official documents:
 * Extracts letter reference numbers, entry numbers, dates, parties, and suggestions.
 */

const DEPARTMENTS = ['شخصي', 'الرنين', 'تناسق', 'NAS FM'];

const DEPARTMENT_KEYWORDS = {
  'الرنين': [/(?:^|[^\p{L}\p{N}])(?:الرنين|رنين|al-raneen|raneen)(?:$|[^\p{L}\p{N}])/u],
  'تناسق': [/(?:^|[^\p{L}\p{N}])(?:تناسق|tanasaq)(?:$|[^\p{L}\p{N}])/u],
  'NAS FM': [/(?:^|[^\p{L}\p{N}])(?:nas\s*fm|إذاعة|راديو|fm)(?:$|[^\p{L}\p{N}])/ui],
  'شخصي': [/(?:^|[^\p{L}\p{N}])(?:شخصي|خاص|عقد إيجار|بطاقة وطنية|جواز)(?:$|[^\p{L}\p{N}])/u],
};

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function normalizeDigits(value) {
  return String(value || '').replace(/[٠-٩۰-۹]/g, (ch) => {
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (arabicIndex >= 0) return String(arabicIndex);
    const easternIndex = EASTERN_ARABIC_DIGITS.indexOf(ch);
    return easternIndex >= 0 ? String(easternIndex) : ch;
  });
}

function cleanExtractedValue(value) {
  return normalizeDigits(value)
    .replace(/[ \t]+/g, ' ')
    .replace(/[،؛.]+$/g, '')
    .trim();
}

function suggestion(value, confidence, source) {
  const clean = cleanExtractedValue(value);
  return {
    value: clean,
    confidence: clean ? confidence : 0,
    source: clean ? source : 'none',
    review_required: !clean || confidence < 0.75,
  };
}

function normalizeInput(text) {
  return normalizeDigits(String(text || ''))
    .replace(/\u200f|\u200e/g, '')
    .replace(/[ \t]+/g, ' ');
}

class AiDocumentAnalyzer {
  extractDocumentNumber(text) {
    if (!text) return { value: '', confidence: 0, source: 'none' };

    const normalizedText = normalizeInput(text);
    const patterns = [
      { regex: /(?:العدد|رقم\s*الكتاب|الرقم|رقم)\s*[:/：]?\s*([0-9A-Za-z\u0600-\u06FF\-_/]{3,30})/u, conf: 0.95 },
      { regex: /(?:^|[^\p{L}\p{N}])([0-9]{3,6}\/[\u0600-\u06FF\-_/]+\/[0-9]{4})(?:$|[^\p{L}\p{N}])/u, conf: 0.90 },
      { regex: /(?:^|[^\p{L}\p{N}])([0-9]{2,6}\/[0-9]{4})(?:$|[^\p{L}\p{N}])/u, conf: 0.80 },
      { regex: /(?:رقم\s*الكتاب)\s*([0-9]{3,8})/, conf: 0.85 },
    ];

    for (const { regex, conf } of patterns) {
      const match = normalizedText.match(regex);
      if (match && match[1]) {
        const val = cleanExtractedValue(match[1]);
        if (val.length >= 3) {
          return suggestion(val, conf, 'pattern');
        }
      }
    }
    return suggestion('', 0, 'none');
  }

  extractEntryNumber(text) {
    if (!text) return { value: '', confidence: 0, source: 'none' };

    const normalizedText = normalizeInput(text);
    const patterns = [
      { regex: /(?:رقم\s*القيد|قيد\s*رقم|القيد)\s*[:/：]?\s*([0-9A-Za-z\u0600-\u06FF\-_/]{2,20})/u, conf: 0.90 },
      { regex: /(?:وارد\s*قيد)\s*([0-9A-Za-z\u0600-\u06FF\-_/]{2,20})/, conf: 0.85 },
    ];

    for (const { regex, conf } of patterns) {
      const match = normalizedText.match(regex);
      if (match && match[1]) {
        return suggestion(match[1], conf, 'pattern');
      }
    }
    return suggestion('', 0, 'none');
  }

  extractDates(text) {
    const res = {
      docDate: { value: '', confidence: 0, source: 'none' },
      incomingDate: { value: '', confidence: 0, source: 'none' },
    };
    if (!text) return res;

    const normalizedText = normalizeInput(text);
    const datePattern = /(?:^|[^\p{L}\p{N}])(20[2-3][0-9][\-/](?:0?[1-9]|1[0-2])[\-/](?:0?[1-9]|[12][0-9]|3[01])|(?:0?[1-9]|[12][0-9]|3[01])[\-/](?:0?[1-9]|1[0-2])[\-/]20[2-3][0-9])(?:$|[^\p{L}\p{N}])/gu;

    function normalizeDate(dStr) {
      const clean = dStr.replace(/\//g, '-');
      const parts = clean.split('-');
      if (parts[0].length === 4) {
        return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
      }
      return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
    }

    const incMatch = normalizedText.match(/(?:تاريخ\s*الورود|ورد\s*بتاريخ)\s*[:/]?\s*([0-9\-/]+)/);
    if (incMatch && incMatch[1]) {
      res.incomingDate = suggestion(normalizeDate(incMatch[1]), 0.95, 'pattern');
    }

    const matches = [...normalizedText.matchAll(datePattern)];
    if (matches.length > 0) {
      res.docDate = suggestion(normalizeDate(matches[0][1]), 0.85, 'pattern');
      if (matches.length > 1 && !res.incomingDate.value) {
        res.incomingDate = suggestion(normalizeDate(matches[1][1]), 0.70, 'pattern');
      }
    }
    return res;
  }

  extractSubjectOrTitle(text, fallbackTitle = '') {
    if (!text) {
      return suggestion(fallbackTitle || 'مستند غير معنون', 0.1, 'fallback');
    }
    const normalizedText = normalizeInput(text);

    const patterns = [
      { regex: /(?:الموضوع|م\/\s*|بشأن)\s*[:/：]?\s*([^\n\r\.]{4,100})/u, conf: 0.95 },
      { regex: /(?:مذكرة\s*تفاهم[^\n\r\.]{0,60})/, conf: 0.90 },
      { regex: /(?:أمر\s*إداري[^\n\r\.]{0,60})/, conf: 0.90 },
      { regex: /(?:كتاب\s*شكر[^\n\r\.]{0,60})/, conf: 0.90 },
    ];

    for (const { regex, conf } of patterns) {
      const match = normalizedText.match(regex);
      if (match) {
        const val = (match[1] || match[0]).trim();
        return suggestion(val, conf, 'pattern');
      }
    }

    if (fallbackTitle && !fallbackTitle.startsWith('scan_') && !fallbackTitle.startsWith('doc_')) {
      return suggestion(fallbackTitle, 0.60, 'existing');
    }

    const lines = normalizedText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 5);
    if (lines.length > 0) {
      return suggestion(lines[0].slice(0, 80), 0.40, 'first_line');
    }

    return suggestion('مستند غير معنون', 0.10, 'fallback');
  }

  extractParties(text) {
    const res = {
      sender: { value: '', confidence: 0, source: 'none' },
      recipient: { value: '', confidence: 0, source: 'none' },
    };
    if (!text) return res;

    const normalizedText = normalizeInput(text);
    const senderMatch = normalizedText.match(/(?:من|الجهة\s*المرسلة|صادر\s*من)\s*[:/：]?\s*([^\n\r\.]{3,50})/u);
    if (senderMatch && senderMatch[1]) {
      res.sender = suggestion(senderMatch[1], 0.90, 'pattern');
    }

    const recipientMatch = normalizedText.match(/(?:إلى|الجهة\s*المستلمة|السيد|السادة)\s*[:/：]?\s*([^\n\r\.]{3,50})/u);
    if (recipientMatch && recipientMatch[1]) {
      res.recipient = suggestion(recipientMatch[1], 0.90, 'pattern');
    }

    return res;
  }

  suggestDepartment(text) {
    if (!text) return { value: 'شخصي', confidence: 0.3, source: 'default' };

    const scores = {};
    for (const dept of DEPARTMENTS) scores[dept] = 0;

    for (const [dept, patterns] of Object.entries(DEPARTMENT_KEYWORDS)) {
      for (const rx of patterns) {
        const flags = rx.flags.includes('g') ? rx.flags : rx.flags + 'g';
        const globalRx = new RegExp(rx.source, flags);
        const matches = text.match(globalRx);
        if (matches) {
          scores[dept] += matches.length * 0.3;
        }
      }
    }

    let bestDept = 'شخصي';
    let bestScore = 0;
    for (const [dept, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestDept = dept;
      }
    }

    if (bestScore > 0) {
      return suggestion(bestDept, Math.min(0.95, 0.5 + bestScore), 'keyword');
    }
    return suggestion('شخصي', 0.30, 'default');
  }

  suggestDocType(text) {
    if (!text) return suggestion('كتاب وارد', 0.4, 'default');

    if (/كتاب\s*صادر|صادر\s*إلى|نحيطكم\s*علماً/.test(text)) {
      return suggestion('كتاب صادر', 0.85, 'pattern');
    }
    if (/كتاب\s*داخلي|مذكرة\s*داخلية|تعميم\s*داخلي/.test(text)) {
      return suggestion('كتاب داخلي', 0.85, 'pattern');
    }
    if (/كتاب\s*وارد|ورود|موضوع|تحية\s*طيبة|تهديكم/.test(text)) {
      return suggestion('كتاب وارد', 0.80, 'pattern');
    }
    return suggestion('كتاب وارد', 0.40, 'default');
  }

  analyze(text, existingTitle = '') {
    const docNum = this.extractDocumentNumber(text);
    const entryNum = this.extractEntryNumber(text);
    const dates = this.extractDates(text);
    const title = this.extractSubjectOrTitle(text, existingTitle);
    const parties = this.extractParties(text);
    const dept = this.suggestDepartment(text);
    const docType = this.suggestDocType(text);

    const missing = [];
    if (!docNum.value) missing.push('رقم الكتاب');
    if (!entryNum.value) missing.push('رقم القيد');
    if (!dates.docDate.value) missing.push('تاريخ الكتاب');
    if (!parties.sender.value) missing.push('الجهة المرسلة');
    if (!parties.recipient.value) missing.push('الجهة المستلمة');

    return {
      title_suggestion: title,
      doc_type_suggestion: docType,
      department_suggestion: dept,
      doc_number_suggestion: docNum,
      entry_number_suggestion: entryNum,
      doc_date_suggestion: dates.docDate,
      incoming_date_suggestion: dates.incomingDate,
      sender_suggestion: parties.sender,
      recipient_suggestion: parties.recipient,
      missing_fields: missing,
      ready_for_review: missing.length <= 2,
      review_required: missing.length > 0 || [
        title,
        docType,
        dept,
        docNum,
        entryNum,
        dates.docDate,
        dates.incomingDate,
        parties.sender,
        parties.recipient,
      ].some((item) => item && item.review_required),
      ai_approved_sync: false, // MANDATORY: Never automatically approved
    };
  }
}

module.exports = new AiDocumentAnalyzer();
