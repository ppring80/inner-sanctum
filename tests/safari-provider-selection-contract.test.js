const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const bridge = fs.readFileSync(
  path.join(root, "cbs-extension", "sanctum-content-bridge.js"),
  "utf8"
);

// Starting ESPN must remain tied to the provider Connect button handler.
assert.match(bridge, /event\.target\.closest\("#providerForms \.connect-btn"\)/);
assert.match(bridge, /if\s*\(isSelected\("espn"\)\)[\s\S]*beginEspnConnect\(\)/);

// Provider-row clicks may refresh/render ESPN UI, but must not start a connection.
const rowListenerMatch = bridge.match(/addEventListener\([\s\S]*?#platformRow[\s\S]*?\n\s*\}\);/);
if (rowListenerMatch) {
  assert.doesNotMatch(rowListenerMatch[0], /INNER_SANCTUM_START_ESPN_CONNECT/);
  assert.doesNotMatch(rowListenerMatch[0], /beginEspnConnect\(/);
}

console.log("safari-provider-selection-contract: PASS");
