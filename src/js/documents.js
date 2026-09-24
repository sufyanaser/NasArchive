/**
 * NAS Archive — Unified Document Management Controller
 * Replaces Paperless frontend with a native, NAS-branded Arabic experience.
 * Features: Grid/List views, department filters, live search, metadata editor,
 * PDF preview, approval workflow, and download/delete operations.
 */

class DocumentsController {
  constructor() {
    this.documents = [];
    this.totalCount = 0;
    this.currentDepartment = 'الكل';
    this.searchQuery = '';
    this.viewMode = 'grid'; // 'grid' or 'list'
    this.tagsMap = {};
    this.docTypesMap = {};
    this.customFields = [];
    this.activeDocument = null;
    this.modalPdfViewer = null;

    this.dom = {
      container: document.getElementById('docsContainer'),
      grid: document.getElementById('docsGrid'),
      list: document.getElementById('docsList'),
      countBadge: document.getElementById('docsCountBadge'),
      filterPills: document.querySelectorAll('.department-filter-pills .filter-pill'),
      searchInput: document.getElementById('docsSearchInput'),
      viewGridBtn: document.getElementById('btnViewGrid'),
      viewListBtn: document.getElementById('btnViewList'),
      sortSelect: document.getElementById('docsSortSelect'),

      // Modal
      modal: document.getElementById('docDetailModal'),
      modalTitle: document.getElementById('modalDocTitle'),
      modalCloseBtn: document.getElementById('modalCloseBtn'),
      modalSaveBtn: document.getElementById('modalSaveBtn'),
      modalApproveBtn: document.getElementById('modalApproveBtn'),
      modalDownloadBtn: document.getElementById('modalDownloadBtn'),
      modalDeleteBtn: document.getElementById('modalDeleteBtn'),

      // Modal Form
      inputTitle: document.getElementById('editDocTitle'),
      selectDocType: document.getElementById('editDocType'),
      deptTagsContainer: document.getElementById('editDocDeptTags'),
      customFieldsContainer: document.getElementById('editDocCustomFields'),
      ocrContentBox: document.getElementById('modalOcrContent'),
    };
  }

  async init() {
    // Modal PDF Viewer
    this.modalPdfViewer = new window.PdfViewer('modalPdfViewport', {
      onPageChange: ({ currentPage, totalPages }) => {
        const ind = document.getElementById('modalPageIndicator');
        if (ind) ind.textContent = `${currentPage} من ${totalPages}`;
      },
    });

    this._bindEvents();
    await this.loadMetadata();
    await this.fetchDocuments();
  }

  _bindEvents() {
    // Department Filter Pills
    this.dom.filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.dom.filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentDepartment = pill.dataset.department || 'الكل';
        this.fetchDocuments();
      });
    });

    // Search Input (debounce)
    let searchTimeout = null;
    this.dom.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.searchQuery = e.target.value.trim();
        this.fetchDocuments();
      }, 350);
    });

    // View Mode Toggle
    if (this.dom.viewGridBtn) {
      this.dom.viewGridBtn.addEventListener('click', () => {
        this.viewMode = 'grid';
        this.dom.viewGridBtn.classList.add('active');
        this.dom.viewListBtn.classList.remove('active');
        this.renderDocuments();
      });
    }
    if (this.dom.viewListBtn) {
      this.dom.viewListBtn.addEventListener('click', () => {
        this.viewMode = 'list';
        this.dom.viewListBtn.classList.add('active');
        this.dom.viewGridBtn.classList.remove('active');
        this.renderDocuments();
      });
    }

    // Modal Events
    this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());
    this.dom.modalSaveBtn.addEventListener('click', () => this.saveDocumentChanges());
    this.dom.modalApproveBtn.addEventListener('click', () => this.approveDocument());
    this.dom.modalDownloadBtn.addEventListener('click', () => this.downloadActiveDocument());
    this.dom.modalDeleteBtn.addEventListener('click', () => this.deleteActiveDocument());

    // Modal Toolbar Navigation
    const prev = document.getElementById('modalBtnPrev');
    const next = document.getElementById('modalBtnNext');
    const zoomIn = document.getElementById('modalBtnZoomIn');
    const zoomOut = document.getElementById('modalBtnZoomOut');
    const rotate = document.getElementById('modalBtnRotate');

    if (prev) prev.addEventListener('click', () => this.modalPdfViewer.prevPage());
    if (next) next.addEventListener('click', () => this.modalPdfViewer.nextPage());
    if (zoomIn) zoomIn.addEventListener('click', () => this.modalPdfViewer.zoomIn());
    if (zoomOut) zoomOut.addEventListener('click', () => this.modalPdfViewer.zoomOut());
    if (rotate) rotate.addEventListener('click', () => this.modalPdfViewer.rotateClockwise());
  }

  async loadMetadata() {
    try {
      const [tagsRes, typesRes, fieldsRes] = await Promise.all([
        window.api.getTags(),
        window.api.getDocumentTypes(),
        window.api.getCustomFields(),
      ]);

      if (tagsRes && tagsRes.results) {
        tagsRes.results.forEach((t) => { this.tagsMap[t.id] = t; });
      }
      if (typesRes && typesRes.results) {
        typesRes.results.forEach((dt) => { this.docTypesMap[dt.id] = dt; });
      }
      if (fieldsRes && fieldsRes.results) {
        this.customFields = fieldsRes.results;
      }
    } catch (e) {
      console.warn('Metadata loading warning:', e);
    }
  }

  async fetchDocuments() {
    const params = {
      ordering: '-created',
      page_size: 50,
    };

    if (this.searchQuery) {
      params['query'] = this.searchQuery;
    }

    if (this.currentDepartment !== 'الكل') {
      params['department'] = this.currentDepartment;
      // Find tag ID for selected department
      const tagEntry = Object.values(this.tagsMap).find((t) => t.name === this.currentDepartment);
      if (tagEntry) {
        params['tags__id__in'] = tagEntry.id;
      }
    }

    try {
      const data = await window.api.getDocuments(params);
      this.documents = data.results || [];
      this.totalCount = data.count || 0;
      if (this.dom.countBadge) {
        this.dom.countBadge.textContent = `${this.totalCount} وثيقة`;
      }
      this.renderDocuments();
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      if (this.dom.grid) {
        this.dom.grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ef4444;">
            تعذر تحميل المستندات من Paperless. يرجى التحقق من حالة الاتصال.
          </div>
        `;
      }
    }
  }

  renderDocuments() {
    if (!this.dom.grid) return;

    if (this.documents.length === 0) {
      this.dom.grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-muted);">
          <svg style="width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
          </svg>
          <div style="font-weight: 600; font-size: 15px;">لا توجد وثائق مطابقة للبحث</div>
          <div style="font-size: 13px; margin-top: 4px;">جرب تغيير القسم أو تصفية البحث</div>
        </div>
      `;
      return;
    }

    this.dom.grid.innerHTML = '';
    this.documents.forEach((doc) => {
      const card = document.createElement('div');
      card.className = 'doc-card';

      // Find department tag
      const deptTag = doc.tags.map((id) => this.tagsMap[id]).find((t) => t && ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name));
      const deptName = deptTag ? deptTag.name : 'عام';

      const isPending = doc.tags.some((id) => this.tagsMap[id] && this.tagsMap[id].name === 'بانتظار المراجعة');
      const thumbUrl = `http://127.0.0.1:8000/api/documents/${doc.id}/thumb/`;

      const createdDate = doc.created ? new Date(doc.created).toLocaleDateString('ar-IQ') : '—';
      const pageCount = doc.page_count || 1;

      card.innerHTML = `
        <div class="doc-thumb-container">
          <img src="${thumbUrl}" alt="Thumbnail" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22><path d=%22M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z%22/><polyline points=%2214 2 14 8 20 8%22/></svg>'">
          <div class="doc-badge-dept">${deptName}</div>
          ${isPending ? '<div style="position: absolute; bottom: 8px; right: 8px; background: #f59e0b; color: #0f172a; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700;">بانتظار المراجعة</div>' : ''}
        </div>
        <div class="doc-info">
          <div class="doc-title" title="${doc.title}">${doc.title}</div>
          <div class="doc-meta-row">
            <span>${pageCount} ${pageCount === 1 ? 'صفحة' : 'صفحات'}</span>
            <span class="ltr">${createdDate}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => this.openDocumentModal(doc));
      this.dom.grid.appendChild(card);
    });
  }

  async openDocumentModal(doc) {
    this.activeDocument = doc;
    this.dom.modalTitle.textContent = doc.title;
    this.dom.inputTitle.value = doc.title;

    // Document types
    this.dom.selectDocType.innerHTML = '<option value="">(غير محدد)</option>';
    Object.values(this.docTypesMap).forEach((dt) => {
      const opt = document.createElement('option');
      opt.value = dt.id;
      opt.textContent = dt.name;
      if (doc.document_type === dt.id) opt.selected = true;
      this.dom.selectDocType.appendChild(opt);
    });

    // Department tags
    this.dom.deptTagsContainer.innerHTML = '';
    ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].forEach((dName) => {
      const tagEntry = Object.values(this.tagsMap).find((t) => t.name === dName);
      if (!tagEntry) return;

      const hasTag = doc.tags.includes(tagEntry.id);
      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = `filter-pill ${hasTag ? 'active' : ''}`;
      tagBtn.textContent = dName;
      tagBtn.addEventListener('click', () => {
        // Toggle single department
        this.dom.deptTagsContainer.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
        tagBtn.classList.add('active');
      });
      this.dom.deptTagsContainer.appendChild(tagBtn);
    });

    // Custom Fields
    this.dom.customFieldsContainer.innerHTML = '';
    const docFields = doc.custom_fields || [];
    this.customFields.forEach((cf) => {
      const existingVal = docFields.find((f) => f.field === cf.id);
      const valStr = existingVal ? existingVal.value : '';

      const group = document.createElement('div');
      group.className = 'form-group';
      group.innerHTML = `
        <label class="field-label">${cf.name}</label>
        <input type="text" class="form-input custom-field-input" data-field-id="${cf.id}" value="${valStr || ''}" placeholder="أدخل ${cf.name}...">
      `;
      this.dom.customFieldsContainer.appendChild(group);
    });

    // OCR Content
    if (this.dom.ocrContentBox) {
      this.dom.ocrContentBox.textContent = doc.content || '(لا يوجد نص مستخرج)';
    }

    // Pending review button visibility
    const isPending = doc.tags.some((id) => this.tagsMap[id] && this.tagsMap[id].name === 'بانتظار المراجعة');
    if (this.dom.modalApproveBtn) {
      this.dom.modalApproveBtn.style.display = isPending ? 'flex' : 'none';
    }

    // Open Modal
    this.dom.modal.classList.add('open');

    // Load PDF Preview into modal viewer via Native IPC or URL fallback
    if (window.nasArchive && window.nasArchive.documents && window.nasArchive.documents.readBinary) {
      try {
        const bin = await window.nasArchive.documents.readBinary(doc.id);
        if (bin.success && bin.base64) {
          await this.modalPdfViewer.loadDocument(bin.base64);
          return;
        }
      } catch (ipcErr) {
        console.warn('IPC readBinary fallback:', ipcErr);
      }
    }
    const previewUrl = `http://127.0.0.1:8000/api/documents/${doc.id}/preview/`;
    await this.modalPdfViewer.loadDocument(previewUrl);
  }

  closeModal() {
    this.dom.modal.classList.remove('open');
    this.activeDocument = null;
    this.modalPdfViewer.clear();
  }

  async saveDocumentChanges() {
    if (!this.activeDocument) return;

    // Selected department tag
    const selectedPill = this.dom.deptTagsContainer.querySelector('.filter-pill.active');
    const selectedDeptName = selectedPill ? selectedPill.textContent.trim() : null;

    let updatedTags = [...this.activeDocument.tags];
    // Remove other department tags
    const deptTagIds = Object.values(this.tagsMap)
      .filter((t) => ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name))
      .map((t) => t.id);

    updatedTags = updatedTags.filter((id) => !deptTagIds.includes(id));
    if (selectedDeptName) {
      const newDept = Object.values(this.tagsMap).find((t) => t.name === selectedDeptName);
      if (newDept) updatedTags.push(newDept.id);
    }

    // Gather custom fields
    const updatedCustomFields = [];
    this.dom.customFieldsContainer.querySelectorAll('.custom-field-input').forEach((inp) => {
      const fieldId = parseInt(inp.dataset.fieldId, 10);
      const val = inp.value.trim();
      if (val) {
        updatedCustomFields.push({ field: fieldId, value: val });
      }
    });

    const patchData = {
      title: this.dom.inputTitle.value.trim() || this.activeDocument.title,
      document_type: this.dom.selectDocType.value ? parseInt(this.dom.selectDocType.value, 10) : null,
      tags: updatedTags,
      custom_fields: updatedCustomFields,
    };

    try {
      this.dom.modalSaveBtn.disabled = true;
      const updated = await window.api.updateDocument(this.activeDocument.id, patchData);
      this.activeDocument = updated;
      alert('تم حفظ التعديلات بنجاح.');
      await this.fetchDocuments();
    } catch (e) {
      alert(`خطأ أثناء حفظ التعديلات:\n${e.message}`);
    } finally {
      this.dom.modalSaveBtn.disabled = false;
    }
  }

  async approveDocument() {
    if (!this.activeDocument) return;

    // Remove pending review tag (ID where name is 'بانتظار المراجعة')
    const pendingTag = Object.values(this.tagsMap).find((t) => t.name === 'بانتظار المراجعة');
    if (!pendingTag) return;

    const newTags = this.activeDocument.tags.filter((id) => id !== pendingTag.id);

    try {
      this.dom.modalApproveBtn.disabled = true;
      await window.api.updateDocument(this.activeDocument.id, { tags: newTags });
      this.activeDocument.tags = newTags;
      this.dom.modalApproveBtn.style.display = 'none';
      alert('تم اعتماد الوثيقة وإلغاء حالة الانتظار بنجاح.');
      await this.fetchDocuments();
    } catch (e) {
      alert(`فشل اعتماد الوثيقة:\n${e.message}`);
    } finally {
      this.dom.modalApproveBtn.disabled = false;
    }
  }

  async downloadActiveDocument() {
    if (!this.activeDocument) return;
    if (window.nasArchive && window.nasArchive.documents && window.nasArchive.documents.exportFile) {
      try {
        const res = await window.nasArchive.documents.exportFile(this.activeDocument.id);
        if (res.success && res.savedPath) {
          alert(`تم حفظ المستند بنجاح في:\n${res.savedPath}`);
          return;
        }
      } catch (ipcErr) {
        console.warn('Native export fallback:', ipcErr);
      }
    }
    const downloadUrl = `http://127.0.0.1:8000/api/documents/${this.activeDocument.id}/download/`;
    window.open(downloadUrl, '_blank');
  }

  async deleteActiveDocument() {
    if (!this.activeDocument) return;
    const ok = confirm(`هل أنت متأكد من حذف الوثيقة نهائياً؟\n"${this.activeDocument.title}"`);
    if (!ok) return;

    try {
      await window.api.deleteDocument(this.activeDocument.id);
      this.closeModal();
      alert('تم حذف الوثيقة بنجاح.');
      await this.fetchDocuments();
    } catch (e) {
      alert(`فشل حذف الوثيقة:\n${e.message}`);
    }
  }

  async refreshAndOpen(docId) {
    await this.fetchDocuments();
    const target = this.documents.find((d) => d.id === docId);
    if (target) {
      this.openDocumentModal(target);
    }
  }
}

window.DocumentsController = DocumentsController;
