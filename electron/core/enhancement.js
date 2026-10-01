/**
 * NAS Archive — Conservative Document Image Enhancement
 * Creates a separate enhanced derivative while preserving the original file.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const storage = require('./storage');
const scanner = require('./scanner');

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 180000, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? ` - ${stderr}` : ''}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

class EnhancementService {
  getWorkDir(docId) {
    const safeId = String(Number(docId)).padStart(7, '0');
    const dir = path.join(storage.dirs.staging, `enhance_${safeId}_${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async renderPdfToImages(pdfPath, workDir) {
    const naps2 = scanner.findNaps2();
    const outputPattern = path.join(workDir, 'page_$(nnnn).png');
    await execFileAsync(naps2, [
      '-i', pdfPath,
      '-o', outputPattern,
      '--noprofile',
      '-n', '0',
      '--disableocr',
      '--force',
      '-v',
    ]);

    const pages = fs.readdirSync(workDir)
      .filter((name) => /^page_\d+\.png$/i.test(name))
      .sort()
      .map((name) => path.join(workDir, name));

    if (pages.length === 0) {
      throw new Error('NAPS2 did not render PDF pages for enhancement.');
    }
    return pages;
  }

  async enhanceImage(sourcePath, targetPath) {
    const input = sharp(sourcePath, { limitInputPixels: false }).rotate();
    const meta = await input.metadata();

    await input
      .modulate({ brightness: 1.035, saturation: 1.0 })
      .linear(1.08, -8)
      .sharpen({ sigma: 0.55, m1: 0.55, m2: 1.0, x1: 2, y2: 10, y3: 18 })
      .png({ compressionLevel: 6 })
      .toFile(targetPath);

    return {
      width: meta.width || null,
      height: meta.height || null,
      colorPreserved: true,
    };
  }

  async imagesToPdf(imagePaths, destPdfPath) {
    const naps2 = scanner.findNaps2();
    await execFileAsync(naps2, [
      '-i', imagePaths.join(';'),
      '-o', destPdfPath,
      '--noprofile',
      '-n', '0',
      '--disableocr',
      '--force',
      '-v',
    ]);

    if (!fs.existsSync(destPdfPath) || fs.statSync(destPdfPath).size === 0) {
      throw new Error('Enhanced PDF output was not produced.');
    }
    if (!storage.validatePdfHeader(destPdfPath)) {
      throw new Error('Enhanced PDF output is not a valid PDF.');
    }
    return destPdfPath;
  }

  cleanupWorkDir(workDir) {
    if (!workDir || !fs.existsSync(workDir)) return;
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {
      // Non-fatal staging cleanup failure.
    }
  }

  async enhancePdf(docId, originalPdfPath) {
    if (!fs.existsSync(originalPdfPath)) {
      throw new Error(`Original PDF does not exist: ${originalPdfPath}`);
    }
    if (!storage.validatePdfHeader(originalPdfPath)) {
      throw new Error('Original file is not a valid PDF for enhancement.');
    }

    const workDir = this.getWorkDir(docId);
    try {
      const sourcePages = await this.renderPdfToImages(originalPdfPath, workDir);
      const enhancedPages = [];
      const pageReports = [];

      for (let i = 0; i < sourcePages.length; i++) {
        const target = path.join(workDir, `enhanced_${String(i + 1).padStart(4, '0')}.png`);
        pageReports.push(await this.enhanceImage(sourcePages[i], target));
        enhancedPages.push(target);
      }

      const tempPdf = path.join(workDir, 'enhanced.pdf');
      await this.imagesToPdf(enhancedPages, tempPdf);
      const stored = storage.storeEnhanced(docId, tempPdf);

      return {
        success: true,
        ...stored,
        pageCount: sourcePages.length,
        processing: {
          backgroundNormalization: true,
          backgroundWhitening: 'conservative',
          textContrast: 'mild',
          sharpening: 'mild',
          colorPreserved: pageReports.every((p) => p.colorPreserved),
          deskew: 'scanner-stage-if-enabled',
        },
      };
    } finally {
      this.cleanupWorkDir(workDir);
    }
  }
}

module.exports = new EnhancementService();
