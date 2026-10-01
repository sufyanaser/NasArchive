/**
 * NAS Archive — Unified AppShell Coordinator & Router
 * Connects all workspace controllers, titlebar window controls,
 * sidebar navigation, split-pane resizers, and background health polling.
 */

class AppRouter {
  constructor() {
    this.currentRoute = 'scanner';
    this.currentDocScope = 'all';
    this.navItems = document.querySelectorAll('.sidebar .nav-item');
    this.viewPanes = document.querySelectorAll('.workspace .view-pane');

    this.scannerController = null;
    this.documentsController = null;
    this.importController = null;
    this.dashboardController = null;
    this.settingsController = null;
    this.archiveExtended = null;
    this.routeMeta = {
      dashboard: ['مساحة العمل', 'الرئيسية'],
      scanner: ['مساحة العمل', 'المسح والاستيراد'],
      import: ['مساحة العمل', 'استيراد ملف'],
      documents: ['مساحة العمل', 'الأرشيف'],
      attributes: ['إدارة البيانات', 'الجهات والأنواع والوسوم'],
      savedViews: ['الأرشيف', 'طرق العرض المحفوظة'],
      workflows: ['إدارة البيانات', 'سير العمل'],
      trash: ['الأرشيف', 'سلة المهملات'],
      tasks: ['النظام', 'السجلات والمهام'],
      logs: ['النظام', 'النسخ الاحتياطي والسجلات'],
      users: ['النظام', 'المستخدمون'],
      settings: ['النظام', 'الإعدادات والتحديثات'],
    };
  }

  async init() {
    this._setupWindowControls();
    this._setupNavigation();
    this._setupTopbar();
    this._setupKeyboardShortcuts();
    this._setupSplitPaneResizer();
    this._setupLiveHealthPolling();

    // Initialize all workspace controllers
    this.scannerController = new window.ScannerController();
    this.documentsController = new window.DocumentsController();
    this.importController = new window.ImportController();
    this.dashboardController = new window.DashboardController();
    this.settingsController = new window.SettingsController();
    this.archiveExtended = window.archiveExtended || new window.ArchiveExtendedController();

    window.scannerController = this.scannerController;
    window.documentsController = this.documentsController;
    window.importController = this.importController;
    window.dashboardController = this.dashboardController;
    window.settingsController = this.settingsController;
    window.archiveExtended = this.archiveExtended;

    await Promise.all([
      this.scannerController.init(),
      this.documentsController.init(),
      this.importController.init(),
      this.dashboardController.init(),
      this.settingsController.init(),
      this.archiveExtended.init(),
    ]);

    // Initial navigation
    this.navigate('scanner');

    // Listen to tray navigation events from Electron
    if (window.nasArchive) {
      // IPC listeners handled if needed
    }
  }

  _setupWindowControls() {
    const btnClose = document.getElementById('btnWindowClose');
    const btnMin = document.getElementById('btnWindowMin');
    const btnMax = document.getElementById('btnWindowMax');

    if (window.nasArchive && window.nasArchive.window) {
      if (btnClose) btnClose.addEventListener('click', () => window.nasArchive.window.close());
      if (btnMin) btnMin.addEventListener('click', () => window.nasArchive.window.minimize());
      if (btnMax) btnMax.addEventListener('click', () => window.nasArchive.window.maximize());
    }
  }

  _setupNavigation() {
    this.navItems = document.querySelectorAll('.sidebar .nav-item');
    this.viewPanes = document.querySelectorAll('.workspace .view-pane');

    this.navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.dataset.view;
        if (targetView) {
          this.navigate(targetView, {
            docScope: item.dataset.docScope || null,
          });
        }
      });
    });
  }

  navigate(route, options = {}) {
    this.currentRoute = route;
    if (route === 'documents') {
      this.currentDocScope = options.docScope || this.currentDocScope || 'all';
    }

    // Update sidebar active class
    this.navItems.forEach((item) => {
      const sameRoute = item.dataset.view === route;
      const itemScope = item.dataset.docScope || null;
      const sameScope = route !== 'documents' || !itemScope || itemScope === this.currentDocScope;
      if (sameRoute && sameScope) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update view pane
    this.viewPanes.forEach((pane) => {
      if (pane.id === `view${route.charAt(0).toUpperCase() + route.slice(1)}`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Hook lifecycle on view activation
    if (route === 'documents' && this.documentsController) {
      if (options.docScope) {
          this.documentsController.setArchiveScope(this.currentDocScope);
      }
      this.documentsController.fetchDocuments();
    } else if (route === 'dashboard' && this.dashboardController) {
      this.dashboardController.refresh();
    } else if (route === 'settings' && this.settingsController) {
      this.settingsController.refreshServiceStatus();
    } else if (route === 'attributes' && this.archiveExtended) {
      this.archiveExtended.renderAttributesTab();
    } else if (route === 'savedViews' && this.archiveExtended) {
      this.archiveExtended.renderSavedViews();
    } else if (route === 'workflows' && this.archiveExtended) {
      this.archiveExtended.renderWorkflows();
    } else if (route === 'trash' && this.archiveExtended) {
      this.archiveExtended.renderTrash();
    } else if (route === 'tasks' && this.archiveExtended) {
      this.archiveExtended.renderTasks();
    } else if (route === 'logs' && this.archiveExtended) {
      this.archiveExtended.renderLogs();
    } else if (route === 'users' && this.archiveExtended) {
      this.archiveExtended.renderUsers();
    }

    this._updateTopbar(route);
  }

  _setupTopbar() {
    const scanBtn = document.getElementById('topbarScanBtn');
    const importBtn = document.getElementById('topbarImportBtn');
    const globalSearch = document.getElementById('globalSearchInput');

    if (scanBtn) scanBtn.addEventListener('click', () => this.navigate('scanner'));
    if (importBtn) importBtn.addEventListener('click', () => this.navigate('import'));
    if (globalSearch) {
      globalSearch.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.navigate('documents');
          if (this.documentsController && this.documentsController.dom.searchInput) {
            this.documentsController.dom.searchInput.value = globalSearch.value;
            this.documentsController.searchQuery = globalSearch.value.trim();
            this.documentsController.fetchDocuments();
          }
        }
      });
    }
  }

  _updateTopbar(route) {
    const breadcrumb = document.getElementById('topbarBreadcrumb');
    const title = document.getElementById('topbarTitle');
    const meta = this.routeMeta[route] || ['NAS Archive', route];
    if (breadcrumb) breadcrumb.textContent = meta[0];
    if (title) title.textContent = meta[1];
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      const isTyping = ['input', 'textarea', 'select'].includes(activeTag);

      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const search = this.currentRoute === 'documents'
          ? document.getElementById('docsSearchInput')
          : document.getElementById('globalSearchInput');
        if (search) search.focus();
      } else if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.navigate('import');
      } else if (event.key === 'Escape') {
        const modal = document.getElementById('docDetailModal');
        if (modal && modal.classList.contains('open') && this.documentsController) {
          this.documentsController.closeModal();
        }
      } else if (!isTyping && event.key === 'Delete' && this.currentRoute === 'documents' && this.documentsController) {
        event.preventDefault();
        this.documentsController.executeBulkDelete();
      } else if (!isTyping && event.key === 'Enter' && this.currentRoute === 'documents' && this.documentsController) {
        const first = this.documentsController.documents && this.documentsController.documents[0];
        if (first) this.documentsController.openDocumentModal(first);
      }
    });
  }

  _setupSplitPaneResizer() {
    const resizer = document.getElementById('scannerPaneResizer');
    const leftPane = document.querySelector('.scanner-controls-pane');
    if (!resizer || !leftPane) return;

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = leftPane.getBoundingClientRect().width;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      // In RTL, dragging left increases the left pane width
      const dx = startX - e.clientX;
      const newWidth = Math.max(320, Math.min(650, startWidth + dx));
      leftPane.style.width = `${newWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        if (this.scannerController && this.scannerController.pdfViewer) {
          this.scannerController.pdfViewer.fitToWidth();
        }
      }
    });
  }

  _setupLiveHealthPolling() {
    const pillNative = document.getElementById('topPillNative');
    const pillScanner = document.getElementById('topPillScanner');

    const updateStatus = async () => {
      try {
        const data = await window.api.getStatus();
        if (pillNative) {
          const isOnline = data.native && data.native.online;
          pillNative.className = `status-pill ${isOnline ? 'online' : 'offline'}`;
          pillNative.querySelector('span:last-child').textContent = isOnline ? 'المحرك المحلي متصل' : 'المحرك المحلي غير متصل';
        }

        if (pillScanner) {
          const sc = data.scanner || {};
          const devs = sc.devices || sc.detected_devices || [];
          const hasDev = devs.length > 0;
          const isReady = sc.ready && hasDev;

          if (isReady) {
            pillScanner.className = 'status-pill online';
            pillScanner.querySelector('span:last-child').textContent = `جاهز: ${devs[0]}`;
          } else if (hasDev) {
            pillScanner.className = 'status-pill warning';
            pillScanner.querySelector('span:last-child').textContent = `مشغول: ${devs[0]}`;
          } else {
            pillScanner.className = 'status-pill warning';
            pillScanner.querySelector('span:last-child').textContent = 'لا يوجد ماسح متصل';
          }
        }
      } catch (e) {
        // native health unavailable
      }
    };

    updateStatus();
    setInterval(updateStatus, 8000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.appRouter = new AppRouter();
  window.appRouter.init();
});
