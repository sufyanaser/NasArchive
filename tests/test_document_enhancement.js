const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');

const storage = require('../electron/core/storage');
const dbManager = require('../electron/core/db');
const scanner = require('../electron/core/scanner');
const enhancement = require('../electron/core/enhancement');
const thumbnail = require('../electron/core/thumbnail');
const documents = require('../electron/core/documents');

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

async function createFixturePng(filePath) {
  const svg = `
    <svg width="1240" height="1754" viewBox="0 0 1240 1754" xmlns="http://www.w3.org/2000/svg">
      <rect width="1240" height="1754" fill="rgb(238,236,228)"/>
      <text x="260" y="900" font-family="Arial" font-size="155" fill="rgba(120,120,120,0.28)" transform="rotate(-28 620 877)">NAS ARCHIVE</text>
      <rect x="80" y="70" width="200" height="120" fill="rgb(23,126,214)"/>
      <circle cx="180" cy="130" r="42" fill="rgb(245,196,42)"/>
      <text x="90" y="310" font-family="Arial" font-size="54" font-weight="700" fill="rgb(10,10,10)">Black document text 0042</text>
      <text x="90" y="390" font-family="Arial" font-size="42" fill="rgb(24,24,24)">Conservative enhancement should keep color marks.</text>
      <path d="M160 1280 C260 1190, 360 1370, 500 1260 S720 1240, 820 1300" stroke="rgb(0,74,210)" stroke-width="16" fill="none" stroke-linecap="round"/>
      <circle cx="940" cy="1260" r="108" fill="none" stroke="rgb(214,28,38)" stroke-width="16"/>
      <text x="865" y="1274" font-family="Arial" font-size="38" font-weight="700" fill="rgb(214,28,38)">STAMP</text>
    </svg>
  `;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

async function imagesToPdf(imagePath, pdfPath) {
  await execFileAsync(scanner.findNaps2(), [
    '-i', imagePath,
    '-o', pdfPath,
    '--noprofile',
    '-n', '0',
    '--disableocr',
    '--force',
    '-v',
  ]);
  assert(fs.existsSync(pdfPath), 'Fixture PDF was not created.');
  assert(storage.validatePdfHeader(pdfPath), 'Fixture PDF is invalid.');
}

async function regionStats(imagePath, region) {
  const { data, info } = await sharp(imagePath)
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let r = 0;
  let g = 0;
  let b = 0;
  let dark = 0;
  let red = 0;
  let blue = 0;
  let watermark = 0;
  for (let i = 0; i < data.length; i += 3) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    r += pr;
    g += pg;
    b += pb;
    if (pr < 70 && pg < 70 && pb < 70) dark++;
    if (pr > 145 && pg < 95 && pb < 100) red++;
    if (pb > 135 && pr < 100 && pg < 135) blue++;
    if (Math.abs(pr - pg) < 16 && Math.abs(pg - pb) < 16 && pr > 150 && pr < 245) watermark++;
  }
  return {
    r: r / pixels,
    g: g / pixels,
    b: b / pixels,
    brightness: (r + g + b) / (pixels * 3),
    dark,
    red,
    blue,
    watermark,
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-enhancement-'));
  storage.initialize(root);
  dbManager.initialize(path.join(root, 'nas.sqlite'));

  const fixturePng = path.join(root, 'source.png');
  const fixturePdf = path.join(root, 'source.pdf');
  await createFixturePng(fixturePng);
  await imagesToPdf(fixturePng, fixturePdf);

  const originalChecksum = storage.computeFileHash(fixturePdf);
  const result = await enhancement.enhancePdf(42, fixturePdf);
  assert.strictEqual(result.success, true, 'Enhancement did not succeed.');
  assert(fs.existsSync(result.path), 'Enhanced derivative is missing.');
  assert(storage.validatePdfHeader(result.path), 'Enhanced derivative is not a valid PDF.');
  assert.strictEqual(storage.computeFileHash(fixturePdf), originalChecksum, 'Original PDF was modified.');
  assert.notStrictEqual(result.checksum, originalChecksum, 'Enhanced derivative should be a separate file.');

  const renderDir = path.join(root, 'rendered');
  fs.mkdirSync(renderDir, { recursive: true });
  const sourcePages = await enhancement.renderPdfToImages(fixturePdf, renderDir);
  const enhancedRenderDir = path.join(root, 'rendered_enhanced');
  fs.mkdirSync(enhancedRenderDir, { recursive: true });
  const enhancedPages = await enhancement.renderPdfToImages(result.path, enhancedRenderDir);

  const sourceBackground = await regionStats(sourcePages[0], { left: 30, top: 30, width: 120, height: 120 });
  const enhancedBackground = await regionStats(enhancedPages[0], { left: 30, top: 30, width: 120, height: 120 });
  assert(enhancedBackground.brightness >= sourceBackground.brightness, 'Background was not normalized/whitened.');

  const textStats = await regionStats(enhancedPages[0], { left: 80, top: 270, width: 900, height: 150 });
  const logoStats = await regionStats(enhancedPages[0], { left: 70, top: 60, width: 230, height: 150 });
  const signatureStats = await regionStats(enhancedPages[0], { left: 130, top: 1180, width: 720, height: 190 });
  const stampStats = await regionStats(enhancedPages[0], { left: 820, top: 1130, width: 260, height: 260 });
  const watermarkStats = await regionStats(enhancedPages[0], { left: 250, top: 760, width: 720, height: 260 });

  assert(textStats.dark > 500, 'Black text contrast was not preserved.');
  assert(logoStats.blue > 500, 'Color logo was not preserved.');
  assert(signatureStats.blue > 250, 'Blue signature was not preserved.');
  assert(stampStats.red > 300, 'Red stamp was not preserved.');
  assert(watermarkStats.watermark > 500, 'Watermark was not preserved.');

  const doc = documents.createDocument({
    title: 'Enhancement fixture',
    content: 'Black document text 0042',
    original_filename: 'source.pdf',
    original_file_path: fixturePdf,
    original_checksum: originalChecksum,
    original_size: fs.statSync(fixturePdf).size,
    original_mime_type: 'application/pdf',
    enhanced_file_path: result.path,
    enhanced_checksum: result.checksum,
    enhanced_size: result.size,
    enhancement_status: 'SUCCESS',
  });
  assert.strictEqual(doc.enhancement_status, 'SUCCESS', 'Document record did not retain enhancement status.');
  assert.strictEqual(doc.enhanced_file_path, result.path, 'Enhanced derivative was not linked to the document.');

  const thumb = await thumbnail.generateForPdf(doc.id, doc.enhanced_file_path, { title: doc.title, force: true });
  assert.strictEqual(thumb.success, true, 'Thumbnail was not generated from enhanced PDF.');

  let fallbackOk = false;
  try {
    await enhancement.enhancePdf(43, path.join(root, 'missing.pdf'));
  } catch (err) {
    fallbackOk = /does not exist/.test(err.message);
  }
  assert(fallbackOk, 'Enhancement failure did not produce a controlled error.');
  assert(fs.existsSync(fixturePdf), 'Original PDF was lost after enhancement failure path.');

  dbManager.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Document image enhancement regression tests passed.');
}

main().catch((err) => {
  try { dbManager.close(); } catch (e) {}
  console.error(err);
  process.exit(1);
});
