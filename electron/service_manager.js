/**
 * NAS Archive — Desktop Background Service Orchestrator.
 * Manages Docker, Compose containers (Paperless, Postgres, Valkey),
 * and Local Scanner Bridge silently and reliably in the background.
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const DOCKER_DESKTOP_PATH = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
const PAPERLESS_URL = 'http://127.0.0.1:8000';
const BRIDGE_URL = 'http://127.0.0.1:8001';

class ServiceManager {
  constructor() {
    this.bridgeProcess = null;
    this.activeTaskCount = 0;
  }

  /** Run a command via execFile returning a Promise */
  _exec(cmd, args, options = {}) {
    return new Promise((resolve) => {
      execFile(cmd, args, { cwd: PROJECT_ROOT, windowsHide: true, ...options }, (error, stdout, stderr) => {
        resolve({
          success: !error,
          code: error ? error.code : 0,
          stdout: stdout ? stdout.trim() : '',
          stderr: stderr ? stderr.trim() : '',
        });
      });
    });
  }

  /** Ping an HTTP endpoint */
  _pingHttp(url, timeoutMs = 2500) {
    return new Promise((resolve) => {
      try {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              statusCode: res.statusCode,
              body,
            });
          });
        });
        req.on('error', () => resolve({ ok: false, statusCode: 0 }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, statusCode: 0, timeout: true });
        });
      } catch (e) {
        resolve({ ok: false, statusCode: 0, error: e.message });
      }
    });
  }

  /** Step 1: Check Docker Desktop installation */
  async isDockerInstalled() {
    if (fs.existsSync(DOCKER_DESKTOP_PATH)) return true;
    const res = await this._exec('where', ['docker']);
    return res.success;
  }

  /** Step 2: Check if Docker Engine is responding */
  async isDockerRunning() {
    const res = await this._exec('docker', ['info', '--format', '{{.ServerVersion}}']);
    return res.success && res.stdout.length > 0;
  }

  /** Step 3: Launch Docker Desktop if not running */
  async startDockerDesktop() {
    if (await this.isDockerRunning()) return true;

    if (fs.existsSync(DOCKER_DESKTOP_PATH)) {
      try {
        const p = spawn(DOCKER_DESKTOP_PATH, [], { detached: true, stdio: 'ignore' });
        p.unref();
      } catch (e) {
        // Continue to poll
      }
    }

    // Poll for up to 45 seconds
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      if (await this.isDockerRunning()) return true;
    }
    return false;
  }

  /** Step 4: Ensure NAS Archive containers are running */
  async ensureContainersRunning() {
    const res = await this._exec('docker', ['compose', 'ps', '--format', 'json']);
    let containers = [];
    if (res.success && res.stdout) {
      try {
        // Handles json array or line-delimited json
        if (res.stdout.startsWith('[')) {
          containers = JSON.parse(res.stdout);
        } else {
          containers = res.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
        }
      } catch (e) {
        containers = [];
      }
    }

    const running = containers.filter((c) => (c.State || '').toLowerCase().includes('running'));
    if (running.length < 3) {
      // Missing or stopped containers - bring them up
      await this._exec('docker', ['compose', 'up', '-d']);
    }
    return true;
  }

  /** Step 5: Wait for Paperless-ngx webserver API */
  async waitForPaperless(timeoutSeconds = 60) {
    const deadline = Date.now() + (timeoutSeconds * 1000);
    while (Date.now() < deadline) {
      const res = await this._pingHttp(`${PAPERLESS_URL}/api/`);
      if (res.ok) return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  /** Step 6: Ensure Scanner Bridge is running on port 8001 */
  async ensureScannerBridge() {
    const ping = await this._pingHttp(`${BRIDGE_URL}/api/status`);
    if (ping.ok) return true;

    // Start Scanner Bridge via pythonw or python
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'scanner_bridge.py');
    const pythonExe = 'python';

    try {
      this.bridgeProcess = spawn(pythonExe, [scriptPath], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      this.bridgeProcess.unref();
    } catch (e) {
      // Failed to launch python directly
    }

    // Poll bridge health
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const chk = await this._pingHttp(`${BRIDGE_URL}/api/status`);
      if (chk.ok) return true;
    }
    return false;
  }

  /** Step 7: Detect available scanners */
  async detectScanners() {
    const res = await this._pingHttp(`${BRIDGE_URL}/api/status`);
    if (res.ok) {
      try {
        const data = JSON.parse(res.body);
        return data.scanner && data.scanner.detected_devices ? data.scanner.detected_devices : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * Run complete startup sequence with asynchronous progress callbacks.
   * Calls progressCallback({ step, totalSteps, title, subtitle, error })
   */
  async runStartupSequence(progressCallback) {
    const notify = (step, title, subtitle, error = null) => {
      if (progressCallback) progressCallback({ step, totalSteps: 5, title, subtitle, error });
    };

    // 1. Docker check
    notify(1, 'فحص بيئة الخدمات المساعدة', 'التحقق من توفر محرك Docker على النظام...');
    const dockerInstalled = await this.isDockerInstalled();
    if (!dockerInstalled) {
      notify(1, 'محرك Docker غير مثبت', 'يرجى تثبيت Docker Desktop لتمكين قاعدة البيانات ونظام الفهرسة.', 'DOCKER_NOT_INSTALLED');
      return { success: false, code: 'DOCKER_NOT_INSTALLED' };
    }

    const dockerRunning = await this.isDockerRunning();
    if (!dockerRunning) {
      notify(1, 'تشغيل Docker Desktop', 'جاري بدء تشغيل Docker Desktop في الخلفية...');
      const started = await this.startDockerDesktop();
      if (!started) {
        notify(1, 'تعذر الاتصال بمحرك Docker', 'يرجى تشغيل Docker Desktop يدوياً ثم إعادة فتح التطبيق.', 'DOCKER_START_TIMEOUT');
        return { success: false, code: 'DOCKER_START_TIMEOUT' };
      }
    }

    // 2. Project containers
    notify(2, 'تشغيل حاويات الأرشيف وقاعدة البيانات', 'التأكد من تشغيل Paperless وPostgreSQL وValkey...');
    await this.ensureContainersRunning();

    // 3. Document storage & Paperless API
    notify(3, 'الاتصال بنظام الفهرسة والتخزين', 'التحقق من جاهزية محرك التعرف الضوئي OCR...');
    const paperlessReady = await this.waitForPaperless(45);
    if (!paperlessReady) {
      notify(3, 'جاري انتظار خدمات الأرشيف...', 'قد يستغرق تشغيل الحاويات بضع ثوانٍ إضافية...');
    }

    // 4. Scanner Bridge
    notify(4, 'تشغيل جسر ربط الماسح الضوئي', 'بدء الاتصال بخدمة NAPS2 وإدارة المسح...');
    const bridgeReady = await this.ensureScannerBridge();
    if (!bridgeReady) {
      notify(4, 'تنبيه الماسح الضوئي', 'يعمل الأرشيف ولكن تعذر الاتصال بجسر الماسح.', 'BRIDGE_OFFLINE');
    }

    // 5. Hardware scanner discovery
    notify(5, 'فحص الطابعات وأجهزة المسح', 'البحث عن أجهزة المسح الضوئي المتصلة (WIA)...');
    const scanners = await this.detectScanners();

    notify(5, 'جاهز للعمل!', scanners.length > 0 ? `تم التعرف على: ${scanners[0]}` : 'جاهز للمسح واستيراد الوثائق.');
    return { success: true, scanners };
  }

  /** Health snapshot for UI settings / dashboard */
  async getHealthSnapshot() {
    const dockerRunning = await this.isDockerRunning();
    const paperlessRes = await this._pingHttp(`${PAPERLESS_URL}/api/`);
    const bridgeRes = await this._pingHttp(`${BRIDGE_URL}/api/status`);

    let bridgeData = null;
    if (bridgeRes.ok) {
      try {
        bridgeData = JSON.parse(bridgeRes.body);
      } catch (e) {
        bridgeData = null;
      }
    }

    return {
      docker: dockerRunning,
      paperless: paperlessRes.ok,
      bridge: bridgeRes.ok,
      scanner: bridgeData ? bridgeData.scanner : null,
      version: '1.2.1',
    };
  }
}

module.exports = new ServiceManager();
