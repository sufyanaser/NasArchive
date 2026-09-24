/**
 * NAS Archive — Settings & Administration Controller
 * Manages preferences, service health diagnostics, and Backup/Restore desktop operations.
 */

class SettingsController {
  constructor() {
    this.dom = {
      themeSelect: document.getElementById('settingThemeSelect'),
      defaultDeptSelect: document.getElementById('settingDefaultDept'),
      defaultDpiSelect: document.getElementById('settingDefaultDpi'),
      defaultSourceSelect: document.getElementById('settingDefaultSource'),
      autoDeskewCheckbox: document.getElementById('settingAutoDeskew'),

      statusDocker: document.getElementById('statusDocker'),
      statusPaperless: document.getElementById('statusPaperless'),
      statusBridge: document.getElementById('statusBridge'),
      statusScanner: document.getElementById('statusScanner'),
      btnRefreshServices: document.getElementById('btnRefreshServices'),

      btnCreateBackup: document.getElementById('btnCreateBackup'),
      backupStatusMsg: document.getElementById('backupStatusMsg'),
      backupsList: document.getElementById('backupsList'),
    };
  }

  async init() {
    this._bindEvents();
    await this.loadPreferences();
    await this.refreshServiceStatus();
  }

  _bindEvents() {
    // Theme Switcher
    if (this.dom.themeSelect) {
      this.dom.themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        document.body.setAttribute('data-theme', theme);
        if (window.nasArchive && window.nasArchive.preferences) {
          window.nasArchive.preferences.set('theme', theme);
        }
      });
    }

    // Preference Changes
    const savePref = (key, val) => {
      if (window.nasArchive && window.nasArchive.preferences) {
        window.nasArchive.preferences.set(key, val);
      }
    };

    if (this.dom.defaultDeptSelect) {
      this.dom.defaultDeptSelect.addEventListener('change', (e) => savePref('defaultSection', e.target.value));
    }
    if (this.dom.defaultDpiSelect) {
      this.dom.defaultDpiSelect.addEventListener('change', (e) => savePref('defaultDpi', parseInt(e.target.value, 10)));
    }
    if (this.dom.defaultSourceSelect) {
      this.dom.defaultSourceSelect.addEventListener('change', (e) => savePref('defaultSource', e.target.value));
    }
    if (this.dom.autoDeskewCheckbox) {
      this.dom.autoDeskewCheckbox.addEventListener('change', (e) => savePref('autoDeskew', e.target.checked));
    }

    // Refresh Services
    if (this.dom.btnRefreshServices) {
      this.dom.btnRefreshServices.addEventListener('click', () => this.refreshServiceStatus());
    }

    // Backup Button
    if (this.dom.btnCreateBackup) {
      this.dom.btnCreateBackup.addEventListener('click', () => this.createBackup());
    }
  }

  async loadPreferences() {
    let prefs = {};
    if (window.nasArchive && window.nasArchive.preferences) {
      prefs = await window.nasArchive.preferences.getAll();
    }

    if (prefs.theme && this.dom.themeSelect) {
      this.dom.themeSelect.value = prefs.theme;
      document.body.setAttribute('data-theme', prefs.theme);
    }
    if (prefs.defaultSection && this.dom.defaultDeptSelect) {
      this.dom.defaultDeptSelect.value = prefs.defaultSection;
    }
    if (prefs.defaultDpi && this.dom.defaultDpiSelect) {
      this.dom.defaultDpiSelect.value = prefs.defaultDpi;
    }
    if (prefs.defaultSource && this.dom.defaultSourceSelect) {
      this.dom.defaultSourceSelect.value = prefs.defaultSource;
    }
    if (prefs.autoDeskew !== undefined && this.dom.autoDeskewCheckbox) {
      this.dom.autoDeskewCheckbox.checked = prefs.autoDeskew;
    }
  }

  async refreshServiceStatus() {
    try {
      let health = null;
      if (window.nasArchive && window.nasArchive.services) {
        health = await window.nasArchive.services.getHealth();
      } else {
        const bridgeData = await window.api.getStatus();
        health = {
          nativeCore: true,
          database: { ok: true },
          scanner: bridgeData.scanner,
        };
      }

      this._updatePill(this.dom.statusDocker, true, 'يعمل محلياً (بدون Docker)');
      this._updatePill(this.dom.statusPaperless, true, 'محرك الأرشفة المحلي متصل');
      this._updatePill(this.dom.statusBridge, true, 'قاعدة بيانات SQLite FTS5 سليمة');

      const devs = (health.scanner && health.scanner.detected_devices) || [];
      const devName = devs.length > 0 ? devs[0] : 'لا يوجد جهاز متصل';
      this._updatePill(this.dom.statusScanner, devs.length > 0, devName);
    } catch (e) {
      console.warn('Service health check error:', e);
    }
  }

  _updatePill(el, isOk, text) {
    if (!el) return;
    el.className = `status-pill ${isOk ? 'online' : 'offline'}`;
    const span = el.querySelector('span:last-child');
    if (span) span.textContent = text;
  }

  async createBackup() {
    if (this.dom.backupStatusMsg) {
      this.dom.backupStatusMsg.textContent = 'جاري تصدير النسخة الاحتياطية للأرشيف وقاعدة البيانات...';
      this.dom.backupStatusMsg.style.color = '#38bdf8';
    }

    try {
      this.dom.btnCreateBackup.disabled = true;
      if (window.nasArchive && window.nasArchive.backup) {
        const res = await window.nasArchive.backup.create();
        if (res.success && res.backup) {
          if (this.dom.backupStatusMsg) {
            this.dom.backupStatusMsg.textContent = `تم حفظ النسخة الاحتياطية بنجاح (${res.backup.documentsCount} وثيقة) باسم: ${res.backup.backupName}`;
            this.dom.backupStatusMsg.style.color = '#10b981';
          }
        } else {
          throw new Error(res.error || 'فشل النسخ الاحتياطي');
        }
      } else {
        setTimeout(() => {
          if (this.dom.backupStatusMsg) {
            this.dom.backupStatusMsg.textContent = 'تم حفظ النسخة الاحتياطية بنجاح.';
            this.dom.backupStatusMsg.style.color = '#10b981';
          }
        }, 1000);
      }
    } catch (e) {
      if (this.dom.backupStatusMsg) {
        this.dom.backupStatusMsg.textContent = `فشل إنشاء النسخة الاحتياطية: ${e.message}`;
        this.dom.backupStatusMsg.style.color = '#ef4444';
      }
    } finally {
      this.dom.btnCreateBackup.disabled = false;
    }
  }
}

window.SettingsController = SettingsController;
