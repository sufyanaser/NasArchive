/**
 * NAS Archive — Extended Archive Service
 * Provides backend services for Saved Views, Workflows, Background Tasks,
 * App Logs, and Local Users.
 */
const dbManager = require('./db');

class ArchiveService {
  // ==========================================
  // 1. SAVED VIEWS
  // ==========================================
  listSavedViews() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM saved_views ORDER BY id ASC').all();
    return {
      count: rows.length,
      results: rows.map((r) => ({
        ...r,
        show_on_dashboard: Boolean(r.show_on_dashboard),
        show_in_sidebar: Boolean(r.show_in_sidebar),
        sort_reverse: Boolean(r.sort_reverse),
        filter_rules: r.filter_rules_json ? JSON.parse(r.filter_rules_json) : {},
      })),
    };
  }

  getSavedView(id) {
    const db = dbManager.getDb();
    const r = db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id);
    if (!r) return null;
    return {
      ...r,
      show_on_dashboard: Boolean(r.show_on_dashboard),
      show_in_sidebar: Boolean(r.show_in_sidebar),
      sort_reverse: Boolean(r.sort_reverse),
      filter_rules: r.filter_rules_json ? JSON.parse(r.filter_rules_json) : {},
    };
  }

  createSavedView({
    name,
    show_on_dashboard = 0,
    show_in_sidebar = 1,
    sort_field = 'created_date',
    sort_reverse = 1,
    filter_rules = {},
    view_mode = 'grid',
  }) {
    if (!name || !name.trim()) throw new Error('اسم طريقة العرض مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const filterJson = typeof filter_rules === 'string' ? filter_rules : JSON.stringify(filter_rules);

    const stmt = db.prepare(`
      INSERT INTO saved_views (name, show_on_dashboard, show_in_sidebar, sort_field, sort_reverse, filter_rules_json, view_mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      name.trim(),
      show_on_dashboard ? 1 : 0,
      show_in_sidebar ? 1 : 0,
      sort_field,
      sort_reverse ? 1 : 0,
      filterJson,
      view_mode,
      now
    );
    return this.getSavedView(Number(res.lastInsertRowid));
  }

  updateSavedView(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getSavedView(id);
    if (!existing) throw new Error(`طريقة العرض رقم ${id} غير موجودة.`);

    const sets = [];
    const args = [];

    if (patch.name !== undefined && patch.name.trim()) {
      sets.push('name = ?');
      args.push(patch.name.trim());
    }
    if (patch.show_on_dashboard !== undefined) {
      sets.push('show_on_dashboard = ?');
      args.push(patch.show_on_dashboard ? 1 : 0);
    }
    if (patch.show_in_sidebar !== undefined) {
      sets.push('show_in_sidebar = ?');
      args.push(patch.show_in_sidebar ? 1 : 0);
    }
    if (patch.sort_field !== undefined) {
      sets.push('sort_field = ?');
      args.push(patch.sort_field);
    }
    if (patch.sort_reverse !== undefined) {
      sets.push('sort_reverse = ?');
      args.push(patch.sort_reverse ? 1 : 0);
    }
    if (patch.filter_rules !== undefined) {
      sets.push('filter_rules_json = ?');
      args.push(typeof patch.filter_rules === 'string' ? patch.filter_rules : JSON.stringify(patch.filter_rules));
    }
    if (patch.view_mode !== undefined) {
      sets.push('view_mode = ?');
      args.push(patch.view_mode);
    }

    if (sets.length > 0) {
      args.push(id);
      db.prepare(`UPDATE saved_views SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return this.getSavedView(id);
  }

  deleteSavedView(id) {
    const db = dbManager.getDb();
    const res = db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ==========================================
  // 2. WORKFLOWS
  // ==========================================
  listWorkflows() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM workflows ORDER BY id ASC').all();
    return {
      count: rows.length,
      results: rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        criteria: r.criteria_json ? JSON.parse(r.criteria_json) : {},
        actions: r.actions_json ? JSON.parse(r.actions_json) : {},
      })),
    };
  }

  getWorkflow(id) {
    const db = dbManager.getDb();
    const r = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!r) return null;
    return {
      ...r,
      is_active: Boolean(r.is_active),
      criteria: r.criteria_json ? JSON.parse(r.criteria_json) : {},
      actions: r.actions_json ? JSON.parse(r.actions_json) : {},
    };
  }

  createWorkflow({ name, trigger_type = 'consumption', criteria = {}, actions = {}, is_active = 1 }) {
    if (!name || !name.trim()) throw new Error('اسم سير العمل مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const criteriaJson = typeof criteria === 'string' ? criteria : JSON.stringify(criteria);
    const actionsJson = typeof actions === 'string' ? actions : JSON.stringify(actions);

    const stmt = db.prepare(`
      INSERT INTO workflows (name, trigger_type, criteria_json, actions_json, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(name.trim(), trigger_type, criteriaJson, actionsJson, is_active ? 1 : 0, now);
    return this.getWorkflow(Number(res.lastInsertRowid));
  }

  updateWorkflow(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getWorkflow(id);
    if (!existing) throw new Error(`سير العمل رقم ${id} غير موجود.`);

    const sets = [];
    const args = [];

    if (patch.name !== undefined && patch.name.trim()) {
      sets.push('name = ?');
      args.push(patch.name.trim());
    }
    if (patch.trigger_type !== undefined) {
      sets.push('trigger_type = ?');
      args.push(patch.trigger_type);
    }
    if (patch.criteria !== undefined) {
      sets.push('criteria_json = ?');
      args.push(typeof patch.criteria === 'string' ? patch.criteria : JSON.stringify(patch.criteria));
    }
    if (patch.actions !== undefined) {
      sets.push('actions_json = ?');
      args.push(typeof patch.actions === 'string' ? patch.actions : JSON.stringify(patch.actions));
    }
    if (patch.is_active !== undefined) {
      sets.push('is_active = ?');
      args.push(patch.is_active ? 1 : 0);
    }

    if (sets.length > 0) {
      args.push(id);
      db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return this.getWorkflow(id);
  }

  deleteWorkflow(id) {
    const db = dbManager.getDb();
    const res = db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * Evaluate and execute active workflows against a document.
   */
  evaluateWorkflows(doc, docService, classificationService) {
    const workflows = this.listWorkflows().results.filter((w) => w.is_active);
    const appliedActions = [];

    for (const wf of workflows) {
      let matched = false;
      const c = wf.criteria;

      // Condition: title contains
      if (c.title_contains && doc.title && doc.title.includes(c.title_contains)) {
        matched = true;
      }
      // Condition: content contains
      if (c.content_contains && doc.content && doc.content.includes(c.content_contains)) {
        matched = true;
      }

      if (matched) {
        const a = wf.actions;
        if (a.add_tag) {
          const allTags = classificationService.listTags().results;
          const tag = allTags.find((t) => t.name === a.add_tag);
          if (tag && !doc.tags.includes(tag.id)) {
            const newTags = [...doc.tags, tag.id];
            docService.updateDocument(doc.id, { tags: newTags });
            appliedActions.push(`إسناد الوسم "${a.add_tag}" بواسطة سير العمل "${wf.name}"`);
          }
        }
        if (a.set_document_type) {
          const allTypes = classificationService.listDocumentTypes().results;
          const dt = allTypes.find((t) => t.name === a.set_document_type);
          if (dt) {
            docService.updateDocument(doc.id, { document_type: dt.id });
            appliedActions.push(`تحديد نوع المستند "${a.set_document_type}" بواسطة سير العمل "${wf.name}"`);
          }
        }
      }
    }
    return appliedActions;
  }

  // ==========================================
  // 3. BACKGROUND TASKS
  // ==========================================
  recordTask({ task_type, status = 'RUNNING', document_id = null, message = '' }) {
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO app_tasks (task_type, status, document_id, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const res = stmt.run(task_type, status, document_id, message, now);
    return Number(res.lastInsertRowid);
  }

  updateTask(id, { status, message = '', finished = false }) {
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const finishedAt = finished ? now : null;
    const stmt = db.prepare(`
      UPDATE app_tasks
      SET status = ?, message = ?, finished_at = COALESCE(?, finished_at)
      WHERE id = ?
    `);
    stmt.run(status, message, finishedAt, id);
  }

  listTasks(limit = 50) {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM app_tasks ORDER BY id DESC LIMIT ?').all(limit);
    return { count: rows.length, results: rows };
  }

  // ==========================================
  // 4. APP LOGS
  // ==========================================
  log(level = 'INFO', source = 'App', message = '') {
    try {
      const db = dbManager.getDb();
      const now = new Date().toISOString();
      const stmt = db.prepare('INSERT INTO app_logs (level, source, message, created_at) VALUES (?, ?, ?, ?)');
      stmt.run(level.toUpperCase(), source, message, now);
    } catch (e) {
      console.warn('Logging error:', e.message);
    }
  }

  listLogs({ limit = 100, level = null } = {}) {
    const db = dbManager.getDb();
    let q = 'SELECT * FROM app_logs';
    const args = [];
    if (level) {
      q += ' WHERE level = ?';
      args.push(level.toUpperCase());
    }
    q += ' ORDER BY id DESC LIMIT ?';
    args.push(limit);
    const rows = db.prepare(q).all(...args);
    return { count: rows.length, results: rows };
  }

  clearLogs() {
    const db = dbManager.getDb();
    db.prepare('DELETE FROM app_logs').run();
    return true;
  }

  // ==========================================
  // 5. LOCAL USERS
  // ==========================================
  listUsers() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT id, username, display_name, email, role, created_at FROM local_users ORDER BY id ASC').all();
    return { count: rows.length, results: rows };
  }

  getUser(id) {
    const db = dbManager.getDb();
    return db.prepare('SELECT id, username, display_name, email, role, created_at FROM local_users WHERE id = ?').get(id) || null;
  }

  createUser({ username, display_name = '', email = '', role = 'user' }) {
    if (!username || !username.trim()) throw new Error('اسم المستخدم مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO local_users (username, display_name, email, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const res = stmt.run(username.trim(), display_name.trim() || username.trim(), email.trim(), role, now);
    return this.getUser(Number(res.lastInsertRowid));
  }

  updateUser(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getUser(id);
    if (!existing) throw new Error(`المستخدم رقم ${id} غير موجود.`);

    const sets = [];
    const args = [];

    if (patch.display_name !== undefined) {
      sets.push('display_name = ?');
      args.push(patch.display_name.trim());
    }
    if (patch.email !== undefined) {
      sets.push('email = ?');
      args.push(patch.email.trim());
    }
    if (patch.role !== undefined) {
      sets.push('role = ?');
      args.push(patch.role);
    }

    if (sets.length > 0) {
      args.push(id);
      db.prepare(`UPDATE local_users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return this.getUser(id);
  }
}

module.exports = new ArchiveService();
