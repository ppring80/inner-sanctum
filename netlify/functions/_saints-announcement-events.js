'use strict';
// Extract only the Saints' explicit, team-authored transaction-alert lead.
const {officialUrl,classify}=require('./_official-club-transactions');
const {publication}=require('./_saints-announcement-discovery');
const clean=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
const attr=(tag,name)=>new RegExp('\\b'+name+'=["\']([^"\']*)["\']','i').exec(tag)?.[1];
const labels={ 'running back':'RB','wide receiver':'WR','tight end':'TE',quarterback:'QB',linebacker:'LB',safety:'S',cornerback:'CB',tackle:'T',guard:'G',center:'C',CB:'CB',WR:'WR',LS:'LS',RB:'RB',EDGE:'EDGE','long snapper':'LS',punter:'P',kicker:'K'};
function extractSaintsEvents(html,{sourceUrl,observedAt}){
 officialUrl(sourceUrl,'NO');const meta=publication(html);
 if(!Number.isFinite(Date.parse(observedAt))||Date.parse(meta.publishedAt)>Date.parse(observedAt))throw Error('Invalid Saints event observation cutoff.');
 const report={sourceUrl,publishedAt:meta.publishedAt,announcement:false,events:[],unresolved:[],subjectsComplete:false,extractionScope:'TEAM_TRANSACTION_LEAD',customerEligible:false};
 if(!/^Shift4 Transaction Alert:/i.test(meta.description))return report;
 report.announcement=true;
 if(meta.authorName!=='New Orleans Saints'){report.unresolved.push({reason:'TEAM_AUTHOR_UNVERIFIED'});return report;}
 const block=/<div\b[^>]*class=["'][^"']*\bnfl-c-body-part--text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1];
 const paragraphs=block?[...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>m[1]):[];
 if(paragraphs.length!==1){report.unresolved.push({reason:'ANNOUNCEMENT_LEAD_CONTRACT_CHANGED'});return report;}
 const lead=paragraphs[0];
 if(!lead){report.unresolved.push({reason:'ANNOUNCEMENT_LEAD_MISSING'});return report;}
 const players=[];
 const marked=lead.replace(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi,(_,tag,body)=>{
  const name=clean(body),href=attr(tag,'href');let profileUrl;
  try{profileUrl=officialUrl(new URL(href,sourceUrl).href,'NO');}catch{report.unresolved.push({reason:'PLAYER_LINK_UNVERIFIED',name});return name;}
  if(!/^\/team\/players-roster\/[^/]+\/$/.test(new URL(profileUrl).pathname)||new URL(profileUrl).search){report.unresolved.push({reason:'PLAYER_PROFILE_PATH_UNVERIFIED',name});return name;}
  const id=players.length;players.push({name,profileUrl});return ` [[P${id}]] `;
 });
 const text=clean(marked).replace(/\(pronounced [^)]*\)/g,'').replace(/\(was on Reserve\/Suspended by Commissioner\)/g,'');
 const actions=[...text.matchAll(/\b(terminated|re-signed|activated|reinstated|placed|waived|released|signed|elevated|opened|traded|reverted)\b/gi)];
 for(let i=0;i<actions.length;i++){
  const action=actions[i],clause=text.slice(action.index,actions[i+1]?.index||text.length).trim(),event=/^re-signed\b/i.test(clause)?{kind:'MEMBERSHIP_ENTRY',status:'ACTIVE'}:/^terminated\b/i.test(clause)&&!/practice squad/i.test(clause)?{kind:'DEPARTURE',status:'DEPARTED'}:classify(clause);
  if(/^terminated\b/i.test(clause)&&event.kind==='NON_RESERVE')continue;
  if(event.kind==='UNCLASSIFIED'){
   if(/injured|reserve|\bpup\b|\bnfi\b|return window/i.test(clause))report.unresolved.push({reason:'RESERVE_ACTION_UNCLASSIFIED',text:clause});
   continue;
  }
  const prefix=text.slice(i?actions[i-1].index:0,action.index);
  if(/\b(?:will|could|might|may)\s+(?:be\s*)?$/i.test(prefix)){report.unresolved.push({reason:'PENDING_ANNOUNCEMENT',text:clause});continue;}
  const subject=clause.slice(action[0].length).replace(/^\s*the contract of\s*/,' ').split(/\b(?:from|off|on|to|with|for)\b/i)[0];
  if(!subject.includes('[[P')){
   const parts=subject.trim().replace(/\s+and\s*$/,'').replace(/[.,]$/,'').split(/\s+and\s+/);
   const subjects=parts.map(p=>/^(CB|WR|LS|RB) ([A-Z][A-Za-z’' .-]+)$/.exec(p.trim()));
   if(subjects.every(Boolean)&&subjects.length){for(const m of subjects)report.events.push({name:m[2].trim(),position:m[1],team:'NO',kind:event.kind,status:event.status||null,publishedAt:meta.publishedAt,reportedAt:meta.publishedAt.slice(0,10),observedAt,sourceUrl,source:'New Orleans Saints official transaction',sourceText:clause,identityVerified:true,identityBasis:'EXPLICIT_TEAM_AUTHORED_NAME_AND_POSITION'});continue;}
  }
  const ids=[...subject.matchAll(/\[\[P(\d+)\]\]/g)].map(m=>Number(m[1]));
  let residue=subject.replace(/\[\[P\d+\]\]/g,' ');
  for(const label of Object.keys(labels))residue=residue.replace(new RegExp('\\b'+label+'\\b','gi'),' ');
  residue=residue.replace(/\b(?:and|the|a|an|standard)\b|\(standard\)|[.,\s]/gi,'');
  if(!ids.length||residue){report.unresolved.push({reason:'UNRESOLVED_ACTION_SUBJECT',text:subject});continue;}
  for(const id of ids){
   const marker='[[P'+id+']]',before=subject.slice(0,subject.indexOf(marker)).trim();
   const label=Object.keys(labels).find(l=>new RegExp('\\b'+l+'$','i').test(before));
   const player=players[id];if(!player||!label){report.unresolved.push({reason:'PLAYER_POSITION_UNVERIFIED',name:player?.name});continue;}
   report.events.push({...player,team:'NO',position:labels[label],kind:event.kind,status:event.status||null,publishedAt:meta.publishedAt,reportedAt:meta.publishedAt.slice(0,10),observedAt,sourceUrl,source:'New Orleans Saints official transaction',sourceText:clause.replace(/\[\[P(\d+)\]\]/g,(_,n)=>players[Number(n)].name),identityVerified:true,identityBasis:'EXPLICIT_CLUB_PLAYER_PROFILE_AND_POSITION'});
  }
 }
 report.subjectsComplete=report.unresolved.length===0;return report;
}
module.exports={extractSaintsEvents};
