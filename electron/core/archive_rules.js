/**
 * NAS Archive — Archive Rules Engine
 * Converts reviewed document metadata into a logical storage key.
 */
const path = require('path');
const storage = require('./storage');

const DEFAULT_WORKSPACE = 'عام';
const DEFAULT_TYPE = 'غير مصنف';

function normalizeDate(value) {
  const raw = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const [year, month, day] = raw.split('-');
  return { raw, year, month, day };
}

function safeSegment(value, fallback) {
  const raw = String(value || fallback || '').trim() || fallback;
  const normalized = raw.replace(/[\\/]+/g, ' ').replace(/\.\.+/g, ' ');
  return storage
    .sanitizeFilename(normalized)
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || fallback;
}

function buildArchivePlan(metadata = {}) {
  const date = normalizeDate(metadata.created_date || metadata.date);
  const workspace = safeSegment(metadata.workspace || metadata.department, DEFAULT_WORKSPACE);
  const docType = safeSegment(metadata.document_type_name || metadata.document_type || metadata.type, DEFAULT_TYPE);
  const title = safeSegment(metadata.title || metadata.original_filename || 'document', 'document').replace(/\.pdf$/i, '');
  const docId = metadata.document_id || metadata.id || 'pending';
  const filename = `${String(docId).padStart(7, '0')}_${date.raw}_${title}.pdf`;
  const storageKey = path.join(workspace, date.year, date.month, docType, filename);

  return {
    workspace,
    year: date.year,
    month: date.month,
    documentType: docType,
    filename,
    storageKey,
  };
}

module.exports = {
  buildArchivePlan,
};
