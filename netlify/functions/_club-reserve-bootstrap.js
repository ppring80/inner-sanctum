'use strict';
// Recover dated placement history for players explicitly on today's reserve roster.
// No inferred activation and no invented publication timestamp.
const {officialUrl}=require('./_official-club-transactions');
const {canonicalNameKey}=require('../../player-identity');
const clean=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function reserveBootstrap(html,snapshot,{season,sourceUrl,observedAt}){
 officialUrl(sourceUrl,snapshot.team);
 if(!Number.isInteger(season)||!Number.isFinite(Date.parse(observedAt)))throw Error('Bootstrap season/observation missing.');
 const required=snapshot.rows.filter(p=>['IR','PUP','NFI'].includes(p.status)),events=[];
 for(const [,row]of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);if(cells.length!==2)continue;
  const day=/^(\d{2})\/(\d{2})$/.exec(clean(cells[0]));if(!day)continue;
  const reportedAt=`${season}-${day[1]}-${day[2]}`;
  if(new Date(reportedAt+'T00:00:00Z').toISOString().slice(0,10)!==reportedAt||reportedAt>observedAt.slice(0,10))throw Error('Bootstrap transaction date invalid.');
  const refs=[];
  const marked=cells[1].replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,(_,href,body)=>{
   let profileUrl;try{profileUrl=officialUrl(new URL(href,sourceUrl).href,snapshot.team);}catch{return ' [[UNKNOWN]] ';}
   const name=clean(body),player=required.find(p=>p.profileUrl===profileUrl&&canonicalNameKey(p.name)===canonicalNameKey(name));
   if(!player)return ' [[UNKNOWN]] ';const n=refs.length;refs.push(player);return ` [[P${n}]] `;
  });
  const text=clean(marked);
  const actions=[...text.matchAll(/\b(placed|signed|activated|reinstated|waived|released|terminated|acquired|awarded|traded)\b/gi)];
  for(let i=0;i<actions.length;i++){
   if(actions[i][1].toLowerCase()!=='placed')continue;
   const clause=text.slice(actions[i].index,actions[i+1]?.index||text.length);let start=0;
   // Each list's subjects end at its own status, including mixed IR/PUP rows.
   for(const match of clause.matchAll(/\bon\s+(Injured Reserve|Reserve\/Injured|Reserve\/PUP|Reserve\/Physically Unable to Perform|Reserve\/NFI|Reserve\/Non-Football Injury|Reserve\/Suspended by Commissioner)/gi)){
    const status=/injured/i.test(match[1])?'IR':/pup|physically/i.test(match[1])?'PUP':/nfi|non-football/i.test(match[1])?'NFI':null;
    const subjects=clause.slice(start,match.index);start=match.index+match[0].length;
    if(!status)continue;
    for(const id of subjects.matchAll(/\[\[P(\d+)\]\]/g)){
     const player=refs[Number(id[1])];events.push({...player,season,status,kind:'RESERVE_PLACEMENT',reportedAt,publishedAt:null,observedAt,sourceUrl,source:'Official club dated transaction table',identityVerified:true,identityBasis:'MATCHED_OFFICIAL_PROFILE_AND_ROSTER_NAME',sourceText:clause.replace(/\[\[P(\d+)\]\]/g,(_,n)=>refs[Number(n)].name),customerEligible:false});
    }
   }
  }
 }
 return {team:snapshot.team,events,missing:required.filter(p=>!events.some(e=>e.profileUrl===p.profileUrl&&e.status===p.status)),customerEligible:false};
}
module.exports={reserveBootstrap};
