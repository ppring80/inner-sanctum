'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { oauthConfiguration, PRODUCTION_SITE_ID } = require('../netlify/functions/_sage-oauth-config');
const { assertIsolated } = require('../acceptance/runtime');
const root = path.resolve(__dirname, '..');
const origin = 'https://sprightly-chebakia-13d478.netlify.app';
const site = 'dcdb8384-114c-4f80-a2fe-acc0ecb39d57';
const env = { SAGE_ACCEPTANCE_MODE:'isolated', SAGE_ACCEPTANCE_ORIGIN:origin, SAGE_ACCEPTANCE_SITE_ID:site, SITE_ID:site };
const event = { headers: { 'x-nf-site-id':site }, blobs:Buffer.from(JSON.stringify({url:'https://test.blobs.netlify.com',token:'synthetic-platform-token'})).toString('base64') };
(async () => {
  assert.equal(oauthConfiguration({}).issuer, 'https://theinnersanctum.xyz');
  assert.equal(oauthConfiguration({}).resource, 'https://theinnersanctum.xyz/.netlify/functions/chatgpt-mcp');
  assert.equal(oauthConfiguration(env).issuer, origin);
  for (const override of [
    {SITE_ID:PRODUCTION_SITE_ID}, {SAGE_ACCEPTANCE_SITE_ID:PRODUCTION_SITE_ID},
    {SAGE_ACCEPTANCE_ORIGIN:'https://theinnersanctum.xyz'},
    {SAGE_ACCEPTANCE_ORIGIN:'https://delicate-dragon-447881.netlify.app'},
    {SAGE_ACCEPTANCE_ORIGIN:'https://deploy-preview-324--other.netlify.app'},
    {SAGE_ACCEPTANCE_ORIGIN:origin+'/'}, {SAGE_ACCEPTANCE_ORIGIN:'http://fixture.netlify.app'},
  ]) assert.throws(() => oauthConfiguration({...env,...override}));
  assert.throws(() => oauthConfiguration({SAGE_ACCEPTANCE_ORIGIN:origin}));
  for (const key of ['ANTHROPIC_API_KEY','TANK01_API_KEY','OPENAI_API_KEY','NETLIFY_AUTH_TOKEN','OTHER_PROVIDER_SECRET']) {
    assert.throws(() => assertIsolated({...env,[key]:'not-a-real-secret'}, event), /credential preflight/);
  }
  assert.throws(() => assertIsolated(env, {headers:{'x-nf-site-id':PRODUCTION_SITE_ID}}), /invocation site mismatch/);
  assert.throws(() => assertIsolated({...env,NETLIFY_BLOBS_CONTEXT:Buffer.from(JSON.stringify({siteID:PRODUCTION_SITE_ID})).toString('base64')},event), /storage identity mismatch/);
  assertIsolated(env,event);

  // Exercise actual OAuth discovery handlers with isolated storage stubs; no tokens or network.
  const load = Module._load;
  const originalEnv = {...process.env};
  Object.assign(process.env, env);
  Module._load = function(request,parent,isMain) {
    if (request === '@netlify/blobs') return { connectLambda:()=>{}, getStore:()=>({get:async()=>null,setJSON:async()=>{throw Error('Unexpected storage write');}}) };
    return load.call(this,request,parent,isMain);
  };
  let oauth;
  try {
    delete require.cache[require.resolve('../netlify/functions/chatgpt-oauth')];
    oauth = require('../netlify/functions/chatgpt-oauth');
    const metadata = await oauth.handler({...event,httpMethod:'GET',queryStringParameters:{action:'authorization-server'}});
    const data = JSON.parse(metadata.body);
    assert.equal(data.issuer,origin);
    for(const key of ['authorization_endpoint','token_endpoint','registration_endpoint']) assert.ok(data[key].startsWith(origin+'/'));
    assert.ok(data.code_challenge_methods_supported.includes('S256'));
    const protectedResource = await oauth.handler({...event,httpMethod:'GET',queryStringParameters:{action:'protected-resource'}});
    assert.equal(JSON.parse(protectedResource.body).resource,origin+'/.netlify/functions/chatgpt-mcp');
  } finally {
    Module._load = load;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env,originalEnv);
    delete require.cache[require.resolve('../netlify/functions/chatgpt-oauth')];
  }

  // Parse the committed Git-build configuration and execute its actual command.
  // Python's standard TOML parser avoids another npm dependency or test framework.
  const gitConfig = JSON.parse(execFileSync('python3', ['-c',
    'import json,tomllib; print(json.dumps(tomllib.load(open("acceptance/netlify.toml","rb"))))'],
    {cwd:root,encoding:'utf8'}));
  assert.deepEqual(Object.keys(gitConfig).sort(), ['build','functions']);
  assert.deepEqual(Object.keys(gitConfig.build).sort(), ['command','environment','functions','ignore','publish']);
  assert.equal(gitConfig.build.command, 'cd .. && node scripts/prepare-sage-acceptance.js && npm install --ignore-scripts --omit=dev --no-audit --no-fund 1>&2');
  assert.equal(gitConfig.build.ignore,'exit 1','changes outside acceptance must still trigger automatic builds');
  assert.equal(gitConfig.build.publish, '../.sage-acceptance/public');
  assert.equal(gitConfig.build.functions, '../.sage-acceptance/functions');
  assert.deepEqual(gitConfig.functions, {node_bundler:'esbuild',included_files:['../.sage-acceptance/lib/**']});
  assert.deepEqual(gitConfig.build.environment, { NODE_VERSION:'24', SAGE_ACCEPTANCE_MODE:'isolated',
    SAGE_ACCEPTANCE_ORIGIN:origin, SAGE_ACCEPTANCE_SITE_ID:site });
  const base = path.join(root,'acceptance');
  // Execute the actual command from Netlify's chosen base. Stub only npm so the
  // offline gate records dependency setup without package downloads or hooks.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(),'sage-acceptance-npm-'));
  const npmMarker = path.join(bin,'called');
  fs.writeFileSync(path.join(bin,'npm'), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$*" >> "'+npmMarker+'"\n', {mode:0o755});
  const buildEnv = {...gitConfig.build.environment, SITE_ID:site, PATH:bin+path.delimiter+process.env.PATH};
  let built;
  try {
    built = JSON.parse(execFileSync('bash', ['-c',gitConfig.build.command],
      {cwd:base,env:buildEnv,encoding:'utf8'}));
    assert.equal(path.resolve(base,gitConfig.build.publish),path.join(root,'.sage-acceptance/public'));
    assert.equal(path.resolve(base,gitConfig.build.functions),path.join(root,'.sage-acceptance/functions'));
    assert.equal(path.resolve(base,gitConfig.functions.included_files[0]),path.join(root,'.sage-acceptance/lib/**'));
    assert.equal(fs.readFileSync(npmMarker,'utf8'),root+'\ninstall --ignore-scripts --omit=dev --no-audit --no-fund\n');
    fs.unlinkSync(npmMarker);
    for (const override of [{SITE_ID:PRODUCTION_SITE_ID},{ANTHROPIC_API_KEY:'synthetic-rejected-value'}]) {
      assert.throws(() => execFileSync('bash',['-c',gitConfig.build.command],
        {cwd:base,env:{...buildEnv,...override},stdio:'pipe'}));
      assert.equal(fs.existsSync(npmMarker),false,'site/credential preflight must fail before dependency setup');
    }
  } finally { fs.rmSync(bin,{recursive:true,force:true}); }
  const {out,manifest} = built;
  assert.equal(manifest.siteId,site);
  assert.deepEqual(fs.readdirSync(path.join(out,'functions')).sort(),['chatgpt-mcp.js','chatgpt-oauth.js']);
  const toml = fs.readFileSync(path.join(out,'netlify.toml'),'utf8');
  assert.doesNotMatch(toml,/schedule|SECRETS_SCAN_ENABLED/);
  assert.deepEqual(fs.readdirSync(path.join(out,'public')).sort(),['_headers','_redirects','build.json','index.html']);
  const fixture = JSON.parse(fs.readFileSync(path.join(out,'lib/acceptance/football-fixture.json')));
  assert.equal(fixture.provenance.kind,'synthetic');
  let networkCalls = 0, handlerCalls = 0;
  const sandbox = {process:{env:{SITE_ID:site}},exports:{},URL,Buffer,Response,
    globalThis:{fetch:async()=>{networkCalls++;return new Response('{}');}},
    require:p=>{
      if(p.endsWith('acceptance/runtime')) return {assertIsolated};
      if(p.endsWith('football-fixture.json')) return fixture;
      return {handler:async()=>{handlerCalls++;return {statusCode:401};}};
    }};
  vm.runInNewContext(fs.readFileSync(path.join(out,'functions/chatgpt-mcp.js'),'utf8'),sandbox);
  assert.equal((await sandbox.exports.handler({...event,httpMethod:'POST',body:JSON.stringify({method:'tools/call',params:{name:'request_rookie_review'}})})).statusCode,403);
  assert.equal(handlerCalls,0);
  assert.equal((await sandbox.exports.handler({...event,httpMethod:'POST',body:JSON.stringify({method:'tools/call',params:{name:'compare_players'}})})).statusCode,401,'allowed tool still uses unchanged authentication handler');
  assert.equal(handlerCalls,1);
  for(const url of ['https://theinnersanctum.xyz/.netlify/functions/weekly-sage-rankings','https://api.anthropic.com/v1/messages','https://tank01.example.com/','https://test.blobs.netlify.com/'+PRODUCTION_SITE_ID+'/store']) {
    await assert.rejects(()=>sandbox.globalThis.fetch(url),/network access blocked/);
  }
  assert.equal(networkCalls,0);
  const rank = await sandbox.globalThis.fetch(origin+'/.netlify/functions/weekly-sage-rankings?season=2026&week=7');
  assert.deepEqual(await rank.json(),fixture.rankings);
  const wrongPeriod = await sandbox.globalThis.fetch(origin+'/.netlify/functions/weekly-sage-rankings?season=2026&week=8');
  assert.equal(wrongPeriod.status,404);
  fs.rmSync(out,{recursive:true,force:true});
  console.log('PASS: production defaults, isolated discovery, fail-closed identity/credentials/storage, committed Git config and build, two-endpoint packaging, paid-tool/network exclusion, synthetic evidence and period binding.');
})().catch(e=>{console.error(e);process.exitCode=1;});
