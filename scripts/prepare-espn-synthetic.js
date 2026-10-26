"use strict";
const fs=require('fs'),path=require('path'),vm=require('vm');
const {origin,cases,league}=require('../acceptance/synthetic-fixture');
function between(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<0)throw Error('source_anchor');return s.slice(a,b);}
async function prepare(root,out){
 const ext=path.join(out,'private-extension');fs.mkdirSync(ext,{recursive:true});
 const capture=fs.readFileSync(path.join(root,'cbs-extension/espn-main-bridge.js'),'utf8');
 const workerSource=fs.readFileSync(path.join(root,'cbs-extension/service-worker-v050.js'),'utf8');
 const delivery=between(workerSource,'async function deliverEspnToSanctum','async function sendEspnCapture');
 const pageSource=fs.readFileSync(path.join(root,'connect-league.html'),'utf8');
 const funcs=between(pageSource,'function getConnectedLeagueIdentity(','function setChatGptLinkMessage(');
 const {loadConnectPage,loadExtensionWorker,runInjectedFunction}=require('../tests/helpers/connect-page-harness');
 const expected={};
 for(const [team,,week] of cases){let listener,posted;const win={location:{href:origin+'/football/team?leagueId=synthetic-league&teamId='+team+'&seasonId=2026'},addEventListener:(t,f)=>listener=f,postMessage:m=>posted=m};
 vm.runInNewContext(capture,{window:win,document:{cookie:''},URL,Date,console:{log(){},warn(){},error(){}},encodeURIComponent,fetch:async u=>({ok:true,json:async()=>String(u).includes('proTeamSchedules')?{settings:{proTeams:[]}}:String(u).includes('kona_player')?{players:[]}:league(team)})});
 await listener({source:win,data:{type:'INNER_SANCTUM_ESPN_MAIN_CAPTURE_REQUEST',requestId:'synthetic'}});
 if(!posted?.success)throw Error('fixture_capture');
 const h=loadConnectPage(),w=loadExtensionWorker();await w.context.deliverEspnToSanctum(1,posted.data);runInjectedFunction(h,w.executeScriptCalls.at(-1));
 h.context.LeagueConnection.update('espn',{week,...(team==='synthetic-b'?{meta:{...posted.data.meta,capturedAt:null}}:{})});
 expected[team]=JSON.parse(JSON.stringify(h.context.buildChatGptLeagueSnapshot('espn',h.context.LeagueConnection.getConnection('espn'))));
 }
 fs.writeFileSync(path.join(out,'lib/acceptance/synthetic-expected.json'),JSON.stringify(expected));
 for(const name of ['synthetic-fixture.js','synthetic-session.js','synthetic-runtime.js'])fs.copyFileSync(path.join(root,'acceptance',name),path.join(out,'lib/acceptance',name));
 fs.copyFileSync(path.join(root,'league-connection.js'),path.join(out,'public/league-connection.js'));
 fs.copyFileSync(path.join(root,'provider-adapters.js'),path.join(out,'public/provider-adapters.js'));
 // The manager's optional context loader gets an inert test-only asset: no provider refresh.
 fs.writeFileSync(path.join(out,'public/team-context.js'),'/* synthetic acceptance: no refresh/context evaluation */');
 fs.writeFileSync(path.join(out,'public/snapshot-builder.js'),funcs);
 fs.writeFileSync(path.join(out,'public/connect-league.html'),`<!doctype html><title>ESPN synthetic acceptance</title><h1>Synthetic fixtures only</h1><button id="begin">Begin synthetic session</button><button id="capture">Capture synthetic fixture</button><button id="upload">Upload synthetic fixture once</button><output id="status"></output><div id="espnResult"></div><script src="/league-connection.js"></script><script src="/provider-adapters.js"></script><script src="/snapshot-builder.js"></script><script src="/synthetic-page.js"></script>`);
 fs.writeFileSync(path.join(out,'public/synthetic-page.js'),`const origin=${JSON.stringify(origin)};if(location.origin!==origin)throw Error('test_origin');document.getElementById('begin').onclick=async()=>{const r=await fetch('/.netlify/functions/espn-synthetic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'begin'})});document.getElementById('status').textContent=String(r.status);};let caseId='synthetic-a';window.selectCase=id=>{if(!['synthetic-a','synthetic-b'].includes(id))throw Error('fixture_case');caseId=id;};document.getElementById('upload').onclick=async()=>{const c=LeagueConnection.getConnection('espn');LeagueConnection.update('espn',{week:caseId==='synthetic-a'?8:10,...(caseId==='synthetic-b'?{meta:{...c.meta,capturedAt:null}}:{})});const snapshot=buildChatGptLeagueSnapshot('espn',LeagueConnection.getConnection('espn'));const r=await fetch('/.netlify/functions/espn-synthetic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upload',caseId,snapshot})});document.getElementById('status').textContent=String(r.status);};`);
 fs.writeFileSync(path.join(out,'public/football.html'),'<!doctype html><title>Synthetic ESPN</title>Fixed synthetic ESPN transport');
 const transport=`(()=>{const native=window.fetch;window.fetch=async input=>{const u=new URL(String(input));if(u.origin!=='https://lm-api-reads.fantasy.espn.com')throw Error('synthetic_network_blocked');const team=new URL(location.href).searchParams.get('teamId');const fixture=${JSON.stringify(Object.fromEntries(cases.map(([t])=>[t,league(t)])))};if(!fixture[team])throw Error('fixture_case');return Response.json(u.searchParams.get('view')==='proTeamSchedules_wl'?{settings:{proTeams:[]}}:u.searchParams.get('view')==='kona_player_info'?{players:[]}:fixture[team]);};})();`;
 fs.writeFileSync(path.join(ext,'synthetic-transport.js'),transport);
 fs.writeFileSync(path.join(ext,'espn-main-bridge.js'),capture);
 fs.copyFileSync(path.join(root,'cbs-extension/espn-content-bridge.js'),path.join(ext,'espn-content-bridge.js'));
 fs.writeFileSync(path.join(ext,'connect-bridge.js'),`document.getElementById('capture').onclick=()=>chrome.runtime.sendMessage({type:'SYNTHETIC_CAPTURE',caseId:window.location.hash.slice(1)||'synthetic-a'});`);
 fs.writeFileSync(path.join(ext,'worker.js'),`const extensionApi=chrome;const origin=${JSON.stringify(origin)};async function isEspnSanctumTabStillValid(id){return new URL((await chrome.tabs.get(id)).url).origin===origin;}\n${delivery}\nchrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.type!=='SYNTHETIC_CAPTURE')return; (async()=>{if(new URL(s.tab.url).origin!==origin||!['synthetic-a','synthetic-b'].includes(m.caseId))throw Error('test_origin');const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===origin+'/football/team?leagueId=synthetic-league&teamId='+m.caseId+'&seasonId=2026');if(!tab)throw Error('fixture_tab');const r=await chrome.tabs.sendMessage(tab.id,{type:'INNER_SANCTUM_ESPN_CAPTURE'});if(!r.success)throw Error('capture_failed');await deliverEspnToSanctum(s.tab.id,r.data);reply({ok:true});})().catch(()=>reply({ok:false}));return true;});`);
 fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'SAGE SYNTHETIC ONLY — PR332',version:'0.5.3',permissions:['tabs','scripting'],host_permissions:[origin+'/*'],background:{service_worker:'worker.js'},content_scripts:[{matches:[origin+'/football/*'],js:['synthetic-transport.js','espn-main-bridge.js'],world:'MAIN',run_at:'document_idle'},{matches:[origin+'/football/*'],js:['espn-content-bridge.js'],run_at:'document_idle'},{matches:[origin+'/connect-league.html*'],js:['connect-bridge.js'],run_at:'document_idle'}]},null,2));
 const mcp=path.join(out,'lib/netlify/functions/chatgpt-mcp.js');fs.writeFileSync(mcp,fs.readFileSync(mcp,'utf8').replace('  return server;\n}','  require("../../acceptance/synthetic-runtime").register(server,z);\n  return server;\n}'));
 const wrapper=fs.readFileSync(path.join(out,'functions/chatgpt-mcp.js'),'utf8');
 fs.writeFileSync(path.join(out,'functions/espn-synthetic.js'),wrapper.replace('require("../lib/netlify/functions/chatgpt-mcp").handler','require("../lib/acceptance/synthetic-runtime").handler'));
 for(const n of ['chatgpt-mcp','chatgpt-oauth','espn-synthetic']){const p=path.join(out,'functions',n+'.js');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('"get_espn_preservation_assertions"]','"get_espn_preservation_assertions", "get_espn_stored_assertions", "cleanup_espn_synthetic", "verify_espn_cleanup"]'));}
 fs.appendFileSync(path.join(out,'public/_headers'),`\n/connect-league.html\n  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'none'; frame-ancestors 'none'\n/football/*\n  Content-Security-Policy: default-src 'none'; connect-src 'none'; frame-ancestors 'none'\n`);
 fs.appendFileSync(path.join(out,'public/_redirects'),'/football/* /football.html 200\n');
}
module.exports={prepare};

if(require.main===module){const root=path.resolve(__dirname,'..');const {prepare:base}=require('./prepare-sage-acceptance');const built=base(root);prepare(root,built.out).then(()=>console.log(JSON.stringify(built))).catch(()=>{console.error('Synthetic preparation failed');process.exitCode=1;});}
