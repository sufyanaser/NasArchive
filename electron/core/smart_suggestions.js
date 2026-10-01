/**
 * NAS Archive — Local Smart Field Suggestions
 * Builds suggestions only from values already stored in the local database.
 */
const dbManager = require('./db');
const { normalizeArabic } = require('./normalizer');

const ALLOWED_FIELDS = new Map([
  ['sender', 'الجهة المرسلة'],
  ['recipient', 'الجهة المستلمة'],
  ['reference_document', 'الكتاب المرجعي'],
  ['sync_approved', 'معتمد للمزامنة'],
  ['reviewed_by', 'راجعه'],
  ['entry_number', 'رقم القيد'],
  ['notes', 'ملاحظات'],
]);

function cleanText(value) {
  return String(value || '').trim();
}

class SmartSuggestionsService {
  normalize(value) {
    return normalizeArabic(cleanText(value)).toLowerCase();
  }

  resolveField(field) {
    const key = cleanText(field);
    if (ALLOWED_FIELDS.has(key)) return { key, name: ALLOWED_FIELDS.get(key) };
    for (const [allowedKey, fieldName] of ALLOWED_FIELDS.entries()) {
      if (key === fieldName) return { key: allowedKey, name: fieldName };
    }
    throw new Error('Invalid suggestion field.');
  }

  getSuggestions(field, query = '', context = {}) {
    const db = dbManager.getDb();
    const resolved = this.resolveField(field);
    const normalizedQuery = this.normalize(query);
    const limitInput = Number(context && context.limit);
    const limit = Number.isInteger(limitInput) && limitInput > 0 ? Math.min(limitInput, 10) : 8;
    const department = cleanText(context && context.department);

    const rows = db.prepare(`
      SELECT
        dcf.value_text AS value,
        COUNT(*) AS frequency,
        MAX(COALESCE(d.modified_at, d.created_at, d.created_date)) AS last_used_at,
        MAX(CASE WHEN t.name = ? THEN 1 ELSE 0 END) AS context_hits
      FROM document_custom_fields dcf
      JOIN custom_fields cf ON cf.id = dcf.field_id
      JOIN documents d ON d.id = dcf.document_id
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      LEFT JOIN tags t ON t.id = dt.tag_id
      WHERE cf.name = ?
        AND d.deleted_at IS NULL
        AND TRIM(COALESCE(dcf.value_text, '')) <> ''
      GROUP BY dcf.value_text
      ORDER BY frequency DESC, last_used_at DESC
      LIMIT 200
    `).all(department, resolved.name);

    const seen = new Set();
    const scored = [];

    for (const row of rows) {
      const value = cleanText(row.value);
      const normalizedValue = this.normalize(value);
      if (!value || seen.has(normalizedValue)) continue;
      seen.add(normalizedValue);

      let matchRank = 4;
      if (normalizedQuery) {
        if (normalizedValue === normalizedQuery) matchRank = 0;
        else if (normalizedValue.startsWith(normalizedQuery)) matchRank = 1;
        else if (normalizedValue.includes(normalizedQuery)) matchRank = 2;
        else continue;
      }

      scored.push({
        field: resolved.key,
        value,
        frequency: Number(row.frequency) || 0,
        last_used_at: row.last_used_at || null,
        context_rank: row.context_hits ? 1 : 0,
        match_rank: matchRank,
      });
    }

    scored.sort((a, b) => (
      a.match_rank - b.match_rank
      || b.context_rank - a.context_rank
      || b.frequency - a.frequency
      || String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''))
      || a.value.localeCompare(b.value, 'ar')
    ));

    return {
      success: true,
      field: resolved.key,
      query: cleanText(query),
      suggestions: scored.slice(0, limit),
    };
  }
}

module.exports = new SmartSuggestionsService();
