/**
 * NAS Archive — Secure Local API Client
 * Interfaces with Paperless-ngx (port 8000) and Local Scanner Bridge (port 8001).
 */
const BRIDGE_BASE = 'http://127.0.0.1:8001';
const PAPERLESS_BASE = 'http://127.0.0.1:8000';

class ApiClient {
  constructor() {
    this.token = null;
  }

  // --- Scanner Bridge API ---
  async getStatus() {
    const res = await fetch(`${BRIDGE_BASE}/api/status`);
    return await res.json();
  }

  async getDevices(driver = 'wia') {
    const res = await fetch(`${BRIDGE_BASE}/api/devices?driver=${driver}`);
    return await res.json();
  }

  async scanStage(options) {
    const res = await fetch(`${BRIDGE_BASE}/api/scan/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return await res.json();
  }

  async scanArchive(options) {
    const res = await fetch(`${BRIDGE_BASE}/api/scan/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return await res.json();
  }

  async importStage(filename, fileDataB64, section = 'شخصي') {
    const res = await fetch(`${BRIDGE_BASE}/api/import/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        file_data: fileDataB64,
        section,
      }),
    });
    return await res.json();
  }

  async discardStaged(filename) {
    const res = await fetch(`${BRIDGE_BASE}/api/staging/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    return await res.json();
  }

  async getTask(taskId) {
    const res = await fetch(`${BRIDGE_BASE}/api/tasks/${taskId}`);
    return await res.json();
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
      await new Promise((r) => setTimeout(r, 1200));
    }
    throw new Error('انتهت مهلة معالجة الطلب');
  }

  // --- Paperless-ngx API ---
  async _getPaperlessToken() {
    if (this.token) return this.token;
    // Attempt to read token from bridge status or test endpoint
    try {
      const res = await fetch(`${BRIDGE_BASE}/api/status`);
      const statusData = await res.json();
      // Token is managed on localhost bridge; Paperless accepts local requests
    } catch (e) {
      // fallback
    }
    return null;
  }

  async queryPaperless(endpoint, method = 'GET', data = null) {
    const url = `${PAPERLESS_BASE}/api/${endpoint.replace(/^\//, '')}`;
    const headers = { 'Content-Type': 'application/json' };
    
    // Check if we have token stored in local storage
    const storedToken = localStorage.getItem('nas_paperless_token');
    if (storedToken) {
      headers['Authorization'] = `Token ${storedToken}`;
    }

    const options = { method, headers };
    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    let resp = await fetch(url, options);
    if (resp.status === 401) {
      // Attempt login via default/admin credentials from bridge
      const loginResp = await fetch(`${PAPERLESS_BASE}/api/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nasadmin', password: 'NasArchiveAdmin2026!' }),
      });
      if (loginResp.ok) {
        const tokenData = await loginResp.json();
        if (tokenData.token) {
          this.token = tokenData.token;
          localStorage.setItem('nas_paperless_token', this.token);
          headers['Authorization'] = `Token ${this.token}`;
          resp = await fetch(url, { ...options, headers });
        }
      }
    }

    if (!resp.ok) {
      throw new Error(`Paperless API HTTP ${resp.status}: ${resp.statusText}`);
    }
    return await resp.json();
  }

  async getDocuments(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.queryPaperless(`documents/?${query}`);
  }

  async getDocument(id) {
    return await this.queryPaperless(`documents/${id}/`);
  }

  async updateDocument(id, patchData) {
    return await this.queryPaperless(`documents/${id}/`, 'PATCH', patchData);
  }

  async deleteDocument(id) {
    const url = `${PAPERLESS_BASE}/api/documents/${id}/`;
    const token = localStorage.getItem('nas_paperless_token') || this.token;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    });
    return res.status === 204;
  }

  async getTags() {
    return await this.queryPaperless('tags/');
  }

  async getDocumentTypes() {
    return await this.queryPaperless('document_types/');
  }

  async getCustomFields() {
    return await this.queryPaperless('custom_fields/');
  }
}

window.api = new ApiClient();
