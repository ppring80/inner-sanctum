'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('weekly.html','utf8');
const loader=html.match(/function loadWeeklyRankings\(\) \{[\s\S]*?\n\}/)[0];
const server=fs.readFileSync('netlify/functions/weekly-sage-rankings.js','utf8');
const fetcher=server.slice(server.indexOf('async function fetchPositionLeaderboard'),server.indexOf('exports.handler'));
const full=Object.fromEntries(['QB','RB','WR','TE','K','DEF'].map(p=>[p,[{name:p,position:p}]]));
async function main(){
 const bad={leaderboard:[],inactive:[{name:'Unavailable WR'}],failures:[{error:'weekly-sage-wr-score: component HTTP 502'}],nextStep:{ready:false}};
 const api={LEADERBOARD_FUNCTION_BY_POSITION:{WR:'weekly-sage-wr-leaderboard'},URLSearchParams,Date,fetch:async()=>({ok:true,json:async()=>bad})};vm.createContext(api);vm.runInContext(fetcher,api);
 const result=await api.fetchPositionLeaderboard({baseUrl:'https://example.test',position:'WR',season:2026,week:4,seasonType:'reg',scoring:'half'});
 assert.equal(result.ok,false);assert.match(result.error,/component HTTP 502/);assert.equal(result.data,bad);
 api.fetch=async()=>({ok:true,json:async()=>({leaderboard:[{name:'WR'}]})});assert.equal((await api.fetchPositionLeaderboard({baseUrl:'https://example.test',position:'WR'})).ok,true);
 const ctx={state:{myRosterOnly:false},Date,encodeURIComponent,getSelectedSeason:()=>2026,getSelectedWeek:()=>4,getScoringFormat:()=> 'half',flattenRankings:d=>Object.values(d.positions).flat(),updateWeeklyContextUI(){},renderTable(){},buildConnectedProviderFallback(){throw Error('Full pool replaced with roster');}};
 vm.createContext(ctx);vm.runInContext(loader,ctx);
 ctx.fetch=async()=>({ok:true,json:async()=>({positions:{...full,WR:[]},inactive:{WR:[{name:'Unavailable WR'}]},metadata:{complete:true,positionsFailed:[]}})});
 await ctx.loadWeeklyRankings();assert.match(ctx.state.loadError,/Missing positions: WR/,'inactive WR must not conceal an empty active pool');
 let resolveOld;
 ctx.fetch=()=>new Promise(resolve=>{resolveOld=resolve;});const old=ctx.loadWeeklyRankings();
 ctx.getScoringFormat=()=> 'half';ctx.fetch=async url=>{assert.match(url,/scoring=half/);return {ok:true,json:async()=>({positions:full,metadata:{positionsFailed:[]}})}};
 await ctx.loadWeeklyRankings();resolveOld({ok:true,json:async()=>({positions:{...full,WR:[]},metadata:{positionsFailed:[]}})});await old;
 assert.equal(ctx.state.rankings.positions.WR.length,1);assert.equal(ctx.state.loadError,null,'old empty response cannot replace newer complete data');
 assert(html.includes('if (connectedScoringChanged) loadWeeklyRankings();'),'connected scoring change must reload rankings');
 console.log('Inactive WR masking, builder failure provenance, connected scoring reload, and stale response protection passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
