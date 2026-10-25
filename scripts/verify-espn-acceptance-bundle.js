#!/usr/bin/env node
"use strict";
// Run against an extracted, actual zip-it-and-ship-it function artifact.
// The verification copy adds an internal export only; deployed files are untouched.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const bundle=path.resolve(process.argv[2]);
const source=fs.readFileSync(bundle,"utf8");
assert.ok(source.includes("var require_espn_preservation_assertions ="));
const probe=bundle+".verification.cjs";
try {
  fs.writeFileSync(probe,source+"\nexports.__assertions=require_espn_preservation_assertions();\nexports.__snapshot=require_league_snapshot();\n");
  const runtime=require(probe), runner=runtime.__assertions, snapshot=runtime.__snapshot;
  const good=runner.run();
  assert.equal(good.stage,"COMPLETE");assert.equal(good.errorCategory,"NONE");
  assert.match(good.buildSha,/^[a-f0-9]{40}$/);
  assert.equal(Object.values(good.assertions).filter(v=>v==="PASS").length,7);
  const original=snapshot.acceptanceCanonical;
  try {
    snapshot.acceptanceCanonical=input=>original({...input,roster:input.roster.map(p=>({...p,lineupSlotId:5}))});
    const broken=runner.run();
    assert.equal(broken.assertions.player_slot_associations,"FAIL");
    assert.equal(Object.values(broken.assertions).filter(v=>v==="PASS").length,6);
    assert.equal(broken.stage,"COMPLETE");assert.equal(broken.errorCategory,"NONE");
    snapshot.acceptanceCanonical=()=>{throw new Error("SYNTHETIC_SECRET_MUST_NOT_ESCAPE");};
    const failed=runner.run();
    assert.equal(failed.errorCategory,"EXECUTION_FAILED");
    assert.equal(Object.values(failed.assertions).filter(v=>v==="FAIL").length,7);
    assert.ok(!JSON.stringify(failed).includes("SYNTHETIC_SECRET"));
  } finally {snapshot.acceptanceCanonical=original;}
  console.log(JSON.stringify({good,brokenFixture:"6 PASS / 1 expected FAIL",exceptionSanitized:true}));
} finally {fs.rmSync(probe,{force:true});}
