'use strict';
const {text}=require('./_newswire-sources');
const {playerKey}=require('./_injury-transactions');
const {resolveCurrentNFLWeek}=require('./_current-nfl-week');
const STORE='team-backfield-roles';
// Focused source adapter. Other teams retain existing evidence, never guessed roles.
const SOURCES=[{team:'PHI',source:'Philadelphia Eagles communications department',url:'https://www.philadelphiaeagles.com/team/depth-chart'}];
function parseRoles(html,source,observedAt){
 const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].filter(m=>/Offense/i.test(m[0]));
 if(tables.length!==1)throw Error('Team depth-chart offense contract changed');
 const headers=[...tables[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>text(m[1]));
 if(headers.join('|')!=='Position|First|Second|Third')throw Error('Team depth-chart order contract changed');
 const rows=[...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1])).filter(c=>text(c[0])==='RB');
 if(rows.length!==1||rows[0].length!==4)throw Error('Team RB row contract changed');
 const players=rows[0].slice(1).flatMap((cell,i)=>{
  if(!text(cell))return [];
  const names=[...cell.matchAll(/<a\b[^>]*href=["']\/team\/players-roster\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>text(m[1]));
  if(names.length!==1||names[0]!==text(cell))throw Error('Ambiguous team RB identity');
  return [{name:names[0],listedRank:i+1}];
 });
 if(players.length<2||new Set(players.map(p=>playerKey(p.name))).size!==players.length)throw Error('Incomplete team RB chart');
 return {team:source.team,source:source.source,sourceUrl:source.url,observedAt,publishedAt:null,chartType:'TEAM_PUBLISHED_UNOFFICIAL',players};
}
function reportedRoles(context,row,cache,now=new Date()){
 const report=cache?.teams?.[row.team],age=new Date(now)-Date.parse(report?.observedAt);
 if(!context||report?.team!==row.team||report?.chartType!=="TEAM_PUBLISHED_UNOFFICIAL"||!SOURCES.some(s=>s.team===row.team&&s.url===report?.sourceUrl)||!Number.isFinite(age)||age<0||age>36*3600000||!Array.isArray(report.players))return context;
 const season=new Date(now).getUTCFullYear();
 if(resolveCurrentNFLWeek(new Date(report.observedAt),season)!==resolveCurrentNFLWeek(new Date(now),season))return context;
 const list=report.players;
 if(list.length<2||list.some(p=>!p.name||!Number.isInteger(p.listedRank)||p.listedRank<1)||new Set(list.map(p=>playerKey(p.name))).size!==list.length||new Set(list.map(p=>p.listedRank)).size!==list.length)return context;
 const candidate=list.filter(p=>playerKey(p.name)===playerKey(row.name));if(candidate.length!==1)return context;
 const order=list.map(p=>({...p,status:context.players.find(r=>playerKey(r.name)===playerKey(p.name))?.availability.status||'UNKNOWN'})).sort((a,b)=>a.listedRank-b.listedRank);
 const unavailable=new Set(['IR','OUT','DOUBTFUL','PUP','NFI','RESERVE/INJURED']);
 const next=order.find(p=>p.listedRank>candidate[0].listedRank&&!unavailable.has(p.status));
 return {...context,roleOrderVerified:true,reportedRoles:{...report,players:order,candidateListedRank:candidate[0].listedRank,
  nextListedAlternative:next||null,notListedInChart:context.players.filter(p=>!list.some(r=>playerKey(r.name)===playerKey(p.name))).map(p=>p.name)},
  note:'Team-published unofficial chart verifies the reported role order only. The next listed alternative skips backs with sourced unavailable status; unknown status is not health clearance. The chart may lag roster additions. No snap share or workload redistribution is established.'};
}
async function collectRoles({store,fetcher=fetch,now=new Date()}){
 const previous=await store.get('latest',{type:'json'}),time=new Date(now).getTime();
 if(previous?.checkedAt&&time-Date.parse(previous.checkedAt)>=0&&time-Date.parse(previous.checkedAt)<6*3600000)return {cached:true,sourceRequests:0};
 const lease=await store.getWithMetadata('lease',{type:'json'});if(lease?.data?.until>time)return {skipped:true,sourceRequests:0};
 const claim=await store.setJSON('lease',{until:time+60000},lease?{onlyIfMatch:lease.etag}:{onlyIfNew:true});if(!claim.modified)return {skipped:true,sourceRequests:0};
 let sourceRequests=0;
 try{
  const teams={};for(const source of SOURCES){sourceRequests++;const r=await fetcher(source.url,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error('Team depth-chart HTTP '+r.status);teams[source.team]=parseRoles(await r.text(),source,new Date(now).toISOString());}
  await store.setJSON('latest',{checkedAt:new Date(now).toISOString(),teams});await store.setJSON('health',{lastAttempt:new Date(now).toISOString(),lastSuccess:new Date(now).toISOString(),error:null,sourceRequests});return {cached:true,sourceRequests,tank01Calls:0};
 }catch(e){await store.setJSON('health',{lastAttempt:new Date(now).toISOString(),lastSuccess:previous?.checkedAt||null,error:e.message,sourceRequests});return {cached:false,previousCachePreserved:true,sourceRequests,error:e.message,tank01Calls:0};}
}
module.exports={STORE,SOURCES,parseRoles,reportedRoles,collectRoles};
