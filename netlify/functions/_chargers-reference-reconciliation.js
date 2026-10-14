'use strict';
const {officialUrl}=require('./_official-club-transactions');
function reconcileChargersReferences(claims,events){
 const unresolved=[],corroborated=[],hypothetical=[];
 for(const claim of claims){
  const text=claim.sourceText;
  if(typeof text!=='string'){unresolved.push(claim);continue;}
  if(text==='With four games in the books, that means any players the Chargers put on Injured Reserve before Week 1 are now eligible to come off that list.'){hypothetical.push({...claim,classification:'GENERAL_ELIGIBILITY_RULE_NOT_ACTIVATION',createsEvent:false});continue;}
  if(/^If either player is placed on Injured Reserve, they would have to miss at least the next four games\.$/.test(text)){hypothetical.push({...claim,createsEvent:false});continue;}
  const m=/^([A-Z][A-Za-z .'-]+) \([a-z ]+\)(?:, who was doubtful to play,| was also ruled out but)? was (?:also )?(placed|put) on Injured Reserve(?: on (Saturday|Friday))?\.$/.exec(text);
  if(!m){unresolved.push(claim);continue;}
  const matches=events.filter(e=>e.name===m[1]&&e.team==='LAC'&&e.identityVerified===true&&e.kind==='RESERVE_PLACEMENT'&&e.status==='IR'&&Number.isFinite(Date.parse(e.reportedAt))&&Date.parse(claim.articleDate)>=Date.parse(e.reportedAt)&&Date.parse(claim.articleDate)-Date.parse(e.reportedAt)<=6*86400000&&(!m[3]||new Date(e.reportedAt+'T00:00:00Z').getUTCDay()===(m[3]==='Saturday'?6:5))&&(()=>{try{return !!officialUrl(e.effectiveDateSourceUrl||e.sourceUrl,'LAC');}catch{return false;}})());
  if(new Set(matches.map(e=>e.reportedAt)).size!==1){unresolved.push(claim);continue;}
  corroborated.push({...claim,event:matches[0],createsEvent:false});
 }
 return {unresolved,corroborated,hypothetical};
}
module.exports={reconcileChargersReferences};
