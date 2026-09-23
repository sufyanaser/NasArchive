/**
 * NAS Archive — Unified AppShell Coordinator & Router
 * Connects all workspace controllers, titlebar window controls,
 * sidebar navigation, split-pane resizers, and background health polling.
 */

class AppRouter {
  constructor() {
    this.currentRoute = 'scanner';
    this.navItems = document.querySelectorAll('.sidebar .nav-item');
    this.viewPanes = document.querySelectorAll('.workspace .view-pane');

    this.scannerController = null;
    this.documentsController = null;
    this.importController = null;
    this.dashboardController = null;
    this.settingsController = null;
  }

  async init() {
    this._setupWindowControls();
    this._setupNavigation();
    this._setupSplitPaneResizer();
    this._setupLiveHealthPolling();

    // Initialize all workspace controllers
    this.scannerController = new window.ScannerController();
    this.documentsController = new window.DocumentsController();
    this.importController = new window.ImportController();
    this.dashboardController = new window.DashboardController();
    this.settingsController = new window.SettingsController();

    window.scannerController = this.scannerController;
    window.documentsController = this.documentsController;
    window.importController = this.importController;
    window.dashboardController = this.dashboardController;
    window.settingsController = this.settingsController;

    await Promise.all([
      this.scannerController.init(),
      this.documentsController.init(),
      this.importController.init(),
      this.dashboardController.init(),
      this.settingsController.init(),
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
    this.navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.dataset.view;
        if (targetView) this.navigate(targetView);
      });
    });
  }

  navigate(route) {
    this.currentRoute = route;

    // Update sidebar active class
    this.navItems.forEach((item) => {
      if (item.dataset.view === route) {
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
      this.documentsController.fetchDocuments();
    } else if (route === 'dashboard' && this.dashboardController) {
      this.dashboardController.refresh();
    } else if (route === 'settings' && this.settingsController) {
      this.settingsController.refreshServiceStatus();
    }
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
    const pillPaperless = document.getElementById('topPillPaperless');
    const pillScanner = document.getElementById('topPillScanner');

    const updateStatus = async () => {
      try {
        const data = await window.api.getStatus();
        if (pillPaperless) {
          const isOnline = data.paperless && data.paperless.online;
          pillPaperless.className = `status-pill ${isOnline ? 'online' : 'offline'}`;
          pillPaperless.querySelector('span:last-child').textContent = isOnline ? 'Paperless متصل' : 'Paperless غير متصل';
        }

        if (pillScanner) {
          const devs = (data.scanner && data.scanner.detected_devices) || [];
          const hasDev = devs.length > 0;
          pillScanner.className = `status-pill ${hasDev ? 'online' : 'warning'}`;
          pillScanner.querySelector('span:last-child').textContent = hasDev ? devs[0] : 'فحص الماسح...';
        }
      } catch (e) {
        // bridge offline
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
