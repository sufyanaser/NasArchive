/**
 * NAS Archive — Native OCR Engine & Text Extraction Service
 * Supports Arabic ('ara') and English ('eng') via integrated NAPS2 OCR and Tesseract OCR.
 * Extracts embedded PDF text layers, runs OCR on scanned documents, and preserves raw output.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const _origWarn = console.warn;
console.warn = (...args) => {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('Cannot polyfill')) return;
  _origWarn(...args);
};
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
console.warn = _origWarn;
const storage = require('./storage');
const scanner = require('./scanner');

class OcrService {
  constructor() {
    this.tessdataDir = this._resolveTessdataDir();
    this.tesseractPath = this._resolveTesseractPath();
  }

  _resolveTessdataDir() {
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'tessdata') : null,
      path.join(__dirname, '..', '..', 'assets', 'tessdata'),
      path.join(process.env.APPDATA || '', 'NAPS2', 'components', 'tesseract4', 'best'),
      path.join(process.env.APPDATA || '', 'NAPS2', 'components', 'tesseract4', 'fast'),
      'C:\\Program Files\\Tesseract-OCR\\tessdata',
    ].filter(Boolean);
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  _resolveTesseractPath() {
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'tesseract.exe') : null,
      'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tesseract-OCR', 'tesseract.exe'),
    ].filter(Boolean);
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'tesseract.exe';
  }

  /**
   * Extract existing text layer from a PDF file using pdfjs-dist.
   */
  async extractTextFromPdf(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file does not exist: ${pdfPath}`);
    }

    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    let fullText = '';
    const pageTexts = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageStr = textContent.items.map((item) => item.str).join(' ');
      pageTexts.push(pageStr);
      fullText += (pageStr + '\n');
    }

    return {
      text: fullText.trim(),
      pageCount: doc.numPages,
      hasTextLayer: fullText.trim().length > 20,
      pageTexts,
    };
  }

  /**
   * Run OCR on an image file using Tesseract CLI.
   */
  async runImageOcr(imagePath, lang = 'ara+eng') {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (this.tessdataDir) {
        env.TESSDATA_PREFIX = this.tessdataDir;
      }

      execFile(
        this.tesseractPath,
        [imagePath, 'stdout', '-l', lang],
        { env, windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Tesseract OCR failed: ${error.message} - ${stderr}`));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  /**
   * Generate an OCR-searchable PDF from a scanned PDF or image using NAPS2.
   */
  async generateSearchablePdf(sourcePath, destPath, lang = 'ara') {
    return new Promise((resolve, reject) => {
      const naps2 = scanner.findNaps2();
      const args = [
        '-i', sourcePath,
        '-o', destPath,
        '--noprofile',
        '-n', '0',
        '--enableocr',
        '--ocrlang', lang,
        '-f',
        '-v',
      ];

      execFile(
        naps2,
        args,
        { windowsHide: true, timeout: 180000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`PDF OCR processing failed: ${error.message} - ${stderr}`));
            return;
          }
          if (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0) {
            reject(new Error('OCR PDF output was not produced.'));
            return;
          }
          resolve(destPath);
        }
      );
    });
  }

  /**
   * Complete OCR pipeline for a document:
   * 1. Inspects existing text layer
   * 2. If already searchable, uses it and copies to archive
   * 3. If image or raster PDF, runs OCR and generates searchable PDF
   * 4. Returns full extracted text, page count, and archive path
   */
  async processDocumentOcr(docId, sourcePath, lang = 'ara') {
    const ext = path.extname(sourcePath).toLowerCase();
    let extractedText = '';
    let pageCount = 1;
    let archivePdfPath = null;

    if (ext === '.pdf') {
      const inspection = await this.extractTextFromPdf(sourcePath);
      pageCount = inspection.pageCount;

      if (inspection.hasTextLayer) {
        // PDF already has searchable text
        extractedText = inspection.text;
      } else {
        // Scanned raster PDF - run OCR to generate searchable text layer
        const tempDest = path.join(storage.dirs.staging, `.tmp_ocr_${docId}_${Date.now()}.pdf`);
        try {
          await this.generateSearchablePdf(sourcePath, tempDest, lang);
          const afterOcr = await this.extractTextFromPdf(tempDest);
          extractedText = afterOcr.text;
          archivePdfPath = tempDest;
        } catch (e) {
          // If NAPS2 OCR fails, fallback to keeping original
          extractedText = '';
        }
      }
    } else if (['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(ext)) {
      // Image file - run Tesseract OCR
      try {
        extractedText = await this.runImageOcr(sourcePath, lang);
      } catch (e) {
        extractedText = '';
      }

      // Convert image to searchable PDF
      const tempPdf = path.join(storage.dirs.staging, `.tmp_ocr_${docId}_${Date.now()}.pdf`);
      try {
        await this.generateSearchablePdf(sourcePath, tempPdf, lang);
        archivePdfPath = tempPdf;
      } catch (e) {
        // fallback
      }
    }

    // Save OCR text to storage
    if (extractedText) {
      storage.storeOcrText(docId, extractedText);
    }

    return {
      text: extractedText,
      pageCount,
      archivePdfPath,
    };
  }
}

module.exports = new OcrService();
