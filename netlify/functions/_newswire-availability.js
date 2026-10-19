'use strict';
const {MODE}=require('./_tank01-player-cache');
const HOUR=3600000;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function injuryTime(injury,now){
 const match=String(injury.description||'').match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}):/);
 if(match){let year=new Date(now).getUTCFullYear();let date=Date.parse(`${match[1]} ${match[2]}, ${year} 00:00:00 GMT`);if(date>now)date=Date.parse(`${match[1]} ${match[2]}, ${year-1} 00:00:00 GMT`);return new Date(date).toISOString();}
 const date=String(injury.injDate||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 return Number.isFinite(Date.parse(date))?new Date(Date.parse(date)).toISOString():'1970-01-01T00:00:00Z';
}
function currentNewswire(reports,cache,now=Date.now()){
 const age=now-Date.parse(cache?.updatedAt);
 const fresh=cache?.availabilityMode===MODE&&cache.teamsSucceeded===32&&cache.teamsFailed===0&&Number.isFinite(age)&&age>=0&&age<8*HOUR;
 // Reporting dates stay reporting dates. Short-lived game/practice instructions
 // must not survive for an entire week merely because the collection ran today.
 const recent=(reports||[]).filter(s=>{
  const age=now-Date.parse(s.publishedAt);
  const transient=/practice|cleared|expected starter|expected to play|availability report|^out$|questionable/i.test(s.status||'')||/before .*kickoff|ruled out for|DNP|walkthrough/i.test((s.headline||'')+' '+(s.summary||''));
  return Number.isFinite(age)&&age>=0&&age<(transient?24:72)*HOUR;
 });
 if(!fresh)return{stories:recent,availability:{fresh:false,updatedAt:cache?.updatedAt||null,source:'Tank01 getNFLPlayerList'}};
 const stories=[],seen=new Set();
 for(const [id,p] of Object.entries(cache.players||{})){
  const designation=String(p.injury?.designation||'').trim();
  if(!['QB','RB','WR','TE','K'].includes(p.pos)||!p.team||String(p.isFreeAgent).toLowerCase()==='true'||!designation)continue;
  const key=norm(p.longName),hasReporting=reports.some(s=>norm(s.player)===norm(p.longName)&&s.team===p.team),report=recent.find(s=>norm(s.player)===key&&s.team===p.team);
  const unavailable=/^(IR|PUP|NFI|OUT|INJURED RESERVE(?: - DESIGNATED TO RETURN)?)$/i.test(designation);
  stories.push({id:'tank01-availability-'+id,player:p.longName,team:p.team,position:p.pos,status:designation,statusTone:unavailable?'breaking':'monitor',headline:p.longName+': '+designation+'.',summary:String(p.injury.description||'Tank01 reports '+designation+'.'),sageImpact:unavailable?`Keep ${p.longName} out of starting lineups while the provider reports ${designation}. Compare healthy alternatives using current SAGE rankings and roles.`:`${p.longName} carries a ${designation} designation. Keep an alternative available and confirm game availability before kickoff.`,hasReporting,sourceLabel:'Tank01 · current player status',sourceUrl:null,publishedAt:cache.updatedAt,observedAt:cache.updatedAt,sortAt:report&&Date.parse(report.publishedAt)>Date.parse(injuryTime(p.injury,now))?report.publishedAt:injuryTime(p.injury,now),dateLabel:'Status checked',injuryDate:p.injury.injDate||null,report:report||null,featured:false});
  seen.add(key);
 }
 // Preserve recent reporting for players without a provider injury designation.
 // An empty designation never becomes an invented "cleared" announcement.
 stories.sort((a,b)=>Date.parse(b.sortAt)-Date.parse(a.sortAt)||a.player.localeCompare(b.player));
 stories.push(...recent.filter(s=>!seen.has(norm(s.player))));
 return{stories,availability:{fresh:true,updatedAt:cache.updatedAt,source:'Tank01 getNFLPlayerList'},reportingUpdatedAt:reports.length?reports.reduce((a,s)=>Date.parse(s.publishedAt)>Date.parse(a)?s.publishedAt:a,reports[0].publishedAt):null};
}
module.exports={currentNewswire};
