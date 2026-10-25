"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path=require("node:path");
const {prepare}=require("../scripts/prepare-sage-acceptance");
const root=path.resolve(__dirname,"..");
prepare(root,{SAGE_ACCEPTANCE_MODE:"isolated",SAGE_ACCEPTANCE_SITE_ID:"synthetic-test",SITE_ID:"synthetic-test",SAGE_ACCEPTANCE_ORIGIN:"https://synthetic-test.netlify.app"});
const {run,register} = require("../.sage-acceptance/lib/acceptance/espn-preservation-assertions");
const good=run();
assert.equal(Object.keys(good.assertions).length,7);
assert.ok(Object.values(good.assertions).every(value=>value==="PASS"));
let tool;
register({registerTool:(name,options,callback)=>{tool={name,options,callback};}},require("zod").z);
tool.options.outputSchema.parse(good);
assert.deepEqual(tool.options.inputSchema.parse({roster:"SYNTHETIC_PRIVATE_PAYLOAD"}),{});
const snapshot=require("../.sage-acceptance/lib/netlify/functions/league-snapshot");
const original=snapshot.acceptanceCanonical;
const secret="SYNTHETIC_PRIVATE_PLAYER_LEAGUE_COOKIE_TOKEN";
const logs=[];
const oldLog=console.log,oldError=console.error,oldWarn=console.warn;
try {
  console.log=console.error=console.warn=(...args)=>logs.push(args);
  snapshot.acceptanceCanonical=()=>{throw new Error(secret);};
  const failed=run({roster:secret,token:secret});
  assert.ok(Object.values(failed.assertions).every(value=>value==="FAIL"));
  assert.ok(!JSON.stringify(failed).includes(secret));
  assert.deepEqual(logs,[]);
} finally {snapshot.acceptanceCanonical=original;console.log=oldLog;console.error=oldError;console.warn=oldWarn;}
const source=fs.readFileSync(require.resolve("../netlify/functions/chatgpt-mcp"),"utf8");
assert.ok(!source.includes('register(server, z)'),'test registration cannot be in source MCP');
assert.match(source,/route\.method ===\s*"tools\/call"/,'all tool calls retain existing OAuth protection');
console.log("PASS: fixed synthetic assertions pass; private request values ignored; failures sanitized; no logs or production registration.");

// A corrupted synthetic slot must fail its unchanged association assertion.
snapshot.acceptanceCanonical=input=>original({...input,roster:input.roster.map(p=>({...p,lineupSlotId:5}))});
const broken=run();
assert.equal(broken.assertions.player_slot_associations,"FAIL");
assert.equal(broken.stage,"COMPLETE");
assert.equal(broken.errorCategory,"NONE");
assert.equal(Object.values(broken.assertions).filter(v=>v==="PASS").length,6);
snapshot.acceptanceCanonical=original;
assert.ok(!fs.readFileSync(require.resolve("../netlify/functions/league-snapshot"),"utf8").includes("exports.acceptanceCanonical"));
