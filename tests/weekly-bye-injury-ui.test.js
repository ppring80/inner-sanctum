'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('weekly.html','utf8');
const ctx={weeklyMatchupLabel:()=>null};vm.createContext(ctx);
for(const name of ['flattenRankings','injuryLabel','injuryPillHtml'])vm.runInContext(html.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0],ctx);
for(const pos of ['QB','RB','WR','TE','K','DEF']){
 const rows=ctx.flattenRankings({positions:{[pos]:[]},inactive:{[pos]:[
  {name:'Bye Player',status:'bye'}, {name:'Unavailable Player',status:'INACTIVE'},
  {name:'Exempt Player',status:'COMMISSIONER_EXEMPT_NO_PLAY'}, {name:'Unknown Player'},
  {name:'Injured Player',status:'OUT'}, {name:'Doubtful Player',status:'DOUBTFUL'},
  {name:'Reserve Player',status:'IR'}]}});
 for(const row of rows.slice(0,4)){assert.equal(row.injury,null);assert.equal(row.eligibleForWeeklyRanking,false);assert.equal(row.call,'sit');}
 assert.equal(rows[0].availabilityStatus,'BYE');assert.equal(rows[4].injury,'out');assert.equal(rows[5].injury,'doubtful');assert.equal(rows[6].injury,'out');
}
assert.match(ctx.injuryPillHtml('bye'),/BYE/);assert.match(ctx.injuryPillHtml('bye'),/Bye week/);
const concern=html.match(/var withConcern =[^]*?var biggestConcern/)[0];
assert(concern.includes("['out', 'doubtful', 'questionable'].indexOf(p.injury) !== -1"));
assert(html.includes("p.availabilityStatus === 'BYE' ? injuryPillHtml('bye') : ''"));
console.log('Bye/non-injury inactivity separated from injury badges and concern selection across all six positions.');
