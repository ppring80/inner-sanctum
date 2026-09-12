'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const cbsWorker = read('cbs-extension/service-worker.js');
const espnWorker = read('cbs-extension/service-worker-v050.js');
const sanctumBridge = read('cbs-extension/sanctum-content-bridge.js');
const manifest = JSON.parse(read('cbs-extension/manifest.json'));

// CBS seamless-connect invariants proven in live acceptance.
assert.match(cbsWorker, /VERSION 0\.1\.1/);
assert.match(cbsWorker, /const CBS_ENTRY_URL/);
assert.match(cbsWorker, /const CBS_PENDING_KEY/);
assert.match(cbsWorker, /const CBS_CONNECT_TIMEOUT_MS/);
assert.match(cbsWorker, /const cbsCaptureInFlight/);
assert.match(cbsWorker, /async function openCbsAndWait/);
assert.match(cbsWorker, /async function sendCbsCaptureRequest/);
assert.match(cbsWorker, /chrome\.tabs\.onUpdated\.addListener/);
assert.match(cbsWorker, /pending\.providerTabId !== tabId/);
assert.match(cbsWorker, /chrome\.tabs\.update\(\s*pending\.sanctumTabId/);

// ESPN pending-capture invariants proven in live acceptance.
assert.match(espnWorker, /ESPN_V050_CAPTURE_RETRY_MS\s*=\s*1000/);
assert.match(espnWorker, /ESPN_V050_CAPTURE_RETRY_LIMIT\s*=\s*12/);
assert.match(espnWorker, /async function retryPendingEspnCapture/);
assert.match(espnWorker, /espnCaptureInFlight\.has\(flightKey\)/);
assert.match(espnWorker, /espnCaptureInFlight\.add\(flightKey\)/);
assert.match(espnWorker, /finally\s*{\s*espnCaptureInFlight\.delete\(flightKey\)/);
assert.match(espnWorker, /await retryPendingEspnCapture\(tabId, pending\.sanctumTabId\)/);

// Provider-selection freeze protection remains installed and idempotent.
assert.match(sanctumBridge, /let refreshQueued = false/);
assert.match(sanctumBridge, /function queueEspnRefresh/);
assert.match(sanctumBridge, /if \(refreshQueued\) return/);
assert.match(sanctumBridge, /if \(info && info\.innerHTML !== ESPN_INFO_HTML\)/);

// Manifest must continue to route both providers through the combined worker.
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background && manifest.background.service_worker, 'service-worker-v050.js');
assert.ok((manifest.permissions || []).includes('storage'), 'session pending state requires storage permission');

console.log('PASS connected stack lock invariants');
