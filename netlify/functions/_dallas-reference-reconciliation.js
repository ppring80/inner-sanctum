'use strict';
const {canonicalNameKey}=require('../../player-identity');
const {officialUrl}=require('./_official-club-transactions');
function reconcileDallasReferences(claims,events,snapshot){
 const unresolved=[],corroborated=[],excluded=[],quarantined=[];
 for(const claim of claims){
  const text=claim.sourceText;
  if(typeof text!=='string'){unresolved.push(claim);continue;}
  if(/^(?:5:03 p\.m\. – After suffering a fractured forearm in Week 1, )?Malik Hooker was not placed on IR-to return, with the hopes he could return before the four-week window\.$/.test(text)){excluded.push({...claim,classification:'EXPLICIT_NEGATION',createsEvent:false});continue;}
  if(claim.sourceUrl==='https://www.dallascowboys.com/news/big-picture-10-storylines-for-cowboys-packers-x0191'&&text==='The week before, linebacker Edgerrin Cooper was also placed on season-ending injured reserve with an Achilles injury.'){excluded.push({...claim,classification:'EXPLICIT_OPPONENT_CONTEXT',createsEvent:false});continue;}
  if(text==="Hooker's return was more than needed for a safety group that also has Jalen Williams and P.J. Locke already on IR."&&snapshot?.team==='DAL'&&Array.isArray(snapshot.rows)){
   const date=claim.reportedAt||claim.articleDate;
   let approved=false;try{officialUrl(claim.sourceUrl,'DAL');approved=/^\/news\/updates-(?:october|september)-2026$/.test(new URL(claim.sourceUrl).pathname);}catch{}
   const unknown=snapshot.rows.filter(p=>canonicalNameKey(p.name)===canonicalNameKey('Jalen Williams'));
   const locke=events.filter(e=>e.name==='P.J. Locke'&&e.team==='DAL'&&e.kind==='RESERVE_PLACEMENT'&&e.status==='IR'&&e.identityVerified===true&&e.reportedAt<=date&&(()=>{try{return !!officialUrl(e.sourceUrl,'DAL');}catch{return false;}})());
   if(approved&&/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&!unknown.length&&locke.length){
    quarantined.push({...claim,name:'Jalen Williams',reason:'NAME_NOT_IN_OFFICIAL_TEAM_ROSTER',status:null,customerEligible:false,createsEvent:false});
    corroborated.push({...claim,matchedEvents:locke,classification:'KNOWN_CO_SUBJECT_CORROBORATED_ONLY',createsEvent:false});continue;
   }
  }
  const beforeSeason=/\bSmith\b.*placed on injured reserve before the season (?:started|began)/i.test(text)&&/\/news\/(?:jerry-jones-on-tyler-smith-|tyler-smith-)/.test(claim.sourceUrl);
  const matches=events.filter(e=>e.team==='DAL'&&e.identityVerified===true&&/^\d{4}-\d{2}-\d{2}$/.test(e.reportedAt||'')&&(()=>{try{return !!officialUrl(e.sourceUrl,'DAL');}catch{return false;}})()&&((beforeSeason&&e.name==='Tyler Smith'&&e.kind==='RESERVE_EXIT'&&e.status==='ACTIVE')||((text.startsWith('No versatile safety P.J. Locke ')&&e.name==='P.J. Locke'||text.startsWith('No veteran safety Jalen Thompson,')&&e.name==='Jalen Thompson')&&e.kind==='RESERVE_PLACEMENT'&&e.status==='IR'&&e.reportedAt<=claim.articleDate)));
  if(matches.length){corroborated.push({...claim,matchedEvents:matches,classification:beforeSeason?'HISTORICAL_RESERVE_CONTEXT_WITH_CONFIRMED_EXIT':'EXISTING_PLACEMENT_REFERENCE',createsEvent:false});continue;}
  unresolved.push(claim);
 }
 return {unresolved,corroborated,excluded,quarantined};
}
module.exports={reconcileDallasReferences};
