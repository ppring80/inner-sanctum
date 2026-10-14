'use strict';
// Chargers Communications leads use bold names rather than player hyperlinks.
const {publication}=require('./_chargers-announcement-discovery');
const {officialUrl,classify,parseTable}=require('./_official-club-transactions');
const {canonicalNameKey}=require('../../player-identity');
const clean=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function extractChargersEvents(html,{sourceUrl,observedAt,roster,transactionHtml}){
 officialUrl(sourceUrl,'LAC');const meta=publication(html),report={sourceUrl,publishedAt:meta.publishedAt,announcement:meta.authorName==='Chargers Communications',events:[],unresolved:[],subjectsComplete:false,customerEligible:false};
 if(!report.announcement)return report;
 const crossDay=meta.modifiedAt&&meta.modifiedAt.slice(0,10)!==meta.publishedAt.slice(0,10);
 if(meta.modifiedAt&&(!Number.isFinite(Date.parse(meta.modifiedAt))||Date.parse(meta.modifiedAt)>Date.parse(observedAt))){report.unresolved.push({reason:'INVALID_MODIFICATION_CUTOFF'});return report;}
 if(crossDay&&!transactionHtml){report.unresolved.push({reason:'MODIFIED_ANNOUNCEMENT_REQUIRES_EFFECTIVE_EVENT_DATE',publishedAt:meta.publishedAt,modifiedAt:meta.modifiedAt});return report;}
 if(!roster||roster.team!=='LAC'||!Number.isFinite(Date.parse(observedAt))||Date.parse(meta.publishedAt)>Date.parse(observedAt))throw Error('Chargers identity/cutoff input incomplete.');
 const tableUrl='https://www.chargers.com/team/transactions/'+meta.publishedAt.slice(0,4);
 const dated=transactionHtml?parseTable(transactionHtml,{season:Number(meta.publishedAt.slice(0,4)),team:'LAC',sourceUrl:tableUrl,observedAt,identities:roster.rows}).evidence:[];
 function corroboration(name,kind,status){const matches=dated.filter(e=>canonicalNameKey(e.name)===canonicalNameKey(name)&&e.kind===kind&&e.status===status&&e.reportedAt>=meta.publishedAt.slice(0,10)&&e.reportedAt<=(meta.modifiedAt||meta.publishedAt).slice(0,10));const dates=[...new Set(matches.map(e=>e.reportedAt))];return dates.length===1?matches[0]:null;}
 const block=/<div\b[^>]*class=["'][^"']*\bnfl-c-body-part--text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1];
 const paragraph=block&&/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1];
 if(!paragraph){report.unresolved.push({reason:'ANNOUNCEMENT_LEAD_MISSING'});return report;}
 const names=[];const marked=paragraph.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi,(_,body)=>{const name=clean(body),matches=roster.rows.filter(p=>canonicalNameKey(p.name)===canonicalNameKey(name));const id=names.length;names.push({name,player:matches.length===1?matches[0]:null});return ` [[P${id}]] `;});
 const text=clean(marked),actions=[...text.matchAll(/\b(activated|reinstated|placed|signed|waived|released|elevated|opened|traded)\b/gi)];
 for(let i=0;i<actions.length;i++){
  const action=actions[i],clause=text.slice(action.index,actions[i+1]?.index||text.length),event=classify(clause);
  if(event.kind==='UNCLASSIFIED')continue;
  if(crossDay&&!event.status)continue;
  const prefix=text.slice(i?actions[i-1].index:0,action.index);
  if(/\b(?:will|could|might|may)\s+(?:be\s*)?$/i.test(prefix)){report.unresolved.push({reason:'PENDING_PLACEMENT_NOT_COMPLETED',text:clause});continue;}
  if(/\bbeing\s*$/i.test(prefix)){const id=[...prefix.matchAll(/\[\[P(\d+)\]\]/g)].at(-1)?.[1],named=names[Number(id)],match=named?.player&&corroboration(named.name,event.kind,event.status);if(match){report.events.push({...named.player,kind:event.kind,status:event.status,reportedAt:match.reportedAt,publishedAt:meta.publishedAt,modifiedAt:meta.modifiedAt,observedAt,sourceUrl,sourceText:(prefix.slice(-180)+clause).replace(/\[\[P(\d+)\]\]/g,(_,n)=>names[Number(n)].name),identityVerified:true,effectiveDateSourceUrl:tableUrl});continue;}report.unresolved.push({reason:'RETROSPECTIVE_PLACEMENT_REFERENCE_REQUIRES_EVENT_DATE',text:prefix.slice(-180)+clause});continue;}
  const subject=clause.slice(action[0].length).split(/\b(?:from|off|on|to|with|for)\b/i)[0],ids=[...subject.matchAll(/\[\[P(\d+)\]\]/g)].map(m=>Number(m[1]));
  const residue=subject.replace(/\[\[P\d+\]\]/g,' ').replace(/fullback\/defensive lineman|guard\/tackle|offensive lineman|outside linebacker|wide receiver|running back|tight end|quarterback|cornerback|linebacker|tackle|guard|safety|center|punter|kicker|and|the|[.,\s]/gi,'');
  if(!ids.length||residue){report.unresolved.push({reason:'UNRESOLVED_ACTION_SUBJECT',text:subject});continue;}
  for(const id of ids){const named=names[id];if(!named?.player){report.unresolved.push({reason:'PLAYER_NOT_IN_OFFICIAL_ROSTER',name:named?.name});continue;}
   const match=crossDay&&event.status?corroboration(named.name,event.kind,event.status):null;
   if(crossDay&&event.status&&!match){report.unresolved.push({reason:'NO_UNIQUE_DATED_TABLE_CORROBORATION',name:named.name});continue;}
   report.events.push({...named.player,kind:event.kind,status:event.status||null,reportedAt:match?.reportedAt||meta.publishedAt.slice(0,10),modifiedAt:meta.modifiedAt,effectiveDateSourceUrl:match?tableUrl:null,publishedAt:meta.publishedAt,observedAt,sourceUrl,source:'Chargers Communications official announcement',sourceText:clause.replace(/\[\[P(\d+)\]\]/g,(_,n)=>names[Number(n)].name),identityVerified:true,identityBasis:'EXACT_UNIQUE_NAME_ON_OFFICIAL_ROSTER'});
  }
 }
 report.subjectsComplete=report.unresolved.length===0;return report;
}
module.exports={extractChargersEvents};
