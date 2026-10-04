"use strict";

const assert = require("assert");
const fs = require("fs");

const mcp = fs.readFileSync("netlify/functions/chatgpt-mcp.js", "utf8");
const decision = fs.readFileSync("netlify/functions/_super-sage-lineup-decision.js", "utf8");

assert(
  mcp.includes("Cross-position comparison: no validated edge from comparable Super SAGE evidence."),
  "Compare must refuse to manufacture a cross-position winner from non-comparable evidence"
);
assert(
  mcp.includes("if (positions.size > 1)"),
  "Cross-position Compare guard must execute before raw SAGE-score fallback"
);
assert(
  mcp.indexOf("if (positions.size > 1)") < mcp.indexOf("const playersWithSageScore ="),
  "Cross-position guard must precede SAGE-score winner selection"
);
assert(
  decision.includes("Cross-position standing alone does not establish a large edge"),
  "BASELINE_TIE explanation must not falsely claim literal rank equality"
);
assert(
  !decision.includes("Their Weekly SAGE standings are tied; this is a close call."),
  "Misleading literal-tie language must stay removed"
);

console.log("Super SAGE cross-tool consistency contract: PASS");
