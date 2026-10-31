'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {applyGameEligibility} = require('../netlify/functions/weekly-sage-rankings');
const html = fs.readFileSync(require('path').join(__dirname,'../weekly.html'),'utf8');
const match=html.match(/function loadWeeklyRankings\(\) \{[\s\S]*?\n\}/);
assert(match);
async function main() {
  let fallbackCalls=0;
  let clock='2026-10-30T20:00:00Z',season=2026,week=4,scoring='half';
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return new Date(clock).getTime();}}
  const context={
    Date:FixedDate,state:{myRosterOnly:false},getSelectedSeason:()=>season,getSelectedWeek:()=>week,getScoringFormat:()=>scoring,
    fetch:async()=>({ok:false,json:async()=>({error:'Week 4 evidence unavailable'})}),
    flattenRankings:data=>Object.values(data.positions).flat(),
    buildConnectedProviderFallback:()=>{fallbackCalls++;return {metadata:{providerProjectionFallbackUsed:true},positions:{RB:[{name:'Roster RB'}]}}},
    updateWeeklyContextUI(){},renderTable(){},encodeURIComponent
  };
  vm.createContext(context);
  vm.runInContext(html.match(/function deriveCurrentWeeklyWeek\(now\) \{[\s\S]*?\n\}/)[0],context);
  vm.runInContext(match[0],context);
  await context.loadWeeklyRankings();
  assert.equal(context.state.rankings,null,'full pool must not be replaced by connected roster');
  assert.equal(fallbackCalls,0);assert(context.state.loadError.includes('unavailable'));
  context.state.myRosterOnly=true;await context.loadWeeklyRankings();
  assert.equal(fallbackCalls,1);assert(context.state.rankings.metadata.providerProjectionFallbackUsed);
  context.state.myRosterOnly=false;
  context.fetch=async url=>{assert(url.includes('evidenceUsage=archive'));return {ok:true,json:async()=>({positions:{RB:[{name:'Full pool RB'}]},metadata:{positionsFailed:['QB']}})}};
  await context.loadWeeklyRankings();assert(context.state.loadError.includes('QB'),'partial data must be disclosed');
  assert.equal(context.state.rankings.positions.RB[0].name,'Full pool RB');
  const fullPool = Object.fromEntries(['QB','RB','WR','TE','K','DEF'].map(pos => [pos,[{name:pos+' player'}]]));
  let reads = 0;
  context.fetch = async (url, options) => {
    assert(url.includes('_fresh=')); assert.equal(options.cache,'no-store'); reads++;
    return {ok:true,json:async()=>({positions: reads === 1 ? {...fullPool,WR:[]} : fullPool,metadata:{complete:true,positionsFailed:[]}})};
  };
  await context.loadWeeklyRankings();
  assert.equal(reads,2,'silently empty WR triggers one fresh retry');
  assert.equal(context.state.rankings.positions.WR.length,1);
  assert.equal(context.state.loadError,null);
  reads=0;
  context.fetch=async()=>{reads++;return {ok:true,json:async()=>({positions:{...fullPool,WR:[]},metadata:{complete:true,positionsFailed:[]}})}};
  await context.loadWeeklyRankings();
  assert.equal(reads,2,'persistent empty WR retry is bounded');
  assert(context.state.loadError.includes('WR'),'empty WR cannot masquerade as complete');
  const positions={QB:[{name:'Completed QB',gameDate:'20260927',gameTime:'1:00p',position:'QB'}]};
  applyGameEligibility(positions,new Date('2026-09-30T04:00:00Z'),'archive');
  assert.equal(positions.QB.length,1,'full weekly view keeps completed game rankings');
  // Run the real page request through the existing production eligibility
  // helper, including K/DEF. These are synthetic rows, not provider calls.
  const board=Object.fromEntries(['QB','RB','WR','TE','K','DEF'].map(pos=>[pos,[
    {name:'Thursday '+pos,team:'GB',opponent:'CAR',gameDate:'20261029',gameTime:'8:15p',rank:1},
    {name:'Sunday '+pos,team:'SEA',opponent:'ARI',gameDate:'20261101',gameTime:'4:05p',rank:2}
  ]]));
  let lastUsage;
  context.fetch=async url=>{
    const query=new URL(url,'https://fixture.invalid').searchParams;
    lastUsage=query.get('evidenceUsage');
    assert.equal(query.get('scoring'),scoring);
    const positions=JSON.parse(JSON.stringify(board));
    applyGameEligibility(positions,new Date(clock),lastUsage);
    return {ok:true,json:async()=>({positions,metadata:{complete:true,positionsFailed:[]}})};
  };
  week=8;
  for(scoring of ['half','standard','ppr']){
    await context.loadWeeklyRankings();assert.equal(lastUsage,'rankings');
    for(const [pos,rows] of Object.entries(context.state.rankings.positions)){
      assert.deepEqual(rows.map(r=>r.name),['Sunday '+pos]);assert.equal(rows[0].rank,1);
    }
  }
  week=7;await context.loadWeeklyRankings();assert.equal(lastUsage,'archive');
  assert.equal(context.state.rankings.positions.QB.length,2,'past-week review retains completed rows');
  week=9;await context.loadWeeklyRankings();assert.equal(lastUsage,'rankings','future week never bypasses eligibility');
  season=2025;week=8;await context.loadWeeklyRankings();assert.equal(lastUsage,'archive','prior season stays historical');
  season=2026;week=8;clock='2026-11-03T05:59:59Z';
  await context.loadWeeklyRankings();assert.equal(lastUsage,'rankings','before Tuesday rollover week 8 is still actionable');
  clock='2026-11-03T06:00:00Z';
  await context.loadWeeklyRankings();assert.equal(lastUsage,'archive','after Tuesday rollover week 8 becomes historical');
  week=9;await context.loadWeeklyRankings();assert.equal(lastUsage,'rankings');
  console.log('Full-pool failure, roster fallback, partial disclosure; all-position post-kickoff exclusion in current/future weeks across scoring formats; past-week/season archives and Tuesday rollover passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
