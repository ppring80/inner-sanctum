'use strict';
const {officialUrl}=require('./_official-club-transactions');
const {canonicalNameKey}=require('../../player-identity');
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Sept:9,Oct:10,Nov:11,Dec:12};
function bootstrapDallas(html,{sourceUrl,season,observedAt,snapshot}){
 officialUrl(sourceUrl,'DAL');if(snapshot.team!=='DAL'||!Number.isFinite(Date.parse(observedAt)))throw Error('Dallas bootstrap inputs incomplete.');
 const events=[],unresolved=[];
 for(const [,row]of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));if(cells.length!==2)continue;
  const date=/^([A-Z][a-z]+)\.\s+(\d{1,2})$/.exec(cells[0]);if(!date||!months[date[1]])continue;
  const reportedAt=`${season}-${String(months[date[1]]).padStart(2,'0')}-${date[2].padStart(2,'0')}`;
  if(new Date(reportedAt).toISOString().slice(0,10)!==reportedAt||reportedAt>observedAt.slice(0,10))throw Error('Dallas bootstrap date invalid.');
  const text=cells[1];let subject;
  const placed=/^(?:Placed|Moved)\s+(.+?)\s+(?:on|to)\s+(?:Reserve\/Injured|injured reserve)(?:\s*\(Designated for Return\))?\.?$/i.exec(text);
  const reverted=/^(.+?)\s+to Reserve\/Injured from Waived\/Injured\.?$/i.exec(text);
  if(placed)subject=placed[1];else if(reverted)subject=reverted[1];else continue;
  const subjects=subject.split(/,|\s+and\s+/i).map(s=>s.trim().replace(/^(?:LB|CB|RB|TE|DT|OL|S|C|G|T)\s+/,''));
  const players=subjects.map(name=>snapshot.rows.filter(p=>canonicalNameKey(p.name)===canonicalNameKey(name)));
  if(players.some(p=>p.length!==1)){unresolved.push({reason:'DALLAS_TABLE_SUBJECT_UNVERIFIED',text});continue;}
  for(const [p] of players)events.push({...p,kind:'RESERVE_PLACEMENT',status:'IR',reportedAt,publishedAt:null,observedAt,sourceUrl,source:'Dallas Cowboys embedded transaction history',sourceText:text,identityVerified:true,identityBasis:'EXACT_UNIQUE_NAME_ON_OFFICIAL_ROSTER',customerEligible:false});
 }
 return {events,unresolved,complete:false,customerEligible:false};
}
module.exports={bootstrapDallas};
