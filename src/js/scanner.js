/**
 * NAS Archive — Scanner Workspace Controller
 * Implements the Two-Stage Scanning Workflow (Stage A: Scan & Preview -> Stage B: Explicit Archive)
 * with Rescan safety, hardware option detection, and live ingestion tracking.
 */

class ScannerController {
  constructor() {
    this.selectedDepartment = 'شخصي';
    this.stagedDoc = null; // { filename, stageId, section, previewUrl }
    this.pdfViewer = null;

    this.dom = {
      pane: document.getElementById('viewScanner'),
      deptCards: document.querySelectorAll('.department-card'),
      deviceSelect: document.getElementById('scannerDeviceSelect'),
      sourceSelect: document.getElementById('scannerSourceSelect'),
      bitdepthSelect: document.getElementById('scannerBitdepthSelect'),
      dpiSelect: document.getElementById('scannerDpiSelect'),
      deskewCheckbox: document.getElementById('scannerDeskewCheckbox'),
      duplicateCheckbox: document.getElementById('scannerDuplicateCheckbox'),

      initialActions: document.getElementById('scannerInitialActions'),
      startScanBtn: document.getElementById('btnStartScan'),
      twoStageActions: document.getElementById('scannerTwoStageActions'),
      rescanBtn: document.getElementById('btnRescan'),
      archiveBtn: document.getElementById('btnArchive'),

      progressCard: document.getElementById('scannerProgressCard'),
      progressMsg: document.getElementById('scannerProgressMsg'),
      progressSteps: document.querySelectorAll('#scannerProgressCard .progress-step'),

      prevPageBtn: document.getElementById('btnPrevPage'),
      nextPageBtn: document.getElementById('btnNextPage'),
      pageIndicator: document.getElementById('pageIndicator'),
      zoomInBtn: document.getElementById('btnZoomIn'),
      zoomOutBtn: document.getElementById('btnZoomOut'),
      zoomLevel: document.getElementById('zoomLevel'),
      fitWidthBtn: document.getElementById('btnFitWidth'),
      rotateBtn: document.getElementById('btnRotate'),
    };
  }

  async init() {
    // Initialize PDF Viewer for right-side preview
    this.pdfViewer = new window.PdfViewer('scannerPdfViewport', {
      onPageChange: ({ currentPage, totalPages, zoom }) => {
        if (this.dom.pageIndicator) {
          this.dom.pageIndicator.textContent = `${currentPage} من ${totalPages}`;
        }
        if (this.dom.zoomLevel) {
          this.dom.zoomLevel.textContent = `${zoom}%`;
        }
      },
    });

    this._bindEvents();
    await this.loadScannerOptions();
  }

  _bindEvents() {
    // Department Selection
    this.dom.deptCards.forEach((card) => {
      card.addEventListener('click', () => {
        this.dom.deptCards.forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedDepartment = card.dataset.department || 'شخصي';
      });
    });

    // Start Scan (Stage A)
    this.dom.startScanBtn.addEventListener('click', () => this.executeStageAScan());

    // Rescan (Stage A Replacement)
    this.dom.rescanBtn.addEventListener('click', () => this.executeRescan());

    // Archive (Stage B Explicit Submit)
    this.dom.archiveBtn.addEventListener('click', () => this.executeStageBArchive());

    // Toolbar Navigation
    if (this.dom.prevPageBtn) this.dom.prevPageBtn.addEventListener('click', () => this.pdfViewer.prevPage());
    if (this.dom.nextPageBtn) this.dom.nextPageBtn.addEventListener('click', () => this.pdfViewer.nextPage());
    if (this.dom.zoomInBtn) this.dom.zoomInBtn.addEventListener('click', () => this.pdfViewer.zoomIn());
    if (this.dom.zoomOutBtn) this.dom.zoomOutBtn.addEventListener('click', () => this.pdfViewer.zoomOut());
    if (this.dom.fitWidthBtn) this.dom.fitWidthBtn.addEventListener('click', () => this.pdfViewer.fitToWidth());
    if (this.dom.rotateBtn) this.dom.rotateBtn.addEventListener('click', () => this.pdfViewer.rotateClockwise());
  }

  async loadScannerOptions() {
    try {
      const data = await window.api.getDevices('wia');
      if (data && data.devices && this.dom.deviceSelect) {
        this.dom.deviceSelect.innerHTML = '';
        data.devices.forEach((dev) => {
          const opt = document.createElement('option');
          opt.value = dev;
          opt.textContent = dev;
          if (dev.includes('EPSON') || dev.includes('WF-C5890')) {
            opt.selected = true;
          }
          this.dom.deviceSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn('Could not load devices:', e);
    }
  }

  /**
   * STAGE A: Scan document and display immediately in preview.
   * Does NOT submit to Paperless.
   */
  async executeStageAScan() {
    const payload = {
      section: this.selectedDepartment,
      device: this.dom.deviceSelect.value || null,
      driver: 'wia',
      source: this.dom.sourceSelect.value || null,
      bitdepth: this.dom.bitdepthSelect.value || 'color',
      dpi: parseInt(this.dom.dpiSelect.value || '300', 10),
      deskew: this.dom.deskewCheckbox.checked,
    };

    this.dom.startScanBtn.disabled = true;
    this._showProgress(true, 'جاري الاتصال بالماسح الضوئي وسحب المستند بدقة عالية...', 1);

    try {
      const res = await window.api.scanStage(payload);
      if (res.error) throw new Error(res.error);

      // Poll task until STAGED_READY
      const task = await window.api.pollTask(res.task_id, (t) => {
        this._showProgress(true, t.message || 'جاري المسح...', t.step || 1);
      });

      if (task.status === 'STAGED_READY' && task.result) {
        this.stagedDoc = task.result;
        this._showProgress(false);

        // Transition buttons: hide Start Scan, show Rescan and Archive
        this.dom.initialActions.style.display = 'none';
        this.dom.twoStageActions.classList.add('visible');

        // Load preview and validate staged document
        await this.loadAndValidatePreview();
      } else {
        throw new Error(task.error || 'تعذر استلام بيانات المعاينة.');
      }
    } catch (err) {
      this._showProgress(false);
      alert(`خطأ أثناء المسح الضوئي:\n${err.message}`);
    } finally {
      this.dom.startScanBtn.disabled = false;
    }
  }

  /**
   * Loads staged document preview using secure local IPC first, falling back to HTTP.
   * Validates file integrity and disables Archive if file is invalid or missing.
   */
  async loadAndValidatePreview() {
    if (!this.stagedDoc) return;
    const filename = this.stagedDoc.filename;

    let isValid = false;
    let previewData = null;

    // 1. Try local direct IPC (Electron secure sandbox)
    if (window.nasArchive && window.nasArchive.staging) {
      try {
        const localRes = await window.nasArchive.staging.read(filename);
        if (localRes.success && localRes.base64) {
          isValid = true;
          previewData = localRes.base64;
        } else {
          console.warn('Local IPC staging read returned error:', localRes.error);
        }
      } catch (ipcErr) {
        console.warn('Local IPC staging read exception:', ipcErr);
      }
    }

    // 2. Fallback: Validate via HTTP bridge if IPC not available
    if (!isValid) {
      try {
        const encName = encodeURIComponent(filename);
        const valRes = await fetch(`http://127.0.0.1:8001/api/staging/${encName}/validate`);
        if (valRes.ok) {
          const valJson = await valRes.json();
          if (valJson.valid) {
            isValid = true;
            previewData = `http://127.0.0.1:8001/api/staging/${encName}`;
          }
        }
      } catch (httpValErr) {
        console.warn('Bridge HTTP validation error:', httpValErr);
      }
    }

    // Requirement 9: Prevent Archive action if staged file is missing, corrupted or invalid
    if (!isValid) {
      this.dom.archiveBtn.disabled = true;
      this.dom.rescanBtn.disabled = false;
      this.pdfViewer._showError(
        'المستند الممسوح مفقود أو تالف ولا يمكن أرشفته. يرجى الضغط على «إعادة المسح».',
        () => this.loadAndValidatePreview()
      );
      return;
    }

    // Document is valid! Enable Archive and Rescan
    this.dom.archiveBtn.disabled = false;
    this.dom.rescanBtn.disabled = false;

    // Load preview with retry callback (Requirement 10: retry without deleting scan)
    const retryCallback = () => this.loadAndValidatePreview();
    await this.pdfViewer.loadDocument(previewData || `http://127.0.0.1:8001/api/staging/${encodeURIComponent(filename)}`, retryCallback);
  }

  /**
   * RESCAN: Starts a replacement scan while preserving previous staged file until success.
   */
  async executeRescan() {
    if (!this.stagedDoc) return;
    const previousDoc = { ...this.stagedDoc };
    const oldFilename = this.stagedDoc.filename;

    const payload = {
      section: this.selectedDepartment,
      device: this.dom.deviceSelect.value || null,
      driver: 'wia',
      source: this.dom.sourceSelect.value || null,
      bitdepth: this.dom.bitdepthSelect.value || 'color',
      dpi: parseInt(this.dom.dpiSelect.value || '300', 10),
      deskew: this.dom.deskewCheckbox.checked,
    };

    this.dom.rescanBtn.disabled = true;
    this.dom.archiveBtn.disabled = true;
    this._showProgress(true, 'جاري إعادة المسح الضوئي والاحتفاظ بالنسخة السابقة...', 1);

    try {
      const res = await window.api.scanStage(payload);
      if (res.error) throw new Error(res.error);

      const task = await window.api.pollTask(res.task_id, (t) => {
        this._showProgress(true, t.message || 'جاري المسح...', t.step || 1);
      });

      if (task.status === 'STAGED_READY' && task.result) {
        // Discard old staged file now that new one succeeded
        await window.api.discardStaged(oldFilename);

        this.stagedDoc = task.result;
        this._showProgress(false);

        // Load preview and validate new staged document
        await this.loadAndValidatePreview();
      } else {
        throw new Error(task.error || 'فشلت إعادة المسح.');
      }
    } catch (err) {
      this._showProgress(false);
      this.stagedDoc = previousDoc;
      alert(`فشلت إعادة المسح (تم الاحتفاظ بالوثيقة السابقة):\n${err.message}`);
      await this.loadAndValidatePreview();
    } finally {
      this.dom.rescanBtn.disabled = false;
    }
  }

  /**
   * STAGE B: Explicit Archive action.
   * Validates staged document, submits to Native Engine, tracks OCR, and opens document.
   */
  async executeStageBArchive() {
    if (!this.stagedDoc || !this.stagedDoc.filename) {
      alert('لا توجد وثيقة صالحة للأرشفة حالياً.');
      return;
    }

    // Validate before submitting to archive
    if (window.nasArchive && window.nasArchive.staging) {
      try {
        const v = await window.nasArchive.staging.validate(this.stagedDoc.filename);
        if (!v.valid) {
          this.dom.archiveBtn.disabled = true;
          alert(`تعذر أرشفة الوثيقة:\n${v.error || 'المستند غير صالح أو تالف'}`);
          return;
        }
      } catch (valErr) {
        // Continue to server validation
      }
    }

    const payload = {
      filename: this.stagedDoc.filename,
      section: this.selectedDepartment,
      allow_duplicate: this.dom.duplicateCheckbox.checked,
    };

    this.dom.rescanBtn.disabled = true;
    this.dom.archiveBtn.disabled = true;
    this._showProgress(true, 'جاري التحقق وحفظ الأصل بالأرشيف وفحص البصمة...', 3);

    try {
      const res = await window.api.scanArchive(payload);
      if (res.error) throw new Error(res.error);

      const task = await window.api.pollTask(res.task_id, (t) => {
        const step = t.step || 3;
        this._showProgress(true, t.message || 'جاري الأرشفة والمعالجة...', step);
      });

      if (task.status === 'DUPLICATE') {
        this._showProgress(false);
        const confirmDup = confirm(
          'تنبيه التكرار:\nالوثيقة ممسوحة مسبقاً بنفس البصمة الرقمية.\nهل ترغب في تجاوز التكرار وأرشفتها على أي حال؟'
        );
        if (confirmDup) {
          this.dom.duplicateCheckbox.checked = true;
          return this.executeStageBArchive();
        }
        return;
      }

      if (task.status === 'SUCCESS' && task.result) {
        this._showProgress(true, 'تمت الأرشفة وفهرسة الـ OCR بنجاح!', 5);

        // Reset workspace state
        setTimeout(() => {
          this._showProgress(false);
          this.stagedDoc = null;
          this.pdfViewer.clear();
          this.dom.initialActions.style.display = 'block';
          this.dom.twoStageActions.classList.remove('visible');

          // Navigate to Documents and open details
          if (window.appRouter) {
            window.appRouter.navigate('documents');
            if (window.documentsController && task.result.document_id) {
              window.documentsController.refreshAndOpen(task.result.document_id);
            }
          }
        }, 1200);
      } else {
        throw new Error(task.error || 'تعذر إتمام الأرشفة.');
      }
    } catch (err) {
      this._showProgress(false);
      alert(`خطأ أثناء الأرشفة في Paperless:\n${err.message}`);
    } finally {
      this.dom.rescanBtn.disabled = false;
      this.dom.archiveBtn.disabled = false;
    }
  }

  _showProgress(show, message = '', activeStep = 1) {
    if (!this.dom.progressCard) return;
    if (show) {
      this.dom.progressCard.classList.add('active');
      if (this.dom.progressMsg) this.dom.progressMsg.textContent = message;

      this.dom.progressSteps.forEach((st, idx) => {
        const stepNum = idx + 1;
        st.classList.remove('active', 'completed');
        if (stepNum < activeStep) {
          st.classList.add('completed');
        } else if (stepNum === activeStep) {
          st.classList.add('active');
        }
      });
    } else {
      this.dom.progressCard.classList.remove('active');
    }
  }
}

window.ScannerController = ScannerController;
