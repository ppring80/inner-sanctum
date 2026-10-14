'use strict';
const {officialUrl}=require('./_official-club-transactions');
function settlementEvents(html,{season,sourceUrl,observedAt}){
 officialUrl(sourceUrl,'NO');const events=[],unresolved=[];
 const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
 if(!tables.length)throw Error('Saints transaction table missing.');
 for(const [,table]of tables)for(const [,row]of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
  const clean=s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if(!cells.length||!/^\d{2}\/\d{2}$/.test(clean(cells[0])))continue;
  const text=clean(cells.slice(1).join(' '));const placement=/^Placed TE .+ and RB .+ on Injured Reserve\.$/.test(text);
  if(!placement&&!/^Reached (?:an )?injury settlements? with /i.test(text))continue;
  const reportedAt=`${season}-${clean(cells[0]).replace('/','-')}`;
  if(!Number.isFinite(Date.parse(observedAt))||!Number.isFinite(Date.parse(reportedAt))||new Date(reportedAt).toISOString().slice(0,10)!==reportedAt||reportedAt>observedAt.slice(0,10))throw Error('Invalid Saints settlement date.');
  const lead=cells.slice(1).join(' ').split(/ and LS |\.\s*Signed /)[0];
  const marked=[],linked=lead.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,(_,href,name)=>{
   const profileUrl=officialUrl(new URL(href,sourceUrl).href,'NO');if(!/^\/team\/players-roster\/[^/]+\/$/.test(new URL(profileUrl).pathname))throw Error('Settlement identity path changed.');
   marked.push({name:clean(name),profileUrl});return ` [[P${marked.length-1}]] `;
  });
  const subject=clean(linked).replace(/^Reached (?:an )?injury settlements? with /i,'').replace(/^Placed /,'').replace(/ on Injured Reserve\.$/,'').replace(/[.]$/,'');
  const matches=[...subject.matchAll(/\b(RB|EDGE|CB|T|TE)\s+\[\[P(\d+)\]\]/g)];
  const residue=subject.replace(/\b(RB|EDGE|CB|T|TE)\s+\[\[P\d+\]\]/g,'').replace(/\band\b|[\s.,]/g,'');
  if(!matches.length||residue||matches.length!==marked.length){unresolved.push({reportedAt,sourceText:text,reason:'SETTLEMENT_SUBJECT_CONTRACT_CHANGED'});continue;}
  for(const m of matches)events.push({...marked[Number(m[2])],position:m[1],team:'NO',season,kind:placement?'RESERVE_PLACEMENT':'DEPARTURE',status:placement?'IR':'DEPARTED',reportedAt,observedAt,publishedAt:null,sourceUrl,source:'New Orleans Saints official transactions',sourceText:text,identityVerified:true});
 }
 return {events,unresolved};
}
module.exports={settlementEvents};
