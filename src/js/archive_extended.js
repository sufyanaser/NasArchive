/**
 * NAS Archive — Extended Archive Modules Controller
 * Manages Attributes (Classification CRUD), Saved Views, Workflows,
 * Trash Lifecycle, Background Tasks, System Logs, and Local Users.
 */

class ArchiveExtendedController {
  constructor() {
    this.currentAttributeTab = 'tags';
  }

  async init() {
    this._bindEvents();
  }

  _bindEvents() {
    // Attributes tabs switching
    document.querySelectorAll('.attributes-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.attributes-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentAttributeTab = btn.dataset.tab;
        this.renderAttributesTab();
      });
    });

    // Add Attribute button
    const btnAddAttr = document.getElementById('btnAddAttribute');
    if (btnAddAttr) {
      btnAddAttr.addEventListener('click', () => this.promptCreateAttribute());
    }

    // Saved Views: Add
    const btnAddView = document.getElementById('btnAddSavedView');
    if (btnAddView) {
      btnAddView.addEventListener('click', () => this.promptCreateSavedView());
    }

    // Workflows: Add
    const btnAddWf = document.getElementById('btnAddWorkflow');
    if (btnAddWf) {
      btnAddWf.addEventListener('click', () => this.promptCreateWorkflow());
    }

    // Trash: Empty all
    const btnEmptyTrash = document.getElementById('btnEmptyTrash');
    if (btnEmptyTrash) {
      btnEmptyTrash.addEventListener('click', () => this.emptyTrash());
    }

    // Tasks: Refresh
    const btnRefreshTasks = document.getElementById('btnRefreshTasks');
    if (btnRefreshTasks) {
      btnRefreshTasks.addEventListener('click', () => this.renderTasks());
    }

    // Logs: Refresh & Clear
    const btnRefreshLogs = document.getElementById('btnRefreshLogs');
    if (btnRefreshLogs) {
      btnRefreshLogs.addEventListener('click', () => this.renderLogs());
    }
    const btnClearLogs = document.getElementById('btnClearLogs');
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => this.clearLogs());
    }
  }

  // ==========================================
  // 1. ATTRIBUTES MANAGEMENT
  // ==========================================
  async renderAttributesTab() {
    const tableBody = document.getElementById('attributesTableBody');
    const tableHeader = document.getElementById('attributesTableHeader');
    if (!tableBody || !tableHeader) return;

    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">جاري التحميل...</td></tr>';

    try {
      if (this.currentAttributeTab === 'tags') {
        tableHeader.innerHTML = `
          <tr>
            <th>الرقم</th>
            <th>اسم الوسم</th>
            <th>اللون</th>
            <th>صندوق الوارد</th>
            <th style="width: 100px;">الإجراءات</th>
          </tr>
        `;
        const res = await window.api.getTags();
        const tags = res.results || [];
        if (tags.length === 0) {
          tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">لا توجد وسوم معرفة</td></tr>';
          return;
        }
        tableBody.innerHTML = tags.map((t) => `
          <tr>
            <td>${t.id}</td>
            <td><span class="filter-chip" style="background: ${t.color}22; border-color: ${t.color}; color: ${t.color};">${t.name}</span></td>
            <td><span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: ${t.color}; vertical-align: middle; margin-left: 6px;"></span><span class="mono">${t.color}</span></td>
            <td>${t.is_inbox_tag ? 'نعم' : 'لا'}</td>
            <td>
              <button class="icon-btn" onclick="window.archiveExtended.editTag(${t.id}, '${t.name}', '${t.color}')" title="تعديل"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="icon-btn" style="color:#ef4444;" onclick="window.archiveExtended.deleteTag(${t.id}, '${t.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
          </tr>
        `).join('');
      } else if (this.currentAttributeTab === 'correspondents') {
        tableHeader.innerHTML = `
          <tr>
            <th>الرقم</th>
            <th>جهة التراسل</th>
            <th>المعرف النصي (Slug)</th>
            <th>تاريخ الإنشاء</th>
            <th style="width: 100px;">الإجراءات</th>
          </tr>
        `;
        const res = await window.api.getCorrespondents();
        const list = res.results || [];
        if (list.length === 0) {
          tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">لا توجد جهات تراسل مسجلة حالياً</td></tr>';
          return;
        }
        tableBody.innerHTML = list.map((c) => `
          <tr>
            <td>${c.id}</td>
            <td style="font-weight: 600;">${c.name}</td>
            <td class="mono">${c.slug || '—'}</td>
            <td class="ltr">${c.created_at ? c.created_at.slice(0, 10) : '—'}</td>
            <td>
              <button class="icon-btn" onclick="window.archiveExtended.editCorrespondent(${c.id}, '${c.name}')" title="تعديل"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="icon-btn" style="color:#ef4444;" onclick="window.archiveExtended.deleteCorrespondent(${c.id}, '${c.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
          </tr>
        `).join('');
      } else if (this.currentAttributeTab === 'types') {
        tableHeader.innerHTML = `
          <tr>
            <th>الرقم</th>
            <th>نوع المستند</th>
            <th>المعرف النصي (Slug)</th>
            <th>تاريخ الإنشاء</th>
            <th style="width: 100px;">الإجراءات</th>
          </tr>
        `;
        const res = await window.api.getDocumentTypes();
        const list = res.results || [];
        tableBody.innerHTML = list.map((dt) => `
          <tr>
            <td>${dt.id}</td>
            <td style="font-weight: 600;">${dt.name}</td>
            <td class="mono">${dt.slug || '—'}</td>
            <td class="ltr">${dt.created_at ? dt.created_at.slice(0, 10) : '—'}</td>
            <td>
              <button class="icon-btn" onclick="window.archiveExtended.editDocType(${dt.id}, '${dt.name}')" title="تعديل"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="icon-btn" style="color:#ef4444;" onclick="window.archiveExtended.deleteDocType(${dt.id}, '${dt.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
          </tr>
        `).join('');
      } else if (this.currentAttributeTab === 'storage_paths') {
        tableHeader.innerHTML = `
          <tr>
            <th>الرقم</th>
            <th>اسم المسار</th>
            <th>قالب التخزين</th>
            <th>خوارزمية المطابقة</th>
            <th style="width: 100px;">الإجراءات</th>
          </tr>
        `;
        const res = await window.api.getStoragePaths();
        const list = res.results || [];
        if (list.length === 0) {
          tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">لا توجد مسارات تخزين مخصصة</td></tr>';
          return;
        }
        tableBody.innerHTML = list.map((sp) => `
          <tr>
            <td>${sp.id}</td>
            <td style="font-weight: 600;">${sp.name}</td>
            <td class="mono ltr">${sp.path_template}</td>
            <td>${sp.matching_algorithm || 'تلقائي'}</td>
            <td>
              <button class="icon-btn" onclick="window.archiveExtended.editStoragePath(${sp.id}, '${sp.name}', '${sp.path_template}')" title="تعديل"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="icon-btn" style="color:#ef4444;" onclick="window.archiveExtended.deleteStoragePath(${sp.id}, '${sp.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
          </tr>
        `).join('');
      } else if (this.currentAttributeTab === 'custom_fields') {
        tableHeader.innerHTML = `
          <tr>
            <th>الرقم</th>
            <th>اسم الحقل المخصص</th>
            <th>نوع البيانات</th>
            <th>تاريخ الإنشاء</th>
            <th style="width: 100px;">الإجراءات</th>
          </tr>
        `;
        const res = await window.api.getCustomFields();
        const list = res.results || [];
        tableBody.innerHTML = list.map((cf) => `
          <tr>
            <td>${cf.id}</td>
            <td style="font-weight: 600;">${cf.name}</td>
            <td><span class="mono">${cf.data_type}</span></td>
            <td class="ltr">${cf.created_at ? cf.created_at.slice(0, 10) : '—'}</td>
            <td>
              <button class="icon-btn" onclick="window.archiveExtended.editCustomField(${cf.id}, '${cf.name}', '${cf.data_type}')" title="تعديل"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="icon-btn" style="color:#ef4444;" onclick="window.archiveExtended.deleteCustomField(${cf.id}, '${cf.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="5" style="color: #ef4444; padding: 20px;">خطأ: ${err.message}</td></tr>`;
    }
  }

  async promptCreateAttribute() {
    const tab = this.currentAttributeTab;
    const name = prompt(`أدخل اسم ${this._tabLabel(tab)} الجديد:`);
    if (!name || !name.trim()) return;

    try {
      if (tab === 'tags') {
        const color = prompt('أدخل لون الوسم (Hex مثل #3b82f6):', '#3b82f6') || '#3b82f6';
        await window.nasArchive.classification.tags.create({ name: name.trim(), color: color.trim() });
      } else if (tab === 'correspondents') {
        await window.nasArchive.classification.correspondents.create({ name: name.trim() });
      } else if (tab === 'types') {
        await window.nasArchive.classification.types.create({ name: name.trim() });
      } else if (tab === 'storage_paths') {
        const tpl = prompt('أدخل قالب مسار التخزين:', '{department}/{created_year}/{title}') || '{department}/{created_year}/{title}';
        await window.nasArchive.classification.storagePaths.create({ name: name.trim(), path_template: tpl.trim() });
      } else if (tab === 'custom_fields') {
        const dt = prompt('أدخل نوع البيانات (string, date, boolean, integer, longtext):', 'string') || 'string';
        await window.nasArchive.classification.customFields.create({ name: name.trim(), data_type: dt.trim() });
      }

      window.notifications.success(`تم إضافة ${this._tabLabel(tab)} بنجاح`);
      this.renderAttributesTab();
      if (window.documentsController) window.documentsController.loadMetadata();
    } catch (e) {
      window.notifications.error(e.message);
    }
  }

  async deleteTag(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف الوسم', message: `هل أنت متأكد من حذف الوسم "${name}"؟ سيتم إزالته من كافة الوثائق المرتبطة.`, danger: true });
    if (!ok) return;
    try {
      await window.nasArchive.classification.tags.delete(id);
      window.notifications.success('تم حذف الوسم بنجاح');
      this.renderAttributesTab();
      if (window.documentsController) window.documentsController.loadMetadata();
    } catch (e) { window.notifications.error(e.message); }
  }

  async deleteCorrespondent(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف جهة التراسل', message: `هل أنت متأكد من حذف جهة التراسل "${name}"؟`, danger: true });
    if (!ok) return;
    try {
      await window.nasArchive.classification.correspondents.delete(id);
      window.notifications.success('تم حذف جهة التراسل');
      this.renderAttributesTab();
    } catch (e) { window.notifications.error(e.message); }
  }

  async deleteDocType(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف نوع المستند', message: `هل أنت متأكد من حذف "${name}"؟`, danger: true });
    if (!ok) return;
    try {
      await window.nasArchive.classification.types.delete(id);
      window.notifications.success('تم حذف نوع المستند');
      this.renderAttributesTab();
    } catch (e) { window.notifications.error(e.message); }
  }

  async deleteStoragePath(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف مسار التخزين', message: `هل أنت متأكد من حذف "${name}"؟`, danger: true });
    if (!ok) return;
    try {
      await window.nasArchive.classification.storagePaths.delete(id);
      window.notifications.success('تم حذف مسار التخزين');
      this.renderAttributesTab();
    } catch (e) { window.notifications.error(e.message); }
  }

  async deleteCustomField(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف الحقل المخصص', message: `هل أنت متأكد من حذف "${name}"؟ سيتم حذف قيمه من كافة الوثائق.`, danger: true });
    if (!ok) return;
    try {
      await window.nasArchive.classification.customFields.delete(id);
      window.notifications.success('تم حذف الحقل المخصص');
      this.renderAttributesTab();
    } catch (e) { window.notifications.error(e.message); }
  }

  _tabLabel(tab) {
    switch (tab) {
      case 'tags': return 'الوسم';
      case 'correspondents': return 'جهة التراسل';
      case 'types': return 'نوع المستند';
      case 'storage_paths': return 'مسار التخزين';
      case 'custom_fields': return 'الحقل المخصص';
      default: return 'العنصر';
    }
  }

  // ==========================================
  // 2. SAVED VIEWS
  // ==========================================
  async renderSavedViews() {
    const listEl = document.getElementById('savedViewsList');
    if (!listEl) return;

    try {
      const res = await window.api.getSavedViews();
      const views = res.results || [];
      if (views.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">لا توجد طرق عرض محفوظة حالياً.</div>';
        return;
      }

      listEl.innerHTML = views.map((v) => `
        <div class="doc-card" style="padding: 16px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 700; font-size: 14px;">${v.name}</div>
            <button class="icon-btn" style="color: #ef4444;" onclick="window.archiveExtended.deleteSavedView(${v.id}, '${v.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            نمط العرض: ${v.view_mode === 'table' ? 'جدول' : v.view_mode === 'list' ? 'قائمة' : 'شبكة'} | الترتيب: ${v.sort_field}
          </div>
          <button class="btn-secondary" style="margin-top: 6px; padding: 6px 12px; font-size: 12px;" onclick="window.archiveExtended.applySavedView(${v.id})">تطبيق طريقة العرض هذه</button>
        </div>
      `).join('');
    } catch (e) {
      listEl.innerHTML = `<div style="color: #ef4444;">خطأ: ${e.message}</div>`;
    }
  }

  async applySavedView(id) {
    if (!window.documentsController) return;
    const v = await window.nasArchive.savedViews.get(id);
    if (!v) return;

    if (window.appRouter) window.appRouter.navigate('documents');
    window.documentsController.applyFilterRules(v.filter_rules, v.view_mode, v.sort_field, v.sort_reverse);
    window.notifications.success(`تم تطبيق طريقة العرض: "${v.name}"`);
  }

  async deleteSavedView(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف طريقة العرض', message: `هل أنت متأكد من حذف طريقة العرض "${name}"؟`, danger: true });
    if (!ok) return;
    await window.api.deleteSavedView(id);
    window.notifications.success('تم حذف طريقة العرض');
    this.renderSavedViews();
    if (window.documentsController) window.documentsController.populateSavedViewsDropdown();
  }

  // ==========================================
  // 3. WORKFLOWS
  // ==========================================
  async renderWorkflows() {
    const listEl = document.getElementById('workflowsList');
    if (!listEl) return;

    try {
      const res = await window.api.getWorkflows();
      const list = res.results || [];
      if (list.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">لا توجد قواعد سير عمل مضافة.</div>';
        return;
      }

      listEl.innerHTML = list.map((w) => `
        <div class="doc-card" style="padding: 16px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; font-size: 14px;">${w.name}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
              المعايير: <span class="mono">${JSON.stringify(w.criteria)}</span> ← الإجراءات: <span class="mono">${JSON.stringify(w.actions)}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="status-pill ${w.is_active ? 'online' : 'offline'}">${w.is_active ? 'مفعل' : 'معطل'}</span>
            <button class="icon-btn" style="color: #ef4444;" onclick="window.archiveExtended.deleteWorkflow(${w.id}, '${w.name}')" title="حذف"><svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      listEl.innerHTML = `<div style="color: #ef4444;">خطأ: ${e.message}</div>`;
    }
  }

  async deleteWorkflow(id, name) {
    const ok = await window.confirmDialog({ title: 'حذف سير العمل', message: `هل أنت متأكد من حذف قاعدة سير العمل "${name}"؟`, danger: true });
    if (!ok) return;
    await window.api.deleteWorkflow(id);
    window.notifications.success('تم حذف سير العمل بنجاح');
    this.renderWorkflows();
  }

  // ==========================================
  // 4. TRASH LIFECYCLE
  // ==========================================
  async renderTrash() {
    const tableBody = document.getElementById('trashTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px;">جاري تحميل سلة المهملات...</td></tr>';

    try {
      const res = await window.api.getTrash();
      const docs = res.results || [];
      if (docs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">سلة المهملات فارغة تماماً</td></tr>';
        return;
      }

      tableBody.innerHTML = docs.map((d) => `
        <tr>
          <td>#${d.id}</td>
          <td style="font-weight: 600;">${d.title}</td>
          <td class="ltr">${d.deleted_at ? d.deleted_at.slice(0, 16).replace('T', ' ') : '—'}</td>
          <td>${d.page_count || 1} ص</td>
          <td style="display: flex; gap: 8px;">
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px; color: #10b981;" onclick="window.archiveExtended.restoreDoc(${d.id})">استعادة</button>
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px; color: #ef4444;" onclick="window.archiveExtended.purgeDoc(${d.id}, '${d.title}')">حذف نهائي</button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      tableBody.innerHTML = `<tr><td colspan="5" style="color: #ef4444; padding: 20px;">خطأ: ${e.message}</td></tr>`;
    }
  }

  async restoreDoc(id) {
    const ok = await window.api.restoreDocument(id);
    if (ok) {
      window.notifications.success('تمت استعادة الوثيقة بنجاح وإعادتها للأرشيف النشط');
      this.renderTrash();
      if (window.documentsController) window.documentsController.fetchDocuments();
    } else {
      window.notifications.error('تعذر استعادة الوثيقة');
    }
  }

  async purgeDoc(id, title) {
    const ok = await window.confirmDialog({
      title: 'حذف نهائي لا يمكن التراجع عنه',
      message: `هل أنت متأكد من الحذف النهائي للوثيقة "${title}"؟ لن يمكن استعادتها مرة أخرى.`,
      danger: true,
      confirmText: 'حذف نهائي',
    });
    if (!ok) return;

    await window.api.deleteDocument(id, true);
    window.notifications.success('تم حذف الوثيقة نهائياً');
    this.renderTrash();
  }

  async emptyTrash() {
    const ok = await window.confirmDialog({
      title: 'تفريغ سلة المهملات بالكامل',
      message: 'هل أنت متأكد من رغبتك في حذف كافة الوثائق الموجودة في سلة المهملات نهائياً؟ هذا الإجراء لا يمكن التراجع عنه.',
      danger: true,
      confirmText: 'تفريغ سلة المهملات',
    });
    if (!ok) return;

    const res = await window.api.purgeTrash();
    if (res.success) {
      window.notifications.success(`تم تفريغ سلة المهملات وحذف ${res.count} وثيقة`);
      this.renderTrash();
    } else {
      window.notifications.error('تعذر تفريغ سلة المهملات');
    }
  }

  // ==========================================
  // 5. TASKS & LOGS
  // ==========================================
  async renderTasks() {
    const body = document.getElementById('tasksTableBody');
    if (!body) return;

    const res = await window.api.getTasksList(30);
    const tasks = res.results || [];
    if (tasks.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">لا توجد مهام جارية أو مسجلة</td></tr>';
      return;
    }

    body.innerHTML = tasks.map((t) => `
      <tr>
        <td>#${t.id}</td>
        <td><strong>${t.task_type}</strong></td>
        <td><span class="status-pill ${t.status === 'SUCCESS' ? 'online' : t.status === 'RUNNING' ? 'warning' : 'offline'}">${t.status}</span></td>
        <td>${t.message || '—'}</td>
        <td class="ltr">${t.created_at ? t.created_at.slice(11, 19) : '—'}</td>
      </tr>
    `).join('');
  }

  async renderLogs() {
    const body = document.getElementById('logsContainer');
    if (!body) return;

    const res = await window.api.getLogsList({ limit: 80 });
    const logs = res.results || [];
    if (logs.length === 0) {
      body.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">لا توجد سجلات بعد.</div>';
      return;
    }

    body.innerHTML = logs.map((l) => `
      <div style="font-family: monospace; font-size: 11px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; gap: 10px;">
        <span class="ltr" style="color: var(--text-muted);">${l.created_at.slice(11, 19)}</span>
        <span style="color: ${l.level === 'ERROR' ? '#ef4444' : l.level === 'WARN' ? '#f59e0b' : '#10b981'}; font-weight: 700;">[${l.level}]</span>
        <span style="color: var(--text-secondary);">[${l.source}]</span>
        <span style="color: var(--text-primary); flex: 1;">${l.message}</span>
      </div>
    `).join('');
  }

  async clearLogs() {
    const ok = await window.confirmDialog({ title: 'مسح السجلات', message: 'هل تريد مسح سجلات النظام الحالية؟' });
    if (!ok) return;
    await window.nasArchive.logs.clear();
    this.renderLogs();
    window.notifications.success('تم مسح السجلات بنجاح');
  }

  // ==========================================
  // 6. LOCAL USERS
  // ==========================================
  async renderUsers() {
    const listEl = document.getElementById('usersListContainer');
    if (!listEl) return;

    const res = await window.api.getUsers();
    const users = res.results || [];
    listEl.innerHTML = users.map((u) => `
      <div class="doc-card" style="padding: 16px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent-primary); display: flex; align-items: center; justify-content: center; font-weight: 700; color: white;">
            ${u.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-weight: 700; font-size: 14px;">${u.display_name || u.username}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${u.email || 'حساب محلي أصيل'}</div>
          </div>
        </div>
        <div>
          <span class="status-pill online">${u.role === 'admin' ? 'مدير كامل الصلاحيات' : 'مستخدم'}</span>
        </div>
      </div>
    `).join('');
  }
}

window.ArchiveExtendedController = ArchiveExtendedController;
window.archiveExtended = new ArchiveExtendedController();
