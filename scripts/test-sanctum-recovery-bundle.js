"use strict";
// Unprivileged recovery validation for the already-accepted pre-browser baseline.
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  assert = require("node:assert/strict");
(async () => {
  const root = process.cwd();
  assert.equal(
    cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    require("./test-sanctum-phase1").ACCEPTED.sha,
  );
  const { zipFunctions } = await import(process.env.SAGE_ZISI_MODULE);
  const dest = fs.mkdtempSync("/tmp/sage-recovery-bundle-");
  const result = await zipFunctions(
    root + "/.sage-acceptance/functions",
    dest,
    {
      basePath: root + "/acceptance",
      config: {
        "*": {
          nodeBundler: "esbuild",
          nodeVersion: "24",
          includedFiles: ["../.sage-acceptance/lib/**"],
        },
      },
    },
  );
  assert.equal(result.length, 2);
  const names = cp
    .execFileSync("unzip", ["-Z1", dest + "/chatgpt-mcp.zip"], {
      encoding: "utf8",
    })
    .split("\n");
  const entry = names.find((n) =>
    n.endsWith("/.sage-acceptance/functions/chatgpt-mcp.js"),
  );
  assert.ok(entry);
  cp.execFileSync("unzip", [
    "-q",
    dest + "/chatgpt-mcp.zip",
    "-d",
    dest + "/extracted",
  ]);
  const bundle = path.join(dest, "extracted", entry);
  const probe = bundle + ".verification.cjs";
  fs.writeFileSync(
    probe,
    fs.readFileSync(bundle, "utf8") +
      "\nexports.recoveryProbe=require_espn_preservation_assertions();\n",
  );
  try {
    const r = require(probe).recoveryProbe.run();
    assert.equal(r.stage, "COMPLETE");
    assert.equal(r.errorCategory, "NONE");
    assert.equal(
      Object.values(r.assertions).filter((v) => v === "PASS").length,
      7,
    );
    console.log(
      "PASS accepted recovery bundle: 7/7 unchanged assertions. New browser path is not applicable to this baseline.",
    );
  } finally {
    fs.rmSync(probe, { force: true });
  }
})().catch(() => {
  console.error("Recovery bundle verification failed");
  process.exitCode = 1;
});
