const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "cbs-extension", "manifest.json"), "utf8")
);
const cbsWorker = fs.readFileSync(
  path.join(root, "cbs-extension", "service-worker.js"),
  "utf8"
);
const espnWorker = fs.readFileSync(
  path.join(root, "cbs-extension", "service-worker-v050.js"),
  "utf8"
);

for (const entry of manifest.content_scripts || []) {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(entry, "world"),
    "Safari-compatible manifest must not declare content_scripts.world"
  );
}

const allManifestScripts = (manifest.content_scripts || []).flatMap(function (entry) {
  return entry.js || [];
});
assert.ok(!allManifestScripts.includes("cbs-browser-connector.js"));
assert.ok(!allManifestScripts.includes("cbs-main-bridge.js"));
assert.ok(!allManifestScripts.includes("espn-main-bridge.js"));
assert.ok(allManifestScripts.includes("cbs-content-bridge.js"));
assert.ok(allManifestScripts.includes("espn-content-bridge.js"));
assert.ok(allManifestScripts.includes("sanctum-content-bridge.js"));

assert.match(cbsWorker, /globalThis\.browser\s*\|\|\s*globalThis\.chrome/);
assert.match(cbsWorker, /function\s+injectCbsMainWorld\s*\(/);
assert.match(cbsWorker, /world:\s*"MAIN"/);
assert.match(cbsWorker, /"cbs-browser-connector\.js"/);
assert.match(cbsWorker, /"cbs-main-bridge\.js"/);
assert.match(cbsWorker, /await\s+injectCbsMainWorld\s*\(/);

assert.match(espnWorker, /function\s+injectEspnMainWorld\s*\(/);
assert.match(espnWorker, /world:\s*"MAIN"/);
assert.match(espnWorker, /"espn-main-bridge\.js"/);
assert.match(espnWorker, /await\s+injectEspnMainWorld\(espnTab\.id\)/);

console.log("safari-extension-main-world: PASS");
