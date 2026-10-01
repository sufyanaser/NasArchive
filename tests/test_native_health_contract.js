const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const api = read('src/js/api.js');
const statusStart = api.indexOf('async getStatus()');
const statusEnd = api.indexOf('async getDevices', statusStart);
assert(statusStart >= 0 && statusEnd > statusStart, 'Unable to isolate getStatus() contract');
const statusMethod = api.slice(statusStart, statusEnd);

const settings = read('src/js/settings.js');
const index = read('src/index.html');
const service = read('electron/core/service_manager.js');

assert(!statusMethod.includes('127.0.0.1:8001'), 'API health must not fall back to localhost HTTP');
assert(!statusMethod.includes('paperless: { online:'), 'API health must not expose a Paperless runtime alias');

for (const legacyId of ['statusDocker', 'statusPaperless', 'statusBridge', 'topPillPaperless', 'dashHealthPaperless']) {
  assert(!settings.includes(legacyId), `settings.js still references legacy id ${legacyId}`);
  assert(!index.includes(legacyId), `index.html still references legacy id ${legacyId}`);
}

assert(!service.includes('docker: true'), 'Native health snapshot must not expose docker compatibility state');
assert(!service.includes('paperless: true'), 'Native health snapshot must not expose paperless compatibility state');
assert(!service.includes('bridge: true'), 'Native health snapshot must not expose bridge compatibility state');
assert(service.includes("architecture: 'native'"), 'Native architecture marker is missing');

console.log('Native health contract regression checks passed.');
