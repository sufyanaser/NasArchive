/**
 * NAS Archive — Native Scanner Integration (NAPS2)
 * Manages device detection (WIA, TWAIN, eSCL), scanner execution,
 * parameter validation, hidden execution, and output verification.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const VALID_DRIVERS = ['wia', 'twain', 'escl'];
const VALID_SOURCES = ['glass', 'feeder', 'duplex'];
const VALID_DPIS = [150, 200, 300, 400, 600];
const VALID_BITDEPTHS = ['color', 'gray', 'bw'];
const VALID_SECTIONS = ['شخصي', 'الرنين', 'تناسق', 'NAS FM'];

class ScannerService {
  constructor() {
    this.currentProcess = null;
  }

  /**
   * Locate NAPS2.Console.exe on the Windows system.
   */
  findNaps2() {
    // 0. Check Bundled resources if packaged
    if (process.resourcesPath) {
      const bundled = path.join(process.resourcesPath, 'bin', 'NAPS2.Console.exe');
      if (fs.existsSync(bundled)) return bundled;
    }

    // 1. Check App Execution Alias
    const winAppsPath = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'NAPS2.Console.exe');
    if (fs.existsSync(winAppsPath)) return winAppsPath;

    // 2. Check Standard Installation Paths
    const common = [
      'C:\\Program Files\\NAPS2\\NAPS2.Console.exe',
      'C:\\Program Files (x86)\\NAPS2\\NAPS2.Console.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'NAPS2', 'NAPS2.Console.exe'),
    ];

    for (const p of common) {
      if (fs.existsSync(p)) return p;
    }

    return 'NAPS2.Console.exe';
  }

  /**
   * List available scanning devices for a driver (wia, twain, escl).
   */
  listDevices(driver = 'wia') {
    return new Promise((resolve) => {
      const naps2 = this.findNaps2();
      const safeDriver = VALID_DRIVERS.includes(driver.toLowerCase()) ? driver.toLowerCase() : 'wia';

      execFile(
        naps2,
        ['--driver', safeDriver, '--listdevices'],
        { windowsHide: true, timeout: 10000 },
        (error, stdout) => {
          if (error) {
            resolve({ driver: safeDriver, devices: [], error: error.message });
            return;
          }
          const lines = stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.includes('NAPS2 Contributors') && !l.includes('Scanning with'));
          resolve({ driver: safeDriver, devices: lines });
        }
      );
    });
  }

  /**
   * Execute physical scan and save output to staging for immediate user preview.
   */
  scanToStaging(options = {}) {
    return new Promise((resolve, reject) => {
      const naps2 = this.findNaps2();

      const section = VALID_SECTIONS.includes(options.section) ? options.section : 'شخصي';
      const driver = VALID_DRIVERS.includes(options.driver) ? options.driver : 'wia';
      const dpi = VALID_DPIS.includes(Number(options.dpi)) ? Number(options.dpi) : 300;
      const bitdepth = VALID_BITDEPTHS.includes(options.bitdepth) ? options.bitdepth : 'color';
      const source = VALID_SOURCES.includes(options.source) ? options.source : null;
      const deskew = options.deskew !== false;

      // Ensure staging dir exists
      if (!storage.dirs.staging) {
        storage.initialize(path.join(__dirname, '..', '..', 'runtime'));
      }

      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
      const safeFilename = options.output_filename
        ? storage.sanitizeFilename(options.output_filename)
        : `scan_${timestamp}_${section}.pdf`;

      const targetPath = path.join(storage.dirs.staging, safeFilename);

      // Temporary file during scanning
      const tempPath = path.join(storage.dirs.staging, `.scan_tmp_${Date.now()}_${safeFilename}`);

      const args = [
        '-o', tempPath,
        '--driver', driver,
        '--dpi', String(dpi),
        '--pagesize', 'a4',
        '--bitdepth', bitdepth,
        '--force',
        '-v',
      ];

      if (options.device && typeof options.device === 'string' && options.device.trim()) {
        args.push('--device', options.device.trim());
      }
      if (source) {
        args.push('--source', source);
      }
      if (deskew) {
        args.push('--deskew');
      }

      this.currentProcess = execFile(
        naps2,
        args,
        { windowsHide: true, timeout: 120000 },
        (error, stdout, stderr) => {
          this.currentProcess = null;

          if (error) {
            if (fs.existsSync(tempPath)) {
              try { fs.unlinkSync(tempPath); } catch (e) {}
            }
            reject(new Error(`فشل المسح الضوئي: ${error.message} - ${stderr}`));
            return;
          }

          if (!fs.existsSync(tempPath)) {
            reject(new Error('لم يتم إنشاء ملف المستند من الماسح الضوئي. تأكد من توصيل الجهاز وتشغيله.'));
            return;
          }

          const stat = fs.statSync(tempPath);
          if (stat.size === 0) {
            fs.unlinkSync(tempPath);
            reject(new Error('الملف الناتج من المسح فارغ (0 بايت).'));
            return;
          }

          // Atomic rename to target staging file
          if (fs.existsSync(targetPath)) {
            try { fs.unlinkSync(targetPath); } catch (e) {}
          }
          fs.renameSync(tempPath, targetPath);

          // Validate PDF header
          if (!storage.validatePdfHeader(targetPath)) {
            reject(new Error('الملف الناتج لا يطابق بنية PDF الصحيحة (%PDF-).'));
            return;
          }

          const checksum = storage.computeFileHash(targetPath);

          resolve({
            success: true,
            filename: safeFilename,
            path: targetPath,
            size: stat.size,
            checksum,
            section,
            dpi,
            bitdepth,
          });
        }
      );
    });
  }

  /**
   * Cancel ongoing scan if active.
   */
  cancelScan() {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
      return true;
    }
    return false;
  }
}

module.exports = new ScannerService();
