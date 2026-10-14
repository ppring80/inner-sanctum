'use strict';
const {officialUrl}=require('./_official-club-transactions');
const {canonicalNameKey}=require('../../player-identity');
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
function bootstrapEagles(html,{sourceUrl,season,observedAt,snapshot}){
 officialUrl(sourceUrl,'PHI');if(snapshot.team!=='PHI'||!Number.isFinite(Date.parse(observedAt)))throw Error('Eagles bootstrap inputs incomplete.');
 const events=[],unresolved=[];
 for(const [,row]of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));if(cells.length!==2||!/^\d{2}\/\d{2}$/.test(cells[0]))continue;
  const reportedAt=`${season}-${cells[0].replace('/','-')}`;
  if(new Date(reportedAt).toISOString().slice(0,10)!==reportedAt||reportedAt>observedAt.slice(0,10))throw Error('Eagles bootstrap date invalid.');
  const text=cells[1],claims=[];
  for(const m of text.matchAll(/\bPlaced\s+(.+?)\s+on\s+(Injured Reserve(?:\/Designated for Return)?|Reserve\/Non-Football Injury)(?=\.|$)/gi))claims.push({subject:m[1],status:/Non-Football/.test(m[2])?'NFI':'IR'});
  // A single explicit subject, not an arbitrary pronoun or prior sentence.
  const pronoun=/\bWaived\s+(?:S|DB)\s+(.+?)\s+with an injury designation and placed him on the Reserve\/Non-Football Injury list\.?$/i.exec(text);
  if(pronoun)claims.push({subject:pronoun[1],status:'NFI'});
  for(const claim of claims){
   const names=claim.subject.split(/,|\s+and\s+/i).map(s=>s.trim().replace(/^(?:LB|CB|RB|TE|DT|OL|S|C|G|T)\s+/,''));
   const matches=names.map(n=>snapshot.rows.filter(p=>canonicalNameKey(p.name)===canonicalNameKey(n)));
   if(matches.some(m=>m.length!==1)){unresolved.push({reason:'EAGLES_TABLE_SUBJECT_UNVERIFIED',text,names,reportedAt});continue;}
   for(const [p]of matches)events.push({...p,kind:'RESERVE_PLACEMENT',status:claim.status,reportedAt,publishedAt:null,observedAt,sourceUrl,source:'Eagles official transaction history',sourceText:text,identityVerified:true,identityBasis:'EXACT_UNIQUE_NAME_ON_OFFICIAL_ROSTER',customerEligible:false});
  }
 }
 return {events,unresolved,complete:false,customerEligible:false};
}
module.exports={bootstrapEagles};
