'use strict';
const {officialUrl}=require('./_official-club-transactions');
const {publication}=require('./_saints-announcement-discovery');
const {canonicalNameKey}=require('../../player-identity');
const {bootstrapDallas}=require('./_dallas-reserve-bootstrap');
function extractDallasEvents(html,{sourceUrl,season,observedAt,snapshot}){
 officialUrl(sourceUrl,'DAL');const meta=publication(html),events=[],unresolved=[];
 if(snapshot?.team!=='DAL'||!Number.isFinite(Date.parse(observedAt))||Date.parse(meta.publishedAt)>Date.parse(observedAt)||Number(meta.publishedAt.slice(0,4))!==season)throw Error('Dallas announcement identity/date input invalid.');
 const match=/^(.+?) officially activated from IR for .+$/.exec(meta.headline);
 if(match&&meta.modifiedAt&&(!Number.isFinite(Date.parse(meta.modifiedAt))||Date.parse(meta.modifiedAt)>Date.parse(observedAt)||meta.modifiedAt.slice(0,10)!==meta.publishedAt.slice(0,10)))unresolved.push({sourceUrl,reason:'DALLAS_ACTIVATION_EFFECTIVE_DATE_AMBIGUOUS',publishedAt:meta.publishedAt,modifiedAt:meta.modifiedAt});
 else if(match){const candidates=snapshot.rows.filter(p=>canonicalNameKey(p.name)===canonicalNameKey(match[1]));
  if(candidates.length!==1)unresolved.push({sourceUrl,reason:'DALLAS_ACTIVATION_IDENTITY_UNVERIFIED',name:match[1]});
  else events.push({...candidates[0],team:'DAL',kind:'RESERVE_EXIT',status:'ACTIVE',reportedAt:meta.publishedAt.slice(0,10),publishedAt:meta.publishedAt,observedAt,sourceUrl,source:'Dallas Cowboys official activation announcement',sourceText:meta.headline,identityVerified:true,identityBasis:'EXACT_UNIQUE_NAME_ON_OFFICIAL_ROSTER',health:'UNKNOWN'});
 }
 if(/<table\b/i.test(html)){const table=bootstrapDallas(html,{sourceUrl,season,observedAt,snapshot});events.push(...table.events);unresolved.push(...table.unresolved.map(e=>({...e,sourceUrl})));}
 return {events,unresolved,publishedAt:meta.publishedAt};
}
module.exports={extractDallasEvents};
