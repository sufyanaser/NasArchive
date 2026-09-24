/**
 * NAS Archive — Unified Document Management Controller (Restored & Enhanced)
 * Provides comprehensive document management, full-parity Paperless functionality:
 * Grid/Table/List views, bulk selection & actions, multi-filter bar with active chips,
 * saved views, sorting, pagination, and split-screen document editor with auto-close on save.
 */

class DocumentsController {
  constructor() {
    this.documents = [];
    this.totalCount = 0;
    this.selectedDocIds = new Set();
    this.viewMode = 'grid'; // 'grid' | 'table' | 'list'

    // Filtering State
    this.currentDepartment = 'الكل';
    this.searchQuery = '';
    this.selectedTagId = null;
    this.selectedCorrespondentId = null;
    this.selectedDocTypeId = null;
    this.selectedStoragePathId = null;
    this.selectedDateRange = 'all';
    this.selectedApprovalStatus = 'all'; // 'all' | 'approved' | 'pending'
    this.currentSort = '-created';
    this.currentPage = 1;
    this.pageSize = 50;

    // Metadata Caches
    this.tagsMap = {};
    this.docTypesMap = {};
    this.correspondentsMap = {};
    this.storagePathsMap = {};
    this.customFields = [];

    // Active Edit State
    this.activeDocument = null;
    this.originalEditState = null;
    this.modalPdfViewer = null;

    this.dom = {};
  }

  async init() {
    this._cacheDom();
    this._initModalPdfViewer();
    this._bindEvents();
    await this.loadMetadata();
    await this.populateSavedViewsDropdown();
    await this.fetchDocuments();
  }

  _cacheDom() {
    this.dom = {
      // Main containers
      viewSection: document.getElementById('viewDocuments'),
      container: document.getElementById('docsContainer'),
      grid: document.getElementById('docsGrid'),
      tableContainer: document.getElementById('docsTableContainer'),
      tableBody: document.getElementById('docsTableBody'),
      listContainer: document.getElementById('docsListContainer'),
      countBadge: document.getElementById('docsCountBadge'),

      // Search & Filters
      searchInput: document.getElementById('docsSearchInput'),
      filterPills: document.querySelectorAll('.department-filter-pills .filter-pill'),
      activeFilterChips: document.getElementById('activeFilterChips'),
      btnResetFilters: document.getElementById('btnResetFilters'),

      // Filter Dropdowns
      filterTagsBtn: document.getElementById('btnFilterTags'),
      filterTagsMenu: document.getElementById('menuFilterTags'),
      filterCorrBtn: document.getElementById('btnFilterCorr'),
      filterCorrMenu: document.getElementById('menuFilterCorr'),
      filterTypeBtn: document.getElementById('btnFilterType'),
      filterTypeMenu: document.getElementById('menuFilterType'),
      filterPathBtn: document.getElementById('btnFilterPath'),
      filterPathMenu: document.getElementById('menuFilterPath'),
      filterDatesBtn: document.getElementById('btnFilterDates'),
      filterDatesMenu: document.getElementById('menuFilterDates'),
      filterStatusBtn: document.getElementById('btnFilterStatus'),
      filterStatusMenu: document.getElementById('menuFilterStatus'),

      // View Controls
      viewGridBtn: document.getElementById('btnViewGrid'),
      viewTableBtn: document.getElementById('btnViewTable'),
      viewListBtn: document.getElementById('btnViewList'),
      sortSelect: document.getElementById('docsSortSelect'),
      savedViewsSelect: document.getElementById('savedViewsSelect'),
      btnSaveCurrentView: document.getElementById('btnSaveCurrentView'),

      // Bulk Action Bar
      bulkBar: document.getElementById('bulkActionsBar'),
      bulkCountLabel: document.getElementById('bulkSelectedCount'),
      btnSelectPage: document.getElementById('btnSelectPage'),
      btnSelectAll: document.getElementById('btnSelectAll'),
      btnClearSelection: document.getElementById('btnClearSelection'),
      btnBulkDelete: document.getElementById('btnBulkDelete'),
      btnBulkApprove: document.getElementById('btnBulkApprove'),
      btnBulkAddTag: document.getElementById('btnBulkAddTag'),

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
      selectCorrespondent: document.getElementById('editDocCorrespondent'),
      selectStoragePath: document.getElementById('editDocStoragePath'),
      deptTagsContainer: document.getElementById('editDocDeptTags'),
      customFieldsContainer: document.getElementById('editDocCustomFields'),
      ocrContentBox: document.getElementById('modalOcrContent'),
    };
  }

  _initModalPdfViewer() {
    this.modalPdfViewer = new window.PdfViewer('modalPdfViewport', {
      onPageChange: ({ currentPage, totalPages }) => {
        const ind = document.getElementById('modalPageIndicator');
        if (ind) ind.textContent = `${currentPage} من ${totalPages}`;
      },
    });
  }

  _bindEvents() {
    // 1. Department Filter Pills
    if (this.dom.filterPills) {
      this.dom.filterPills.forEach((pill) => {
        pill.addEventListener('click', () => {
          this.dom.filterPills.forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          this.currentDepartment = pill.dataset.department || 'الكل';
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }

    // 2. Search Input with debounce
    let searchTimeout = null;
    if (this.dom.searchInput) {
      this.dom.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.searchQuery = e.target.value.trim();
          this.currentPage = 1;
          this.fetchDocuments();
          this._renderFilterChips();
        }, 300);
      });
    }

    // 3. View Mode Toggles
    if (this.dom.viewGridBtn) {
      this.dom.viewGridBtn.addEventListener('click', () => this.setViewMode('grid'));
    }
    if (this.dom.viewTableBtn) {
      this.dom.viewTableBtn.addEventListener('click', () => this.setViewMode('table'));
    }
    if (this.dom.viewListBtn) {
      this.dom.viewListBtn.addEventListener('click', () => this.setViewMode('list'));
    }

    // 4. Sort Dropdown
    if (this.dom.sortSelect) {
      this.dom.sortSelect.addEventListener('change', (e) => {
        this.currentSort = e.target.value;
        this.fetchDocuments();
      });
    }

    // 5. Reset All Filters
    if (this.dom.btnResetFilters) {
      this.dom.btnResetFilters.addEventListener('click', () => this.resetAllFilters());
    }

    // 6. Bulk Selection Controls
    if (this.dom.btnSelectPage) {
      this.dom.btnSelectPage.addEventListener('click', () => this.selectPageDocuments());
    }
    if (this.dom.btnSelectAll) {
      this.dom.btnSelectAll.addEventListener('click', () => this.selectAllDocuments());
    }
    if (this.dom.btnClearSelection) {
      this.dom.btnClearSelection.addEventListener('click', () => this.clearSelection());
    }
    if (this.dom.btnBulkDelete) {
      this.dom.btnBulkDelete.addEventListener('click', () => this.executeBulkDelete());
    }
    if (this.dom.btnBulkApprove) {
      this.dom.btnBulkApprove.addEventListener('click', () => this.executeBulkApprove());
    }
    if (this.dom.btnBulkAddTag) {
      this.dom.btnBulkAddTag.addEventListener('click', () => this.executeBulkAddTag());
    }

    // 7. Modal Controls
    if (this.dom.modalCloseBtn) this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());
    if (this.dom.modalSaveBtn) this.dom.modalSaveBtn.addEventListener('click', () => this.saveDocumentChanges());
    if (this.dom.modalApproveBtn) this.dom.modalApproveBtn.addEventListener('click', () => this.approveDocument());
    if (this.dom.modalDownloadBtn) this.dom.modalDownloadBtn.addEventListener('click', () => this.downloadActiveDocument());
    if (this.dom.modalDeleteBtn) this.dom.modalDeleteBtn.addEventListener('click', () => this.deleteActiveDocument());

    // 8. Modal Viewer Toolbar
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

    // 9. Dropdown menus toggle helper
    this._setupDropdowns();

    // 10. Save current view
    if (this.dom.btnSaveCurrentView) {
      this.dom.btnSaveCurrentView.addEventListener('click', () => this.promptSaveCurrentView());
    }
    if (this.dom.savedViewsSelect) {
      this.dom.savedViewsSelect.addEventListener('change', (e) => {
        if (e.target.value) this.applySavedView(parseInt(e.target.value, 10));
      });
    }
  }

  _setupDropdowns() {
    const dropdowns = [
      { btn: this.dom.filterTagsBtn, menu: this.dom.filterTagsMenu },
      { btn: this.dom.filterCorrBtn, menu: this.dom.filterCorrMenu },
      { btn: this.dom.filterTypeBtn, menu: this.dom.filterTypeMenu },
      { btn: this.dom.filterPathBtn, menu: this.dom.filterPathMenu },
      { btn: this.dom.filterDatesBtn, menu: this.dom.filterDatesMenu },
      { btn: this.dom.filterStatusBtn, menu: this.dom.filterStatusMenu },
    ];

    dropdowns.forEach(({ btn, menu }) => {
      if (!btn || !menu) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('show');
        document.querySelectorAll('.filter-dropdown-menu').forEach((m) => m.classList.remove('show'));
        if (!isOpen) menu.classList.add('show');
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.filter-dropdown-menu').forEach((m) => m.classList.remove('show'));
    });
  }

  async loadMetadata() {
    try {
      const [tagsRes, typesRes, fieldsRes, corrRes, pathsRes] = await Promise.all([
        window.api.getTags(),
        window.api.getDocumentTypes(),
        window.api.getCustomFields(),
        window.api.getCorrespondents(),
        window.api.getStoragePaths(),
      ]);

      this.tagsMap = {};
      if (tagsRes && tagsRes.results) {
        tagsRes.results.forEach((t) => { this.tagsMap[t.id] = t; });
      }

      this.docTypesMap = {};
      if (typesRes && typesRes.results) {
        typesRes.results.forEach((dt) => { this.docTypesMap[dt.id] = dt; });
      }

      this.correspondentsMap = {};
      if (corrRes && corrRes.results) {
        corrRes.results.forEach((c) => { this.correspondentsMap[c.id] = c; });
      }

      this.storagePathsMap = {};
      if (pathsRes && pathsRes.results) {
        pathsRes.results.forEach((sp) => { this.storagePathsMap[sp.id] = sp; });
      }

      this.customFields = fieldsRes && fieldsRes.results ? fieldsRes.results : [];

      this._populateFilterMenus();
    } catch (e) {
      console.warn('Metadata loading warning:', e);
    }
  }

  _populateFilterMenus() {
    // 1. Tags Filter Menu
    if (this.dom.filterTagsMenu) {
      this.dom.filterTagsMenu.innerHTML = `
        <div class="filter-option-item ${!this.selectedTagId ? 'selected' : ''}" data-id="">(كافة العلامات)</div>
        ${Object.values(this.tagsMap).map((t) => `
          <div class="filter-option-item ${this.selectedTagId === t.id ? 'selected' : ''}" data-id="${t.id}">
            <span>${t.name}</span>
            <span style="width:10px;height:10px;border-radius:50%;background:${t.color};display:inline-block;"></span>
          </div>
        `).join('')}
      `;
      this.dom.filterTagsMenu.querySelectorAll('.filter-option-item').forEach((opt) => {
        opt.addEventListener('click', () => {
          this.selectedTagId = opt.dataset.id ? parseInt(opt.dataset.id, 10) : null;
          this.dom.filterTagsBtn.classList.toggle('active', Boolean(this.selectedTagId));
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }

    // 2. Correspondents Filter Menu
    if (this.dom.filterCorrMenu) {
      this.dom.filterCorrMenu.innerHTML = `
        <div class="filter-option-item ${!this.selectedCorrespondentId ? 'selected' : ''}" data-id="">(كافة جهات التراسل)</div>
        ${Object.values(this.correspondentsMap).map((c) => `
          <div class="filter-option-item ${this.selectedCorrespondentId === c.id ? 'selected' : ''}" data-id="${c.id}">${c.name}</div>
        `).join('')}
      `;
      this.dom.filterCorrMenu.querySelectorAll('.filter-option-item').forEach((opt) => {
        opt.addEventListener('click', () => {
          this.selectedCorrespondentId = opt.dataset.id ? parseInt(opt.dataset.id, 10) : null;
          this.dom.filterCorrBtn.classList.toggle('active', Boolean(this.selectedCorrespondentId));
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }

    // 3. Document Types Filter Menu
    if (this.dom.filterTypeMenu) {
      this.dom.filterTypeMenu.innerHTML = `
        <div class="filter-option-item ${!this.selectedDocTypeId ? 'selected' : ''}" data-id="">(كافة أنواع المستندات)</div>
        ${Object.values(this.docTypesMap).map((dt) => `
          <div class="filter-option-item ${this.selectedDocTypeId === dt.id ? 'selected' : ''}" data-id="${dt.id}">${dt.name}</div>
        `).join('')}
      `;
      this.dom.filterTypeMenu.querySelectorAll('.filter-option-item').forEach((opt) => {
        opt.addEventListener('click', () => {
          this.selectedDocTypeId = opt.dataset.id ? parseInt(opt.dataset.id, 10) : null;
          this.dom.filterTypeBtn.classList.toggle('active', Boolean(this.selectedDocTypeId));
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }

    // 4. Storage Paths Filter Menu
    if (this.dom.filterPathMenu) {
      this.dom.filterPathMenu.innerHTML = `
        <div class="filter-option-item ${!this.selectedStoragePathId ? 'selected' : ''}" data-id="">(كافة مسارات التخزين)</div>
        ${Object.values(this.storagePathsMap).map((sp) => `
          <div class="filter-option-item ${this.selectedStoragePathId === sp.id ? 'selected' : ''}" data-id="${sp.id}">${sp.name}</div>
        `).join('')}
      `;
      this.dom.filterPathMenu.querySelectorAll('.filter-option-item').forEach((opt) => {
        opt.addEventListener('click', () => {
          this.selectedStoragePathId = opt.dataset.id ? parseInt(opt.dataset.id, 10) : null;
          this.dom.filterPathBtn.classList.toggle('active', Boolean(this.selectedStoragePathId));
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }

    // 5. Dates Filter Menu
    if (this.dom.filterDatesMenu) {
      this.dom.filterDatesMenu.innerHTML = `
        <div class="filter-option-item ${this.selectedDateRange === 'all' ? 'selected' : ''}" data-range="all">كافة التواريخ</div>
        <div class="filter-option-item ${this.selectedDateRange === 'today' ? 'selected' : ''}" data-range="today">وثائق اليوم</div>
        <div class="filter-option-item ${this.selectedDateRange === 'month' ? 'selected' : ''}" data-range="month">وثائق هذا الشهر</div>
        <div class="filter-option-item ${this.selectedDateRange === 'year' ? 'selected' : ''}" data-range="year">وثائق هذا العام</div>
      `;
      this.dom.filterDatesMenu.querySelectorAll('.filter-option-item').forEach((opt) => {
        opt.addEventListener('click', () => {
          this.selectedDateRange = opt.dataset.range;
          this.dom.filterDatesBtn.classList.toggle('active', this.selectedDateRange !== 'all');
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }

    // 6. Status Filter Menu
    if (this.dom.filterStatusMenu) {
      this.dom.filterStatusMenu.innerHTML = `
        <div class="filter-option-item ${this.selectedApprovalStatus === 'all' ? 'selected' : ''}" data-status="all">كافة الحالات</div>
        <div class="filter-option-item ${this.selectedApprovalStatus === 'pending' ? 'selected' : ''}" data-status="pending">بانتظار المراجعة</div>
        <div class="filter-option-item ${this.selectedApprovalStatus === 'approved' ? 'selected' : ''}" data-status="approved">معتمد للمزامنة</div>
      `;
      this.dom.filterStatusMenu.querySelectorAll('.filter-option-item').forEach((opt) => {
        opt.addEventListener('click', () => {
          this.selectedApprovalStatus = opt.dataset.status;
          this.dom.filterStatusBtn.classList.toggle('active', this.selectedApprovalStatus !== 'all');
          this.fetchDocuments();
          this._renderFilterChips();
        });
      });
    }
  }

  async populateSavedViewsDropdown() {
    if (!this.dom.savedViewsSelect) return;
    try {
      const res = await window.api.getSavedViews();
      const views = res.results || [];
      this.dom.savedViewsSelect.innerHTML = '<option value="">طرق عرض محفوظة...</option>';
      views.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        this.dom.savedViewsSelect.appendChild(opt);
      });
    } catch (e) {
      console.warn('Saved views populate warning:', e);
    }
  }

  async fetchDocuments() {
    const params = {
      ordering: this.currentSort,
      page: this.currentPage,
      page_size: this.pageSize,
    };

    if (this.searchQuery) params.search = this.searchQuery;

    if (this.currentDepartment !== 'الكل') {
      params.department = this.currentDepartment;
    }
    if (this.selectedTagId) {
      params.tag_id = this.selectedTagId;
    }
    if (this.selectedCorrespondentId) {
      params.correspondent_id = this.selectedCorrespondentId;
    }
    if (this.selectedDocTypeId) {
      params.document_type_id = this.selectedDocTypeId;
    }
    if (this.selectedStoragePathId) {
      params.storage_path_id = this.selectedStoragePathId;
    }

    // Date range filters
    const now = new Date();
    if (this.selectedDateRange === 'today') {
      params.date_from = now.toISOString().slice(0, 10);
    } else if (this.selectedDateRange === 'month') {
      params.date_from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (this.selectedDateRange === 'year') {
      params.date_from = `${now.getFullYear()}-01-01`;
    }

    // Status filter
    if (this.selectedApprovalStatus === 'pending') {
      params.inbox_only = true;
    } else if (this.selectedApprovalStatus === 'approved') {
      params.is_approved_for_sync = true;
    }

    try {
      const data = await window.api.getDocuments(params);
      this.documents = data.results || [];
      this.totalCount = data.count || 0;

      if (this.dom.countBadge) {
        this.dom.countBadge.textContent = `${this.totalCount} وثيقة`;
      }

      this.renderDocuments();
      this._updateBulkBar();
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      window.notifications.error(`تعذر تحميل المستندات: ${err.message}`);
    }
  }

  renderDocuments() {
    if (this.viewMode === 'table') {
      this._renderTableView();
    } else if (this.viewMode === 'list') {
      this._renderListView();
    } else {
      this._renderGridView();
    }
  }

  _renderGridView() {
    this._showViewContainer('grid');
    if (!this.dom.grid) return;

    if (this.documents.length === 0) {
      this.dom.grid.innerHTML = this._emptyStateHtml();
      return;
    }

    this.dom.grid.innerHTML = '';
    this.documents.forEach((doc) => {
      const card = document.createElement('div');
      const isSelected = this.selectedDocIds.has(doc.id);
      card.className = `doc-card ${isSelected ? 'selected' : ''}`;
      card.dataset.id = doc.id;

      // Find department tag
      const deptTag = doc.tags.map((id) => this.tagsMap[id]).find((t) => t && ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name));
      const deptName = deptTag ? deptTag.name : 'عام';
      const isPending = doc.tags.some((id) => this.tagsMap[id] && this.tagsMap[id].name === 'بانتظار المراجعة');

      const createdDate = doc.created_date ? doc.created_date.replace(/-/g, '/') : '—';
      const pageCount = doc.page_count || 1;
      const typeName = doc.document_type_name || '';
      const corrName = doc.correspondent_name || '';

      card.innerHTML = `
        <input type="checkbox" class="doc-card-checkbox" ${isSelected ? 'checked' : ''} title="تحديد الوثيقة">
        <div class="doc-thumb-container">
          <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--bg-surface-elevated); color: var(--text-muted);">
            <svg style="width: 36px; height: 36px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div class="doc-badge-dept">${deptName}</div>
          ${isPending ? '<div style="position: absolute; bottom: 8px; right: 8px; background: #f59e0b; color: #0f172a; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700;">بانتظار المراجعة</div>' : ''}
          ${corrName ? `<div style="position: absolute; bottom: 8px; left: 8px; background: rgba(59, 130, 246, 0.9); color: white; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 600;">${corrName}</div>` : ''}
        </div>
        <div class="doc-info">
          <div class="doc-title" title="${doc.title}">${doc.title}</div>
          <div class="doc-meta-row">
            <span>${typeName ? `<span style="color: var(--accent-primary); font-weight: 600;">${typeName}</span> · ` : ''}${pageCount} ص</span>
            <span class="ltr">${createdDate}</span>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end;">
            <button class="icon-btn btn-quick-view" title="معاينة وتعديل"><svg style="width: 15px; height: 15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
            <button class="icon-btn btn-quick-download" title="تحميل الملف الأصلي"><svg style="width: 15px; height: 15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          </div>
        </div>
      `;

      // Checkbox event
      const chk = card.querySelector('.doc-card-checkbox');
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDocSelection(doc.id, chk.checked);
      });

      // Quick buttons
      card.querySelector('.btn-quick-view').addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDocumentModal(doc);
      });
      card.querySelector('.btn-quick-download').addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadDocumentDirect(doc.id);
      });

      card.addEventListener('click', () => this.openDocumentModal(doc));
      this.dom.grid.appendChild(card);
    });
  }

  _renderTableView() {
    this._showViewContainer('table');
    if (!this.dom.tableBody) return;

    if (this.documents.length === 0) {
      this.dom.tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">${this._emptyStateHtml()}</td></tr>`;
      return;
    }

    this.dom.tableBody.innerHTML = this.documents.map((doc) => {
      const isSelected = this.selectedDocIds.has(doc.id);
      const deptTag = doc.tags.map((id) => this.tagsMap[id]).find((t) => t && ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name));
      const deptName = deptTag ? deptTag.name : 'عام';
      const createdDate = doc.created_date ? doc.created_date.replace(/-/g, '/') : '—';
      const typeName = doc.document_type_name || '—';
      const corrName = doc.correspondent_name || '—';

      return `
        <tr class="${isSelected ? 'selected' : ''}" data-id="${doc.id}">
          <td style="width: 40px; text-align: center;">
            <input type="checkbox" class="doc-row-checkbox" data-id="${doc.id}" ${isSelected ? 'checked' : ''}>
          </td>
          <td style="font-weight: 600; cursor: pointer;" onclick="window.documentsController.openDocumentModalById(${doc.id})">${doc.title}</td>
          <td><span class="filter-chip" style="font-size: 11px;">${deptName}</span></td>
          <td>${typeName}</td>
          <td>${corrName}</td>
          <td class="ltr">${createdDate}</td>
          <td>
            <button class="icon-btn" onclick="window.documentsController.openDocumentModalById(${doc.id})" title="تعديل"><svg style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
            <button class="icon-btn" onclick="window.documentsController.downloadDocumentDirect(${doc.id})" title="تحميل"><svg style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          </td>
        </tr>
      `;
    }).join('');

    this.dom.tableBody.querySelectorAll('.doc-row-checkbox').forEach((chk) => {
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(chk.dataset.id, 10);
        this.toggleDocSelection(id, chk.checked);
      });
    });
  }

  _renderListView() {
    this._showViewContainer('list');
    if (!this.dom.listContainer) return;

    if (this.documents.length === 0) {
      this.dom.listContainer.innerHTML = this._emptyStateHtml();
      return;
    }

    this.dom.listContainer.innerHTML = this.documents.map((doc) => {
      const isSelected = this.selectedDocIds.has(doc.id);
      const deptTag = doc.tags.map((id) => this.tagsMap[id]).find((t) => t && ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name));
      const deptName = deptTag ? deptTag.name : 'عام';
      const createdDate = doc.created_date ? doc.created_date.replace(/-/g, '/') : '—';

      return `
        <div class="doc-list-row ${isSelected ? 'selected' : ''}" data-id="${doc.id}">
          <input type="checkbox" class="doc-row-checkbox" data-id="${doc.id}" ${isSelected ? 'checked' : ''}>
          <div style="flex: 1; min-width: 0;" onclick="window.documentsController.openDocumentModalById(${doc.id})">
            <div style="font-weight: 700; font-size: 13px;">${doc.title}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
              القسم: <span style="color: var(--accent-primary);">${deptName}</span> | الصفحات: ${doc.page_count || 1} | التاريخ: <span class="ltr">${createdDate}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="icon-btn" onclick="window.documentsController.openDocumentModalById(${doc.id})" title="معاينة"><svg style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
            <button class="icon-btn" onclick="window.documentsController.downloadDocumentDirect(${doc.id})" title="تنزيل"><svg style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          </div>
        </div>
      `;
    }).join('');

    this.dom.listContainer.querySelectorAll('.doc-row-checkbox').forEach((chk) => {
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(chk.dataset.id, 10);
        this.toggleDocSelection(id, chk.checked);
      });
    });
  }

  _showViewContainer(mode) {
    if (this.dom.grid) this.dom.grid.style.display = mode === 'grid' ? 'grid' : 'none';
    if (this.dom.tableContainer) this.dom.tableContainer.style.display = mode === 'table' ? 'block' : 'none';
    if (this.dom.listContainer) this.dom.listContainer.style.display = mode === 'list' ? 'flex' : 'none';
  }

  setViewMode(mode) {
    this.viewMode = mode;
    if (this.dom.viewGridBtn) this.dom.viewGridBtn.classList.toggle('active', mode === 'grid');
    if (this.dom.viewTableBtn) this.dom.viewTableBtn.classList.toggle('active', mode === 'table');
    if (this.dom.viewListBtn) this.dom.viewListBtn.classList.toggle('active', mode === 'list');
    this.renderDocuments();
  }

  _emptyStateHtml() {
    return `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-muted);">
        <svg style="width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
        </svg>
        <div style="font-weight: 600; font-size: 15px;">لا توجد وثائق مطابقة للبحث أو التصفيات الحالية</div>
        <div style="font-size: 13px; margin-top: 4px;">جرب تغيير القسم أو إعادة تعيين عوامل التصفية</div>
      </div>
    `;
  }

  // ==========================================
  // SELECTION & BULK ACTIONS
  // ==========================================
  toggleDocSelection(id, checked) {
    if (checked) {
      this.selectedDocIds.add(id);
    } else {
      this.selectedDocIds.delete(id);
    }
    this._updateBulkBar();
    this._updateSelectionVisuals();
  }

  selectPageDocuments() {
    this.documents.forEach((d) => this.selectedDocIds.add(d.id));
    this._updateBulkBar();
    this.renderDocuments();
  }

  selectAllDocuments() {
    this.documents.forEach((d) => this.selectedDocIds.add(d.id));
    this._updateBulkBar();
    this.renderDocuments();
  }

  clearSelection() {
    this.selectedDocIds.clear();
    this._updateBulkBar();
    this.renderDocuments();
  }

  _updateBulkBar() {
    if (!this.dom.bulkBar) return;
    const count = this.selectedDocIds.size;
    if (count > 0) {
      this.dom.bulkBar.classList.add('visible');
      if (this.dom.bulkCountLabel) {
        this.dom.bulkCountLabel.textContent = `تم تحديد ${count} وثيقة`;
      }
    } else {
      this.dom.bulkBar.classList.remove('visible');
    }
  }

  _updateSelectionVisuals() {
    const ids = this.selectedDocIds;
    document.querySelectorAll('.doc-card').forEach((c) => {
      const id = parseInt(c.dataset.id, 10);
      c.classList.toggle('selected', ids.has(id));
      const chk = c.querySelector('.doc-card-checkbox');
      if (chk) chk.checked = ids.has(id);
    });
    document.querySelectorAll('.doc-list-row, .docs-table tr').forEach((r) => {
      const id = parseInt(r.dataset.id, 10);
      r.classList.toggle('selected', ids.has(id));
      const chk = r.querySelector('.doc-row-checkbox');
      if (chk) chk.checked = ids.has(id);
    });
  }

  async executeBulkDelete() {
    const ids = Array.from(this.selectedDocIds);
    if (ids.length === 0) return;

    const ok = await window.confirmDialog({
      title: 'حذف جماعي للوثائق',
      message: `هل أنت متأكد من رغبتك في نقل ${ids.length} وثيقة إلى سلة المهملات؟`,
      danger: true,
      confirmText: 'نقل إلى المهملات',
    });
    if (!ok) return;

    const res = await window.api.bulkDelete(ids, false);
    if (res.success) {
      window.notifications.success(`تم نقل ${res.count} وثيقة إلى سلة المهملات بنجاح.`);
      this.clearSelection();
      await this.fetchDocuments();
    } else {
      window.notifications.error('تعذر تنفيذ الحذف الجماعي');
    }
  }

  async executeBulkApprove() {
    const ids = Array.from(this.selectedDocIds);
    if (ids.length === 0) return;

    const res = await window.api.bulkApprove(ids);
    if (res.success) {
      window.notifications.success(`تم اعتماد ${res.count} وثيقة وإلغاء حالة الانتظار.`);
      this.clearSelection();
      await this.fetchDocuments();
    } else {
      window.notifications.error('تعذر تنفيذ الاعتماد الجماعي');
    }
  }

  async executeBulkAddTag() {
    const ids = Array.from(this.selectedDocIds);
    if (ids.length === 0) return;

    const tagNames = Object.values(this.tagsMap).map((t) => t.name).join('، ');
    const chosenName = prompt(`أدخل اسم الوسم لإسناده لكافة الوثائق المحددة (${ids.length} وثيقة):\nالوسوم المتاحة: ${tagNames}`);
    if (!chosenName || !chosenName.trim()) return;

    const tag = Object.values(this.tagsMap).find((t) => t.name === chosenName.trim());
    if (!tag) {
      window.notifications.warning(`الوسم "${chosenName}" غير موجود.`);
      return;
    }

    const res = await window.api.bulkAddTag(ids, tag.id);
    window.notifications.success(`تم إسناد الوسم "${tag.name}" للوثائق المحددة.`);
    this.clearSelection();
    await this.fetchDocuments();
  }

  // ==========================================
  // FILTER BAR & ACTIVE CHIPS
  // ==========================================
  _renderFilterChips() {
    if (!this.dom.activeFilterChips) return;
    const chips = [];

    if (this.searchQuery) {
      chips.push({ label: `بحث: "${this.searchQuery}"`, clear: () => { this.searchQuery = ''; if (this.dom.searchInput) this.dom.searchInput.value = ''; } });
    }
    if (this.currentDepartment !== 'الكل') {
      chips.push({ label: `القسم: ${this.currentDepartment}`, clear: () => { this.currentDepartment = 'الكل'; this._resetDeptPills(); } });
    }
    if (this.selectedTagId && this.tagsMap[this.selectedTagId]) {
      chips.push({ label: `علامة: ${this.tagsMap[this.selectedTagId].name}`, clear: () => { this.selectedTagId = null; if (this.dom.filterTagsBtn) this.dom.filterTagsBtn.classList.remove('active'); } });
    }
    if (this.selectedCorrespondentId && this.correspondentsMap[this.selectedCorrespondentId]) {
      chips.push({ label: `جهة التراسل: ${this.correspondentsMap[this.selectedCorrespondentId].name}`, clear: () => { this.selectedCorrespondentId = null; if (this.dom.filterCorrBtn) this.dom.filterCorrBtn.classList.remove('active'); } });
    }
    if (this.selectedDocTypeId && this.docTypesMap[this.selectedDocTypeId]) {
      chips.push({ label: `نوع المستند: ${this.docTypesMap[this.selectedDocTypeId].name}`, clear: () => { this.selectedDocTypeId = null; if (this.dom.filterTypeBtn) this.dom.filterTypeBtn.classList.remove('active'); } });
    }
    if (this.selectedStoragePathId && this.storagePathsMap[this.selectedStoragePathId]) {
      chips.push({ label: `مسار: ${this.storagePathsMap[this.selectedStoragePathId].name}`, clear: () => { this.selectedStoragePathId = null; if (this.dom.filterPathBtn) this.dom.filterPathBtn.classList.remove('active'); } });
    }
    if (this.selectedDateRange !== 'all') {
      const dLabel = this.selectedDateRange === 'today' ? 'اليوم' : this.selectedDateRange === 'month' ? 'هذا الشهر' : 'هذا العام';
      chips.push({ label: `التاريخ: ${dLabel}`, clear: () => { this.selectedDateRange = 'all'; if (this.dom.filterDatesBtn) this.dom.filterDatesBtn.classList.remove('active'); } });
    }
    if (this.selectedApprovalStatus !== 'all') {
      const sLabel = this.selectedApprovalStatus === 'pending' ? 'بانتظار المراجعة' : 'معتمد للمزامنة';
      chips.push({ label: `الحالة: ${sLabel}`, clear: () => { this.selectedApprovalStatus = 'all'; if (this.dom.filterStatusBtn) this.dom.filterStatusBtn.classList.remove('active'); } });
    }

    if (chips.length === 0) {
      this.dom.activeFilterChips.innerHTML = '';
      if (this.dom.btnResetFilters) this.dom.btnResetFilters.style.display = 'none';
      return;
    }

    if (this.dom.btnResetFilters) this.dom.btnResetFilters.style.display = 'inline-flex';

    this.dom.activeFilterChips.innerHTML = chips.map((c, i) => `
      <span class="filter-chip">
        <span>${c.label}</span>
        <button type="button" data-chip-idx="${i}" title="إزالة">×</button>
      </span>
    `).join('');

    this.dom.activeFilterChips.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.chipIdx, 10);
        if (chips[idx]) chips[idx].clear();
        this.fetchDocuments();
        this._renderFilterChips();
      });
    });
  }

  _resetDeptPills() {
    if (this.dom.filterPills) {
      this.dom.filterPills.forEach((p) => {
        p.classList.toggle('active', p.dataset.department === 'الكل');
      });
    }
  }

  resetAllFilters() {
    this.searchQuery = '';
    if (this.dom.searchInput) this.dom.searchInput.value = '';
    this.currentDepartment = 'الكل';
    this._resetDeptPills();
    this.selectedTagId = null;
    this.selectedCorrespondentId = null;
    this.selectedDocTypeId = null;
    this.selectedStoragePathId = null;
    this.selectedDateRange = 'all';
    this.selectedApprovalStatus = 'all';

    // Remove active styles from filter buttons
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));

    this.currentPage = 1;
    this.fetchDocuments();
    this._renderFilterChips();
    window.notifications.info('تمت إعادة ضبط جميع التصفيات.');
  }

  // ==========================================
  // SAVED VIEWS
  // ==========================================
  async promptSaveCurrentView() {
    const name = prompt('أدخل اسماً لطريقة العرض الحالية:');
    if (!name || !name.trim()) return;

    const filterRules = {
      department: this.currentDepartment !== 'الكل' ? this.currentDepartment : null,
      tag_id: this.selectedTagId,
      correspondent_id: this.selectedCorrespondentId,
      document_type_id: this.selectedDocTypeId,
      storage_path_id: this.selectedStoragePathId,
      date_range: this.selectedDateRange,
      status: this.selectedApprovalStatus,
      search: this.searchQuery || null,
    };

    try {
      await window.api.createSavedView({
        name: name.trim(),
        sort_field: this.currentSort,
        view_mode: this.viewMode,
        filter_rules: filterRules,
      });
      window.notifications.success(`تم حفظ طريقة العرض "${name.trim()}" بنجاح.`);
      await this.populateSavedViewsDropdown();
    } catch (e) {
      window.notifications.error(e.message);
    }
  }

  async applySavedView(id) {
    try {
      const v = await window.nasArchive.savedViews.get(id);
      if (!v) return;
      this.applyFilterRules(v.filter_rules, v.view_mode, v.sort_field, v.sort_reverse);
      window.notifications.success(`تم تطبيق طريقة العرض "${v.name}"`);
    } catch (e) {
      window.notifications.error(e.message);
    }
  }

  applyFilterRules(rules = {}, viewMode = 'grid', sortField = '-created', sortReverse = true) {
    this.currentDepartment = rules.department || 'الكل';
    this.selectedTagId = rules.tag_id || null;
    this.selectedCorrespondentId = rules.correspondent_id || null;
    this.selectedDocTypeId = rules.document_type_id || null;
    this.selectedStoragePathId = rules.storage_path_id || null;
    this.selectedDateRange = rules.date_range || 'all';
    this.selectedApprovalStatus = rules.status || (rules.inbox_only ? 'pending' : 'all');
    this.searchQuery = rules.search || '';
    if (this.dom.searchInput) this.dom.searchInput.value = this.searchQuery;

    if (viewMode) this.setViewMode(viewMode);
    if (sortField) this.currentSort = sortField;

    this._resetDeptPills();
    if (this.currentDepartment !== 'الكل' && this.dom.filterPills) {
      this.dom.filterPills.forEach((p) => p.classList.toggle('active', p.dataset.department === this.currentDepartment));
    }

    this.fetchDocuments();
    this._renderFilterChips();
  }

  // ==========================================
  // DOCUMENT MODAL & EDIT (PHASE 2 & PHASE 6)
  // ==========================================
  openDocumentModalById(id) {
    const doc = this.documents.find((d) => d.id === id);
    if (doc) this.openDocumentModal(doc);
  }

  async openDocumentModal(doc) {
    this.activeDocument = doc;
    this.dom.modalTitle.textContent = doc.title;
    this.dom.inputTitle.value = doc.title;

    // Document types select
    if (this.dom.selectDocType) {
      this.dom.selectDocType.innerHTML = '<option value="">(غير محدد)</option>';
      Object.values(this.docTypesMap).forEach((dt) => {
        const opt = document.createElement('option');
        opt.value = dt.id;
        opt.textContent = dt.name;
        if (doc.document_type === dt.id) opt.selected = true;
        this.dom.selectDocType.appendChild(opt);
      });
    }

    // Correspondents select
    if (this.dom.selectCorrespondent) {
      this.dom.selectCorrespondent.innerHTML = '<option value="">(غير محدد)</option>';
      Object.values(this.correspondentsMap).forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (doc.correspondent === c.id) opt.selected = true;
        this.dom.selectCorrespondent.appendChild(opt);
      });
    }

    // Storage Paths select
    if (this.dom.selectStoragePath) {
      this.dom.selectStoragePath.innerHTML = '<option value="">(الافتراضي)</option>';
      Object.values(this.storagePathsMap).forEach((sp) => {
        const opt = document.createElement('option');
        opt.value = sp.id;
        opt.textContent = sp.name;
        if (doc.storage_path === sp.id) opt.selected = true;
        this.dom.selectStoragePath.appendChild(opt);
      });
    }

    // Department tags pills
    if (this.dom.deptTagsContainer) {
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
          this.dom.deptTagsContainer.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
          tagBtn.classList.add('active');
        });
        this.dom.deptTagsContainer.appendChild(tagBtn);
      });
    }

    // Custom Fields
    if (this.dom.customFieldsContainer) {
      this.dom.customFieldsContainer.innerHTML = '';
      const docFields = doc.custom_fields || [];
      this.customFields.forEach((cf) => {
        const existingVal = docFields.find((f) => f.field === cf.id);
        const valStr = existingVal ? existingVal.value : '';

        const group = document.createElement('div');
        group.className = 'form-group';
        group.innerHTML = `
          <label class="field-label">${cf.name}:</label>
          <input type="text" class="form-input custom-field-input" data-field-id="${cf.id}" value="${valStr || ''}" placeholder="أدخل ${cf.name}...">
        `;
        this.dom.customFieldsContainer.appendChild(group);
      });
    }

    // OCR Content
    if (this.dom.ocrContentBox) {
      this.dom.ocrContentBox.textContent = doc.content || '(لا يوجد نص مستخرج من الوثيقة)';
    }

    // Pending review button
    const isPending = doc.tags.some((id) => this.tagsMap[id] && this.tagsMap[id].name === 'بانتظار المراجعة');
    if (this.dom.modalApproveBtn) {
      this.dom.modalApproveBtn.style.display = isPending ? 'inline-flex' : 'none';
    }

    // Capture initial state for dirty checking
    this.originalEditState = this._getCurrentEditorState();

    // Show modal
    this.dom.modal.classList.add('open');

    // Load PDF Preview into modal viewer
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
  }

  _getCurrentEditorState() {
    const selectedPill = this.dom.deptTagsContainer ? this.dom.deptTagsContainer.querySelector('.filter-pill.active') : null;
    const selectedDept = selectedPill ? selectedPill.textContent.trim() : null;

    const cfMap = {};
    if (this.dom.customFieldsContainer) {
      this.dom.customFieldsContainer.querySelectorAll('.custom-field-input').forEach((inp) => {
        cfMap[inp.dataset.fieldId] = inp.value.trim();
      });
    }

    return {
      title: this.dom.inputTitle ? this.dom.inputTitle.value.trim() : '',
      docType: this.dom.selectDocType ? this.dom.selectDocType.value : '',
      correspondent: this.dom.selectCorrespondent ? this.dom.selectCorrespondent.value : '',
      storagePath: this.dom.selectStoragePath ? this.dom.selectStoragePath.value : '',
      department: selectedDept,
      customFields: cfMap,
    };
  }

  closeModal() {
    this.dom.modal.classList.remove('open');
    this.activeDocument = null;
    this.originalEditState = null;
    this.modalPdfViewer.clear();
  }

  /**
   * Save Document Changes — Fully compliant with Phase 2 requirements:
   * 1. Validate modified fields
   * 2. Persist to native SQLite
   * 3. Confirm transaction commitment
   * 4. Update search index
   * 5. Refresh document card
   * 6. Close modal automatically
   * 7. Return to archive view
   * 8. Discreet success notification
   */
  async saveDocumentChanges() {
    if (!this.activeDocument) return;

    const currentState = this._getCurrentEditorState();

    // 1. Validation
    if (!currentState.title) {
      window.notifications.warning('يرجى إدخال عنوان صالح للوثيقة.', 'حقل العنوان مطلوب');
      if (this.dom.inputTitle) this.dom.inputTitle.focus();
      return;
    }

    // 2. Dirty Check: if no modifications, close cleanly without writing to DB
    const isDirty = JSON.stringify(currentState) !== JSON.stringify(this.originalEditState);
    if (!isDirty) {
      this.closeModal();
      window.notifications.info('لم يتم إجراء أي تعديلات جديدة على الوثيقة.');
      return;
    }

    // Compute updated department tag
    let updatedTags = [...this.activeDocument.tags];
    const deptTagIds = Object.values(this.tagsMap)
      .filter((t) => ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name))
      .map((t) => t.id);

    updatedTags = updatedTags.filter((id) => !deptTagIds.includes(id));
    if (currentState.department) {
      const newDept = Object.values(this.tagsMap).find((t) => t.name === currentState.department);
      if (newDept) updatedTags.push(newDept.id);
    }

    // Gather custom fields
    const updatedCustomFields = [];
    Object.entries(currentState.customFields).forEach(([fieldId, val]) => {
      if (val) updatedCustomFields.push({ field: parseInt(fieldId, 10), value: val });
    });

    const patchData = {
      title: currentState.title,
      document_type: currentState.docType ? parseInt(currentState.docType, 10) : null,
      correspondent: currentState.correspondent ? parseInt(currentState.correspondent, 10) : null,
      storage_path: currentState.storagePath ? parseInt(currentState.storagePath, 10) : null,
      tags: updatedTags,
      custom_fields: updatedCustomFields,
    };

    try {
      // Disable save button to prevent duplicate submissions
      this.dom.modalSaveBtn.disabled = true;
      this.dom.modalSaveBtn.textContent = 'جاري الحفظ...';

      // Persist changes to SQLite
      const updated = await window.api.updateDocument(this.activeDocument.id, patchData);

      // Confirm transaction succeeded
      if (!updated || updated.id !== this.activeDocument.id) {
        throw new Error('لم يتم تأكيد حفظ التغييرات في قاعدة البيانات.');
      }

      // Close modal automatically
      this.closeModal();

      // Refresh document card and list
      await this.fetchDocuments();

      // Display discreet success notification
      window.notifications.success('تم حفظ التعديلات بنجاح.');
    } catch (e) {
      // On failure: keep modal open, preserve all unsaved input, display error toast, allow retry
      window.notifications.error(`فشل حفظ التعديلات: ${e.message}`, 'خطأ في الحفظ', {
        retry: () => this.saveDocumentChanges(),
      });
    } finally {
      if (this.dom.modalSaveBtn) {
        this.dom.modalSaveBtn.disabled = false;
        this.dom.modalSaveBtn.textContent = 'حفظ التعديلات';
      }
    }
  }

  async approveDocument() {
    if (!this.activeDocument) return;

    const pendingTag = Object.values(this.tagsMap).find((t) => t.name === 'بانتظار المراجعة');
    if (!pendingTag) return;

    const newTags = this.activeDocument.tags.filter((id) => id !== pendingTag.id);

    try {
      this.dom.modalApproveBtn.disabled = true;
      await window.api.updateDocument(this.activeDocument.id, { tags: newTags, status: 'APPROVED' });
      this.closeModal();
      window.notifications.success('تم اعتماد الوثيقة وإلغاء حالة الانتظار بنجاح.');
      await this.fetchDocuments();
    } catch (e) {
      window.notifications.error(`فشل اعتماد الوثيقة: ${e.message}`);
    } finally {
      if (this.dom.modalApproveBtn) this.dom.modalApproveBtn.disabled = false;
    }
  }

  async downloadActiveDocument() {
    if (!this.activeDocument) return;
    await this.downloadDocumentDirect(this.activeDocument.id);
  }

  async downloadDocumentDirect(docId) {
    if (window.nasArchive && window.nasArchive.documents && window.nasArchive.documents.exportFile) {
      try {
        const res = await window.nasArchive.documents.exportFile(docId);
        if (res.success && res.savedPath) {
          window.notifications.success(`تم حفظ المستند بنجاح في: ${res.savedPath}`);
          return;
        }
      } catch (ipcErr) {
        window.notifications.error(`تعذر تنزيل المستند: ${ipcErr.message}`);
      }
    }
  }

  async deleteActiveDocument() {
    if (!this.activeDocument) return;

    const ok = await window.confirmDialog({
      title: 'حذف الوثيقة',
      message: `هل أنت متأكد من رغبتك في نقل الوثيقة "${this.activeDocument.title}" إلى سلة المهملات؟`,
      confirmText: 'نقل إلى المهملات',
      danger: true,
    });
    if (!ok) return;

    try {
      await window.api.deleteDocument(this.activeDocument.id, false);
      this.closeModal();
      window.notifications.success('تم نقل الوثيقة إلى سلة المهملات.');
      await this.fetchDocuments();
    } catch (e) {
      window.notifications.error(`فشل حذف الوثيقة: ${e.message}`);
    }
  }
}

window.DocumentsController = DocumentsController;
