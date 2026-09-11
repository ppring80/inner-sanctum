const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const worker = fs.readFileSync(
  path.join(root, "cbs-extension", "service-worker.js"),
  "utf8"
);

assert.match(worker, /const\s+extensionApi\s*=\s*globalThis\.browser\s*\|\|\s*globalThis\.chrome/);
assert.match(worker, /function\s+injectCbsMainWorld\s*\(/);
assert.match(worker, /files:\s*\[[\s\S]*"cbs-browser-connector\.js"[\s\S]*"cbs-main-bridge\.js"[\s\S]*\]/);
assert.match(worker, /await\s+injectCbsMainWorld\s*\(\s*cbsTab\.id\s*\)/);
assert.match(worker, /extensionApi\.tabs\.sendMessage/);

console.log("cbs-safari-main-world: PASS");
