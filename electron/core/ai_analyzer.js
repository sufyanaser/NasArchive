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

class AiDocumentAnalyzer {
  extractDocumentNumber(text) {
    if (!text) return { value: '', confidence: 0, source: 'none' };

    const patterns = [
      { regex: /(?:العدد|رقم\s*الكتاب|الرقم|رقم)\s*[:/]\s*([0-9A-Za-z\u0600-\u06FF\-_/]{3,30})/, conf: 0.95 },
      { regex: /\b([0-9]{3,6}\/[\u0600-\u06FF\-_/]+\/[0-9]{4})\b/, conf: 0.90 },
      { regex: /\b([0-9]{2,6}\/[0-9]{4})\b/, conf: 0.80 },
      { regex: /(?:رقم\s*الكتاب)\s*([0-9]{3,8})/, conf: 0.85 },
    ];

    for (const { regex, conf } of patterns) {
      const match = text.match(regex);
      if (match && match[1]) {
        const val = match[1].trim();
        if (val.length >= 3) {
          return { value: val, confidence: conf, source: 'pattern' };
        }
      }
    }
    return { value: '', confidence: 0, source: 'none' };
  }

  extractEntryNumber(text) {
    if (!text) return { value: '', confidence: 0, source: 'none' };

    const patterns = [
      { regex: /(?:رقم\s*القيد|قيد\s*رقم|القيد)\s*[:/]\s*([0-9A-Za-z\u0600-\u06FF\-_/]{2,20})/, conf: 0.90 },
      { regex: /(?:وارد\s*قيد)\s*([0-9A-Za-z\u0600-\u06FF\-_/]{2,20})/, conf: 0.85 },
    ];

    for (const { regex, conf } of patterns) {
      const match = text.match(regex);
      if (match && match[1]) {
        return { value: match[1].trim(), confidence: conf, source: 'pattern' };
      }
    }
    return { value: '', confidence: 0, source: 'none' };
  }

  extractDates(text) {
    const res = {
      docDate: { value: '', confidence: 0, source: 'none' },
      incomingDate: { value: '', confidence: 0, source: 'none' },
    };
    if (!text) return res;

    const datePattern = /\b(20[2-3][0-9][\-/](?:0[1-9]|1[0-2])[\-/](?:0[1-9]|[12][0-9]|3[01])|(?:0[1-9]|[12][0-9]|3[01])[\-/](?:0[1-9]|1[0-2])[\-/]20[2-3][0-9])\b/g;

    function normalizeDate(dStr) {
      const clean = dStr.replace(/\//g, '-');
      const parts = clean.split('-');
      if (parts[0].length === 4) {
        return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
      }
      return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
    }

    const incMatch = text.match(/(?:تاريخ\s*الورود|ورد\s*بتاريخ)\s*[:/]?\s*([0-9\-/]+)/);
    if (incMatch && incMatch[1]) {
      res.incomingDate = { value: normalizeDate(incMatch[1]), confidence: 0.95, source: 'pattern' };
    }

    const matches = [...text.matchAll(datePattern)];
    if (matches.length > 0) {
      res.docDate = { value: normalizeDate(matches[0][1]), confidence: 0.85, source: 'pattern' };
      if (matches.length > 1 && !res.incomingDate.value) {
        res.incomingDate = { value: normalizeDate(matches[1][1]), confidence: 0.70, source: 'pattern' };
      }
    }
    return res;
  }

  extractSubjectOrTitle(text, fallbackTitle = '') {
    if (!text) {
      return { value: fallbackTitle || 'مستند غير معنون', confidence: 0.1, source: 'fallback' };
    }

    const patterns = [
      { regex: /(?:الموضوع|م\/\s*|بشأن)\s*[:/]\s*([^\n\r\.]{4,100})/, conf: 0.95 },
      { regex: /(?:مذكرة\s*تفاهم[^\n\r\.]{0,60})/, conf: 0.90 },
      { regex: /(?:أمر\s*إداري[^\n\r\.]{0,60})/, conf: 0.90 },
      { regex: /(?:كتاب\s*شكر[^\n\r\.]{0,60})/, conf: 0.90 },
    ];

    for (const { regex, conf } of patterns) {
      const match = text.match(regex);
      if (match) {
        const val = (match[1] || match[0]).trim();
        return { value: val, confidence: conf, source: 'pattern' };
      }
    }

    if (fallbackTitle && !fallbackTitle.startsWith('scan_') && !fallbackTitle.startsWith('doc_')) {
      return { value: fallbackTitle, confidence: 0.60, source: 'existing' };
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 5);
    if (lines.length > 0) {
      return { value: lines[0].slice(0, 80), confidence: 0.40, source: 'first_line' };
    }

    return { value: 'مستند غير معنون', confidence: 0.10, source: 'fallback' };
  }

  extractParties(text) {
    const res = {
      sender: { value: '', confidence: 0, source: 'none' },
      recipient: { value: '', confidence: 0, source: 'none' },
    };
    if (!text) return res;

    const senderMatch = text.match(/(?:من|الجهة\s*المرسلة|صادر\s*من)\s*[:/]\s*([^\n\r\.]{3,50})/);
    if (senderMatch && senderMatch[1]) {
      res.sender = { value: senderMatch[1].trim(), confidence: 0.90, source: 'pattern' };
    }

    const recipientMatch = text.match(/(?:إلى|الجهة\s*المستلمة|السيد|السادة)\s*[:/]\s*([^\n\r\.]{3,50})/);
    if (recipientMatch && recipientMatch[1]) {
      res.recipient = { value: recipientMatch[1].trim(), confidence: 0.90, source: 'pattern' };
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
      return { value: bestDept, confidence: Math.min(0.95, 0.5 + bestScore), source: 'keyword' };
    }
    return { value: 'شخصي', confidence: 0.30, source: 'default' };
  }

  suggestDocType(text) {
    if (!text) return { value: 'كتاب وارد', confidence: 0.4, source: 'default' };

    if (/كتاب\s*صادر|صادر\s*إلى|نحيطكم\s*علماً/.test(text)) {
      return { value: 'كتاب صادر', confidence: 0.85, source: 'pattern' };
    }
    if (/كتاب\s*داخلي|مذكرة\s*داخلية|تعميم\s*داخلي/.test(text)) {
      return { value: 'كتاب داخلي', confidence: 0.85, source: 'pattern' };
    }
    if (/كتاب\s*وارد|ورود|موضوع|تحية\s*طيبة|تهديكم/.test(text)) {
      return { value: 'كتاب وارد', confidence: 0.80, source: 'pattern' };
    }
    return { value: 'كتاب وارد', confidence: 0.40, source: 'default' };
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
      ai_approved_sync: false, // MANDATORY: Never automatically approved
    };
  }
}

module.exports = new AiDocumentAnalyzer();
