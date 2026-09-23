/**
 * NAS Archive — Manual Document Import Controller
 * Drag & drop and native file picker with Two-Stage staging and preview.
 */

class ImportController {
  constructor() {
    this.stagedDoc = null;
    this.pdfViewer = null;
    this.selectedDepartment = 'شخصي';

    this.dom = {
      dropzone: document.getElementById('importDropzone'),
      fileInput: document.getElementById('importFileInput'),
      browseBtn: document.getElementById('btnBrowseFile'),
      deptCards: document.querySelectorAll('#importDeptGrid .department-card'),

      initialControls: document.getElementById('importInitialControls'),
      stagedControls: document.getElementById('importStagedControls'),
      fileNameLabel: document.getElementById('importFileNameLabel'),
      fileSizeLabel: document.getElementById('importFileSizeLabel'),
      archiveBtn: document.getElementById('btnArchiveImport'),
      cancelBtn: document.getElementById('btnCancelImport'),
      duplicateCheckbox: document.getElementById('importDuplicateCheckbox'),

      progressCard: document.getElementById('importProgressCard'),
      progressMsg: document.getElementById('importProgressMsg'),
    };
  }

  async init() {
    this.pdfViewer = new window.PdfViewer('importPdfViewport', {
      onPageChange: ({ currentPage, totalPages }) => {
        const ind = document.getElementById('importPageIndicator');
        if (ind) ind.textContent = `${currentPage} من ${totalPages}`;
      },
    });

    this._bindEvents();
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

    // File Picker Button
    this.dom.browseBtn.addEventListener('click', async () => {
      if (window.nasArchive && window.nasArchive.dialog) {
        // Native desktop file dialog
        const res = await window.nasArchive.dialog.selectFile();
        if (res) {
          await this.stageFile(res.name, res.base64);
        }
      } else {
        this.dom.fileInput.click();
      }
    });

    this.dom.fileInput.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = reader.result.split(',')[1];
          await this.stageFile(file.name, b64);
        };
        reader.readAsDataURL(file);
      }
    });

    // Drag & Drop
    const dz = this.dom.dropzone;
    ['dragenter', 'dragover'].forEach((eventName) => {
      dz.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dz.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('dragover');
      });
    });

    dz.addEventListener('drop', async (e) => {
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = reader.result.split(',')[1];
          await this.stageFile(file.name, b64);
        };
        reader.readAsDataURL(file);
      }
    });

    // Archive and Cancel
    this.dom.archiveBtn.addEventListener('click', () => this.executeArchive());
    this.dom.cancelBtn.addEventListener('click', () => this.cancelStagedFile());

    // Toolbar navigation
    const prev = document.getElementById('importBtnPrev');
    const next = document.getElementById('importBtnNext');
    const zoomIn = document.getElementById('importBtnZoomIn');
    const zoomOut = document.getElementById('importBtnZoomOut');
    const rotate = document.getElementById('importBtnRotate');

    if (prev) prev.addEventListener('click', () => this.pdfViewer.prevPage());
    if (next) next.addEventListener('click', () => this.pdfViewer.nextPage());
    if (zoomIn) zoomIn.addEventListener('click', () => this.pdfViewer.zoomIn());
    if (zoomOut) zoomOut.addEventListener('click', () => this.pdfViewer.zoomOut());
    if (rotate) rotate.addEventListener('click', () => this.pdfViewer.rotateClockwise());
  }

  async stageFile(filename, base64Data) {
    this._showProgress(true, 'جاري فحص الملف وتجهيز المعاينة...');

    try {
      const res = await window.api.importStage(filename, base64Data, this.selectedDepartment);
      if (res.error) throw new Error(res.error);

      if (res.result) {
        this.stagedDoc = res.result;
        this.dom.fileNameLabel.textContent = filename;
        const kb = Math.round(res.result.size_bytes / 1024);
        this.dom.fileSizeLabel.textContent = `${kb} كيلوبايت`;

        // Load preview
        const previewUrl = `http://127.0.0.1:8001${res.result.preview_url}`;
        await this.pdfViewer.loadDocument(previewUrl);

        this.dom.initialControls.style.display = 'none';
        this.dom.stagedControls.style.display = 'flex';
      }
    } catch (err) {
      alert(`فشل استيراد الملف للمعاينة:\n${err.message}`);
    } finally {
      this._showProgress(false);
    }
  }

  async executeArchive() {
    if (!this.stagedDoc) return;

    this.dom.archiveBtn.disabled = true;
    this.dom.cancelBtn.disabled = true;
    this._showProgress(true, 'جاري ترحيل الوثيقة والأرشفة في Paperless...');

    try {
      const payload = {
        filename: this.stagedDoc.filename,
        section: this.selectedDepartment,
        allow_duplicate: this.dom.duplicateCheckbox.checked,
      };

      const res = await window.api.scanArchive(payload);
      if (res.error) throw new Error(res.error);

      const task = await window.api.pollTask(res.task_id, (t) => {
        this._showProgress(true, t.message || 'جاري الأرشفة والـ OCR...');
      });

      if (task.status === 'DUPLICATE') {
        this._showProgress(false);
        const confirmDup = confirm('تنبيه: تم أرشفت هذا الملف مسبقاً بنفس البصمة الرقمية. هل تريد تجاوزه والأرشفة؟');
        if (confirmDup) {
          this.dom.duplicateCheckbox.checked = true;
          return this.executeArchive();
        }
        return;
      }

      if (task.status === 'SUCCESS' && task.result) {
        this._showProgress(true, 'تمت أرشفة الوثيقة وفهرستها بنجاح!');
        setTimeout(() => {
          this.cancelStagedFile();
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
      alert(`خطأ أثناء أرشفة الملف:\n${err.message}`);
    } finally {
      this.dom.archiveBtn.disabled = false;
      this.dom.cancelBtn.disabled = false;
      this._showProgress(false);
    }
  }

  async cancelStagedFile() {
    if (this.stagedDoc && this.stagedDoc.filename) {
      try {
        await window.api.discardStaged(this.stagedDoc.filename);
      } catch (e) {
        // ignore
      }
    }
    this.stagedDoc = null;
    this.pdfViewer.clear();
    this.dom.fileInput.value = '';
    this.dom.initialControls.style.display = 'block';
    this.dom.stagedControls.style.display = 'none';
    this._showProgress(false);
  }

  _showProgress(show, message = '') {
    if (!this.dom.progressCard) return;
    this.dom.progressCard.style.display = show ? 'block' : 'none';
    if (this.dom.progressMsg) this.dom.progressMsg.textContent = message;
  }
}

window.ImportController = ImportController;
