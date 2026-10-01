const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'js', 'app.js'), 'utf8');
const documentsJs = fs.readFileSync(path.join(root, 'src', 'js', 'documents.js'), 'utf8');

for (const label of ['الرئيسية', 'الوارد', 'الأرشيف', 'المسح والاستيراد', 'إدارة البيانات', 'النظام']) {
  assert(html.includes(label), `Navigation should include ${label}.`);
}

for (const scope of ['كل المستندات', 'بانتظار المراجعة', 'المؤرشفة', 'سلة المهملات']) {
  assert(html.includes(scope), `Archive sub-navigation should include ${scope}.`);
}

for (const tab of ['المستند', 'المراسلات', 'المراجعة', 'OCR', 'تقني']) {
  assert(html.includes(`data-editor-tab=`) && html.includes(tab), `Document editor tab should include ${tab}.`);
}

assert(html.includes('workspace-topbar'), 'Unified workspace topbar should exist.');
assert(html.includes('globalSearchInput'), 'Global search input should exist.');
assert(css.includes('@media (max-width: 1400px), (max-height: 820px)'), '1366x768 responsive pass should be codified.');
assert(css.includes(':focus-visible'), 'Visible focus states should be present.');
assert(appJs.includes("event.ctrlKey && event.key.toLowerCase() === 'k'"), 'Ctrl+K shortcut should focus search.');
assert(appJs.includes("event.ctrlKey && event.key.toLowerCase() === 'n'"), 'Ctrl+N shortcut should open import flow.');
assert(documentsJs.includes('setArchiveScope(scope)'), 'Document workspace should expose archive scope switching.');
assert(documentsJs.includes('_setupEditorTabs()'), 'Document editor tabs should have controller behavior.');

console.log('Premium UI contract tests passed.');
