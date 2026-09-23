/**
 * NAS Archive — High-Performance Multipage PDF Viewer
 * Built on PDF.js with complete custom toolbar and responsive rendering.
 */

class PdfViewer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.pdfDoc = null;
    this.pageNum = 1;
    this.pageRendering = false;
    this.pageNumPending = null;
    this.scale = 1.0;
    this.rotation = 0;
    this.autoFit = 'width'; // 'width', 'page', or null

    this.onPageChange = options.onPageChange || null;
    this.onLoadComplete = options.onLoadComplete || null;

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview-canvas';
    this.ctx = this.canvas.getContext('2d');
  }

  async loadDocument(urlOrData, retryCallback = null) {
    this.lastSource = urlOrData;
    this.lastRetryCallback = retryCallback;

    if (!window.pdfjsLib) {
      console.error('PDF.js library not loaded.');
      this._showError('مكتبة عرض PDF غير محملة على النظام.', retryCallback);
      return;
    }

    try {
      this._showLoading(true);

      let docParam = urlOrData;
      // Handle base64 string
      if (typeof urlOrData === 'string' && !urlOrData.startsWith('http://') && !urlOrData.startsWith('https://') && !urlOrData.startsWith('data:')) {
        try {
          const binaryStr = atob(urlOrData);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          docParam = { data: bytes };
        } catch (b64Err) {
          docParam = urlOrData;
        }
      } else if (urlOrData instanceof Uint8Array || urlOrData instanceof ArrayBuffer) {
        docParam = { data: urlOrData };
      }

      const loadingTask = window.pdfjsLib.getDocument(docParam);
      this.pdfDoc = await loadingTask.promise;
      this.pageNum = 1;
      this.rotation = 0;
      this._showLoading(false);

      if (this.onLoadComplete) {
        this.onLoadComplete({ totalPages: this.pdfDoc.numPages });
      }

      await this.renderPage(this.pageNum);
    } catch (error) {
      this._showLoading(false);
      console.error('PdfViewer load error:', error);
      const msg = error.message || 'فشل تحميل ملف المعاينة';
      this._showError(msg, retryCallback);
    }
  }

  async renderPage(num) {
    if (!this.pdfDoc) return;
    this.pageRendering = true;

    try {
      const page = await this.pdfDoc.getPage(num);

      // Determine viewport scale based on container width or fit
      const unscaledViewport = page.getViewport({ scale: 1.0, rotation: this.rotation });
      if (this.autoFit === 'width' && this.container) {
        const availableWidth = Math.max(300, this.container.clientWidth - 48);
        this.scale = availableWidth / unscaledViewport.width;
      } else if (this.autoFit === 'page' && this.container) {
        const availableHeight = Math.max(400, this.container.clientHeight - 48);
        this.scale = availableHeight / unscaledViewport.height;
      }

      const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });
      const pixelRatio = window.devicePixelRatio || 1;

      this.canvas.height = viewport.height * pixelRatio;
      this.canvas.width = viewport.width * pixelRatio;
      this.canvas.style.height = `${viewport.height}px`;
      this.canvas.style.width = `${viewport.width}px`;

      this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // Render to canvas
      const renderContext = {
        canvasContext: this.ctx,
        viewport: viewport,
      };

      const renderTask = page.render(renderContext);
      await renderTask.promise;

      this.pageRendering = false;
      this._ensureCanvasAttached();

      if (this.pageNumPending !== null) {
        const pending = this.pageNumPending;
        this.pageNumPending = null;
        this.renderPage(pending);
      }

      if (this.onPageChange) {
        this.onPageChange({
          currentPage: num,
          totalPages: this.pdfDoc.numPages,
          zoom: Math.round(this.scale * 100),
        });
      }
    } catch (e) {
      this.pageRendering = false;
    }
  }

  queueRenderPage(num) {
    if (this.pageRendering) {
      this.pageNumPending = num;
    } else {
      this.renderPage(num);
    }
  }

  prevPage() {
    if (this.pageNum <= 1) return;
    this.pageNum--;
    this.queueRenderPage(this.pageNum);
  }

  nextPage() {
    if (!this.pdfDoc || this.pageNum >= this.pdfDoc.numPages) return;
    this.pageNum++;
    this.queueRenderPage(this.pageNum);
  }

  goToPage(num) {
    if (!this.pdfDoc) return;
    const target = Math.max(1, Math.min(this.pdfDoc.numPages, num));
    this.pageNum = target;
    this.queueRenderPage(this.pageNum);
  }

  zoomIn() {
    this.autoFit = null;
    this.scale = Math.min(3.0, this.scale * 1.2);
    this.queueRenderPage(this.pageNum);
  }

  zoomOut() {
    this.autoFit = null;
    this.scale = Math.max(0.4, this.scale / 1.2);
    this.queueRenderPage(this.pageNum);
  }

  fitToWidth() {
    this.autoFit = 'width';
    this.queueRenderPage(this.pageNum);
  }

  fitToPage() {
    this.autoFit = 'page';
    this.queueRenderPage(this.pageNum);
  }

  rotateClockwise() {
    this.rotation = (this.rotation + 90) % 360;
    this.queueRenderPage(this.pageNum);
  }

  clear() {
    this.pdfDoc = null;
    this.pageNum = 1;
    this.rotation = 0;
    if (this.container) {
      this.container.innerHTML = `
        <div class="preview-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <div style="font-weight: 600; font-size: 15px;">جاهز للمعاينة الفورية</div>
          <div style="font-size: 13px;">قم ببدء مسح ضوئي جديد أو سحب ملف لعرضه هنا بدقة كاملة</div>
        </div>
      `;
    }
  }

  _ensureCanvasAttached() {
    if (!this.container) return;
    const existing = this.container.querySelector('.preview-canvas');
    if (!existing) {
      this.container.innerHTML = '';
      this.container.appendChild(this.canvas);
    }
  }

  _showLoading(show) {
    if (!this.container) return;
    let loader = this.container.querySelector('.preview-loading');
    if (show) {
      if (!loader) {
        loader = document.createElement('div');
        loader.className = 'preview-loading';
        loader.style.cssText = 'position:absolute;inset:0;background:rgba(15,23,42,0.8);display:flex;align-items:center;justify-content:center;color:#10b981;font-weight:600;font-size:14px;z-index:20;';
        loader.textContent = 'جاري تحضير ومعالجة المعاينة...';
        this.container.appendChild(loader);
      }
    } else if (loader) {
      loader.remove();
    }
  }

  _showError(msg, retryCallback = null) {
    if (!this.container) return;
    const cleanMsg = (typeof msg === 'string')
      ? msg.replace(/^Missing PDF ".*"$/, 'تعذر تحميل ملف المعاينة (الملف غير متاح أو تالف).')
      : 'فشل تحميل ملف المعاينة';

    const effectiveRetry = retryCallback || this.lastRetryCallback;

    this.container.innerHTML = `
      <div class="preview-empty-state" style="color: #ef4444; padding: 24px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 48px; height: 48px; margin-bottom: 12px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px;">تعذر عرض المعاينة</div>
        <div style="font-size: 13px; color: #94a3b8; max-width: 320px; line-height: 1.5; margin-bottom: 16px;">${cleanMsg}</div>
        ${effectiveRetry ? `
          <button id="btnRetryPreviewAction" class="btn btn-secondary" style="font-size: 13px; padding: 6px 16px; border: 1px solid #475569; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border-radius: 6px; background: rgba(30, 41, 59, 0.8); color: #f8fafc;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 14px; height: 14px;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <span>إعادة محاولة المعاينة</span>
          </button>
        ` : ''}
      </div>
    `;

    if (effectiveRetry) {
      const btn = this.container.querySelector('#btnRetryPreviewAction');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          effectiveRetry();
        });
      }
    }
  }
}

window.PdfViewer = PdfViewer;
