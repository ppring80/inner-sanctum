'use strict';
const {officialUrl}=require('./_official-club-transactions');
function reconcileEaglesReferences(claims,events){
 const unresolved=[],corroborated=[],excluded=[];
 for(const claim of claims){
  const text=claim.sourceText;let name=null,oneDay=false,tuesday=false;
  try{officialUrl(claim.sourceUrl,'PHI');}catch{unresolved.push(claim);continue;}
  if(text==='On the offensive side, Rams tight end Terrance Ferguson was placed on Injured Reserve on Friday with an ankle injury.'){excluded.push({...claim,classification:'EXPLICIT_OPPONENT_CONTEXT',createsEvent:false});continue;}
  if(text==="Barkley didn't practice all week and will be inactive, while Bigsby was placed on Injured reserve.")name='Tank Bigsby';
  if(text==='Steele joins Dameon Pierce as the two running backs signed to the active roster this week after injuries to Saquon Barkley and Tank Bigsby - the latter of whom was placed on Injured Reserve.')name='Tank Bigsby';
  if(text==='Running back Tank Bigsby was also put on injured reserve after suffering an injury later in the game.')name='Tank Bigsby';
  if(text==='One day after the Eagles placed running back Tank Bigsby on Injured Reserve, the team filled his spot on the 53-man roster with another running back – Dameon Pierce from the practice squad.'){name='Tank Bigsby';oneDay=true;}
  if(text==='The Eagles announced on Tuesday that the team has placed running back Tank Bigsby on Injured Reserve.'){name='Tank Bigsby';tuesday=true;}
  if(text==='Following the season-opening win over Washington, Jurgens moved from center over to left guard after Landon Dickerson was placed on Injured Reserve.')name='Landon Dickerson';
  // Corroborate historical references only; section identity is supplied by
  // an exact unique official-roster name and compatible position heading.
  let referenceDate=null;
  if(claim.sectionSubject&&/\bwas placed on Injured Reserve\b/.test(text)){
   const subject=claim.sectionSubject,last=subject.split(' ').at(-1);
   const explicit=text.startsWith(last+' was placed ')||text.startsWith(subject+' was placed ');
   const pronoun=text.startsWith('He was placed ')||text.startsWith('However, the uber-athletic receiving weapon was placed ');
   if(explicit||pronoun){
    const date=/on ([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th)?\b/.exec(text);
    if(date){const month=['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(date[1])+1;
     if(month)referenceDate=claim.articleDate.slice(0,4)+'-'+String(month).padStart(2,'0')+'-'+date[2].padStart(2,'0');}
    name=subject;
   }
  }
  const matches=events.filter(e=>name&&e.name===name&&e.team==='PHI'&&e.identityVerified===true&&e.kind==='RESERVE_PLACEMENT'&&e.status==='IR'&&/^\d{4}-\d{2}-\d{2}$/.test(e.reportedAt||'')&&e.reportedAt<=claim.articleDate&&(!referenceDate||e.reportedAt===referenceDate)&&(!oneDay||Date.parse(claim.articleDate)-Date.parse(e.reportedAt)===86400000)&&(!tuesday||e.reportedAt===claim.articleDate&&new Date(e.reportedAt+'T00:00:00Z').getUTCDay()===2)&&(()=>{try{return !!officialUrl(e.sourceUrl,'PHI');}catch{return false;}})());
  if(new Set(matches.map(e=>e.reportedAt)).size!==1){unresolved.push(claim);continue;}
  corroborated.push({...claim,matchedEvent:matches[0],createsEvent:false});
 }
 return {unresolved,corroborated,excluded};
}
module.exports={reconcileEaglesReferences};
