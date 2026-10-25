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
  const hiddenValue = 'SYNTHETIC_VALUE_MUST_NEVER_APPEAR';
  for (const key of ['ANTHROPIC_API_KEY','TANK01_API_KEY','OPENAI_API_KEY','NETLIFY_AUTH_TOKEN','OTHER_PROVIDER_SECRET']) {
    assert.throws(() => assertIsolated({...env,[key]:hiddenValue},event), error => {
      assert.equal(error.message, 'Acceptance credential preflight failed (values withheld); rejected variable names: '+JSON.stringify([key]));
      assert.ok(!error.stack.includes(hiddenValue),'diagnostic and stack must never contain credential values');
      return true;
    });
  }
  assert.throws(() => assertIsolated({...env,Z_BUILD_TOKEN:hiddenValue,A_PROVIDER_KEY:hiddenValue,UNRELATED:'safe'},event), error => {
    assert.ok(error.message.endsWith('["A_PROVIDER_KEY","Z_BUILD_TOKEN"]'),'all rejected names are sorted deterministically');
    assert.ok(!error.message.includes('UNRELATED'));
    assert.ok(!error.stack.includes(hiddenValue));
    return true;
  });
  const skewEnv = {...env,NETLIFY_SKEW_PROTECTION_TOKEN:hiddenValue};
  assert.doesNotThrow(() => assertIsolated(skewEnv),'exact Netlify skew variable is permitted during build');
  assert.doesNotThrow(() => assertIsolated(skewEnv,event),'exact Netlify skew variable is permitted at runtime');
  for (const key of ['PRODUCTION_TOKEN','PRODUCTION_SECRET','PROVIDER_API_KEY','DATABASE_CONNECTION_STRING','SERVICE_PASSWORD',
    'NETLIFY_AUTH_TOKEN','ANTHROPIC_API_KEY','NETLIFY_SKEW_PROTECTION_TOKEN_SECRET','NETLIFY_SKEW_PROTECTION_API_KEY']) {
    assert.throws(() => assertIsolated({...skewEnv,[key]:'SYNTHETIC_PRODUCTION_VALUE'},event), error => {
      assert.equal(error.message,'Acceptance credential preflight failed (values withheld); rejected variable names: '+JSON.stringify([key]));
      assert.ok(!error.stack.includes(hiddenValue));
      assert.ok(!error.stack.includes('SYNTHETIC_PRODUCTION_VALUE'));
      return true;
    });
  }
  assert.throws(() => assertIsolated({...skewEnv,SITE_ID:PRODUCTION_SITE_ID}),/site identity mismatch/);
  const platformRuntimeEnv = {...skewEnv,AWS_LAMBDA_METADATA_TOKEN:hiddenValue,NETLIFY_FUNCTIONS_TOKEN:hiddenValue};
  for (const key of ['AWS_LAMBDA_METADATA_TOKEN','NETLIFY_FUNCTIONS_TOKEN']) {
    assert.doesNotThrow(() => assertIsolated({...env,[key]:hiddenValue},event));
  }
  assert.doesNotThrow(() => assertIsolated(platformRuntimeEnv),'cold-start guard accepts both observed infrastructure variables');
  assert.doesNotThrow(() => assertIsolated(platformRuntimeEnv,event),'invocation guard accepts both observed infrastructure variables');
  for (const key of ['PRODUCTION_TOKEN','PRODUCTION_SECRET','PROVIDER_API_KEY','DATABASE_CONNECTION_STRING','SERVICE_PASSWORD',
    'NETLIFY_AUTH_TOKEN','ANTHROPIC_API_KEY','NETLIFY_FUNCTIONS_TOKEN_SECRET','NETLIFY_OTHER_TOKEN',
    'AWS_LAMBDA_METADATA_TOKEN_SECRET','AWS_OTHER_TOKEN']) {
    assert.throws(() => assertIsolated({...platformRuntimeEnv,[key]:'SYNTHETIC_UNAUTHORIZED_VALUE'},event), error => {
      assert.equal(error.message,'Acceptance credential preflight failed (values withheld); rejected variable names: '+JSON.stringify([key]));
      assert.ok(!error.stack.includes(hiddenValue));
      assert.ok(!error.stack.includes('SYNTHETIC_UNAUTHORIZED_VALUE'));
      return true;
    });
  }
  assert.throws(() => assertIsolated({...platformRuntimeEnv,SITE_ID:PRODUCTION_SITE_ID}),/site identity mismatch/);
  assert.throws(() => assertIsolated(platformRuntimeEnv,{headers:{'x-nf-site-id':PRODUCTION_SITE_ID}}),/invocation site mismatch/);
  assert.throws(() => assertIsolated({...platformRuntimeEnv,NETLIFY_BLOBS_CONTEXT:Buffer.from(JSON.stringify({siteID:PRODUCTION_SITE_ID})).toString('base64')},event),/storage identity mismatch/);
  assert.doesNotThrow(() => assertIsolated({...env,EMPTY_TOKEN:''},event));
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
  const buildEnv = {...gitConfig.build.environment, SITE_ID:site, NETLIFY_SKEW_PROTECTION_TOKEN:hiddenValue, PATH:bin+path.delimiter+process.env.PATH};
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
  const packagedLib = path.join(out,'lib');
  const identity = path.join(packagedLib,'player-identity.js');
  assert.deepEqual(fs.readFileSync(identity),fs.readFileSync(path.join(root,'player-identity.js')),
    'shared identity dependency is copied byte-for-byte into private lib');
  const localImportsResolve = () => {
    let checked = 0;
    const seen = new Set();
    const pending = ['chatgpt-mcp.js','chatgpt-oauth.js'].map(name => path.join(out,'functions',name));
    while (pending.length) {
      const file = pending.pop();
      if (seen.has(file) || !file.endsWith('.js')) continue;
      seen.add(file);
      const relative = path.relative(out,file);
      const resolver = Module.createRequire(file);
      const source = fs.readFileSync(file,'utf8');
      for (const match of source.matchAll(/\brequire\(\s*(['"])(\.[^'"]*)\1\s*\)/g)) {
        const resolved = resolver.resolve(match[2]);
        assert.ok(resolved.startsWith(packagedLib+path.sep),'relative imports must stay inside the private package: '+relative);
        assert.ok(fs.existsSync(resolved),'packaged dependency missing: '+relative+' -> '+match[2]);
        pending.push(resolved);
        checked++;
      }
    }
    return checked;
  };
  assert.ok(localImportsResolve()>10,'verify both entry points and their transitive local dependencies without executing handlers');
  for (const name of ['_super-sage-lineup-decision.js','_super-sage-lineup-service.js','_super-sage-role-establishment.js']) {
    const original = path.join(root,'netlify/functions',name);
    const packaged = path.join(packagedLib,'netlify/functions',name);
    assert.deepEqual(fs.readFileSync(packaged),fs.readFileSync(original),'production SAGE modules remain byte-identical');
    assert.equal(Module.createRequire(packaged).resolve('../../player-identity'),identity);
  }
  // Prove the packaging check catches the exact omission from the failed deploy.
  fs.unlinkSync(identity);
  assert.throws(localImportsResolve,/packaged dependency missing|Cannot find module/);
  fs.copyFileSync(path.join(root,'player-identity.js'),identity);
  localImportsResolve();
  assert.deepEqual(fs.readdirSync(path.join(out,'functions')).sort(),['chatgpt-mcp.js','chatgpt-oauth.js']);
  const toml = fs.readFileSync(path.join(out,'netlify.toml'),'utf8');
  assert.doesNotMatch(toml,/schedule|SECRETS_SCAN_ENABLED/);
  assert.deepEqual(fs.readdirSync(path.join(out,'public')).sort(),['_headers','_redirects','build.json','index.html']);
  const fixture = JSON.parse(fs.readFileSync(path.join(out,'lib/acceptance/football-fixture.json')));
  assert.equal(fixture.provenance.kind,'synthetic');
  let networkCalls = 0, handlerCalls = 0;
  const storageRequests = [];
  const sdk = require('@netlify/blobs');
  const sandbox = {process:{env:{SITE_ID:site,AWS_LAMBDA_METADATA_TOKEN:hiddenValue,NETLIFY_FUNCTIONS_TOKEN:hiddenValue}},exports:{},URL,Buffer,Response,
    globalThis:{fetch:async(input,options)=>{networkCalls++;storageRequests.push({input:String(input),options});return new Response('{}');}},
    require:p=>{
      if(p === '@netlify/blobs') return {connectLambda:e=>{
        // Run the real SDK initializer, retaining its output in the VM's environment.
        const previous = process.env.NETLIFY_BLOBS_CONTEXT;
        try { sdk.connectLambda(e); sandbox.process.env.NETLIFY_BLOBS_CONTEXT = process.env.NETLIFY_BLOBS_CONTEXT; }
        finally { if(previous === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = previous; }
      }};
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
  // Rejected endpoint diagnostics must contain only parsed protocol and hostname.
  for (const endpoint of ['https://private-user:private-password@untrusted.example:8443/private-path?token=private-query#private-fragment',
    'http://private-user:private-password@test.blobs.netlify.com:8080/private-path?token=private-query#private-fragment']) {
    const parsed = new URL(endpoint);
    const rejectedEvent = {...event, blobs:Buffer.from(JSON.stringify({url:endpoint,token:'private-invocation-token',other:'private-invocation-data'})).toString('base64')};
    await assert.rejects(()=>sandbox.exports.handler(rejectedEvent),error=>{
      assert.equal(error.message,'Untrusted Blobs endpoint; '+JSON.stringify({protocol:parsed.protocol,hostname:parsed.hostname}));
      for (const secret of ['private-user','private-password','8443','8080','private-path','private-query','private-fragment','private-invocation-token','private-invocation-data']) {
        assert.equal(error.message.includes(secret),false);
        assert.equal(error.stack.includes(secret),false);
      }
      return true;
    });
  }
  assert.equal(handlerCalls,1,'rejected endpoints never reach authentication handler');
  assert.equal(networkCalls,0);
  // Real SDK context and request construction, with synthetic credentials and no network.
  const platformEvent = {...event,blobs:Buffer.from(JSON.stringify({url:'https://edge.netlifyblobs.com',token:'synthetic-only'})).toString('base64')};
  assert.equal((await sandbox.exports.handler(platformEvent)).statusCode,401);
  const context = JSON.parse(Buffer.from(sandbox.process.env.NETLIFY_BLOBS_CONTEXT,'base64').toString());
  assert.equal(context.siteID,site);
  assert.equal(context.edgeURL,'https://edge.netlifyblobs.com');
  const previousContext = process.env.NETLIFY_BLOBS_CONTEXT;
  try {
    process.env.NETLIFY_BLOBS_CONTEXT = sandbox.process.env.NETLIFY_BLOBS_CONTEXT;
    for (const region of [undefined,'us-east-2']) {
      const store = sdk.getStore({name:'acceptance-regression',region,fetch:sandbox.globalThis.fetch});
      await store.get('synthetic-key');
    }
  } finally { if(previousContext === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = previousContext; }
  assert.equal(networkCalls,2);
  assert.ok(storageRequests.every(r=>r.options.redirect === 'error'));
  for (const target of [
    'https://edge.netlifyblobs.com/'+PRODUCTION_SITE_ID+'/'+site+'/store',
    'https://edge.netlifyblobs.com/other/'+site+'/store',
    'https://edge.netlifyblobs.com/region:invalid/'+site+'/store',
    'https://edge.netlifyblobs.com/region:us-east-2/'+PRODUCTION_SITE_ID+'/'+site,
    'https://edge.netlifyblobs.com/'+site+'-suffix/store',
    'https://edge.netlifyblobs.com:8443/'+site+'/store',
    'https://user:password@edge.netlifyblobs.com/'+site+'/store',
    'https://edge.netlifyblobs.com.evil.example/'+site+'/store',
    'http://edge.netlifyblobs.com/'+site+'/store',
    'https://theinnersanctum.xyz/'+site+'/store',
    'https://api.anthropic.com/'+site+'/store'
  ]) await assert.rejects(()=>sandbox.globalThis.fetch(target,{redirect:'follow'}),/network access blocked/);
  await assert.rejects(()=>sandbox.exports.handler({...platformEvent,headers:{'x-nf-site-id':PRODUCTION_SITE_ID}}),/invocation site mismatch/);
  for (const endpoint of ['https://edge.netlifyblobs.com:8443','https://user:password@edge.netlifyblobs.com','http://edge.netlifyblobs.com','not-a-url']) {
    await assert.rejects(()=>sandbox.exports.handler({...platformEvent,blobs:Buffer.from(JSON.stringify({url:endpoint,token:'synthetic-only'})).toString('base64')}),/Blobs endpoint/);
    await assert.rejects(()=>sandbox.globalThis.fetch('https://edge.netlifyblobs.com/'+site+'/store'),/network access blocked/);
  }
  // Even caller-supplied redirect:follow is overridden before the transport.
  await sandbox.exports.handler(platformEvent);
  await sandbox.globalThis.fetch('https://edge.netlifyblobs.com/'+site+'/store',{redirect:'follow'});
  assert.equal(storageRequests.at(-1).options.redirect,'error');
  assert.equal(networkCalls,3,'denied requests never reach transport');
  const rank = await sandbox.globalThis.fetch(origin+'/.netlify/functions/weekly-sage-rankings?season=2026&week=7');
  assert.deepEqual(await rank.json(),fixture.rankings);
  const wrongPeriod = await sandbox.globalThis.fetch(origin+'/.netlify/functions/weekly-sage-rankings?season=2026&week=8');
  assert.equal(wrongPeriod.status,404);
  fs.rmSync(out,{recursive:true,force:true});
  console.log('PASS: production defaults, isolated discovery, fail-closed identity/credentials/storage, committed Git config and build, two-endpoint packaging, paid-tool/network exclusion, synthetic evidence and period binding.');
})().catch(e=>{console.error(e);process.exitCode=1;});
