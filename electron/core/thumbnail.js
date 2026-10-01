/**
 * NAS Archive — Document Thumbnail Service
 * Generates deterministic cached first-page previews without exposing paths to renderer.
 */
const fs = require('fs');
const path = require('path');
const _origWarn = console.warn;
console.warn = (...args) => {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('Cannot polyfill')) return;
  _origWarn(...args);
};
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
console.warn = _origWarn;
const sharp = require('sharp');
const storage = require('./storage');

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class ThumbnailService {
  getThumbnailPath(documentId) {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid document id for thumbnail.');
    }
    return path.join(storage.dirs.thumbnails, `${String(id).padStart(7, '0')}.png`);
  }

  getLegacyThumbnailPath(documentId) {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid document id for thumbnail.');
    }
    return path.join(storage.dirs.thumbnails, `${String(id).padStart(7, '0')}.svg`);
  }

  async generateForPdf(documentId, pdfPath, options = {}) {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid document id for thumbnail.');
    }
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      throw new Error('Thumbnail source PDF is missing.');
    }
    if (!storage.validatePdfHeader(pdfPath)) {
      throw new Error('Thumbnail source is not a valid PDF.');
    }

    const thumbnailPath = this.getThumbnailPath(id);
    if (fs.existsSync(thumbnailPath) && !options.force) {
      return {
        success: true,
        reused: true,
        path: thumbnailPath,
        relativePath: path.relative(storage.baseDir, thumbnailPath),
      };
    }
    const legacyPath = this.getLegacyThumbnailPath(id);
    if (fs.existsSync(legacyPath) && !options.force) {
      return {
        success: true,
        reused: true,
        path: legacyPath,
        relativePath: path.relative(storage.baseDir, legacyPath),
      };
    }

    try {
      await sharp(pdfPath, { page: 0, density: 144 })
        .resize({ width: 360, height: 520, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(thumbnailPath);

      return {
        success: true,
        reused: false,
        path: thumbnailPath,
        relativePath: path.relative(storage.baseDir, thumbnailPath),
        renderer: 'sharp',
      };
    } catch (renderErr) {
      if (options.strictRaster) {
        throw renderErr;
      }
    }

    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const width = 360;
    const height = Math.max(480, Math.round(width * (viewport.height / viewport.width)));
    const sx = width / viewport.width;
    const sy = height / viewport.height;

    const textNodes = textContent.items.slice(0, 80).map((item) => {
      const str = escapeXml(item.str).trim();
      if (!str) return '';
      const tx = Array.isArray(item.transform) ? item.transform[4] : 24;
      const ty = Array.isArray(item.transform) ? item.transform[5] : viewport.height - 24;
      const x = Math.max(18, Math.min(width - 24, Math.round(tx * sx)));
      const y = Math.max(28, Math.min(height - 24, Math.round(height - (ty * sy))));
      const fontSize = Math.max(9, Math.min(15, Math.round((Math.abs(item.height || 10) || 10) * sy)));
      return `<text x="${x}" y="${y}" font-size="${fontSize}" direction="rtl">${str}</text>`;
    }).filter(Boolean).join('\n');

    const title = escapeXml(options.title || path.basename(pdfPath));
    const fallback = textNodes || `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="18">${title}</text>`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
  <g fill="#0f172a" font-family="Arial, 'Segoe UI', sans-serif" opacity="0.9">
${fallback}
  </g>
</svg>
`;

    fs.writeFileSync(legacyPath, svg, 'utf8');
    return {
      success: true,
      reused: false,
      path: legacyPath,
      relativePath: path.relative(storage.baseDir, legacyPath),
      pageCount: pdf.numPages,
      renderer: 'text-svg-fallback',
    };
  }

  readDataUrl(documentId) {
    let thumbnailPath = this.getThumbnailPath(documentId);
    let mimeType = 'image/png';
    if (!fs.existsSync(thumbnailPath)) {
      thumbnailPath = this.getLegacyThumbnailPath(documentId);
      mimeType = 'image/svg+xml';
    }
    if (!fs.existsSync(thumbnailPath)) {
      return { success: false, error: 'Thumbnail not found.' };
    }
    const data = fs.readFileSync(thumbnailPath);
    return {
      success: true,
      mimeType,
      base64: data.toString('base64'),
      dataUrl: `data:${mimeType};base64,${data.toString('base64')}`,
    };
  }
}

module.exports = new ThumbnailService();
