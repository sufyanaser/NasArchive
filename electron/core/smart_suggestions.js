/**
 * NAS Archive — Local Smart Field Suggestions
 * Builds suggestions only from values already stored in the local database.
 */
const dbManager = require('./db');
const { normalizeArabic } = require('./normalizer');

const ALLOWED_FIELDS = new Map([
  ['title', 'العنوان'],
  ['department', 'القسم'],
  ['document_type', 'نوع المستند'],
  ['sender', 'الجهة المرسلة'],
  ['recipient', 'الجهة المستلمة'],
  ['document_number', 'رقم الكتاب'],
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
    const activeDocumentId = Number(context && context.documentId);
    const excludeDocumentClause = Number.isInteger(activeDocumentId) && activeDocumentId > 0 ? 'AND d.id <> ?' : '';
    const excludeArgs = Number.isInteger(activeDocumentId) && activeDocumentId > 0 ? [activeDocumentId] : [];

    if (resolved.key === 'department') {
      return this.getStaticSuggestions(resolved, ['شخصي', 'الرنين', 'تناسق', 'NAS FM'], normalizedQuery, limit);
    }

    if (resolved.key === 'title') {
      return this.getTitleSuggestions(resolved, normalizedQuery, limit, department, excludeDocumentClause, excludeArgs);
    }

    if (resolved.key === 'document_type') {
      return this.getLookupSuggestions(resolved, 'document_types', normalizedQuery, limit);
    }

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
        ${excludeDocumentClause}
        AND TRIM(COALESCE(dcf.value_text, '')) <> ''
      GROUP BY dcf.value_text
      ORDER BY frequency DESC, last_used_at DESC
      LIMIT 200
    `).all(department, resolved.name, ...excludeArgs);

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

  scoreRows(rows, resolved, normalizedQuery, limit) {
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
      query: '',
      suggestions: scored.slice(0, limit),
    };
  }

  getTitleSuggestions(resolved, normalizedQuery, limit, department, excludeDocumentClause, excludeArgs) {
    const db = dbManager.getDb();
    const rows = db.prepare(`
      SELECT
        d.title AS value,
        COUNT(*) AS frequency,
        MAX(COALESCE(d.modified_at, d.created_at, d.created_date)) AS last_used_at,
        MAX(CASE WHEN t.name = ? THEN 1 ELSE 0 END) AS context_hits
      FROM documents d
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      LEFT JOIN tags t ON t.id = dt.tag_id
      WHERE d.deleted_at IS NULL
        ${excludeDocumentClause}
        AND TRIM(COALESCE(d.title, '')) <> ''
      GROUP BY d.title
      ORDER BY frequency DESC, last_used_at DESC
      LIMIT 200
    `).all(department, ...excludeArgs);
    return this.scoreRows(rows, resolved, normalizedQuery, limit);
  }

  getLookupSuggestions(resolved, table, normalizedQuery, limit) {
    const db = dbManager.getDb();
    const rows = db.prepare(`SELECT name AS value, 1 AS frequency, created_at AS last_used_at, 0 AS context_hits FROM ${table} ORDER BY id ASC`).all();
    return this.scoreRows(rows, resolved, normalizedQuery, limit);
  }

  getStaticSuggestions(resolved, values, normalizedQuery, limit) {
    const rows = values.map((value, index) => ({
      value,
      frequency: values.length - index,
      last_used_at: null,
      context_hits: 0,
    }));
    return this.scoreRows(rows, resolved, normalizedQuery, limit);
  }
}

module.exports = new SmartSuggestionsService();
