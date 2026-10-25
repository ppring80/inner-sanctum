"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {run,register} = require("../acceptance/espn-preservation-assertions");
const good=run();
assert.equal(Object.keys(good.assertions).length,7);
assert.ok(Object.values(good.assertions).every(value=>value==="PASS"));
let tool;
register({registerTool:(name,options,callback)=>{tool={name,options,callback};}},require("zod").z);
tool.options.outputSchema.parse(good);
assert.deepEqual(tool.options.inputSchema.parse({roster:"SYNTHETIC_PRIVATE_PAYLOAD"}),{});
const original=fs.readFileSync;
const secret="SYNTHETIC_PRIVATE_PLAYER_LEAGUE_COOKIE_TOKEN";
const logs=[];
const oldLog=console.log,oldError=console.error,oldWarn=console.warn;
try {
  console.log=console.error=console.warn=(...args)=>logs.push(args);
  fs.readFileSync=()=>{throw new Error(secret);};
  const failed=run({roster:secret,token:secret});
  assert.ok(Object.values(failed.assertions).every(value=>value==="FAIL"));
  assert.ok(!JSON.stringify(failed).includes(secret));
  assert.deepEqual(logs,[]);
} finally {fs.readFileSync=original;console.log=oldLog;console.error=oldError;console.warn=oldWarn;}
const source=fs.readFileSync(require.resolve("../netlify/functions/chatgpt-mcp"),"utf8");
assert.ok(!source.includes('register(server, z)'),'test registration cannot be in source MCP');
assert.match(source,/route\.method ===\s*"tools\/call"/,'all tool calls retain existing OAuth protection');
console.log("PASS: fixed synthetic assertions pass; private request values ignored; failures sanitized; no logs or production registration.");
