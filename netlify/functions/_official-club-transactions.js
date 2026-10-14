'use strict';
// Pure evidence parsing. No network, persistence, or authority to mark a cache fresh.
const {canonicalNameKey}=require('../../player-identity');
const clubs=require('./_official-club-sources.json');
const clean=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
function officialUrl(url,team){
 const club=clubs.find(c=>c.team===team);const parsed=new URL(url);
 if(!club||![club.origin,...(club.aliases||[])].includes(parsed.origin)||parsed.username||parsed.password)throw Error('Unapproved official club source.');
 return parsed.href;
}
function dateValue(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('Invalid official event date.');
 return value;
}
// Split before new actions, rather than using the presence of IR anywhere in a row.
function clauses(value){
 const parts=clean(value).split(/;|\.(?=\s+(?:Placed|Signed|Activated|Reinstated|Released|Waived|The |Traded|Acquired|Elevated|Opened))|(?=\b(?:placed|signed|activated|reinstated|released|waived|traded|acquired|elevated|opened)\b)/i).map(s=>s.trim()).filter(Boolean);
 const joined=[];
 for(const part of parts){if(joined.length&&/\b(?:(?:will|could|might|may)\s+(?:be\s*)?|(?:expected|plans?)\s+to\s+(?:be\s*)?)$/i.test(joined.at(-1)))joined[joined.length-1]+=' '+part;else joined.push(part);}
 return joined;
}
function classify(value){
 const s=value.toLowerCase();
 if(/\b(?:(?:will|could|might|may)\s+(?:be\s+)?(?:placed|place|activated|activate|waived|waive|released|release)|(?:expected|plans?)\s+to\s+(?:be\s+)?(?:placed|place|activated|activate|waived|waive|released|release))\b/.test(s))return {kind:'PENDING',status:null};
 if(/practice squad|standard elevation|active\/pup|active\/nfi|^elevated\s*\(standard\)/.test(s))return {kind:'NON_RESERVE'};
 if(/practice window|designated to return|designated for return/.test(s)&&!/^activat|\bactivated\b|\bplaced\b/.test(s))return {kind:'RETURN_PROCESS'};
 if(/waived.*injur|injury settlement/.test(s))return {kind:/settlement/.test(s)?'DEPARTURE':'PENDING',status:/settlement/.test(s)?'DEPARTED':null};
 if(/\b(?:released|waived|traded)\b/.test(s))return {kind:'DEPARTURE',status:'DEPARTED'};
 if(/\b(?:activated|reinstated)\b/.test(s)&&/\b(?:from|off)\b/.test(s)&&/injured|\bpup\b|\bnfi\b|physically unable|non-football/.test(s))return {kind:'RESERVE_EXIT',status:'ACTIVE'};
 if(/\bplaced\b|\breserve\//.test(s)){
  if(/injured[ /-]*reserve|reserve[ /-]*injured/.test(s))return {kind:'RESERVE_PLACEMENT',status:'IR'};
  if(/reserve\/(?:pup|physically unable to perform)/.test(s))return {kind:'RESERVE_PLACEMENT',status:'PUP'};
  if(/reserve\/(?:nfi|non-football injury)/.test(s))return {kind:'RESERVE_PLACEMENT',status:'NFI'};
 }
 return {kind:'UNCLASSIFIED'};
}
function parseStatement({text,reportedAt,team,sourceUrl,observedAt,identities=[]}){
 sourceUrl=officialUrl(sourceUrl,team);reportedAt=dateValue(reportedAt);
 if(!Number.isFinite(Date.parse(observedAt)))throw Error('Missing observation timestamp.');
 if(reportedAt>new Date(observedAt).toISOString().slice(0,10))throw Error('Official event is after observation cutoff.');
 const evidence=[],unresolved=[];
 for(const clause of clauses(text)){
  const reserveClasses=new Set([...(clause.match(/injured[ /-]*reserve|reserve[ /-]*injured|reserve\/(?:pup|physically unable to perform|nfi|non-football injury)/gi)||[])].map(x=>/injured/i.test(x)?'IR':/pup|physically/i.test(x)?'PUP':'NFI'));
  if(reserveClasses.size>1){unresolved.push({text:clause,reason:'MULTIPLE_RESERVE_STATUSES_REQUIRE_SUBJECT_ADAPTER'});continue;}
  const event=classify(clause);
  if(['NON_RESERVE','RETURN_PROCESS','UNCLASSIFIED'].includes(event.kind)){
   if(event.kind==='UNCLASSIFIED'&&/injured|reserve|pup|nfi|activation/i.test(clause))unresolved.push({text:clause,reason:'UNCLASSIFIED_RESERVE_CLAIM'});
   continue;
  }
  const key=canonicalNameKey(clause);
  const candidates=identities.filter(p=>p.team===team&&canonicalNameKey(p.name)&&key.includes(canonicalNameKey(p.name)));
  const unique=new Map(candidates.map(p=>[canonicalNameKey(p.name),p]));
  if(!unique.size){unresolved.push({text:clause,reason:'UNRESOLVED_SUBJECT'});continue;}
  // A known name does not establish that every other subject was resolved.
  // Subject completeness must be checked separately by the collection adapter.
  for(const player of unique.values())evidence.push({name:player.name,team,position:player.position||null,season:Number(reportedAt.slice(0,4)),kind:event.kind,status:event.status,reportedAt,observedAt,source:'Official club transaction',sourceUrl,sourceText:clause,identityVerified:false});
 }
 return {evidence,unresolved,complete:false};
}
function parseTable(html,{season,team,sourceUrl,observedAt,identities=[]}){
 officialUrl(sourceUrl,team);
 const tables=[...String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
 if(!tables.length)throw Error('Official club transaction table missing.');
 const rows=[];let datedRows=0;
 for(const [,table]of tables)for(const [,row]of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
  if(!cells.length)continue;
  const date=/^(\d{2})\/(\d{2})$/.exec(cells[0]);if(!date)continue;
  datedRows++;
  rows.push(parseStatement({text:cells.slice(1).join(' '),reportedAt:`${season}-${date[1]}-${date[2]}`,team,sourceUrl,observedAt,identities}));
 }
 if(!datedRows)throw Error('Official club transaction dates missing.');
 return {evidence:rows.flatMap(r=>r.evidence),unresolved:rows.flatMap(r=>r.unresolved),datedRows,complete:false};
}
module.exports={clubs,officialUrl,parseStatement,parseTable,classify};
