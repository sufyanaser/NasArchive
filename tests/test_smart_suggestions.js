const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const storage = require('../electron/core/storage');
const dbManager = require('../electron/core/db');
const docService = require('../electron/core/documents');
const suggestions = require('../electron/core/smart_suggestions');

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n' +
  '0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n',
  'binary'
);

function fieldId(name) {
  const row = dbManager.getDb().prepare('SELECT id FROM custom_fields WHERE name = ?').get(name);
  assert(row, `Missing custom field: ${name}`);
  return row.id;
}

function createDoc(root, title, department, values, modifiedAt) {
  const source = path.join(root, `${title.replace(/[^\w]+/g, '_')}.pdf`);
  fs.writeFileSync(source, MINIMAL_PDF);
  const custom_fields = Object.entries(values).map(([name, value]) => ({
    field: fieldId(name),
    value,
  }));
  const doc = docService.createDocument({
    title,
    content: title,
    department,
    original_filename: path.basename(source),
    original_file_path: source,
    original_checksum: storage.computeFileHash(source),
    original_size: fs.statSync(source).size,
    original_mime_type: 'application/pdf',
    custom_fields,
  });
  if (modifiedAt) {
    dbManager.getDb().prepare('UPDATE documents SET modified_at = ? WHERE id = ?').run(modifiedAt, doc.id);
  }
  return doc;
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    if (force) this.add(name);
    else this.remove(name);
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  querySelectorAll(selector) {
    if (selector !== '.smart-suggest-item') return [];
    return this.children.filter((child) => child.className && child.className.includes('smart-suggest-item'));
  }
}

function testKeyboardNavigation() {
  global.window = {};
  global.document = {
    createElement: (tag) => new FakeElement(tag),
  };
  delete require.cache[require.resolve('../src/js/documents.js')];
  require('../src/js/documents.js');
  const controller = new window.DocumentsController();
  const input = new FakeElement('input');
  const menu = new FakeElement('div');
  let dispatched = false;
  input.dispatchEvent = () => { dispatched = true; };
  global.Event = function Event(type) { this.type = type; };

  controller._renderSuggestionMenu(input, menu, [
    { value: 'مديرية التخطيط العمراني' },
    { value: 'مديرية تربية الأنبار' },
  ]);
  assert(menu.classList.contains('open'), 'Suggestion menu should open.');
  assert.strictEqual(controller.suggestionState.selectedIndex, 0, 'First suggestion should be selected by default.');

  const downEvent = { key: 'ArrowDown', preventDefault: () => { downEvent.prevented = true; } };
  controller._handleSuggestionKeydown(downEvent, input, menu);
  assert.strictEqual(downEvent.prevented, true, 'ArrowDown should prevent default.');
  assert.strictEqual(controller.suggestionState.selectedIndex, 1, 'ArrowDown should select next item.');

  const upEvent = { key: 'ArrowUp', preventDefault: () => { upEvent.prevented = true; } };
  controller._handleSuggestionKeydown(upEvent, input, menu);
  assert.strictEqual(controller.suggestionState.selectedIndex, 0, 'ArrowUp should select previous item.');

  const enterEvent = { key: 'Enter', preventDefault: () => { enterEvent.prevented = true; } };
  controller._handleSuggestionKeydown(enterEvent, input, menu);
  assert.strictEqual(input.value, 'مديرية التخطيط العمراني', 'Enter should apply selected value.');
  assert.strictEqual(dispatched, true, 'Enter should dispatch input event after selection.');
  assert.strictEqual(menu.classList.contains('open'), false, 'Enter should close menu.');

  controller._renderSuggestionMenu(input, menu, [{ value: 'Legal Affairs' }]);
  const escEvent = { key: 'Escape', preventDefault: () => { escEvent.prevented = true; } };
  controller._handleSuggestionKeydown(escEvent, input, menu);
  assert.strictEqual(escEvent.prevented, true, 'Escape should prevent default.');
  assert.strictEqual(menu.classList.contains('open'), false, 'Escape should close menu.');

  delete global.window;
  delete global.document;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-smart-suggestions-'));
  storage.initialize(root);
  dbManager.initialize(path.join(root, 'nas.sqlite'));

  let empty = suggestions.getSuggestions('sender', '', { limit: 5 });
  assert.deepStrictEqual(empty.suggestions, [], 'Empty database should return no suggestions.');

  createDoc(root, 'doc-a', 'تناسق', {
    'الجهة المرسلة': 'مديرية التخطيط العمراني في الأنبار',
    'الجهة المستلمة': 'NAS Archive Office',
    'الكتاب المرجعي': 'كتاب مرجعي 2026',
    'معتمد للمزامنة': 'نعم',
    'راجعه': 'Sufyan',
    'رقم القيد': 'REG-2026-0042',
    'ملاحظات': 'مراجعة مكتملة',
  }, '2026-01-02T00:00:00.000Z');
  createDoc(root, 'doc-b', 'تناسق', {
    'الجهة المرسلة': 'مديرية التخطيط العمراني في الأنبار',
    'الجهة المستلمة': 'Finance Team',
    'الكتاب المرجعي': 'كتاب مرجعي 2026',
    'معتمد للمزامنة': 'نعم',
    'راجعه': 'Sara',
    'رقم القيد': 'REG-2026-0043',
    'ملاحظات': 'مراجعة مكتملة',
  }, '2026-01-03T00:00:00.000Z');
  createDoc(root, 'doc-c', 'NAS FM', {
    'الجهة المرسلة': 'مديرية تربية الأنبار',
    'الجهة المستلمة': 'NAS Archive Office',
    'الكتاب المرجعي': 'Broadcast REF',
    'معتمد للمزامنة': 'لا',
    'راجعه': 'Omar',
    'رقم القيد': 'FM-100',
    'ملاحظات': 'English note',
  }, '2026-01-04T00:00:00.000Z');
  createDoc(root, 'doc-d', 'الرنين', {
    'الجهة المرسلة': 'دائرة المنظمات غير الحكومية',
    'الجهة المستلمة': 'Legal Affairs',
    'الكتاب المرجعي': 'NGO-REF',
    'معتمد للمزامنة': 'نعم',
    'راجعه': 'Sufyan',
    'رقم القيد': 'RN-200',
    'ملاحظات': 'English note',
  }, '2026-01-05T00:00:00.000Z');

  let res = suggestions.getSuggestions('sender', 'مديرية التخطيط العمراني في الأنبار');
  assert.strictEqual(res.suggestions[0].value, 'مديرية التخطيط العمراني في الأنبار', 'Exact match should rank first.');

  res = suggestions.getSuggestions('sender', 'مديرية');
  assert(res.suggestions[0].value.startsWith('مديرية'), 'Prefix match should be returned.');

  res = suggestions.getSuggestions('sender', 'تربية');
  assert.strictEqual(res.suggestions[0].value, 'مديرية تربية الأنبار', 'Contains match should work.');

  res = suggestions.getSuggestions('sender', 'الانبار');
  assert(res.suggestions.some((s) => s.value.includes('الأنبار')), 'Arabic normalization should match hamza variants.');

  res = suggestions.getSuggestions('recipient', 'finance');
  assert.strictEqual(res.suggestions[0].value, 'Finance Team', 'English search should work case-insensitively.');

  res = suggestions.getSuggestions('sender', 'مديرية', { limit: 10 });
  const values = res.suggestions.map((s) => s.value);
  assert.strictEqual(values.filter((v) => v === 'مديرية التخطيط العمراني في الأنبار').length, 1, 'Duplicates should be removed.');

  res = suggestions.getSuggestions('reviewed_by', '', { limit: 2 });
  assert.strictEqual(res.suggestions.length, 2, 'Limit should be respected.');

  res = suggestions.getSuggestions('sender', '', { department: 'NAS FM', limit: 5 });
  assert.strictEqual(res.suggestions[0].value, 'مديرية تربية الأنبار', 'Context department should improve ranking.');

  createDoc(root, 'doc-new-value', 'تناسق', {
    'الجهة المرسلة': 'دائرة المنظمات غير الحكومية',
  }, '2026-01-06T00:00:00.000Z');
  res = suggestions.getSuggestions('sender', 'دائرة المنظمات');
  assert.strictEqual(res.suggestions[0].value, 'دائرة المنظمات غير الحكومية', 'Newly saved values should become suggestions.');

  assert.throws(() => suggestions.getSuggestions('archive_file_path', ''), /Invalid suggestion field/, 'Invalid fields must be rejected.');

  res = suggestions.getSuggestions('sender', "' OR 1=1 --");
  assert.strictEqual(res.suggestions.length, 0, 'SQL-like input should not broaden results.');
  const stillThere = suggestions.getSuggestions('sender', 'مديرية');
  assert(stillThere.suggestions.length > 0, 'Database should remain usable after SQL-like input.');

  const handlers = {};
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: {
          handle: (channel, handler) => { handlers[channel] = handler; },
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../electron/core/ipc_handlers')];
    const { setupNativeIpcHandlers } = require('../electron/core/ipc_handlers');
    setupNativeIpcHandlers(root);
    assert.strictEqual(typeof handlers['suggestions:get'], 'function', 'suggestions:get IPC handler should be registered.');
    const ipcRes = await handlers['suggestions:get'](null, {
      field: 'sender',
      query: 'مديرية',
      context: { department: 'تناسق', limit: 5 },
    });
    assert.strictEqual(ipcRes.success, true, 'IPC suggestion flow should succeed.');
    assert(ipcRes.suggestions.length > 0, 'IPC suggestion flow should return database values.');
  } finally {
    Module._load = originalLoad;
  }

  testKeyboardNavigation();

  dbManager.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Smart suggestions regression tests passed.');
}

main().catch((err) => {
  try { dbManager.close(); } catch (e) {}
  console.error(err);
  process.exit(1);
});
