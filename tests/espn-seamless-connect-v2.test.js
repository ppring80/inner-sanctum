const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "cbs-extension", "manifest.json"), "utf8")
);
const mainBridge = fs.readFileSync(
  path.join(root, "cbs-extension", "espn-main-bridge.js"),
  "utf8"
);
const contentBridge = fs.readFileSync(
  path.join(root, "cbs-extension", "espn-content-bridge.js"),
  "utf8"
);
const sanctumBridge = fs.readFileSync(
  path.join(root, "cbs-extension", "sanctum-content-bridge.js"),
  "utf8"
);
const worker = fs.readFileSync(
  path.join(root, "cbs-extension", "service-worker-v050.js"),
  "utf8"
);

assert.strictEqual(manifest.manifest_version, 3);
assert.strictEqual(manifest.background.service_worker, "service-worker-v050.js");
assert.ok(manifest.permissions.includes("storage"));
assert.ok(manifest.host_permissions.includes("https://fantasy.espn.com/*"));
assert.ok(manifest.host_permissions.includes("https://lm-api-reads.fantasy.espn.com/*"));

const espnScripts = manifest.content_scripts.filter(function (entry) {
  return entry.matches && entry.matches.includes("https://fantasy.espn.com/football/*");
});
assert.strictEqual(espnScripts.length, 2);
assert.ok(espnScripts.some(function (entry) {
  return entry.js.includes("espn-main-bridge.js");
}));
assert.ok(espnScripts.some(function (entry) {
  return entry.js.includes("espn-content-bridge.js");
}));

// Protect the ESPN default-position namespace from lineup-slot IDs.
assert.match(mainBridge, /1:\s*"QB"/);
assert.match(mainBridge, /2:\s*"RB"/);
assert.match(mainBridge, /3:\s*"WR"/);
assert.match(mainBridge, /4:\s*"TE"/);
assert.match(mainBridge, /5:\s*"K"/);
assert.match(mainBridge, /16:\s*"D\/ST"/);
assert.doesNotMatch(mainBridge, /0:\s*"QB"/);
assert.doesNotMatch(mainBridge, /6:\s*"TE"/);
assert.doesNotMatch(mainBridge, /17:\s*"K"/);
assert.match(mainBridge, /lineupSlotId:\s*entry\?\.lineupSlotId/);

// Browser adapter is shared across Chromium and Safari Web Extensions.
assert.match(contentBridge, /globalThis\.browser\s*\|\|\s*globalThis\.chrome/);
assert.match(sanctumBridge, /globalThis\.browser\s*\|\|\s*globalThis\.chrome/);
assert.match(worker, /globalThis\.browser\s*\|\|\s*globalThis\.chrome/);

// ESPN must be browser-assisted and customer-safe.
assert.match(sanctumBridge, /INNER_SANCTUM_START_ESPN_CONNECT/);
assert.match(sanctumBridge, /no League ID, Public\/Private selection, Developer Tools, SWID or espn_s2 copy\/paste required/);
assert.match(worker, /connectionMode:\s*"browser-assisted"/);
assert.match(worker, /private:\s*true/);

// CBS remains delegated to its existing production worker.
assert.match(worker, /importScripts\("service-worker\.js"\)/);

console.log("espn-seamless-connect-v2: PASS");
