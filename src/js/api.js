/**
 * NAS Archive — Unified API Client
 * Primary transport: High-speed Secure Electron IPC (zero localhost ports, zero Docker).
 * Fallback transport: Local HTTP (for standalone headless/testing scenarios).
 */

class ApiClient {
  constructor() {
    this.tasks = {};
  }

  // --- System & Service Health ---
  async getStatus() {
    if (window.nasArchive && window.nasArchive.services) {
      const health = await window.nasArchive.services.getHealth();
      const sc = health.scanner || {};
      const devs = sc.devices || sc.detected_devices || [];
      return {
        paperless: { online: true, version: health.version || '2.0.0 (Native)' },
        native: { online: true, version: '2.0.0' },
        bridge: { online: true, port: null },
        scanner: {
          detected: devs.length > 0,
          detected_devices: devs,
          devices: devs,
          ready: Boolean(sc.ready && devs.length > 0),
          status: sc.status || (devs.length > 0 ? 'READY' : 'NO_DEVICES'),
          activeDevice: sc.activeDevice || (devs.length > 0 ? devs[0] : null),
        },
        database: health.database || { ok: true },
        ocr: health.ocr || { ready: true },
      };
    }
    try {
      const res = await fetch('http://127.0.0.1:8001/api/status');
      return await res.json();
    } catch (e) {
      return { paperless: { online: true }, native: { online: true }, bridge: { online: true }, scanner: { detected: false, detected_devices: [], devices: [], ready: false } };
    }
  }

  async getDevices(driver = 'wia') {
    if (window.nasArchive && window.nasArchive.scanner) {
      const res = await window.nasArchive.scanner.getDevices(driver);
      return { driver, devices: res.devices || [] };
    }
    try {
      const res = await fetch(`http://127.0.0.1:8001/api/devices?driver=${driver}`);
      return await res.json();
    } catch (e) {
      return { driver, devices: [] };
    }
  }

  async checkScannerReadiness(device = null, driver = 'wia') {
    if (window.nasArchive && window.nasArchive.scanner && window.nasArchive.scanner.checkReadiness) {
      return await window.nasArchive.scanner.checkReadiness(device, driver);
    }
    const devicesRes = await this.getDevices(driver);
    return {
      ready: (devicesRes.devices || []).length > 0,
      devices: devicesRes.devices || [],
    };
  }

  // --- Two-Stage Scanning & Staging ---
  async scanStage(options) {
    if (window.nasArchive && window.nasArchive.scanner) {
      const res = await window.nasArchive.scanner.scanStage(options);
      if (!res.success) {
        return { error: res.error || 'فشل المسح الضوئي' };
      }
      const taskId = `scan_task_${Date.now()}`;
      this.tasks[taskId] = {
        task_id: taskId,
        status: res.isDuplicate ? 'DUPLICATE' : 'STAGED_READY',
        step: 2,
        message: 'اكتمل المسح بنجاح، جاري عرض المعاينة...',
        result: res,
      };
      return { task_id: taskId, status: 'ACCEPTED' };
    }
    const res = await fetch('http://127.0.0.1:8001/api/scan/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return await res.json();
  }

  async scanArchive(options) {
    if (window.nasArchive && window.nasArchive.documents) {
      const taskId = `archive_task_${Date.now()}`;
      this.tasks[taskId] = {
        task_id: taskId,
        status: 'PROCESSING',
        step: 3,
        message: 'جاري حفظ النسخة الأصلية بالأرشيف...',
      };

      // Asynchronously process archive
      (async () => {
        try {
          this.tasks[taskId].step = 4;
          this.tasks[taskId].message = 'جاري معالجة الـ OCR وفهرسة البحث...';

          const res = await window.nasArchive.documents.archiveStage(options);
          if (!res.success) {
            if (res.status === 'DUPLICATE') {
              this.tasks[taskId] = { task_id: taskId, status: 'DUPLICATE', message: res.message, existingId: res.existingId };
              return;
            }
            this.tasks[taskId] = { task_id: taskId, status: 'FAILED', error: res.error || 'فشلت الأرشفة' };
            return;
          }

          this.tasks[taskId] = {
            task_id: taskId,
            status: 'SUCCESS',
            step: 5,
            message: 'تمت الأرشفة وفهرسة الـ OCR بنجاح!',
            result: {
              document_id: res.document.id,
              document: res.document,
              aiSuggestions: res.aiSuggestions,
            },
          };
        } catch (err) {
          this.tasks[taskId] = { task_id: taskId, status: 'FAILED', error: err.message };
        }
      })();

      return { task_id: taskId, status: 'ACCEPTED' };
    }

    const res = await fetch('http://127.0.0.1:8001/api/scan/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return await res.json();
  }

  async importStage(filename, fileDataB64, section = 'شخصي') {
    if (window.nasArchive && window.nasArchive.documents) {
      const res = await window.nasArchive.documents.importStage(filename, fileDataB64, section);
      if (!res.success) {
        return { error: res.error || 'فشل استيراد الملف' };
      }
      const taskId = `import_task_${Date.now()}`;
      this.tasks[taskId] = {
        task_id: taskId,
        status: res.isDuplicate ? 'DUPLICATE' : 'STAGED_READY',
        step: 2,
        message: 'تم تجهيز الملف للمعاينة بنجاح',
        result: res,
      };
      return { task_id: taskId, status: 'ACCEPTED' };
    }

    const res = await fetch('http://127.0.0.1:8001/api/import/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, file_data: fileDataB64, section }),
    });
    return await res.json();
  }

  async discardStaged(filename) {
    if (window.nasArchive && window.nasArchive.documents) {
      return await window.nasArchive.documents.discardStaged(filename);
    }
    const res = await fetch(`http://127.0.0.1:8001/api/staging/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    return await res.json();
  }

  async getTask(taskId) {
    if (this.tasks[taskId]) {
      return this.tasks[taskId];
    }
    try {
      const res = await fetch(`http://127.0.0.1:8001/api/tasks/${taskId}`);
      return await res.json();
    } catch (e) {
      return { status: 'FAILED', error: e.message };
    }
  }

  async pollTask(taskId, onProgress, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = await this.getTask(taskId);
      if (onProgress) onProgress(task);

      if (task.status === 'SUCCESS' || task.status === 'STAGED_READY' || task.status === 'DUPLICATE') {
        return task;
      }
      if (task.status === 'FAILED') {
        throw new Error(task.error || 'فشلت معالجة الطلب');
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    throw new Error('انتهت مهلة معالجة الطلب');
  }

  // --- Document Management & Metadata ---
  async getDocuments(params = {}) {
    if (window.nasArchive && window.nasArchive.documents) {
      const queryParams = {
        department: params.department || null,
        tag_id: params.tag_id || params.tags__id__in || null,
        search: params.query || params.search || null,
        page: params.page || 1,
        page_size: params.page_size || 50,
      };
      if (params.query === 'بانتظار المراجعة' || params.search === 'بانتظار المراجعة') {
        queryParams.inbox_only = true;
        queryParams.search = null;
      }
      const data = await window.nasArchive.documents.list(queryParams);
      return {
        count: data.count,
        results: data.results,
      };
    }

    const query = new URLSearchParams(params).toString();
    const res = await fetch(`http://127.0.0.1:8000/api/documents/?${query}`);
    return await res.json();
  }

  async getDocument(id) {
    if (window.nasArchive && window.nasArchive.documents) {
      const res = await window.nasArchive.documents.get(id);
      if (!res.success) throw new Error(res.error || 'المستند غير موجود');
      return res.document;
    }
    const res = await fetch(`http://127.0.0.1:8000/api/documents/${id}/`);
    return await res.json();
  }

  async updateDocument(id, patchData) {
    if (window.nasArchive && window.nasArchive.documents) {
      const res = await window.nasArchive.documents.update(id, patchData);
      if (!res.success) throw new Error(res.error || 'فشل تحديث المستند');
      return res.document;
    }
    const res = await fetch(`http://127.0.0.1:8000/api/documents/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchData),
    });
    return await res.json();
  }

  async deleteDocument(id) {
    if (window.nasArchive && window.nasArchive.documents) {
      const res = await window.nasArchive.documents.delete(id);
      return res.success;
    }
    const res = await fetch(`http://127.0.0.1:8000/api/documents/${id}/`, { method: 'DELETE' });
    return res.status === 204;
  }

  async getTags() {
    if (window.nasArchive && window.nasArchive.documents) {
      return await window.nasArchive.documents.getTags();
    }
    const res = await fetch('http://127.0.0.1:8000/api/tags/');
    return await res.json();
  }

  async getDocumentTypes() {
    if (window.nasArchive && window.nasArchive.documents) {
      return await window.nasArchive.documents.getDocumentTypes();
    }
    const res = await fetch('http://127.0.0.1:8000/api/document_types/');
    return await res.json();
  }

  async getCustomFields() {
    if (window.nasArchive && window.nasArchive.documents) {
      return await window.nasArchive.documents.getCustomFields();
    }
    const res = await fetch('http://127.0.0.1:8000/api/custom_fields/');
    return await res.json();
  }
}

window.api = new ApiClient();
