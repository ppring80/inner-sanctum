"use strict";
// Real unpacked extension in disposable Chrome. All requests intercepted; no live league.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),Module=require('module'),crypto=require('crypto');
const {memory}=require('../tests/espn-synthetic-session.test');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.sage-acceptance');
const stores=new Map();const getStore=o=>{const n=typeof o==='string'?o:o.name;if(!stores.has(n))stores.set(n,memory());return stores.get(n);};
const original=Module._load;Module._load=function(name,...rest){return name==='@netlify/blobs'?{getStore,connectLambda(){}}:original.call(this,name,...rest);};
const {origin}=require('../acceptance/synthetic-fixture');
async function run(){
 const runtime=require(path.join(out,'lib/acceptance/synthetic-runtime'));
 const mcp=require(path.join(out,'lib/netlify/functions/chatgpt-mcp'));
 const token='FIXED_SYNTHETIC_AUTH_ONLY';await getStore({name:'chatgpt-oauth'}).setJSON('access:'+crypto.createHash('sha256').update(token).digest('hex'),{expiresAt:Math.floor(Date.now()/1000)+3600,resource:origin+'/.netlify/functions/chatgpt-mcp',scopes:['inner_sanctum.league.read']});
 const call=async(name,authorized=true)=>mcp.handler({httpMethod:'POST',path:'/.netlify/functions/chatgpt-mcp',headers:{host:new URL(origin).host,'content-type':'application/json',accept:'application/json, text/event-stream',...(authorized?{authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}})},{});
 assert.equal((await call('get_espn_stored_assertions',false)).statusCode,401);
 const {chromium}=require(process.env.SAGE_PLAYWRIGHT_MODULE||'playwright');
 const args=['--no-sandbox','--disable-dev-shm-usage','--disable-extensions-except='+out+'/private-extension','--load-extension='+out+'/private-extension'];
 const browser=await chromium.launchPersistentContext(fs.mkdtempSync('/tmp/sage-synthetic-browser-'),{headless:true,channel:"chromium",...(process.env.SAGE_CHROME_EXECUTABLE?{executablePath:process.env.SAGE_CHROME_EXECUTABLE}:{}),ignoreDefaultArgs:['--disable-extensions'],args});
 let denied=0;
 try{
  await browser.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==origin){denied++;return route.abort();}
   if(u.pathname==='/.netlify/functions/espn-synthetic'){const r=await runtime.handler({httpMethod:req.method(),headers:req.headers(),body:req.postData()});return route.fulfill({status:r.statusCode,headers:r.headers,body:r.body});}
   const f=path.join(out,'public',u.pathname.startsWith('/football/')?'football.html':u.pathname.slice(1));if(!f.startsWith(out+'/public/')||!fs.existsSync(f))return route.fulfill({status:404,body:''});
   return route.fulfill({status:200,contentType:f.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(f)});
  });
  const page=await browser.newPage();await page.goto(origin+'/connect-league.html#synthetic-a');
  await page.click('#begin');await page.waitForFunction(()=>document.getElementById('status').textContent==='200');
  for(const team of ['synthetic-a','synthetic-b']){
   const provider=await browser.newPage();await provider.goto(origin+'/football/team?leagueId=synthetic-league&teamId='+team+'&seasonId=2026');
   await page.goto(origin+'/connect-league.html#'+team);await page.evaluate(t=>window.selectCase(t),team);await page.click('#capture');
   await page.waitForFunction(t=>window.LeagueConnection.getConnection('espn')?.teamId===t,team);
   await page.click('#upload');await page.waitForFunction(()=>document.getElementById('status').textContent==='200');await provider.close();
  }
  const result=await call('get_espn_stored_assertions');assert.equal(result.statusCode,200);
  const body=result.body.startsWith('event:')||result.body.includes('\ndata:')?JSON.parse(result.body.split('data: ')[1].split('\n')[0]):JSON.parse(result.body);
  const report=body.result.structuredContent;assert.equal(report.ok,true);assert.equal(Object.values(report.assertions).filter(x=>x==='PASS').length,7);
  assert.equal((await runtime.handler({httpMethod:'POST',headers:{origin:'https://theinnersanctum.xyz'},body:'{"action":"begin"}'})).statusCode,403);
  for(const name of ['cleanup_espn_synthetic','verify_espn_cleanup']){const r=await call(name);assert.equal(r.statusCode,200);assert.ok(r.body.includes('"ok":true'));}
  assert.equal(denied,0,'capture must answer fixture requests without any external network');
  console.log(JSON.stringify({browser:'PASS',storedAssertions:report,cleanup:'PASS',liveNetworkRequests:0}));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Module._load=original;});
