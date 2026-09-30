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
  const context={
    state:{myRosterOnly:false},getSelectedSeason:()=>2026,getSelectedWeek:()=>4,getScoringFormat:()=> 'half',
    fetch:async()=>({ok:false,json:async()=>({error:'Week 4 evidence unavailable'})}),
    flattenRankings:data=>Object.values(data.positions).flat(),
    buildConnectedProviderFallback:()=>{fallbackCalls++;return {metadata:{providerProjectionFallbackUsed:true},positions:{RB:[{name:'Roster RB'}]}}},
    updateWeeklyContextUI(){},renderTable(){},encodeURIComponent
  };
  vm.createContext(context);vm.runInContext(match[0],context);
  await context.loadWeeklyRankings();
  assert.equal(context.state.rankings,null,'full pool must not be replaced by connected roster');
  assert.equal(fallbackCalls,0);assert(context.state.loadError.includes('unavailable'));
  context.state.myRosterOnly=true;await context.loadWeeklyRankings();
  assert.equal(fallbackCalls,1);assert(context.state.rankings.metadata.providerProjectionFallbackUsed);
  context.state.myRosterOnly=false;
  context.fetch=async url=>{assert(url.includes('evidenceUsage=archive'));return {ok:true,json:async()=>({positions:{RB:[{name:'Full pool RB'}]},metadata:{positionsFailed:['QB']}})}};
  await context.loadWeeklyRankings();assert(context.state.loadError.includes('QB'),'partial data must be disclosed');
  assert.equal(context.state.rankings.positions.RB[0].name,'Full pool RB');
  const positions={QB:[{name:'Completed QB',gameDate:'20260927',gameTime:'1:00p',position:'QB'}]};
  applyGameEligibility(positions,new Date('2026-09-30T04:00:00Z'),'archive');
  assert.equal(positions.QB.length,1,'full weekly view keeps completed game rankings');
  console.log('Full-pool failure, roster-only fallback, partial evidence disclosure, and completed-game weekly view passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
