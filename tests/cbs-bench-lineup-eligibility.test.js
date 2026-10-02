'use strict';
const assert=require('assert');
const {isUnavailableRosterStatus}=require('../netlify/functions/inner-sanctum-ranking-normalizers');
const {_test}=require('../netlify/functions/chatgpt-mcp');
async function main(){
 for(const status of ['RS','Reserve'])assert.equal(isUnavailableRosterStatus(status,'CBS'),false);
 for(const status of ['I','IR','Out'])assert.equal(isUnavailableRosterStatus(status,'cbs'),true);
 assert.equal(isUnavailableRosterStatus('RS'),true,'unknown provider meaning remains conservative');
 const roster=[
  {name:'Fixture QB',position:'QB',status:'A'},
  {name:'Fixture RB',position:'RB',status:'A'},
  {name:'Fixture WR',position:'WR',status:'A'},
  {name:'Fixture TE',position:'TE',status:'A'},
  {name:'Fixture Bench RB',position:'RB',status:'RS'},
  {name:'Fixture IR RB',position:'RB',status:'IR'},
  {name:'Fixture Out WR',position:'WR',status:'O'}
 ];
 const positions={QB:[],RB:[],WR:[],TE:[],K:[],DEF:[]};
 roster.forEach((v,i)=>positions[v.position].push({name:v.name,position:v.position,playerID:String(i),team:'AAA',rank:i+1,projectedPoints:30-i,recommendation:'START',sageTake:'Fixture weekly evidence'}));
 const saved=global.fetch;let requested=[];
 global.fetch=async url=>{requested.push(String(url));return {ok:true,status:200,json:async()=>({positions,metadata:{complete:true}})};};
 try{
  const snapshot={provider:'cbs',league:{season:2026,teamCount:12},scoringFormat:'half-ppr',roster,settings:{lineupSlots:['QB','RB','WR','TE','FLEX'].map(slot=>({slot,count:1}))}};
  const server=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot});
  const result=await server._registeredTools.get_lineup_recommendation.handler({season:2026,week:4});
  const data=result.structuredContent;assert(data,JSON.stringify(result));assert.equal(data.inputSource,'linked_league');
  assert.equal(data.unfilledSlots.length,0);assert(data.starters.some(x=>x.player==='Fixture Bench RB'));
  assert(!data.starters.some(x=>['Fixture IR RB','Fixture Out WR'].includes(x.player)));
  assert.equal(requested.length,1);assert(requested[0].includes('scoring=half'));
  // A supplied ESPN roster must take precedence over linked CBS.
  requested=[];
  const pasted=[{name:'Fixture Bench RB',position:'RB',lineupSlot:'RB',rosterStatus:'active'}];
  const other=await server._registeredTools.get_lineup_recommendation.handler({season:2026,week:4,provider:'ESPN',roster:pasted,teamCount:10,scoringFormat:'standard'});
  assert.equal(other.structuredContent.inputSource,'pasted_roster');assert.equal(other.structuredContent.context.provider,'ESPN');
  assert.deepEqual(other.structuredContent.starters.map(x=>x.player),['Fixture Bench RB']);assert(requested[0].includes('scoring=standard'));
 }finally{global.fetch=saved;}
 console.log('CBS bench fills FLEX; injured players excluded; pasted ESPN roster overrides linked CBS.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
