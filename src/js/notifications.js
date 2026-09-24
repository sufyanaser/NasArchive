/**
 * NAS Archive — macOS-Inspired Desktop Notification & Dialog System
 * Replaces native JavaScript alert() and confirm() dialogs with elegant,
 * non-blocking floating toast notifications and macOS-style confirmation modals.
 */

class ToastNotifier {
  constructor() {
    this.container = null;
    this.activeToasts = new Map(); // key -> { element, count, timer }
    this._ensureContainer();
  }

  _ensureContainer() {
    if (this.container && document.body.contains(this.container)) return;
    this.container = document.getElementById('toastNotificationContainer');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toastNotificationContainer';
      this.container.className = 'toast-notification-container';
      this.container.setAttribute('aria-live', 'polite');
      this.container.setAttribute('role', 'region');
      this.container.setAttribute('aria-label', 'الإشعارات');
      document.body.appendChild(this.container);
    }
  }

  /**
   * Generic show notification method.
   */
  show({
    type = 'info', // 'success' | 'error' | 'warning' | 'info'
    title = '',
    message = '',
    duration = 4000,
    retry = null,
  }) {
    this._ensureContainer();

    const textMessage = String(message || '').trim();
    const textTitle = title ? String(title).trim() : this._defaultTitle(type);
    const key = `${type}:${textTitle}:${textMessage}`;

    // Deduplication check: if identical notification is already visible, bump its count and bounce
    if (this.activeToasts.has(key)) {
      const existing = this.activeToasts.get(key);
      existing.count += 1;
      let badge = existing.element.querySelector('.toast-repeat-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'toast-repeat-badge';
        existing.element.appendChild(badge);
      }
      badge.textContent = `×${existing.count}`;

      // Reset auto-dismiss timer if applicable
      if (existing.timer) clearTimeout(existing.timer);
      if (duration > 0 && type !== 'error') {
        existing.timer = setTimeout(() => this._dismiss(key), duration);
      }

      existing.element.classList.remove('toast-bounce');
      void existing.element.offsetWidth; // trigger reflow
      existing.element.classList.add('toast-bounce');
      return existing.element;
    }

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    // Icon based on type
    const iconHtml = this._getIcon(type);

    let retryBtnHtml = '';
    if (retry && typeof retry === 'function') {
      retryBtnHtml = `<button class="toast-action-btn" type="button">إعادة المحاولة</button>`;
    }

    toast.innerHTML = `
      <div class="toast-icon-wrapper">${iconHtml}</div>
      <div class="toast-body">
        <div class="toast-title">${this._escape(textTitle)}</div>
        ${textMessage ? `<div class="toast-message">${this._escape(textMessage)}</div>` : ''}
        ${retryBtnHtml}
      </div>
      <button class="toast-close-btn" type="button" title="إغلاق" aria-label="إغلاق الإشعار">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;

    // Hook Close Button
    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dismiss(key);
    });

    // Hook Retry Button
    if (retry && typeof retry === 'function') {
      const retryBtn = toast.querySelector('.toast-action-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._dismiss(key);
          try { retry(); } catch (err) { console.error('Retry error:', err); }
        });
      }
    }

    this.container.appendChild(toast);

    // Entrance transition
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss logic: success, info, warning auto-dismiss; errors stay visible until acknowledged
    let timer = null;
    if (type !== 'error' && duration > 0) {
      timer = setTimeout(() => this._dismiss(key), duration);
    }

    this.activeToasts.set(key, { element: toast, count: 1, timer });
    return toast;
  }

  _dismiss(key) {
    if (!this.activeToasts.has(key)) return;
    const { element, timer } = this.activeToasts.get(key);
    if (timer) clearTimeout(timer);

    element.classList.remove('toast-visible');
    element.classList.add('toast-hiding');
    this.activeToasts.delete(key);

    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }, 280);
  }

  success(message, title = 'تم بنجاح') {
    return this.show({ type: 'success', title, message, duration: 4000 });
  }

  error(message, title = 'تعذر تنفيذ العملية', options = {}) {
    return this.show({
      type: 'error',
      title,
      message,
      duration: options.duration || 0, // Errors stay visible
      retry: options.retry || null,
    });
  }

  warning(message, title = 'تنبيه') {
    return this.show({ type: 'warning', title, message, duration: 5500 });
  }

  info(message, title = 'معلومة') {
    return this.show({ type: 'info', title, message, duration: 4000 });
  }

  /**
   * macOS-style Confirmation Modal dialog returning Promise<boolean>.
   * Replaces native window.confirm().
   */
  confirm({
    title = 'تأكيد العملية',
    message = 'هل أنت متأكد من رغبتك في متابعة هذا الإجراء؟',
    confirmText = 'متابعة',
    cancelText = 'إلغاء',
    danger = false,
  } = {}) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'confirm-dialog-overlay';

      modal.innerHTML = `
        <div class="confirm-dialog-card">
          <div class="confirm-dialog-header">
            <div class="confirm-dialog-icon ${danger ? 'danger' : 'primary'}">
              ${danger ? `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              ` : `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              `}
            </div>
            <div>
              <div class="confirm-dialog-title">${this._escape(title)}</div>
              <div class="confirm-dialog-message">${this._escape(message)}</div>
            </div>
          </div>
          <div class="confirm-dialog-actions">
            <button class="btn-secondary btn-cancel" type="button">${this._escape(cancelText)}</button>
            <button class="${danger ? 'btn-danger' : 'btn-primary'} btn-confirm" type="button">${this._escape(confirmText)}</button>
          </div>
        </div>
      `;

      const cleanup = (result) => {
        modal.classList.remove('open');
        document.removeEventListener('keydown', onKeyDown);
        setTimeout(() => {
          if (modal.parentNode) modal.parentNode.removeChild(modal);
          resolve(result);
        }, 200);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') cleanup(false);
        if (e.key === 'Enter') cleanup(true);
      };

      modal.querySelector('.btn-cancel').addEventListener('click', () => cleanup(false));
      modal.querySelector('.btn-confirm').addEventListener('click', () => cleanup(true));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) cleanup(false);
      });

      document.body.appendChild(modal);
      document.addEventListener('keydown', onKeyDown);

      requestAnimationFrame(() => {
        modal.classList.add('open');
        modal.querySelector('.btn-confirm').focus();
      });
    });
  }

  _defaultTitle(type) {
    switch (type) {
      case 'success': return 'تمت العملية بنجاح';
      case 'error': return 'تعذر إتمام الإجراء';
      case 'warning': return 'تنبيه هام';
      default: return 'إشعار النظام';
    }
  }

  _getIcon(type) {
    switch (type) {
      case 'success':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
      case 'error':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
      case 'warning':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    }
  }

  _escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Instantiate globally
window.notifications = new ToastNotifier();
window.toast = window.notifications;
window.confirmDialog = (opts) => window.notifications.confirm(opts);

// Override native alert to use non-blocking toast notifications
window.alert = function (message) {
  if (typeof message === 'string' && (message.includes('خطأ') || message.includes('فشل') || message.includes('تعذر'))) {
    window.notifications.error(message);
  } else if (typeof message === 'string' && (message.includes('نجاح') || message.includes('تم '))) {
    window.notifications.success(message);
  } else {
    window.notifications.info(message);
  }
};
