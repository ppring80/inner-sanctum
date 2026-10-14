'use strict';
const {officialUrl}=require('./_official-club-transactions');
const {canonicalNameKey}=require('../../player-identity');
// A recap is corroboration only. Never turn its publication into an event date.
function reconcileReferences(claims,events){
 const unresolved=[],corroborated=[];
 for(const claim of claims){
  if(typeof claim.sourceText!=='string'){unresolved.push(claim);continue;}
  const text=claim.sourceText.replace(/^Prized unrestricted free agent signee /,'');
   const combined=/^Ty Chandler opened the season on injured reserve and (Devin Neal and Audric Estime,.*)$/.exec(text);
   if(combined){
    const chandler=events.filter(e=>e.name==='Ty Chandler'&&e.team==='NO'&&e.identityVerified===true&&e.kind==='RESERVE_PLACEMENT'&&e.status==='IR'&&/^\d{4}-08-\d{2}$/.test(e.reportedAt)&&e.reportedAt<=claim.articleDate&&(()=>{try{return !!officialUrl(e.sourceUrl,'NO');}catch{return false;}})());
    const departures=reconcileReferences([{...claim,sourceText:combined[1]}],events);
    if(chandler.length&&departures.unresolved.length===0){corroborated.push({...claim,matchedEvents:[...chandler,...departures.corroborated[0].matchedEvents],createsEvent:false});continue;}
   }
   if(combined){unresolved.push(claim);continue;}
  let names,kind,status;
  let m=/^(.+?) was placed on injured reserve Thursday\.$/i.exec(text);
  const weekly=/^Running the ball will help, too, but that task is made more difficult by the absence of running back (.+?)\s*, who was placed on injured reserve this week\.$/.exec(text);
  if(weekly)m=[weekly[0],weekly[1]];
  if(m){names=[m[1]];kind='RESERVE_PLACEMENT';status='IR';}
  else {m=/^(.+?) and (.+?), who played meaningful snaps last season, both were released with injury settlements and both signed with the Vikings practice squad Wednesday\.$/i.exec(text);
   if(m){names=[m[1],m[2]];kind='DEPARTURE';status='DEPARTED';}
  }
  if(!names){
   unresolved.push(claim);continue;
  }
  const matches=names.map(name=>events.filter(e=>e.team==='NO'&&e.identityVerified===true&&e.kind===kind&&e.status===status&&canonicalNameKey(e.name)===canonicalNameKey(name)&&/^\d{4}-\d{2}-\d{2}$/.test(e.reportedAt)&&e.reportedAt<=claim.articleDate&&(kind!=='RESERVE_PLACEMENT'||(weekly?Date.parse(claim.articleDate)-Date.parse(e.reportedAt)>=0&&Date.parse(claim.articleDate)-Date.parse(e.reportedAt)<=6*86400000:e.reportedAt===claim.articleDate))&&(()=>{try{return !!officialUrl(e.sourceUrl,'NO');}catch{return false;}})()));
  if(matches.some(es=>!es.length)){unresolved.push(claim);continue;}
  corroborated.push({...claim,matchedEvents:matches.map(es=>es.sort((a,b)=>a.reportedAt.localeCompare(b.reportedAt)).at(-1)),createsEvent:false});
 }
 return {unresolved,corroborated};
}
module.exports={reconcileReferences};
