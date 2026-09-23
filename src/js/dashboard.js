/**
 * NAS Archive — Operational Dashboard Controller
 * Displays key archive metrics, department breakdown, service health, and recent documents.
 */

class DashboardController {
  constructor() {
    this.dom = {
      totalDocs: document.getElementById('dashTotalDocs'),
      pendingDocs: document.getElementById('dashPendingDocs'),
      deptPersonal: document.getElementById('dashDeptPersonal'),
      deptRaneen: document.getElementById('dashDeptRaneen'),
      deptTanasuq: document.getElementById('dashDeptTanasuq'),
      deptNasfm: document.getElementById('dashDeptNasfm'),
      recentDocsList: document.getElementById('dashRecentDocsList'),
      healthDocker: document.getElementById('dashHealthDocker'),
      healthPaperless: document.getElementById('dashHealthPaperless'),
      healthScanner: document.getElementById('dashHealthScanner'),
    };
  }

  async init() {
    await this.refresh();
  }

  async refresh() {
    try {
      const [docsData, healthData, tagsData] = await Promise.all([
        window.api.getDocuments({ ordering: '-created', page_size: 10 }),
        window.api.getStatus(),
        window.api.getTags(),
      ]);

      const tagsMap = {};
      if (tagsData && tagsData.results) {
        tagsData.results.forEach((t) => { tagsMap[t.id] = t.name; });
      }

      const allDocs = docsData.results || [];
      const totalCount = docsData.count || 0;

      if (this.dom.totalDocs) this.dom.totalDocs.textContent = totalCount;

      // Count by department & pending
      let personal = 0, raneen = 0, tanasuq = 0, nasfm = 0, pending = 0;
      allDocs.forEach((d) => {
        const names = d.tags.map((id) => tagsMap[id]);
        if (names.includes('شخصي')) personal++;
        if (names.includes('الرنين')) raneen++;
        if (names.includes('تناسق')) tanasuq++;
        if (names.includes('NAS FM')) nasfm++;
        if (names.includes('بانتظار المراجعة')) pending++;
      });

      if (this.dom.pendingDocs) this.dom.pendingDocs.textContent = pending;
      if (this.dom.deptPersonal) this.dom.deptPersonal.textContent = personal;
      if (this.dom.deptRaneen) this.dom.deptRaneen.textContent = raneen;
      if (this.dom.deptTanasuq) this.dom.deptTanasuq.textContent = tanasuq;
      if (this.dom.deptNasfm) this.dom.deptNasfm.textContent = nasfm;

      // Update sidebar pending badge
      const sidebarBadge = document.getElementById('badgePendingReview');
      if (sidebarBadge) {
        sidebarBadge.textContent = pending;
        sidebarBadge.style.display = pending > 0 ? 'inline-block' : 'none';
      }

      // Render Recent Documents
      if (this.dom.recentDocsList) {
        if (allDocs.length === 0) {
          this.dom.recentDocsList.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">لا توجد وثائق مؤرشفة بعد.</div>';
        } else {
          this.dom.recentDocsList.innerHTML = '';
          allDocs.slice(0, 5).forEach((d) => {
            const item = document.createElement('div');
            item.className = 'recent-doc-row';
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); cursor: pointer; transition: background 0.2s;';
            item.innerHTML = `
              <div style="display: flex; align-items: center; gap: 12px;">
                <img src="http://127.0.0.1:8000/api/documents/${d.id}/thumb/" style="width: 38px; height: 48px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-subtle);" onerror="this.src='../assets/icon.png'">
                <div>
                  <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${d.title}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${d.page_count || 1} صفحة • ${d.created ? new Date(d.created).toLocaleDateString('ar-IQ') : '—'}</div>
                </div>
              </div>
              <button class="btn-secondary" style="padding: 6px 12px; font-size: 12px;">عرض</button>
            `;
            item.addEventListener('click', () => {
              if (window.appRouter) {
                window.appRouter.navigate('documents');
                if (window.documentsController) {
                  window.documentsController.refreshAndOpen(d.id);
                }
              }
            });
            this.dom.recentDocsList.appendChild(item);
          });
        }
      }

      // Health Indicators
      if (this.dom.healthPaperless) {
        const isOnline = healthData.paperless && healthData.paperless.online;
        this.dom.healthPaperless.className = `status-pill ${isOnline ? 'online' : 'offline'}`;
        this.dom.healthPaperless.querySelector('span:last-child').textContent = isOnline ? 'متصل' : 'غير متصل';
      }

      if (this.dom.healthScanner) {
        const devs = (healthData.scanner && healthData.scanner.detected_devices) || [];
        const isDetected = devs.length > 0;
        this.dom.healthScanner.className = `status-pill ${isDetected ? 'online' : 'warning'}`;
        this.dom.healthScanner.querySelector('span:last-child').textContent = isDetected ? devs[0] : 'لا يوجد جهاز متصل';
      }
    } catch (err) {
      console.warn('Dashboard refresh error:', err);
    }
  }
}

window.DashboardController = DashboardController;
