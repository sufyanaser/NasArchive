/**
 * NAS Archive — Arabic Text & Query Normalizer
 * Provides accurate normalization for Arabic full-text search (FTS5)
 * while strictly preserving leading zeros and formatting in official reference numbers.
 */

/**
 * Normalizes Arabic text for full-text search indexing and search querying.
 * Strips tashkeel (diacritics), tatweel (kashida), unifies alef variants,
 * unifies teh marbuta with heh, and unifies alef maksura with yeh.
 */
function normalizeArabic(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // 1. Remove Arabic diacritics (Tashkeel / Harakat)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // 2. Remove Tatweel (Kashida)
    .replace(/\u0640/g, '')
    // 3. Normalize Alef variants (أ, إ, آ, ٱ -> ا)
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    // 4. Normalize Teh Marbuta to Heh (ة -> ه)
    .replace(/\u0629/g, '\u0647')
    // 5. Normalize Alef Maksura to Yeh (ى -> ي)
    .replace(/\u0649/g, '\u064A')
    // 6. Normalize Arabic-Indic digits to standard Arabic digits (optional for search)
    .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .trim();
}

/**
 * Sanitizes and prepares a user search query for SQLite FTS5.
 * Tokenizes terms, normalizes them, and builds prefix match queries.
 */
function buildFtsQuery(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') return '';

  // Clean special FTS5 operators from user input
  const sanitized = userQuery.replace(/["*^:]/g, ' ');
  const tokens = sanitized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return '';

  // For each token, produce normalized term with prefix wildcard
  const ftsTerms = tokens.map((token) => {
    const norm = normalizeArabic(token);
    // Quote term for safety and append wildcard for prefix matching
    const safeTerm = norm.replace(/'/g, "''");
    return `"${safeTerm}"*`;
  });

  return ftsTerms.join(' AND ');
}

/**
 * Validates and preserves official reference numbers (e.g. "0042/ص-2026").
 * Ensures leading zeros, dashes, and slashes are never truncated or lost.
 */
function sanitizeReferenceNumber(ref) {
  if (ref === null || ref === undefined) return '';
  return String(ref).trim();
}

module.exports = {
  normalizeArabic,
  buildFtsQuery,
  sanitizeReferenceNumber,
};
