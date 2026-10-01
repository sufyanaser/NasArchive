/**
 * NAS Archive — Safe local file reveal helper.
 * Renderer sends only document IDs; native core resolves and validates paths.
 */
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

function isInsideStorage(targetPath) {
  if (!storage.baseDir || !targetPath) return false;
  const base = path.resolve(storage.baseDir);
  const resolved = path.resolve(targetPath);
  return resolved === base || resolved.startsWith(base + path.sep);
}

function selectRevealPath(doc) {
  if (!doc) {
    throw new Error('الوثيقة غير موجودة.');
  }

  const candidates = [
    doc.archive_file_path,
    doc.enhanced_file_path,
    doc.original_file_path,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isInsideStorage(candidate) && fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  throw new Error('لا يوجد ملف محلي صالح داخل مجلد الأرشفة لهذه الوثيقة.');
}

function revealDocument(doc, shell) {
  const targetPath = selectRevealPath(doc);
  shell.showItemInFolder(targetPath);
  return {
    success: true,
    filename: path.basename(targetPath),
  };
}

module.exports = {
  isInsideStorage,
  selectRevealPath,
  revealDocument,
};
